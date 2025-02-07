(() => {
	chrome.runtime.onInstalled.addListener(() => {
		chrome.action.onClicked.addListener((tab) => {
			chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ["script.js"],
			});
		});
	});

	const extensionID = chrome.i18n.getMessage("@@extension_id");
	console.log("Background event page starting...");
	console.log(`Extension ID = ${extensionID}`);

	let shuffle = false;
	const moveDelay = 10;
	let tabCount = null;

	const updateTabBadge = () => {
		chrome.tabs.query({}, (tabs) => {
			tabCount = tabs.length;
			chrome.action.setBadgeText({ text: String(tabCount) });
		});
	};

	const trimPrefix = (s, prefix) => (s.startsWith(prefix) ? s.slice(prefix.length) : s);
	const lexHost = (url) => {
		const { host } = new URL(url);
		let parts = host.split(".").reverse();
		if (parts.length > 1) parts = parts.slice(1);
		return parts.join(".");
	};
	const lexScheme = (url) => {
		const { protocol } = new URL(url);
		switch (protocol) {
			case "http:":
			case "https:":
				return "http:";
			case "chrome:":
			case "file:":
				return `~${protocol}`;
			default:
				return protocol;
		}
	};
	const lexTab = (tab) => {
		const pieces = [];
		if (shuffle) pieces.push(Math.random());
		pieces.push(tab.pinned ? `pin:0(yes):${tab.index}` : "pin:1(no)");
		pieces.push(lexScheme(tab.url), lexHost(tab.url), tab.title.toLowerCase());
		return pieces.join(" ! ");
	};

	const logWindow = (windowId) => {
		chrome.tabs.query({ windowId }, (tabs) => {
			console.log("Tabs (after reposition):");
			tabs.forEach((t, i) => console.log(i, lexTab(t)));
		});
	};

	const moveNextTab = (win, tabs, i, inserted) => {
		if (i >= tabs.length) {
			console.log(`Finished sorting window ${win.id}; tabs are now:`);
			logWindow(win.id);
			return;
		}
		const tab = tabs[i];
		if (tab.pinned) {
			console.log(`Pinned ${tab.id} at ${tab.index} to ${i} ${lexTab(tab)}`);
			return setTimeout(() => moveNextTab(win, tabs, i + 1, inserted), 0);
		}
		if (i === tab.index + inserted) {
			console.log(`No action for ${tab.id} at ${tab.index}+${inserted} ${lexTab(tab)}`);
			return setTimeout(() => moveNextTab(win, tabs, i + 1, inserted), 0);
		}
		console.log(`Moving ${tab.id} from ${tab.index} to ${i} ${lexTab(tab)}`);
		chrome.tabs.move(tab.id, { index: i }, () => {
			setTimeout(() => moveNextTab(win, tabs, i + 1, inserted + 1), moveDelay);
		});
	};

	const sortWindow = (win) => {
		console.log(`Sorting window: ${win.id}`);
		const { tabs } = win;
		console.log("Tabs (before sorting):");
		tabs.forEach((t, i) => console.log(i, lexTab(t)));
		tabs.sort((a, b) => lexTab(a).localeCompare(lexTab(b)));
		setTimeout(() => moveNextTab(win, tabs, 0, 0), 0);
	};

	const extractDomain = () => {
		chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
			const { url, id } = activeTab;
			const target = lexHost(url);
			chrome.windows.create({ tabId: id, focused: true }, (win) => {
				chrome.tabs.query({ windowType: "normal" }, (allTabs) => {
					allTabs.forEach((t) => {
						if (lexHost(t.url) === target) {
							chrome.tabs.move(t.id, { windowId: win.id, index: -1 });
						}
					});
					setTimeout(() => {
						chrome.windows.get(win.id, { windowTypes: ["normal"], populate: true }, sortWindow);
					}, moveDelay);
				});
			});
		});
	};

	const sortByMode = (mode) => {
		console.log(`Sorting tabs: ${mode}`);
		const opts = { windowTypes: ["normal"], populate: true };
		switch (mode) {
			case "all":
				chrome.windows.getAll(opts, (wins) => wins.forEach(sortWindow));
				break;
			case "window":
				chrome.windows.getLastFocused(opts, sortWindow);
				break;
			case "domain":
				extractDomain();
				break;
		}
	};

	const handleMessage = ({ action, args }, sender, respond) => {
		console.log(`${action} (${args})`);
		if (action === "sort") {
			sortByMode(...args);
			respond({ status: "sorting started" });
		} else {
			console.log("Unhandled message:", action);
			respond({ status: "unhandled action" });
		}
	};

	chrome.runtime.onMessage.addListener(handleMessage);

	const findDuplicateTabs = (tabs) => {
		const seen = new Set(),
			duplicates = [];
		tabs.forEach((t) => (seen.has(t.url) ? duplicates.push(t) : seen.add(t.url)));
		return duplicates;
	};

	const closeDuplicateTabs = () => {
		chrome.tabs.query({}, (tabs) => {
			const duplicates = findDuplicateTabs(tabs);
			duplicates.forEach((tab) => {
				chrome.tabs.remove(tab.id, () => {
					if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
				});
			});
			chrome.notifications.create({
				type: "basic",
				iconUrl: "128icon.png",
				title: chrome.i18n.getMessage("extension_name"),
				message: chrome.i18n.getMessage("closed_duplicates_alert", duplicates.length.toString()),
			});
		});
	};

	const sortTabs = (tabs, windowId) => {
		const sorted = [...tabs].sort((a, b) => a.title.localeCompare(b.title));
		sorted.forEach((tab, i) => {
			chrome.tabs.move(tab.id, { index: i }, () => {
				if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
			});
		});
	};
	const sortAllTabs = () => {
		chrome.windows.getAll({ populate: true }, (wins) => {
			wins.forEach((win) => sortTabs(win.tabs, win.id));
		});
	};
	const sortCurrentWindowTabs = () => {
		chrome.windows.getCurrent({ populate: true }, (win) => {
			sortTabs(win.tabs, win.id);
		});
	};

	chrome.commands.onCommand.addListener((cmd) => {
		if (cmd === "sort_all_tabs") sortAllTabs();
		else if (cmd === "sort_current_window") sortCurrentWindowTabs();
		else if (cmd === "close_duplicates") closeDuplicateTabs();
	});

	chrome.tabs.onCreated.addListener(updateTabBadge);
	chrome.tabs.onRemoved.addListener(updateTabBadge);
	updateTabBadge();
})();
