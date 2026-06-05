window.ArmoryUI = (function() {
    const d = window.ArmoryData;
    let rightDragEnabled = true;

    // 工具函数
    function $(sel, root=document) { return root.querySelector(sel); }
    function $all(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }
    function formatDate(ts, locale='zh-CN', short=false) {
        if (!ts && ts !== 0) return '-';
        try {
            const date = new Date(Number(ts));
            if (isNaN(date)) return '-';
            return short ? date.toISOString().split('T')[0] : date.toLocaleString(locale);
        } catch(e) { return '-'; }
    }
    function formatRelativeTime(ts) {
        if (!ts) return '';
        const diff = Math.floor((Date.now() - Number(ts)) / 60000);
        if (diff < 60) return `(${diff}分钟前)`;
        const hours = Math.floor(diff / 60);
        if (hours < 24) return `(${hours}小时前)`;
        return `(${Math.floor(hours / 24)}天前)`;
    }
    function showToast(msg, timeout=3000) {
        let t = document.createElement('div');
        t.className = 'addon-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(()=> t.classList.add('show'), 10);
        setTimeout(()=> { t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, timeout);
    }

    // 拖拽相关状态 (围绕 Right 和 Top)
    let isDragging = false;
    let dragStartX, dragStartY;
    let initialRight, initialTop;

    // 创建 DOM
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'addon-toggle-btn';
    toggleBtn.textContent = '国服英雄榜速查';
    document.body.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.className = 'addon-panel';
    panel.innerHTML = `
        <div class="addon-header">
            <div class="addon-header-top">
                <div class="addon-header-left">
                    <div class="addon-title">国服英雄榜速查</div>
                    <div class="addon-external-links" id="addon-external-links"></div>
                </div>
                <div class="addon-controls">
                    <button class="addon-btn" id="addon-settings-btn">设置</button>
                    <button class="addon-btn" id="addon-refresh">刷新</button>
                    <button class="addon-btn" id="addon-close">收起</button>
                </div>
            </div>
            <div class="addon-login-time" id="addon-login-time"></div>
            
            <div class="addon-settings-popup" id="addon-settings-popup">
               <label><input type="checkbox" id="chk-default-open"> 默认展开面板</label>
               <label><input type="checkbox" id="chk-right-drag"> 按住右键拖动</label>
            </div>
        </div>
        <div class="addon-tabs" id="addon-tabs"></div>
        <div class="addon-subtabs" id="addon-subtabs" style="display:none;"></div>
        <div class="addon-body" id="addon-body"></div>
    `;
    document.body.appendChild(panel);

    const uiRefs = {
        loginTimeEl: $('#addon-login-time', panel),
        tabsContainer: $('#addon-tabs', panel),
        subtabsContainer: $('#addon-subtabs', panel),
        bodyContainer: $('#addon-body', panel),
        externalLinksContainer: $('#addon-external-links', panel),
        settingsPopup: $('#addon-settings-popup', panel),
        chkDefaultOpen: $('#chk-default-open', panel),
        chkRightDrag: $('#chk-right-drag', panel)
    };

    // 事件绑定: 拖拽逻辑
    function initDrag(el) {
        el.addEventListener('mousedown', (e) => {
            if (e.button === 2 && rightDragEnabled) { // 右键拖拽
                isDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;

                const style = window.getComputedStyle(panel);
                initialRight = parseFloat(style.right) || 18;
                initialTop = parseFloat(style.top) || 80;

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        });
    }

    function onMouseMove(e) {
        if (!isDragging) return;
        // 围绕 Right 和 Top 计算
        const deltaX = dragStartX - e.clientX; 
        const deltaY = e.clientY - dragStartY; 
        const newRight = initialRight + deltaX;
        const newTop = initialTop + deltaY;

        toggleBtn.style.right = `${newRight}px`;
        toggleBtn.style.top = `${newTop}px`;
        panel.style.right = `${newRight}px`;
        panel.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        if (isDragging) {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            chrome.storage.local.set({
                addonPosX: parseFloat(panel.style.right),
                addonPosY: parseFloat(panel.style.top)
            });
        }
    }

    // 禁用指定元素的右键菜单
    function preventContext(e) { if (rightDragEnabled) e.preventDefault(); }

    initDrag(toggleBtn);
    initDrag($('#addon-close', panel));
    toggleBtn.addEventListener('contextmenu', preventContext);
    $('#addon-close', panel).addEventListener('contextmenu', preventContext);

    // 面板交互
    toggleBtn.addEventListener('click', () => panel.classList.add('open'));
    $('#addon-close', panel).addEventListener('click', () => panel.classList.remove('open'));
    
    // 设置交互
    $('#addon-settings-btn', panel).addEventListener('click', () => {
        uiRefs.settingsPopup.classList.toggle('open');
    });
    uiRefs.chkDefaultOpen.addEventListener('change', e => chrome.storage.local.set({ defaultOpen: e.target.checked }));
    uiRefs.chkRightDrag.addEventListener('change', e => {
        rightDragEnabled = e.target.checked;
        chrome.storage.local.set({ rightDrag: e.target.checked });
    });

    // 渲染方法集 (完美还原原始文字说明)
    const render = {
        raidTable: function(cfg, raidsData, achievementsData, findInst, findMythic, findProg, findAch) {
            const inst = cfg.instanceId ? findInst(raidsData, cfg.instanceId) : null;
            const mode = inst ? findMythic(inst.modes || []) : null;
            const allFirstDates = [];
            let hasAny = false;

            const allBossData = cfg.bosses.map(b => {
                let currentMode = mode;
                if (b.instanceId) {
                    const bInst = findInst(raidsData, b.instanceId);
                    currentMode = bInst ? findMythic(bInst.modes || []) : null;
                }
                const prog = currentMode ? findProg(currentMode, b.encounterId) : null;
                const kills = prog ? (prog.completed_count ?? 0) : 0;
                const lastKill = prog ? (prog.last_kill_timestamp ?? null) : null;
                const achEntry = findAch(achievementsData, b.achId);
                const firstKill = achEntry ? (achEntry.completed_timestamp ?? null) : null;

                if (kills > 0 || firstKill) hasAny = true;
                if (firstKill && (!cfg.colorDeadline || firstKill <= cfg.colorDeadline)) {
                    allFirstDates.push(formatDate(firstKill, 'zh-CN', true));
                }
                return { name: b.name, kills, lastKill, firstKill };
            });

            if (!hasAny) return `<div class="addon-small" style="margin-bottom:8px;">未检测到此角色的史诗难度击杀记录，也未检测到其战网的最高进度成就。</div>`;

            const dateCounts = allFirstDates.reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
            const redDates = Object.keys(dateCounts).filter(d => dateCounts[d] > 1);

            let html = `<table class="addon-table"><thead><tr><th style="width:35%">首领（史诗难度）</th><th style="width:20%">击杀次数</th><th style="width:22.5%">最后击杀</th><th style="width:22.5%">首次击杀</th></tr></thead><tbody>`;
            html += allBossData.map(r => {
                let killsHtml = r.kills > 0 ? r.kills : (r.firstKill ? '<span class="addon-small">无记录</span>' : '-');
                let lastHtml = r.kills > 0 ? escapeHtml(formatDate(r.lastKill)) : (r.firstKill ? '<span class="addon-small">无记录</span>' : '-');
                let firstHtml = '-';
                if (r.firstKill) {
                    firstHtml = escapeHtml(formatDate(r.firstKill));
                    if (redDates.includes(formatDate(r.firstKill, 'zh-CN', true))) firstHtml = `<span class="addon-date-red">${firstHtml}</span>`;
                }
                return `<tr><td>${escapeHtml(r.name)}</td><td>${killsHtml}</td><td>${lastHtml}</td><td>${firstHtml}</td></tr>`;
            }).join('');
            html += `</tbody></table><div class="addon-small" style="margin-top:8px">*首次击杀时间取自英雄榜成就，为角色所属战网帐号/战团的最早完成时间，可能并非角色本身完成。击杀次数和最后击杀时间为角色本身数据。</div>`;
            return html;
        },

        resilienceTable: function(achList, achievementsData, findAch) {
            const rows = achList.map(a => {
                const ent = findAch(achievementsData, a.id);
                return { level: a.level, ts: ent ? ent.completed_timestamp : null };
            }).filter(r => r.ts);

            if (rows.length === 0) return `<div class="addon-small">未检测到该分类下的坚韧钥石成就</div>`;

            const dateCounts = rows.map(r => formatDate(r.ts, 'zh-CN', true)).reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
            const redDates = Object.keys(dateCounts).filter(d => dateCounts[d] > 1);
            rows.sort((a, b) => b.level - a.level);

            let html = `<table class="addon-table"><thead><tr><th style="width:40%">坚韧等级</th><th style="width:60%">完成时间</th></tr></thead><tbody>`;
            html += rows.map(r => {
                let timeHtml = escapeHtml(formatDate(r.ts));
                if (redDates.includes(formatDate(r.ts, 'zh-CN', true))) timeHtml = `<span class="addon-date-red">${timeHtml}</span>`;
                return `<tr><td>+${r.level}</td><td>${timeHtml}</td></tr>`;
            }).join('');
            html += `</tbody></table><div class="addon-small" style="margin-top:8px">*完成时间取自英雄榜成就，为角色所属战网帐号/战团完成的最早完成时间，可能并非角色本身完成，建议结合角色史诗钥石分数和进度一并判断</div>`;
            return html;
        },

        warbandTable: function(achievementsData, loginTime, findAch) {
            let html = '';
            if (loginTime && ((Date.now() - Number(loginTime)) / 86400000) > 30) {
                html += `<div style="font-size:12px; color:#ff8a8a; margin-bottom:10px; padding:6px 8px; border:1px solid rgba(255,138,138,0.2); border-radius:4px; background:rgba(255,138,138,0.05);">当前角色已超过30天未登录游戏，其英雄榜成就/成就点数、宠物/坐骑数据无法及时更新，可能并非最新状态。</div>`;
            }

            let hasAny = false, isFirst = true;
            const collapsibles = ['装备升级', '钥石胜利者', '特色更新', '战团导师：至暗之夜', '至暗之夜专业', 'S1地下城传送'];

            d.WARBAND_ACHIEVEMENTS.forEach((cat, index) => {
                let comp = [], uncomp = [];
                cat.list.forEach(a => {
                    const ent = findAch(achievementsData, a.id);
                    if (ent && ent.completed_timestamp) comp.push({ ...a, ts: ent.completed_timestamp, done: true });
                    else uncomp.push({ ...a, ts: null, done: false });
                });

                if (comp.length > 0) {
                    hasAny = true;
                    comp.sort((a, b) => b.ts - a.ts);
                    let catTitle = escapeHtml(cat.name);
                    const isCol = collapsibles.includes(cat.name);
                    let toggleIcon = '';

                    if (isCol) {
                        let counter = comp.length === cat.list.length ? `<span style="color:#4caf50;">(${comp.length}/${cat.list.length})</span>` : `(<span class="addon-date-red">${comp.length}</span>/${cat.list.length})`;
                        catTitle += ` ${counter}`;
                        toggleIcon = `<span class="toggle-icon" style="font-size: 10px; color: #888;">▶</span>`;
                    }

                    let extraStyle = isCol ? "cursor: pointer; display: flex; justify-content: space-between; align-items: center;" : "";
                    html += `<div class="addon-raid-header ${isCol ? 'collapsible-header' : ''}" style="margin-top: ${isFirst ? '0' : '10px'}; ${extraStyle}" data-target="wb-cat-${index}"><span>${catTitle}</span>${toggleIcon}</div>`;
                    isFirst = false;

                    html += `<div id="wb-cat-${index}" style="${isCol ? 'display:none;' : ''}"><table class="addon-table"><tbody>`;
                    (isCol ? comp.concat(uncomp) : comp).forEach(c => {
                        if (c.done) html += `<tr><td style="width:40%">${escapeHtml(c.name)}</td><td style="width:60%">${escapeHtml(formatDate(c.ts))}</td></tr>`;
                        else html += `<tr><td style="width:40%; color:#888;">${escapeHtml(c.name)}</td><td style="width:60%"><span class="addon-small">未完成</span></td></tr>`;
                    });
                    html += `</tbody></table></div>`;
                }
            });

            if (!hasAny && !loginTime) return `<div class="addon-small">未检测到相关的战团成就记录。</div>`;
            return html;
        }
    };

    return { toggleBtn, panel, uiRefs, render, formatDate, formatRelativeTime, escapeHtml, showToast };
})();