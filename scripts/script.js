(() => {
	const getTabs = async (windowId) => {
		const tabs = await chrome.tabs.query({ windowId });
		return tabs;
	};

	const getAllWindows = async () => {
		const currentWindow = await chrome.windows.getCurrent();
		const allWindows = await chrome.windows.getAll({ populate: true });
		return { currentWindow, allWindows };
	};

	const exportTabs = async () => {
		const { currentWindow, allWindows } = await getAllWindows();
		const content = document.getElementById("content");
		const inclAll = document.getElementById("inclAll")?.checked;
		const inclTitle = document.getElementById("inclTitle")?.checked;

		if (!content) return;
		content.value = "";

		allWindows.forEach((win) => {
			if (currentWindow.id === win.id || inclAll) {
				win.tabs.forEach((tab) => {
					if (inclTitle) content.value += `${tab.title}\n`;
					content.value += `${tab.url}\n\n`;
				});
			}
		});
	};

	const openTabs = () => {
		const content = document.getElementById("content").value;
		const rExp = new RegExp("(^|[ \t\r\n])((ftp|http|https|news|file|view-source|chrome):(([A-Za-z0-9$_.+!*(),;/?:@&~=-])|%[A-Fa-f0-9]{2}){2,}(#([a-zA-Z0-9][a-zA-Z0-9$_.+!*(),;/?:@&~=%-]*))?([A-Za-z0-9$_+!*();/?:~-])*)", "g");
		const urls = content.match(rExp);

		if (urls) {
			urls.forEach((url) => chrome.tabs.create({ url, active: false }));
		} else {
			i18nAlert("only_fully_qualified");
		}
	};

	const download = async (windowSelection, format) => {
		const { currentWindow, allWindows } = await getAllWindows();
		let tabs = [];

		if (windowSelection === "current") {
			tabs = allWindows.find((win) => win.id === currentWindow.id).tabs;
		} else {
			allWindows.forEach((win) => {
				tabs = tabs.concat(win.tabs);
			});
		}

		let blob;
		let filename;
		let mimeType;

		if (format === "html") {
			const html = tabs.map((tab) => `<a href="${tab.url}">${tab.title}</a><br/>`).join("");
			blob = new Blob([`<html><head></head><body>${html}</body></html>`], { type: "text/html;charset=utf-8" });
			filename = "tabs.html";
			mimeType = "text/html;charset=utf-8";
		} else if (format === "csv") {
			const csvContent = "data:text/csv;charset=utf-8," + tabs.map((tab) => `"${tab.title}","${tab.url}"`).join("\n");
			blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
			filename = "tabs.csv";
			mimeType = "text/csv;charset=utf-8";
		} else if (format === "json") {
			const jsonContent = JSON.stringify(tabs, null, 2);
			blob = new Blob([jsonContent], { type: "application/json;charset=utf-8" });
			filename = "tabs.json";
			mimeType = "application/json;charset=utf-8";
		}

		if (blob && filename) {
			const a = document.createElement("a");
			const url = URL.createObjectURL(blob);
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} else {
			if (i18nAlert) {
				i18nAlert("download_failed");
			} else {
				console.error("Download failed: Blob or filename is undefined.");
			}
		}
	};

	let i18nAlert = null;

	const setI18nAlert = () => {
		i18nAlert = (messageKey, ...args) => {
			window.alert(chrome.i18n.getMessage(messageKey, args));
		};
	};

	const closeDuplicateTabs = async () => {
		const tabs = await chrome.tabs.query({});
		const tabUrls = new Set();
		const duplicates = tabs.filter((tab) => {
			if (tabUrls.has(tab.url)) return true;
			tabUrls.add(tab.url);
			return false;
		});

		duplicates.forEach((tab) => chrome.tabs.remove(tab.id));
		if (i18nAlert) {
			i18nAlert("closed_duplicates_alert", duplicates.length.toString());
		}
	};

	const closeDuplicateTabsCurrent = async () => {
		const currentWindow = await chrome.windows.getCurrent();
		const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
		const tabUrls = new Set();
		const duplicates = tabs.filter((tab) => {
			if (tabUrls.has(tab.url)) return true;
			tabUrls.add(tab.url);
			return false;
		});

		duplicates.forEach((tab) => chrome.tabs.remove(tab.id));
		if (i18nAlert) {
			i18nAlert("closed_duplicates_current_alert", duplicates.length.toString());
		}
	};

	const handleButtonClick = async (action) => {
		if (action === "closeDuplicates") {
			await closeDuplicateTabs();
		} else if (action === "closeDuplicatesCurrent") {
			await closeDuplicateTabsCurrent();
		} else if (action === "settingsBtn") {
			chrome.runtime.openOptionsPage();
		} else if (action === "managerBtn") {
			chrome.tabs.create({ url: chrome.runtime.getURL("pages/manager.html") });
			window.close();
		} else if (action === "exportTabs") {
			const windowSelection = document.getElementById("exportWindow").value;
			const format = document.getElementById("exportFormat").value;
			await download(windowSelection, format);
		} else {
			chrome.runtime.sendMessage({ action: "sort", args: [action] }, () => chrome.runtime.lastError || window.close());
		}
	};

	const initI18n = async () => {
		const { language = "en" } = await chrome.storage.sync.get(["language"]);
		const messages = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`)).then((res) => res.json());

		document.querySelectorAll("[data-i18n]").forEach((el) => {
			const key = el.getAttribute("data-i18n");
			if (messages[key]) el.textContent = messages[key].message;
		});

		setI18nAlert();
	};

	const init = async () => {
		document.querySelectorAll(".btn").forEach((btn) => {
			btn.addEventListener("click", () => handleButtonClick(btn.id));
		});

		const eventMap = {
			"#btOpenTabs": openTabs,
			"#inclTitle": exportTabs,
			"#inclAll": exportTabs,
		};

		Object.entries(eventMap).forEach(([selector, handler]) => {
			document.querySelector(selector)?.addEventListener("click", handler);
		});

		await exportTabs();
		feather.replace();

		if (window.location.pathname.endsWith("pages/popup.html")) {
			const { popupWidth } = await chrome.storage.sync.get(["popupWidth"]);
			if (popupWidth) document.body.style.width = `${popupWidth}px`;
		}
	};

	document.addEventListener("DOMContentLoaded", async () => {
		await initI18n();
		await init();
	});
})();