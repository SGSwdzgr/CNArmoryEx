(function() {
    const Data = window.ArmoryData;
    const UI = window.ArmoryUI;
    const { toggleBtn, panel, uiRefs, render } = UI;

    let lastFetched = { token: null, raids: null, achievements: null, mounts: null, pets: null, indexData: null, charKey: null };

    // 初始化读取本地配置 (包含新增的设置项逻辑)
    chrome.storage.local.get({
        addonPosX: 18,
        addonPosY: 80,
        defaultOpen: false, 
        rightDrag: true
    }, (res) => {
        toggleBtn.style.right = `${res.addonPosX}px`;
        toggleBtn.style.top = `${res.addonPosY}px`;
        panel.style.right = `${res.addonPosX}px`;
        panel.style.top = `${res.addonPosY}px`;
        
        uiRefs.chkDefaultOpen.checked = res.defaultOpen;
        uiRefs.chkRightDrag.checked = res.rightDrag;
        if (res.defaultOpen && checkValidPage()) panel.classList.add('open');
    });

    // 页面合法性检测 (利用你原版的退出逻辑来隐藏按钮)
    function checkValidPage() {
        const href = location.href;
        if (href === 'https://wow.blizzard.cn/character/#/' || href === 'https://wow.blizzard.cn/character/404/' ||
            href.startsWith('https://wow.blizzard.cn/character/#/search?q=') || href.startsWith('https://wow.blizzard.cn/character/classic/')) {
            toggleBtn.style.display = 'none';
            panel.classList.remove('open');
            return false;
        }
        toggleBtn.style.display = 'block';
        return true;
    }
    window.addEventListener('hashchange', () => setTimeout(() => { if (checkValidPage()) doFullRefresh(true); }, 300));

    // 查数据相关
    function parseCharacter() {
        try {
            const parts = (location.hash || '').split('?')[0].replace(/^#\/?/, '').split('/');
            return parts.length >= 2 ? { realm_slug: decodeURIComponent(parts[0]), role_name: decodeURIComponent(parts[1]) } : null;
        } catch(e) { return null; }
    }

    function fetchApi(url) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'FETCH_API', url: url }, response => {
                if (chrome.runtime.lastError) reject(new Error('通信失败: ' + chrome.runtime.lastError.message));
                else if (!response.success) reject(new Error(response.error));
                else resolve(response.data);
            });
        });
    }

    function findInst(raids, id) {
        if (!raids?.data?.expansions) return null;
        for (const exp of raids.data.expansions) {
            for (const inst of (exp.instances || [])) if (Number(inst.instance?.id) === Number(id)) return inst;
        } return null;
    }
    function findMythic(modes) { return modes.find(m => m.difficulty?.type === 'MYTHIC') || null; }
    function findProg(mode, id) { return mode?.progress?.encounters?.find(e => Number(e.encounter?.id) === Number(id)) || null; }
    function findAch(achs, id) { return achs?.data?.achievements?.find(a => Number(a.id) === Number(id) || Number(a.achievement?.id) === Number(id)) || null; }

    // 刷新和渲染主逻辑
    async function showTabContent(tabDef) {
        uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">加载中...</div>`;
        try {
            if (!lastFetched.raids || !lastFetched.achievements) throw new Error('内部错误：缺失团本或成就数据，请点击"刷新"重试。');
            
            if (tabDef.type === 'raid') {
                uiRefs.bodyContainer.innerHTML = render.raidTable(tabDef.cfg, lastFetched.raids, lastFetched.achievements, findInst, findMythic, findProg, findAch);
            } else if (tabDef.type === 'resilience') {
                uiRefs.bodyContainer.innerHTML = render.resilienceTable(tabDef.cfg, lastFetched.achievements, findAch);
            } else if (tabDef.type === 'warband') {
                const loginTime = lastFetched.indexData?.character_summary?.last_login_timestamp;
                uiRefs.bodyContainer.innerHTML = render.warbandTable(lastFetched.achievements, loginTime, findAch);
                
                // 绑定战团折叠事件
                uiRefs.bodyContainer.querySelectorAll('.collapsible-header').forEach(h => {
                    h.addEventListener('click', function() {
                        const content = document.getElementById(this.getAttribute('data-target'));
                        const icon = this.querySelector('.toggle-icon');
                        if (content.style.display === 'none') { content.style.display = 'block'; if (icon) icon.textContent = '▼'; }
                        else { content.style.display = 'none'; if (icon) icon.textContent = '▶'; }
                    });
                });
            }
        } catch (e) { uiRefs.bodyContainer.innerHTML = `<div class="addon-error">${UI.escapeHtml(e.message)}</div>`; }
    }

    // Tabs 逻辑结构
    const tabDefs = [
        { key: 'midnight_s1', label: '至暗之夜S1', type: 'raid', cfg: Data.S1_RAIDS[0] },
        { key: 'resilience_s1', label: '坚韧钥石', type: 'resilience', cfg: Data.S1_RESILIENCE },
        { key: 'tww_s3', label: '地心之战S3', type: 'group', subTabs: [
            { key: 'raid_omega', label: '法力熔炉：欧米伽', type: 'raid', cfg: Data.S3_RAIDS[0] },
            { key: 'resilience_s3', label: 'S3坚韧钥石', type: 'resilience', cfg: Data.S3_RESILIENCE }
        ]},
        { key: 'warband_ach', label: '战团成就', type: 'warband' }
    ];

    let activeSubDef = null;
    tabDefs.forEach((t, i) => {
        const btn = document.createElement('div');
        btn.className = 'addon-tab' + (i===0 ? ' active' : '');
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
            uiRefs.tabsContainer.querySelectorAll('.addon-tab').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            handleTabClick(t);
        });
        uiRefs.tabsContainer.appendChild(btn);
    });

    function handleTabClick(t, subKey = null) {
        if (t.type === 'group') {
            uiRefs.subtabsContainer.style.display = 'flex';
            uiRefs.subtabsContainer.innerHTML = '';
            let target = t.subTabs[0];
            t.subTabs.forEach((sub, j) => {
                const subBtn = document.createElement('div');
                subBtn.className = 'addon-subtab';
                if (subKey === sub.key || (!subKey && j === 0)) { subBtn.classList.add('active'); target = sub; }
                subBtn.textContent = sub.label;
                subBtn.addEventListener('click', () => {
                    uiRefs.subtabsContainer.querySelectorAll('.addon-subtab').forEach(x => x.classList.remove('active'));
                    subBtn.classList.add('active');
                    activeSubDef = sub; showTabContent(sub);
                });
                uiRefs.subtabsContainer.appendChild(subBtn);
            });
            activeSubDef = target; showTabContent(target);
        } else {
            uiRefs.subtabsContainer.style.display = 'none';
            activeSubDef = null; showTabContent(t);
        }
    }

    async function getTokenAndData(char, doRefresh) {
        const charKey = `${char.realm_slug}||${char.role_name}`;
        if (doRefresh || lastFetched.charKey !== charKey || !lastFetched.token) {
            uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">获取 token ...</div>`;
            const indexRes = await fetchApi(`https://webapi.blizzard.cn/wow-armory-server/api/index?realm_slug=${encodeURIComponent(char.realm_slug)}&role_name=${encodeURIComponent(char.role_name)}`);
            if (!indexRes?.data?.token) throw new Error('未获取到token，可尝试先访问一次自己的英雄榜页面');
            lastFetched = { token: indexRes.data.token, charKey, indexData: indexRes.data, raids: null, achievements: null, mounts: null, pets: null };
        }
        if (!lastFetched.raids || doRefresh) { uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">获取团本数据 ...</div>`; lastFetched.raids = await fetchApi(`https://webapi.blizzard.cn/wow-armory-server/api/do?api=raids&token=${lastFetched.token}`); }
        if (!lastFetched.achievements || doRefresh) { uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">获取成就数据 ...</div>`; lastFetched.achievements = await fetchApi(`https://webapi.blizzard.cn/wow-armory-server/api/do?api=character_achievement&token=${lastFetched.token}`); }
        if (!lastFetched.mounts || doRefresh) { uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">获取坐骑数据 ...</div>`; lastFetched.mounts = await fetchApi(`https://webapi.blizzard.cn/wow-armory-server/api/do?api=mounts&token=${lastFetched.token}`); }
        if (!lastFetched.pets || doRefresh) { uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">获取宠物数据 ...</div>`; lastFetched.pets = await fetchApi(`https://webapi.blizzard.cn/wow-armory-server/api/do?api=pets&token=${lastFetched.token}`); }
        
        const loginTime = lastFetched.indexData?.character_summary?.last_login_timestamp;
        uiRefs.loginTimeEl.innerHTML = `坐骑：<span style="color:#ddd">${lastFetched.mounts?.data?.now??0}</span> &nbsp;|&nbsp; 宠物：<span style="color:#ddd">${lastFetched.pets?.data?.now??0}</span> &nbsp;|&nbsp; ${loginTime ? `角色上次登录：${UI.formatDate(loginTime)} ${UI.formatRelativeTime(loginTime)}` : '角色上次登录：无法获取'}`;
        
        const slug = char.realm_slug.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
        uiRefs.externalLinksContainer.innerHTML = [
            {n:'Raider.IO', u:`https://raider.io/cn/characters/cn/${slug}/${char.role_name}`},
            {n:'Warcraft Logs', u:`https://cn.warcraftlogs.com/character/cn/${slug}/${char.role_name}`}
        ].map(l => `<a href="${l.u}" target="_blank">${l.n}</a>`).join('');
    }

    async function doFullRefresh(force=false) {
        const char = parseCharacter();
        if (!char) {
            uiRefs.bodyContainer.innerHTML = `<div class="addon-error">请在角色英雄榜页面打开（示例：https://wow.blizzard.cn/character/#/{服务器}/{角色名}）。</div>`;
            return;
        }
        try {
            uiRefs.bodyContainer.innerHTML = `<div class="addon-loading">正在刷新数据...</div>`;
            await getTokenAndData(char, force);
            const activeTab = document.querySelector('.addon-tab.active');
            handleTabClick(tabDefs[Array.from(activeTab.parentNode.children).indexOf(activeTab)] || tabDefs[0], activeSubDef?.key);
            if (force) UI.showToast('数据已刷新');
        } catch(e) { uiRefs.bodyContainer.innerHTML = `<div class="addon-error">${UI.escapeHtml(e.message)}</div>`; }
    }

    document.getElementById('addon-refresh').addEventListener('click', () => doFullRefresh(true));

    if (checkValidPage()) {
        setTimeout(() => {
            handleTabClick(tabDefs[0]);
            doFullRefresh(false);
        }, 600);
    }
})();