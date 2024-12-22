(() => {
    // Apply dark mode based on saved preference
    chrome.storage.sync.get(['darkMode'], (result) => {
        if (result.darkMode) {
            document.body.classList.add('dark-mode');
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const darkModeToggle = document.getElementById('darkModeToggle');

        // Load saved dark mode preference
        chrome.storage.sync.get(['darkMode'], (result) => {
            if (darkModeToggle) {
                darkModeToggle.checked = result.darkMode || false;
                toggleDarkMode(result.darkMode || false);
            }
        });

        // Add event listener to toggle
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', () => {
                const isDarkMode = darkModeToggle.checked;
                chrome.storage.sync.set({ darkMode: isDarkMode }, () => {
                    toggleDarkMode(isDarkMode);
                });
            });
        }

        function toggleDarkMode(enable) {
            if (enable) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
        }
    });
	
	document.addEventListener('DOMContentLoaded', () => {
		// Apply dark mode based on saved preference
		chrome.storage.sync.get(['darkMode'], (result) => {
			if (result.darkMode) {
				document.body.classList.add('dark-mode');
			}
		});

		// Listen for changes in dark mode
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === 'sync' && changes.darkMode) {
				if (changes.darkMode.newValue) {
					document.body.classList.add('dark-mode');
				} else {
					document.body.classList.remove('dark-mode');
				}
			}
		});
});

})();