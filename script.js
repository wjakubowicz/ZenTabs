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
        const exportAll = document.getElementById('inclAll').checked ? 1 : 0;
        const contentElement = document.getElementById('content');
        contentElement.value = '';
        for (let i = 0; i < numWindows; i++) {
            const win = windows[i];
            if (targetWindow.id === win.id || exportAll === 1) {
                const numTabs = win.tabs.length;
                for (let j = 0; j < numTabs; j++) {
                    const tab = win.tabs[j];
                    if (document.getElementById('inclTitle').checked) {
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
            alert('Only fully qualified URLs will be opened.');
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
            alert(`Closed ${duplicates.length} duplicate tabs.`);
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
        document.querySelector('#btOpenTabs').addEventListener('click', openTabs);
        document.querySelector('#inclTitle').addEventListener('click', start);
        document.querySelector('#inclAll').addEventListener('click', start);
        document.querySelector('#download').addEventListener('click', download);
        start();
    };

    document.addEventListener('DOMContentLoaded', init);
    jQuery(setup);
})();