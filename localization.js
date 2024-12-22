document.addEventListener('DOMContentLoaded', () => {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
        const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
        if (message) {
            element.textContent = message;
        }
    });

    // Replace alert messages in script.js
    const originalAlert = window.alert;
    window.alert = function(messageKey, ...args) {
        const message = chrome.i18n.getMessage(messageKey, args);
        originalAlert(message);
    };
});