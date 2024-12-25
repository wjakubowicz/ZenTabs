(() => {
    chrome.runtime.onInstalled.addListener(() => {
        chrome.action.onClicked.addListener((tab) => {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['script.js']
            });
        });
    });

    const extensionID = chrome.i18n.getMessage('@@extension_id');

    console.log('Background event page starting...');
    console.log('Extension ID =', extensionID);

    let shuffle = false;
    const moveDelay = 10;  // ms
    let tabCount = null;

    // trimPrefix trims the given prefix from the given string.
    function trimPrefix(s, prefix) {
        return s.startsWith(prefix) ? s.slice(prefix.length) : s;
    }

    // lexHost returns a string for sorting hostnames lexicographically.
    function lexHost(url) {
        const u = new URL(url);
        let parts = u.host.split('.').reverse();
        if (parts.length > 1) parts = parts.slice(1);
        return parts.join('.');
    }

    // lexScheme returns a string for sorting schemes lexicographically.
    function lexScheme(url) {
        const u = new URL(url);
        switch (u.protocol) {
            case 'http:':
            case 'https:':
                return 'http:';
            case 'chrome:':
            case 'file:':
                return '~' + u.protocol;
            default:
                return u.protocol;
        }
    }

    // lexTab returns a string for sorting tabs lexicographically.
    function lexTab(tab) {
        const pieces = [];
        if (shuffle) pieces.push(Math.random());
        pieces.push(tab.pinned ? 'pin:0(yes):' + tab.index : 'pin:1(no)');
        pieces.push(lexScheme(tab.url));
        pieces.push(lexHost(tab.url));
        pieces.push(tab.title.toLowerCase());
        return pieces.join(' ! ');
    }

    // extractDomain extracts all tabs with the active tab's domain into a new window and then sorts them.
    function extractDomain() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            const target = lexHost(tab.url);

            chrome.windows.create({ tabId: tab.id, focused: true }, (win) => {
                chrome.tabs.query({ windowType: 'normal' }, (tabs) => {
                    tabs.forEach((tab) => {
                        if (lexHost(tab.url) === target) {
                            chrome.tabs.move(tab.id, { windowId: win.id, index: -1 });
                        }
                    });

                    setTimeout(() => {
                        chrome.windows.get(win.id, { windowTypes: ['normal'], populate: true }, sortWindow);
                    }, moveDelay);
                });
            });
        });
    }

    function logWindow(windowId) {
        chrome.tabs.query({ windowId }, (tabs) => {
            console.log('Tabs (after reposition):');
            tabs.forEach((tab, i) => console.log(i, lexTab(tab)));
        });
    }

    function moveNextTab(win, tabs, i, inserted) {
        if (i >= tabs.length) {
            console.log('Finished sorting window', win.id, '; tabs are now:');
            logWindow(win.id);
            return;
        }

        const tab = tabs[i];
        if (tab.pinned) {
            console.log('Pinned', tab.id, 'at', tab.index, 'to', i, lexTab(tab));
            setTimeout(moveNextTab, 0, win, tabs, i + 1, inserted);
            return;
        }
        if (i === tab.index + inserted) {
            console.log('No action for', tab.id, 'at', tab.index, '+', inserted, lexTab(tab));
            setTimeout(moveNextTab, 0, win, tabs, i + 1, inserted);
            return;
        }

        console.log('Moving', tab.id, 'from', tab.index, 'to', i, lexTab(tab));
        chrome.tabs.move(tab.id, { index: i }, () => {
            setTimeout(moveNextTab, moveDelay, win, tabs, i + 1, inserted + 1);
        });
    }

    function sortWindow(win) {
        console.log('Sorting window:', win.id);

        const tabs = win.tabs;
        console.log('Tabs (before sorting):');
        tabs.forEach((tab, i) => console.log(i, lexTab(tab)));

        tabs.sort((a, b) => lexTab(a).localeCompare(lexTab(b)));
        setTimeout(moveNextTab, 0, win, tabs, 0, 0);
    }

    // sortByMode sorts the tabs based on the given mode.
    function sortByMode(mode) {
        const q = { windowTypes: ['normal'], populate: true };

        console.log('Sorting tabs:', mode);
        switch (mode) {
            case 'all':
                chrome.windows.getAll(q, (windows) => windows.forEach(sortWindow));
                break;
            case 'window':
                chrome.windows.getLastFocused(q, sortWindow);
                break;
            case 'domain':
                extractDomain();
                break;
        }
    }

    // handleMessage handles an incoming message from the app.
    function handleMessage(message, sender, respond) {
        const { action, args } = message;

        console.log(action, '(', args, ')');
        switch (action) {
            case 'sort':
                sortByMode(...args);
                respond({ status: 'sorting started' });
                break;
            default:
                console.log('Unhandled message:', message);
                respond({ status: 'unhandled action' });
                break;
        }
    }

    chrome.tabs.onCreated.addListener(() => {
        chrome.tabs.query({}, (tabs) => {
            tabCount = tabs.length;
            chrome.action.setBadgeText({ text: tabCount.toString() });
        });
    });

    chrome.tabs.onRemoved.addListener(() => {
        chrome.tabs.query({}, (tabs) => {
            tabCount = tabs.length;
            chrome.action.setBadgeText({ text: tabCount.toString() });
        });
    });

    chrome.tabs.query({}, (tabs) => {
        tabCount = tabs.length;
        chrome.action.setBadgeText({ text: tabCount.toString() });
    });

    chrome.runtime.onMessage.addListener(handleMessage);

    chrome.commands.onCommand.addListener((command) => {
        if (command === "sort_all_tabs") {
            sortAllTabs();
        } else if (command === "sort_current_window") {
            sortCurrentWindowTabs();
        } else if (command === "close_duplicates") {
            closeDuplicateTabs();
        }
    });

    const sortAllTabs = () => {
        chrome.windows.getAll({ populate: true }, (windows) => {
            windows.forEach((window) => {
                sortTabs(window.tabs, window.id);
            });
        });
    };

    const sortCurrentWindowTabs = () => {
        chrome.windows.getCurrent({ populate: true }, (window) => {
            sortTabs(window.tabs, window.id);
        });
    };

    const sortTabs = (tabs, windowId) => {
        const sortedTabs = tabs.slice().sort((a, b) => a.title.localeCompare(b.title));
        sortedTabs.forEach((tab, index) => {
            chrome.tabs.move(tab.id, { index: index }, () => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                }
            });
        });
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
                chrome.tabs.remove(tab.id, () => {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError);
                    }
                });
            });
            chrome.notifications.create({
                type: 'basic',
                iconUrl: '128icon.png',
                title: chrome.i18n.getMessage('extension_name'),
                message: chrome.i18n.getMessage('closed_duplicates_alert', duplicates.length.toString()),
            });
        });
    };
})();