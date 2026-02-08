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
		try {
			const { host } = new URL(url);
			const parts = host.split(".").reverse();
			return parts.length > 1 ? parts.slice(1).join(".") : parts.join(".");
		} catch {
			return '';
		}
	};

	const getRootDomain = url => {
		try {
			const { hostname } = new URL(url);
			if (!hostname) return '';
			const parts = hostname.split('.');
			if (parts.length <= 2) return hostname;
			const twoPartTLDs = new Set(['co.uk','com.au','co.jp','co.kr','co.nz','com.br','com.cn','com.mx','org.uk','net.au','org.au','com.pl','net.pl','org.pl','co.in','com.sg','com.hk','co.za']);
			const lastTwo = parts.slice(-2).join('.');
			return twoPartTLDs.has(lastTwo) && parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
		} catch { return ''; }
	};

	const buildDomainCounts = tabs => {
		const counts = new Map();
		for (const tab of tabs) {
			const rd = getRootDomain(tab.url);
			counts.set(rd, (counts.get(rd) || 0) + 1);
		}
		return counts;
	};

	const lexScheme = url => {
		try {
			const { protocol } = new URL(url);
			return {
				"http:": "http:", "https:": "http:",
				"chrome:": `~${protocol}`, "file:": `~${protocol}`
			}[protocol] || protocol;
		} catch {
			return '~unknown';
		}
	};

	const lexTab = tab => [
		...(shuffle ? [Math.random()] : []),
		tab.pinned ? `pin:0(yes):${tab.index}` : "pin:1(no)",
		lexScheme(tab.url),
		lexHost(tab.url),
		tab.title.toLowerCase()
	].join(" ! ");

	const computeSortKey = (tab, sortMode, domainCounts = null) => {
		switch (sortMode) {
			case 'alpha-asc': case 'alpha-desc':
				return tab.title.toLowerCase();
			case 'domain-asc': case 'domain-desc':
				return lexHost(tab.url) + '\x00' + tab.title.toLowerCase();
			case 'count-asc': case 'count-desc': {
				const rd = getRootDomain(tab.url);
				const count = domainCounts?.get(rd) || 0;
				return String(count).padStart(8, '0') + '\x00' + rd + '\x00' + tab.title.toLowerCase();
			}
			default:
				return lexTab(tab);
		}
	};

	// Optimized: batch sort and move tabs in a single chrome.tabs.move call
	const sortWindowBatch = async (win, sortMode = 'default', domainCounts = null) => {
		const tabs = win.tabs;
		// Pre-compute sort keys (avoids recomputing in every comparator call)
		const keyed = tabs.map(tab => ({ tab, key: computeSortKey(tab, sortMode, domainCounts) }));
		const desc = sortMode.endsWith('-desc');

		keyed.sort((a, b) => {
			if (a.tab.pinned && !b.tab.pinned) return -1;
			if (!a.tab.pinned && b.tab.pinned) return 1;
			if (a.tab.pinned && b.tab.pinned) return a.tab.index - b.tab.index;
			const cmp = a.key.localeCompare(b.key);
			return desc ? -cmp : cmp;
		});

		const pinnedCount = tabs.filter(t => t.pinned).length;
		const sortedIds = keyed.filter(kt => !kt.tab.pinned).map(kt => kt.tab.id);

		if (sortedIds.length > 0) {
			try {
				await chrome.tabs.move(sortedIds, { index: pinnedCount });
			} catch (e) {
				console.warn('Batch move failed, falling back to sequential:', e);
				for (let i = 0; i < sortedIds.length; i++) {
					try { await chrome.tabs.move(sortedIds[i], { index: pinnedCount + i }); }
					catch (err) { console.warn(`Move tab ${sortedIds[i]} failed:`, err); }
				}
			}
		}
		console.log(`Sorted window ${win.id} (mode: ${sortMode}, ${tabs.length} tabs)`);
	};

	const extractDomain = async () => {
		const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		if (!activeTab?.url) return;

		const target = getRootDomain(activeTab.url);
		if (!target) {
			chrome.notifications.create({
				type: "basic",
				iconUrl: "icons/128icon.png",
				title: chrome.i18n.getMessage("extension_name"),
				message: chrome.i18n.getMessage("only_fully_qualified")
			});
			return;
		}

		// Collect ALL matching tab IDs BEFORE creating the new window (avoids race conditions)
		const allTabs = await chrome.tabs.query({ windowType: "normal" });
		const matchingTabIds = allTabs
			.filter(t => t.id !== activeTab.id && getRootDomain(t.url) === target)
			.map(t => t.id);

		// Create new window with the active tab
		const newWin = await chrome.windows.create({ tabId: activeTab.id, focused: true });

		// Move remaining matching tabs into the new window
		if (matchingTabIds.length > 0) {
			try {
				await chrome.tabs.move(matchingTabIds, { windowId: newWin.id, index: -1 });
			} catch (e) {
				console.warn('Batch move failed, falling back to sequential:', e);
				for (const id of matchingTabIds) {
					try { await chrome.tabs.move(id, { windowId: newWin.id, index: -1 }); }
					catch (err) { console.warn(`Move tab ${id} failed:`, err); }
				}
			}
		}

		// Sort the new window after a short delay for the moves to settle
		setTimeout(async () => {
			try {
				const updatedWin = await chrome.windows.get(newWin.id, { windowTypes: ["normal"], populate: true });
				await sortWindowBatch(updatedWin);
			} catch (e) { console.warn('Post-extract sort failed:', e); }
		}, 200);
	};

	const sortByMode = async (scope, sortMode = 'default') => {
		console.log(`Sorting tabs: scope=${scope}, mode=${sortMode}`);
		const opts = { windowTypes: ["normal"], populate: true };

		if (scope === 'domain') { await extractDomain(); return; }

		// Build domain counts if needed for count-based sorting
		let domainCounts = null;
		if (sortMode.startsWith('count')) {
			const allWins = await chrome.windows.getAll(opts);
			domainCounts = buildDomainCounts(allWins.flatMap(w => w.tabs));
		}

		if (scope === 'all') {
			const windows = await chrome.windows.getAll(opts);
			await Promise.all(windows.map(w => sortWindowBatch(w, sortMode, domainCounts)));
		} else if (scope === 'window') {
			const win = await chrome.windows.getLastFocused(opts);
			await sortWindowBatch(win, sortMode, domainCounts);
		}
	};

	// Message handler (returns true to keep the channel open for async responses)
	chrome.runtime.onMessage.addListener((msg, sender, respond) => {
		console.log(`${msg.action} (${msg.args})`);

		const handleAsync = async () => {
			try {
				if (msg.action === 'sort') {
					await sortByMode(...(msg.args || []));
					return { status: 'sorting done' };
				}
				if (msg.action === 'openTabsViewer') {
					await chrome.tabs.create({ url: chrome.runtime.getURL('tabs-viewer.html') });
					return { status: 'tabs viewer opened' };
				}
				return { status: 'unhandled action' };
			} catch (e) {
				console.error(`Error handling ${msg.action}:`, e);
				return { status: 'error', message: e.message };
			}
		};

		handleAsync().then(respond);
		return true; // keep message channel open for async response
	});

	// Duplicate management
	const findDuplicateTabs = tabs => {
		const seen = new Set();
		return tabs.filter(t => {
			if (!t.url || t.url === 'about:blank' || t.url.startsWith('chrome://') || t.url.startsWith('about:')) return false;
			return seen.has(t.url) ? true : !seen.add(t.url);
		});
	};

	const closeDuplicateTabs = async () => {
		const tabs = await chrome.tabs.query({});
		const duplicateIds = findDuplicateTabs(tabs).map(t => t.id);

		// Batch remove all duplicates in a single API call
		if (duplicateIds.length > 0) await chrome.tabs.remove(duplicateIds);

		chrome.notifications.create({
			type: "basic",
			iconUrl: "128icon.png",
			title: chrome.i18n.getMessage("extension_name"),
			message: chrome.i18n.getMessage("closed_duplicates_alert", duplicateIds.length.toString())
		});
	};

	const sortAllTabs = async () => {
		const opts = { windowTypes: ["normal"], populate: true };
		const wins = await chrome.windows.getAll(opts);
		await Promise.all(wins.map(w => sortWindowBatch(w)));
	};

	const sortCurrentWindowTabs = async () => {
		const opts = { windowTypes: ["normal"], populate: true };
		const win = await chrome.windows.getCurrent(opts);
		await sortWindowBatch(win);
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