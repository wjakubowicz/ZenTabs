(() => {
	const getAllWindows = async () => ({
		currentWindow: await chrome.windows.getCurrent(),
		allWindows: await chrome.windows.getAll({ populate: true })
	});

	const exportTabs = async () => {
		const { currentWindow, allWindows } = await getAllWindows();
		const content = document.getElementById("content");
		const inclAll = document.getElementById("inclAll")?.checked;
		const inclTitle = document.getElementById("inclTitle")?.checked;

		if (!content) return;
		content.value = allWindows
			.filter(win => currentWindow.id === win.id || inclAll)
			.flatMap(win => win.tabs)
			.map(tab => `${inclTitle ? `${tab.title}\n` : ""}${tab.url}\n\n`)
			.join("");
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
		const tabs = windowSelection === "current"
			? allWindows.find(win => win.id === currentWindow.id).tabs
			: allWindows.flatMap(win => win.tabs);

		const formats = {
			html: () => ({
				content: `<html><head></head><body>${tabs.map(tab => `<a href="${tab.url}">${tab.title}</a><br/>`).join("")}</body></html>`,
				type: "text/html;charset=utf-8",
				filename: "tabs.html"
			}),
			csv: () => ({
				content: tabs.map(tab => `"${tab.title}","${tab.url}"`).join("\n"),
				type: "text/csv;charset=utf-8",
				filename: "tabs.csv"
			}),
			json: () => ({
				content: JSON.stringify(tabs, null, 2),
				type: "application/json;charset=utf-8",
				filename: "tabs.json"
			})
		};

		const fileData = formats[format]?.();
		if (!fileData) return i18nAlert?.("download_failed") ?? console.error("Download failed: Invalid format.");

		const blob = new Blob([fileData.content], { type: fileData.type });
		const a = Object.assign(document.createElement("a"), {
			href: URL.createObjectURL(blob),
			download: fileData.filename
		});

		document.body.append(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(a.href);
	};

	let i18nAlert = null;

	const setI18nAlert = () => {
		i18nAlert = (messageKey, ...args) => alert(chrome.i18n.getMessage(messageKey, args));
	};

	const closeDuplicateTabs = async (currentWindowOnly = false) => {
		const tabs = await chrome.tabs.query(currentWindowOnly ? { windowId: (await chrome.windows.getCurrent()).id } : {});
		const seen = new Set();
		const duplicateIds = tabs.filter(tab => {
			if (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return false;
			return seen.has(tab.url) ? true : !seen.add(tab.url);
		}).map(tab => tab.id);

		// Batch remove all duplicates in a single API call
		if (duplicateIds.length > 0) await chrome.tabs.remove(duplicateIds);
		i18nAlert?.(currentWindowOnly ? "closed_duplicates_current_alert" : "closed_duplicates_alert", duplicateIds.length.toString());
	};

	const handleButtonClick = async (action) => {
		const actions = {
			closeDuplicates: () => closeDuplicateTabs(),
			closeDuplicatesCurrent: () => closeDuplicateTabs(true),
			settingsBtn: () => chrome.runtime.openOptionsPage(),
			managerBtn: () => (chrome.tabs.create({ url: chrome.runtime.getURL("pages/manager.html") }), window.close()),
			exportTabs: () => download(document.getElementById("exportWindow").value, document.getElementById("exportFormat").value)
		};

		const sortMode = document.getElementById("sortMode")?.value || "default";
		if (actions[action]) {
			await actions[action]();
		} else {
			try {
				await chrome.runtime.sendMessage({ action: "sort", args: [action, sortMode] });
			} catch (e) { console.warn('Sort message error:', e); }
			window.close();
		}
	};

	const initI18n = async () => {
		const { language = "en" } = await chrome.storage.sync.get(["language"]);
		const messages = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`)).then(res => res.json());

		document.querySelectorAll("[data-i18n]").forEach(el => {
			const message = messages[el.getAttribute("data-i18n")]?.message;
			if (message) el.textContent = message;
		});

		setI18nAlert();
	};

	const init = async () => {
		document.querySelectorAll(".btn").forEach(btn =>
			btn.addEventListener("click", () => handleButtonClick(btn.id))
		);

		Object.entries({
			"#btOpenTabs": openTabs,
			"#inclTitle": exportTabs,
			"#inclAll": exportTabs
		}).forEach(([selector, handler]) =>
			document.querySelector(selector)?.addEventListener("click", handler)
		);

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