(() => {
	const extensionID = chrome.i18n.getMessage("@@extension_id");
	console.log("Background event page starting...", `Extension ID = ${extensionID}`);

	let shuffle = false;
	const moveDelay = 10;

	// Event listeners setup
	chrome.runtime.onInstalled.addListener(() => {
		chrome.action.onClicked.addListener(tab => {
			chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ["script.js"]
			});
		});
	});

	// Badge update
	const updateTabBadge = async () => {
		const tabs = await chrome.tabs.query({});
		chrome.action.setBadgeText({ text: String(tabs.length) });
	};

	// Utility functions
	const trimPrefix = (s, prefix) => s.startsWith(prefix) ? s.slice(prefix.length) : s;
	
	const lexHost = url => {
		const { host } = new URL(url);
		const parts = host.split(".").reverse();
		return parts.length > 1 ? parts.slice(1).join(".") : parts.join(".");
	};

	const lexScheme = url => {
		const { protocol } = new URL(url);
		return {
			"http:": "http:", "https:": "http:",
			"chrome:": `~${protocol}`, "file:": `~${protocol}`
		}[protocol] || protocol;
	};

	const lexTab = tab => [
		...(shuffle ? [Math.random()] : []),
		tab.pinned ? `pin:0(yes):${tab.index}` : "pin:1(no)",
		lexScheme(tab.url),
		lexHost(tab.url),
		tab.title.toLowerCase()
	].join(" ! ");

	const logWindow = async windowId => {
		const tabs = await chrome.tabs.query({ windowId });
		console.log("Tabs (after reposition):");
		tabs.forEach((t, i) => console.log(i, lexTab(t)));
	};

	const moveNextTab = async (win, tabs, i, inserted = 0) => {
		if (i >= tabs.length) {
			console.log(`Finished sorting window ${win.id}; tabs are now:`);
			await logWindow(win.id);
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

	const sortWindow = win => {
		console.log(`Sorting window: ${win.id}`, "Tabs (before sorting):");
		win.tabs.forEach((t, i) => console.log(i, lexTab(t)));
		win.tabs.sort((a, b) => lexTab(a).localeCompare(lexTab(b)));
		setTimeout(() => moveNextTab(win, win.tabs, 0, 0), 0);
	};

	const extractDomain = async () => {
		const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const target = lexHost(activeTab.url);
		
		const win = await chrome.windows.create({ tabId: activeTab.id, focused: true });
		const allTabs = await chrome.tabs.query({ windowType: "normal" });
		
		allTabs.forEach(t => {
			if (lexHost(t.url) === target) {
				chrome.tabs.move(t.id, { windowId: win.id, index: -1 });
			}
		});

		setTimeout(async () => {
			const updatedWin = await chrome.windows.get(win.id, { windowTypes: ["normal"], populate: true });
			sortWindow(updatedWin);
		}, moveDelay);
	};

	const sortByMode = async mode => {
		console.log(`Sorting tabs: ${mode}`);
		const opts = { windowTypes: ["normal"], populate: true };
		
		const actions = {
			all: async () => (await chrome.windows.getAll(opts)).forEach(sortWindow),
			window: async () => sortWindow(await chrome.windows.getLastFocused(opts)),
			domain: extractDomain
		};

		await actions[mode]?.();
	};

	// Message handler
	chrome.runtime.onMessage.addListener((msg, sender, respond) => {
		console.log(`${msg.action} (${msg.args})`);
		
		const actions = {
			sort: () => { sortByMode(...msg.args); return "sorting started"; },
			openTabsViewer: () => { chrome.tabs.create({ url: chrome.runtime.getURL("tabs-viewer.html") }); return "tabs viewer opened"; }
		};

		const result = actions[msg.action]?.() || "unhandled action";
		respond({ status: result });
	});

	// Duplicate management
	const findDuplicateTabs = tabs => {
		const seen = new Set();
		return tabs.filter(t => seen.has(t.url) ? true : !seen.add(t.url));
	};

	const closeDuplicateTabs = async () => {
		const tabs = await chrome.tabs.query({});
		const duplicates = findDuplicateTabs(tabs);
		
		duplicates.forEach(tab => chrome.tabs.remove(tab.id));
		
		chrome.notifications.create({
			type: "basic",
			iconUrl: "128icon.png",
			title: chrome.i18n.getMessage("extension_name"),
			message: chrome.i18n.getMessage("closed_duplicates_alert", duplicates.length.toString())
		});
	};

	const sortTabs = tabs => {
		[...tabs]
			.sort((a, b) => a.title.localeCompare(b.title))
			.forEach((tab, i) => chrome.tabs.move(tab.id, { index: i }));
	};

	const sortAllTabs = async () => {
		const wins = await chrome.windows.getAll({ populate: true });
		wins.forEach(win => sortTabs(win.tabs));
	};

	const sortCurrentWindowTabs = async () => {
		const win = await chrome.windows.getCurrent({ populate: true });
		sortTabs(win.tabs);
	};

	// Command handlers
	const commands = {
		sort_all_tabs: sortAllTabs,
		sort_current_window: sortCurrentWindowTabs,
		close_duplicates: closeDuplicateTabs
	};

	chrome.commands.onCommand.addListener(cmd => commands[cmd]?.());

	// Event listeners for badge updates
	[
		chrome.tabs.onCreated,
		chrome.tabs.onRemoved,
		chrome.tabs.onMoved,
		chrome.tabs.onUpdated,
		chrome.windows.onCreated,
		chrome.windows.onRemoved
	].forEach(event => event.addListener(updateTabBadge));

	updateTabBadge();
})();