chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FETCH_API') {
        fetch(request.url, {
            headers: { 'Accept': 'application/json' }
        })
        .then(res => {
            if (!res.ok) throw new Error(`API 请求失败: ${res.status} ${res.statusText}`);
            return res.json();
        })
        .then(data => sendResponse({ success: true, data: data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true; // 保持异步通信通道开启
    }
});