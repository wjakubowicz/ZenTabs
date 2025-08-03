(() => {
	const LANGUAGES = {
		en: "English",
		pl: "Polski"
	};
	
	const applyDarkMode = enable => {
		// Apply to both html and body for comprehensive coverage
		document.documentElement.classList.toggle("dark-mode", !!enable);
		document.body.classList.toggle("dark-mode", !!enable);
	};

	const initialize = () => {
		const darkModeToggle = document.getElementById("darkModeToggle");
		const languageSelect = document.getElementById("languageSelect");
		const popupWidthRange = document.getElementById("popupWidthRange");
		const popupWidthValue = document.getElementById("popupWidthValue");

		languageSelect &&
			Object.entries(LANGUAGES).forEach(([code, name]) => {
				const option = document.createElement("option");
				option.value = code;
				option.textContent = name;
				languageSelect.appendChild(option);
			});

		chrome.storage.sync.get(["darkMode", "language", "popupWidth"], res => {
			if (darkModeToggle) {
				darkModeToggle.checked = !!res.darkMode;
				applyDarkMode(res.darkMode);
			}
			const lang =
				res.language ||
				(LANGUAGES[navigator.language.split("-")[0]] ? navigator.language.split("-")[0] : "en");
			chrome.storage.sync.set({ language: lang });
			languageSelect && (languageSelect.value = lang);

			if (popupWidthRange && popupWidthValue) {
				const width = res.popupWidth || 380;
				popupWidthRange.value = width;
				popupWidthValue.textContent = `${width} px`;
			}
		});

		languageSelect?.addEventListener("change", () =>
			chrome.storage.sync.set({ language: languageSelect.value }, () => location.reload())
		);

		darkModeToggle?.addEventListener("change", () => {
			const isDark = darkModeToggle.checked;
			chrome.storage.sync.set({ darkMode: isDark }, () => applyDarkMode(isDark));
		});

		popupWidthRange && popupWidthValue && popupWidthRange.addEventListener("input", () => {
			popupWidthValue.textContent = `${popupWidthRange.value} px`;
			chrome.storage.sync.set({ popupWidth: popupWidthRange.value });
		});

		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "sync" && changes.darkMode) {
				applyDarkMode(changes.darkMode.newValue);
				// Update toggle state if it exists
				if (darkModeToggle) {
					darkModeToggle.checked = !!changes.darkMode.newValue;
				}
			}
		});
	};

	// Apply initial dark mode state immediately
	chrome.storage.sync.get(["darkMode"], r => {
		if (r.darkMode) applyDarkMode(true);
	});

	document.addEventListener("DOMContentLoaded", initialize);
})();