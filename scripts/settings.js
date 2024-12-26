(() => {
    const LANGUAGES = {
        en: "English",
        pl: "Polski"
    };

    const applyDarkMode = (enable) => document.body.classList.toggle("dark-mode", !!enable);

    const initialize = () => {
        const darkModeToggle = document.getElementById("darkModeToggle");
        const languageSelect = document.getElementById("languageSelect");
        const popupWidthRange = document.getElementById("popupWidthRange");
        const popupWidthValue = document.getElementById("popupWidthValue");

        // Populate language dropdown
        if (languageSelect) {
            Object.entries(LANGUAGES).forEach(([code, name]) => {
                const option = document.createElement("option");
                option.value = code;
                option.textContent = name;
                languageSelect.appendChild(option);
            });
        }

        // Load storage values
        chrome.storage.sync.get(["darkMode", "language", "popupWidth"], (res) => {
            if (darkModeToggle) {
                darkModeToggle.checked = !!res.darkMode;
                applyDarkMode(res.darkMode);
            }
            const lang = res.language || (LANGUAGES[navigator.language.split("-")[0]] ? navigator.language.split("-")[0] : "en");
            chrome.storage.sync.set({ language: lang });
            if (languageSelect) languageSelect.value = lang;

            if (popupWidthRange && popupWidthValue) {
                const width = res.popupWidth || 380;
                popupWidthRange.value = width;
                popupWidthValue.textContent = `${width} px`;
            }
        });

        // Event listeners
        languageSelect?.addEventListener("change", () => {
            chrome.storage.sync.set({ language: languageSelect.value }, () => location.reload());
        });

        darkModeToggle?.addEventListener("change", () => {
            const isDark = darkModeToggle.checked;
            chrome.storage.sync.set({ darkMode: isDark }, () => applyDarkMode(isDark));
        });

        if (popupWidthRange && popupWidthValue) {
            popupWidthRange.addEventListener("input", () => {
                const value = `${popupWidthRange.value} px`;
                popupWidthValue.textContent = value;
                chrome.storage.sync.set({ popupWidth: popupWidthRange.value });
            });
        }

        // Listen for storage changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "sync" && changes.darkMode) {
                applyDarkMode(changes.darkMode.newValue);
            }
        });
    };

    chrome.storage.sync.get(["darkMode"], (r) => {
        if (r.darkMode) applyDarkMode(true);
    });

    document.addEventListener("DOMContentLoaded", initialize);
})();