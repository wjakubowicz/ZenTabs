(() => {
    const LANGUAGES = {
        en: "English",
        pl: "Polski"
    };

    // Pre-apply dark mode from storage
    chrome.storage.sync.get(["darkMode"], (r) => {
        if (r.darkMode) document.body.classList.add("dark-mode");
    });

    document.addEventListener("DOMContentLoaded", () => {
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
                toggleDarkMode(res.darkMode);
            }
            let lang = res.language;
            if (!lang) {
                const browserLang = navigator.language.split("-")[0];
                lang = LANGUAGES[browserLang] ? browserLang : "en";
                chrome.storage.sync.set({ language: lang });
            }
            if (languageSelect) languageSelect.value = lang;

            if (popupWidthRange && popupWidthValue) {
                popupWidthRange.value = res.popupWidth || 380;
                popupWidthValue.textContent = popupWidthRange.value + " px";
            }
        });

        // Language change
        if (languageSelect) {
            languageSelect.addEventListener("change", () => {
                chrome.storage.sync.set({ language: languageSelect.value }, () => location.reload());
            });
        }

        // Dark mode toggle
        if (darkModeToggle) {
            darkModeToggle.addEventListener("change", () => {
                const isDark = darkModeToggle.checked;
                chrome.storage.sync.set({ darkMode: isDark }, () => toggleDarkMode(isDark));
            });
        }

        // Popup width range
        if (popupWidthRange && popupWidthValue) {
            popupWidthRange.addEventListener("input", () => {
                popupWidthValue.textContent = popupWidthRange.value + " px";
                chrome.storage.sync.set({ popupWidth: popupWidthRange.value });
            });
        }

        // Listen for storage changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "sync" && changes.darkMode) {
                toggleDarkMode(changes.darkMode.newValue);
            }
        });
    });

    function toggleDarkMode(enable) {
        document.body.classList.toggle("dark-mode", !!enable);
    }
})();