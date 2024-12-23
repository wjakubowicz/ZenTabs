document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['language'], (result) => {
        const currentLang = result.language || 'en';
        fetch(chrome.runtime.getURL(`_locales/${currentLang}/messages.json`))
            .then(res => res.json())
            .then(messages => {
                const elements = document.querySelectorAll('[data-i18n]');
                elements.forEach(el => {
                    const key = el.getAttribute('data-i18n');
                    if (messages[key]) {
                        el.textContent = messages[key].message;
                    }
                });
                // Override default alerts with i18n
                const originalAlert = window.alert;
                window.alert = function(messageKey, ...args) {
                    const message = chrome.i18n.getMessage(messageKey, args);
                    originalAlert(message);
                };
            })
    });
});