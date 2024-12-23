(() => {
    // Available languages map
    const LANGUAGES = {
        'en': 'English',
        'pl': 'Polski'
    };

    // Apply dark mode based on saved preference
    chrome.storage.sync.get(['darkMode'], (result) => {
        if (result.darkMode) {
            document.body.classList.add('dark-mode');
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const darkModeToggle = document.getElementById('darkModeToggle');
        const languageSelect = document.getElementById('languageSelect');
        if (!languageSelect) return; // Add guard

        // Populate language dropdown
        Object.entries(LANGUAGES).forEach(([code, name]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            languageSelect.appendChild(option);
        });

        // Load saved dark mode preference and language
        chrome.storage.sync.get(['darkMode', 'language'], (result) => {
            if (darkModeToggle) {
                darkModeToggle.checked = result.darkMode || false;
                toggleDarkMode(result.darkMode || false);
            }

            let storedLang = result.language;
            if (!storedLang) {
                const browserLang = navigator.language.split('-')[0];
                storedLang = LANGUAGES[browserLang] ? browserLang : 'en';
                chrome.storage.sync.set({ language: storedLang });
            }
            languageSelect.value = storedLang;
        });

        // Save language changes
        languageSelect.addEventListener('change', () => {
            chrome.storage.sync.set({ language: languageSelect.value }, () => {
                location.reload(); // Reload to apply new language
            });
        });

        // Add event listener to toggle dark mode
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', () => {
                const isDarkMode = darkModeToggle.checked;
                chrome.storage.sync.set({ darkMode: isDarkMode }, () => {
                    toggleDarkMode(isDarkMode);
                });
            });
        }

        // Listen for storage changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync') {
                if (changes.darkMode) {
                    toggleDarkMode(changes.darkMode.newValue);
                }
            }
        });
    });

    function toggleDarkMode(enable) {
        if (enable) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }
})();