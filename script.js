(() => {
    let targetWindow = null;
    let tabCount = 0;

    const start = () => {
        chrome.windows.getCurrent(getWindows);
    };

    const getWindows = (win) => {
        targetWindow = win;
        chrome.tabs.query({ windowId: targetWindow.id }, getTabs);
    };

    const getTabs = (tabs) => {
        tabCount = tabs.length;
        chrome.windows.getAll({ populate: true }, expTabs);
    };

    const expTabs = (windows) => {
        const numWindows = windows.length;
        const inclAllElement = document.getElementById('inclAll');
        const exportAll = inclAllElement ? (inclAllElement.checked ? 1 : 0) : 0;
        const contentElement = document.getElementById('content');
        if (contentElement) {
            contentElement.value = '';
        } else {
            return;
        }
        for (let i = 0; i < numWindows; i++) {
            const win = windows[i];
            if (targetWindow.id === win.id || exportAll === 1) {
                const numTabs = win.tabs.length;
                for (let j = 0; j < numTabs; j++) {
                    const tab = win.tabs[j];
                    const inclTitleElement = document.getElementById('inclTitle');
                    if (inclTitleElement && inclTitleElement.checked) {
                        contentElement.value += `${tab.title}\n`;
                    }
                    contentElement.value += `${tab.url}\n\n`;
                }
            }
        }
    };

    const openTabs = () => {
        const content = document.getElementById('content').value;
        const rExp = new RegExp(
            "(^|[ \t\r\n])((ftp|http|https|news|file|view-source|chrome):(([A-Za-z0-9$_.+!*(),;/?:@&~=-])|%[A-Fa-f0-9]{2}){2,}(#([a-zA-Z0-9][a-zA-Z0-9$_.+!*(),;/?:@&~=%-]*))?([A-Za-z0-9$_+!*();/?:~-])*)",
            "g"
        );
        const newTabs = content.match(rExp);
        if (newTabs) {
            newTabs.forEach(nt => {
                chrome.tabs.create({ url: nt, active: false });
            });
        } else {
            alert('only_fully_qualified');
        }
    };

    const download = () => {
        const content = document.getElementById('content').value;
        const contentArr = content.split('\n\n');
        let data = '<html><head></head><body>';
        contentArr.forEach(contentItem => {
            const contentUrl = contentItem.split('\n');
            if (document.getElementById('inclTitle').checked) {
                data += `<a href="${contentUrl[1]}">${contentUrl[0]}</a><br/>`;
            } else {
                data += `<a href="${contentItem}">${contentItem}</a><br/>`;
            }
        });
        data += '</body></html>';

        const blob = new Blob([data], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.download = "tabs.html";
        a.href = url;
        a.click();
    };

    const findDuplicateTabs = (tabs) => {
        const tabUrls = new Set();
        const duplicateTabs = [];

        tabs.forEach(tab => {
            if (tabUrls.has(tab.url)) {
                duplicateTabs.push(tab);
            } else {
                tabUrls.add(tab.url);
            }
        });

        return duplicateTabs;
    };

    const closeDuplicateTabs = () => {
        chrome.tabs.query({}, (tabs) => {
            const duplicates = findDuplicateTabs(tabs);
            duplicates.forEach(tab => {
                chrome.tabs.remove(tab.id);
            });
            alert('closed_duplicates_alert', duplicates.length.toString());
        });
    };

    const setup = ($) => {
        $('.btn').each(function() {
            const $button = $(this);
            const action = $button.attr('id');
            $button.click(function() {
                console.log('Action:', action);
                if (action === 'closeDuplicates') {
                    closeDuplicateTabs();
                } else if (action === 'settingsBtn') {
                    chrome.runtime.openOptionsPage();
                } else {
                    chrome.runtime.sendMessage(
                        {
                            'action': 'sort',
                            'args': [action],
                        },
                        function(response) {
                            if (chrome.runtime.lastError) {
                                console.error('Error:', chrome.runtime.lastError.message);
                            } else {
                                console.log('Sort complete; closing popup');
                                window.close();
                            }
                        }
                    );
                }
            });
            console.log('Registered action:', action);
        });
    };

    const init = () => {
        const btOpenTabs = document.querySelector('#btOpenTabs');
        if (btOpenTabs) {
            btOpenTabs.addEventListener('click', openTabs);
        }
        const inclTitle = document.querySelector('#inclTitle');
        if (inclTitle) {
            inclTitle.addEventListener('click', start);
        }
        const inclAll = document.querySelector('#inclAll');
        if (inclAll) {
            inclAll.addEventListener('click', start);
        }
        const downloadBtn = document.querySelector('#download');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', download);
        }
        start();
        feather.replace();
    };

    document.addEventListener('DOMContentLoaded', init);
    jQuery(setup);
})();