(() => {
	// State management
	const state = {
		allWindows: [],
		filteredWindows: [],
		totalTabs: 0,
		totalPinned: 0,
		messages: {},
		currentSearchTerm: '',
		selectedTabs: new Set(),
		selectionMode: false,
		isLoading: false,
		selectedWindows: new Set()
	};

	// Reuse utility functions from script.js
	const getAllWindows = async () => ({
		currentWindow: await chrome.windows.getCurrent(),
		allWindows: await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })
	});

	// Enhanced Chrome API wrapper with better error handling
	const chromeAPI = {
		getWindows: () => chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
		updateWindow: (windowId, updateInfo) => chrome.windows.update(windowId, updateInfo),
		createWindow: (createData) => chrome.windows.create(createData),
		updateTab: (tabId, updateInfo) => chrome.tabs.update(tabId, updateInfo),
		removeTab: (tabIds) => chrome.tabs.remove(Array.isArray(tabIds) ? tabIds : [tabIds]),
		moveTab: (tabIds, moveProperties) => chrome.tabs.move(Array.isArray(tabIds) ? tabIds : [tabIds], moveProperties)
	};

	// Utility functions
	const getDomainFromUrl = url => {
		try { return new URL(url).hostname; } catch { return url; }
	};

	const debounce = (fn, delay) => {
		let timeout;
		return (...args) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => fn(...args), delay);
		};
	};

	const waitForChromeReady = () => new Promise(resolve => {
		if (chrome?.windows && chrome?.tabs) {
			resolve();
		} else {
			setTimeout(() => waitForChromeReady().then(resolve), 100);
		}
	});

	// I18n functions (optimized)
	const initI18n = async () => {
		try {
			const { language = "en" } = await chrome.storage.sync.get(["language"]);
			state.messages = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`))
				.then(res => res.json());
			
			// Update DOM elements
			document.querySelectorAll("[data-i18n]").forEach(el => {
				const message = state.messages[el.getAttribute("data-i18n")]?.message;
				if (message) el.textContent = message;
			});
			
			document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
				const message = state.messages[el.getAttribute("data-i18n-placeholder")]?.message;
				if (message) el.placeholder = message;
			});
		} catch (error) {
			console.warn("Could not load i18n messages:", error);
		}
	};

	const getMessage = (key, ...substitutions) => {
		if (!state.messages[key]) return key;
		return substitutions.reduce((msg, sub, index) => 
			msg.replace(`$${index + 1}`, sub), state.messages[key].message);
	};

	// Enhanced notification system with better Bootstrap integration
	const showToast = (message, type = 'info', duration = 3000) => {
		const toastContainer = document.getElementById('toastContainer');
		const toast = document.createElement('div');
		
		toast.className = `toast align-items-center text-white bg-${type} border-0`;
		toast.setAttribute('role', 'alert');
		toast.innerHTML = `
			<div class="d-flex align-items-center">
				<div class="toast-body flex-grow-1">
					<i data-feather="${type === 'success' ? 'check-circle' : type === 'danger' ? 'alert-circle' : 'info'}"></i>
					${message}
				</div>
				<button type="button" class="btn-close btn-close-white me-2" data-bs-dismiss="toast">
					<i data-feather="x-circle"></i>
				</button>
			</div>
		`;
		
		toastContainer.appendChild(toast);
		feather.replace();
		
		// Use Bootstrap Toast if available, fallback to manual
		if (window.bootstrap?.Toast) {
			const bsToast = new bootstrap.Toast(toast, { delay: duration });
			bsToast.show();
			toast.addEventListener('hidden.bs.toast', () => toast.remove());
		} else {
			toast.style.display = 'block';
			setTimeout(() => toast.remove(), duration);
		}
	};

	// Loading state management
	const setLoadingState = loading => {
		state.isLoading = loading;
		const loadingState = document.getElementById("loadingState");
		const refreshBtn = document.getElementById("refreshBtn");
		
		if (loadingState) loadingState.style.display = loading ? 'block' : 'none';
		refreshBtn.classList.toggle('loading', loading);
		refreshBtn.disabled = loading;
	};

	// Tab and window utilities
	const getVisibleTabIds = () => {
		const visibleTabs = new Set();
		(state.currentSearchTerm ? state.filteredWindows : state.allWindows)
			.forEach(window => window.tabs.forEach(tab => visibleTabs.add(tab.id)));
		return visibleTabs;
	};

	const cleanupSelectedTabs = () => {
		const visibleTabIds = getVisibleTabIds();
		state.selectedTabs = new Set([...state.selectedTabs].filter(tabId => visibleTabIds.has(tabId)));
		const allWindowIds = new Set((state.currentSearchTerm ? state.filteredWindows : state.allWindows).map(w => w.id));
		state.selectedWindows = new Set([...state.selectedWindows].filter(id => allWindowIds.has(id)));
	};

	// Enhanced tab element creation with better accessibility
	const createTabElement = (tab) => {
		const tabDiv = document.createElement("div");
		const domain = getDomainFromUrl(tab.url);
		const faviconHtml = tab.favIconUrl 
			? `<img src="${tab.favIconUrl}" alt="" data-domain="${domain}" loading="lazy">`
			: domain.charAt(0).toUpperCase();

		tabDiv.className = `tab-item ${tab.active ? "active" : ""} ${tab.pinned ? "pinned" : ""} ${state.selectedTabs.has(tab.id) ? "selected" : ""}`;
		tabDiv.setAttribute("data-tab-id", tab.id);
		tabDiv.setAttribute("role", "listitem");
		tabDiv.setAttribute("tabindex", "0");
		tabDiv.setAttribute("aria-label", `${tab.title} - ${domain}`);

		tabDiv.innerHTML = `
			<div class="tab-selection" style="display: ${state.selectionMode ? 'flex' : 'none'}">
				<input type="checkbox" class="tab-checkbox" ${state.selectedTabs.has(tab.id) ? 'checked' : ''} aria-label="Select tab">
			</div>
			<div class="tab-favicon ${tab.favIconUrl ? "" : "default"}">${faviconHtml}</div>
			<div class="tab-content">
				<div class="tab-title" title="${tab.title}">${tab.title}</div>
				<div class="tab-url" title="${tab.url}">${domain}</div>
			</div>
			<div class="tab-badges">
				${tab.pinned ? '<span class="badge bg-warning tab-badge" title="Pinned tab">📌</span>' : ''}
				${tab.active ? '<span class="badge bg-success tab-badge" title="Active tab">●</span>' : ''}
				${tab.audible ? '<span class="badge bg-info tab-badge" title="Playing audio">🔊</span>' : ''}
				${tab.mutedInfo?.muted ? '<span class="badge bg-secondary tab-badge" title="Muted">🔇</span>' : ''}
			</div>
			<div class="tab-actions">
				<button class="btn btn-outline-primary switch-tab" title="${getMessage('switch_to_tab')}" aria-label="Switch to tab">
					<i data-feather="external-link"></i>
				</button>
				<button class="btn btn-outline-danger close-tab" title="${getMessage('close_tab')}" aria-label="Close tab">
					<i data-feather="x"></i>
				</button>
			</div>
		`;

		// Event delegation for better performance
		setupTabEvents(tabDiv, tab);
		return tabDiv;
	};

	// Separate event setup for cleaner code
	const setupTabEvents = (tabDiv, tab) => {
		const checkbox = tabDiv.querySelector('.tab-checkbox');
		const faviconImg = tabDiv.querySelector('.tab-favicon img');

		// Handle favicon error
		faviconImg?.addEventListener('error', function() {
			const domain = this.getAttribute('data-domain');
			this.parentElement.classList.add('default');
			this.parentElement.innerHTML = domain.charAt(0).toUpperCase();
		});

		const handleSelection = checked => {
			state.selectedTabs[checked ? 'add' : 'delete'](tab.id);
			tabDiv.classList.toggle('selected', checked);
			updateSelectionUI();
		};

		// Event listeners
		checkbox.addEventListener('change', e => {
			e.stopPropagation();
			handleSelection(e.target.checked);
		});

		tabDiv.addEventListener("click", e => {
			if (e.target.closest(".tab-actions, .tab-selection")) return;
			
			if (state.selectionMode) {
				checkbox.checked = !checkbox.checked;
				handleSelection(checkbox.checked);
			} else {
				switchToTab(tab.id, tab.windowId);
			}
		});

		tabDiv.addEventListener("keydown", e => {
			if (!['Enter', ' '].includes(e.key)) return;
			e.preventDefault();
			
			if (state.selectionMode) {
				checkbox.checked = !checkbox.checked;
				handleSelection(checkbox.checked);
			} else {
				switchToTab(tab.id, tab.windowId);
			}
		});

		tabDiv.querySelector(".switch-tab").addEventListener("click", e => {
			e.stopPropagation();
			switchToTab(tab.id, tab.windowId);
		});

		tabDiv.querySelector(".close-tab").addEventListener("click", e => {
			e.stopPropagation();
			closeTab(tab.id);
		});
	};

	// Enhanced window element creation
	const createWindowElement = (windowData) => {
		const windowDiv = document.createElement("div");
		const pinnedTabs = windowData.tabs.filter(tab => tab.pinned).length;
		const incognito = windowData.incognito;

		windowDiv.className = "window-card";
		windowDiv.setAttribute("data-window-id", windowData.id);
		windowDiv.setAttribute("role", "region");
		windowDiv.setAttribute("aria-label", `Window ${windowData.id}`);

		windowDiv.innerHTML = `
			<div class="window-header">
				<div class="window-info">
					<div class="window-select" style="display:${state.selectionMode ? 'flex':'none'};margin-right:.5rem;">
						<input type="checkbox" class="window-checkbox" aria-label="Select window"
							${state.selectedWindows.has(windowData.id)?'checked':''}
							${incognito ? 'disabled title="Incognito windows cannot be merged"' : ''}>
					</div>
					<i data-feather="monitor"></i>
					<div>
						<div class="window-title">
							${getMessage('window')} ${windowData.id} ${windowData.focused ? `(${getMessage('current_window')})` : ""}
							${incognito ? '<span class="badge bg-dark ms-1" title="Incognito">Incognito</span>' : ''}
						</div>
						<div class="window-stats">${windowData.tabs.length} ${getMessage('tabs').toLowerCase()} • ${pinnedTabs} ${getMessage('pinned').toLowerCase()}</div>
					</div>
				</div>
				<div class="window-actions">
					<div class="window-selection-controls" style="display: ${state.selectionMode ? 'flex' : 'none'}">
						<button class="btn btn-outline-light btn-sm select-all-window">
							<i data-feather="check-square"></i> ${getMessage('select_all')}
						</button>
						<button class="btn btn-outline-light btn-sm select-none-window">
							<i data-feather="square"></i> ${getMessage('select_none')}
						</button>
					</div>
					<button class="btn btn-outline-light focus-window">
						<i data-feather="airplay"></i> ${getMessage('focus_window')}
					</button>
					<button class="btn btn-outline-light sort-window">
						<i data-feather="shuffle"></i> ${getMessage('sort_window')}
					</button>
				</div>
			</div>
			<div class="tabs-grid" role="list" aria-label="Tabs in window ${windowData.id}"></div>
		`;

		// Add tabs to grid
		const tabsGrid = windowDiv.querySelector(".tabs-grid");
		windowData.tabs.forEach(tab => tabsGrid.appendChild(createTabElement(tab)));

		// Setup window event listeners
		setupWindowEvents(windowDiv, windowData.id);

		// Window checkbox handler
		const winCheckbox = windowDiv.querySelector('.window-checkbox');
		winCheckbox?.addEventListener('change', (e) => {
			handleWindowSelection(windowData.id, e.target.checked);
		});

		if (state.selectedWindows.has(windowData.id)) {
			windowDiv.classList.add('window-selected');
		}

		return windowDiv;
	};

	const setupWindowEvents = (windowDiv, windowId) => {
		windowDiv.querySelector(".focus-window").addEventListener("click", () => focusWindow(windowId));
		windowDiv.querySelector(".sort-window").addEventListener("click", () => sortWindow(windowId));
		windowDiv.querySelector(".select-all-window").addEventListener("click", () => selectAllTabsInWindow(windowId));
		windowDiv.querySelector(".select-none-window").addEventListener("click", () => selectNoTabsInWindow(windowId));
	};

	// Window selection helper
	const handleWindowSelection = (windowId, checked) => {
		const win = state.allWindows.find(w => w.id === windowId);
		if (win?.incognito) {
			showToast('Incognito windows cannot be merged', 'info', 2500);
			return;
		}
		if (checked) {
			state.selectedWindows.add(windowId);
			// add all tabs of that window to selectedTabs for consistency
			const fullWindow = state.allWindows.find(w => w.id === windowId);
			fullWindow?.tabs.forEach(t => state.selectedTabs.add(t.id));
		} else {
			state.selectedWindows.delete(windowId);
			// leave tab selections as-is (do not auto-deselect to allow granular control)
		}
		updateSelectionUI();
		renderWindows();
	};

	// Search and filter functionality
	const filterTabs = searchTerm => {
		state.currentSearchTerm = searchTerm.toLowerCase().trim();
		
		if (!state.currentSearchTerm) {
			state.filteredWindows = [...state.allWindows];
		} else {
			state.filteredWindows = state.allWindows
				.map(window => {
					const matchingTabs = window.tabs.filter(tab => {
						const searchText = [tab.title, tab.url, getDomainFromUrl(tab.url)]
							.join(' ').toLowerCase();
						return searchText.includes(state.currentSearchTerm);
					});
					return matchingTabs.length > 0 ? { ...window, tabs: matchingTabs } : null;
				})
				.filter(Boolean);
		}
		cleanupSelectedTabs();
	};

	// Stats and rendering
	const updateStats = () => {
		const windowsToShow = state.currentSearchTerm ? state.filteredWindows : state.allWindows;
		const tabsToShow = windowsToShow.reduce((sum, win) => sum + win.tabs.length, 0);
		const pinnedToShow = windowsToShow.reduce((sum, win) => 
			sum + win.tabs.filter(tab => tab.pinned).length, 0);
		
		document.getElementById("windowCount").textContent = windowsToShow.length;
		document.getElementById("tabCount").textContent = tabsToShow;
		document.getElementById("pinnedCount").textContent = pinnedToShow;
	};

	const renderWindows = () => {
		const container = document.getElementById("windowsContainer");
		const windowsToRender = state.currentSearchTerm ? state.filteredWindows : state.allWindows;

		if (windowsToRender.length === 0) {
			const messageKey = state.currentSearchTerm ? 'no_search_results' : 'no_windows_found';
			const descriptionKey = state.currentSearchTerm ? 'no_search_results_description' : 'no_windows_description';
			
			container.innerHTML = `
				<div class="empty-state">
					<i data-feather="${state.currentSearchTerm ? 'search' : 'inbox'}"></i>
					<h3>${getMessage(messageKey)}</h3>
					<p>${getMessage(descriptionKey)}</p>
				</div>
			`;
		} else {
			// Use DocumentFragment for better performance
			const fragment = document.createDocumentFragment();
			windowsToRender.forEach(windowData => 
				fragment.appendChild(createWindowElement(windowData)));
			container.replaceChildren(fragment);
		}

		feather.replace();
		updateStats();
	};

	// Enhanced window loading with better error handling
	const loadWindowsAndTabs = async () => {
		if (state.isLoading) return;
		
		try {
			setLoadingState(true);
			await waitForChromeReady();
			
			const windows = await chromeAPI.getWindows();
			
			const ordered = prioritizeFocusedWindow(windows || []);
			
			state.allWindows = ordered;
			// Purge any incognito window ids that may have been retained before rule change
			state.selectedWindows = new Set(
				[...state.selectedWindows].filter(id => {
					const w = state.allWindows.find(w => w.id === id);
					return w && !w.incognito;
				})
			);
			state.totalTabs = state.allWindows.reduce((sum, win) => sum + win.tabs.length, 0);
			state.totalPinned = state.allWindows.reduce((sum, win) => 
				sum + win.tabs.filter(tab => tab.pinned).length, 0);
			
			console.log('Loaded windows:', state.allWindows.length, 'Total tabs:', state.totalTabs);
			
			filterTabs(state.currentSearchTerm);
			renderWindows();
			
			if (state.totalTabs === 0) showToast('No tabs found', 'info');
		} catch (error) {
			console.error("Error loading windows and tabs:", error);
			showToast(`Error loading tabs: ${error.message}`, 'danger');
			renderErrorState(error);
		} finally {
			setLoadingState(false);
		}
	};

	const renderErrorState = error => {
		const container = document.getElementById("windowsContainer");
		container.innerHTML = `
			<div class="empty-state">
				<i data-feather="alert-triangle"></i>
				<h3>Error Loading Data</h3>
				<p>Failed to load browser windows and tabs.</p>
				<p class="text-muted small">${error.message}</p>
				<button class="btn btn-primary mt-3" id="retryLoadBtn">
					<i data-feather="refresh-cw" class="me-1"></i>Try Again
				</button>
			</div>
		`;
		feather.replace();
		
		container.querySelector('#retryLoadBtn')?.addEventListener('click', loadWindowsAndTabs);
	};

	// Tab operations with async/await
	const switchToTab = async (tabId, windowId) => {
		try {
			await Promise.all([
				chromeAPI.updateWindow(windowId, { focused: true }),
				chromeAPI.updateTab(tabId, { active: true })
			]);
		} catch (error) {
			console.error("Error switching to tab:", error);
			showToast('Error switching to tab', 'danger');
		}
	};

	const closeTab = async tabId => {
		try {
			await chromeAPI.removeTab(tabId);
			state.selectedTabs.delete(tabId);
			await loadWindowsAndTabs();
			updateSelectionUI();
			showToast('Tab closed', 'success', 1500);
		} catch (error) {
			console.error("Error closing tab:", error);
			showToast('Error closing tab', 'danger');
		}
	};

	// Bulk operations
	const closeSelectedTabs = async () => {
		const visibleTabIds = getVisibleTabIds();
		const tabsToClose = [...state.selectedTabs].filter(tabId => visibleTabIds.has(tabId));
		
		if (tabsToClose.length === 0) return;
		if (!confirm(`Close ${tabsToClose.length} selected tabs?`)) return;
		
		try {
			setLoadingState(true);
			await chromeAPI.removeTab(tabsToClose);
			state.selectedTabs.clear();
			await loadWindowsAndTabs();
			updateSelectionUI();
			showToast(`Closed ${tabsToClose.length} tabs`, 'success');
		} catch (error) {
			console.error("Error closing tabs:", error);
			showToast('Error closing tabs', 'danger');
		} finally {
			setLoadingState(false);
		}
	};

	const focusWindow = async windowId => {
		try {
			await chromeAPI.updateWindow(windowId, { focused: true });
		} catch (error) {
			console.error("Error focusing window:", error);
			showToast('Error focusing window', 'danger');
		}
	};

	// Reuse sorting logic from background.js
	const sortWindow = async windowId => {
		try {
			chrome.runtime.sendMessage({ action: "sort", args: ["window"] });
			setTimeout(loadWindowsAndTabs, 1000);
			showToast('Window tabs sorted', 'success');
		} catch (error) {
			console.error("Error sorting window:", error);
			showToast('Error sorting window', 'danger');
		}
	};

	// Selection operations
	const toggleSelectionMode = () => {
		state.selectionMode = !state.selectionMode;
		state.selectedTabs.clear();
		state.selectedWindows.clear();
		updateSelectionUI();
		renderWindows();
	};

	const selectAllTabsInWindow = windowId => {
		const windowsToCheck = state.currentSearchTerm ? state.filteredWindows : state.allWindows;
		const windowData = windowsToCheck.find(w => w.id === windowId);
		if (windowData) {
			windowData.tabs.forEach(tab => state.selectedTabs.add(tab.id));
			// Only mark window as selected if mergeable (non-incognito)
			if (!windowData.incognito) state.selectedWindows.add(windowId);
			updateSelectionUI();
			renderWindows();
		}
	};

	const selectNoTabsInWindow = windowId => {
		const windowsToCheck = state.currentSearchTerm ? state.filteredWindows : state.allWindows;
		const windowData = windowsToCheck.find(w => w.id === windowId);
		if (windowData) {
			windowData.tabs.forEach(tab => state.selectedTabs.delete(tab.id));
			state.selectedWindows.delete(windowId);
			updateSelectionUI();
			renderWindows();
		}
	};

	const selectAllTabs = () => {
		const windowsToCheck = state.currentSearchTerm ? state.filteredWindows : state.allWindows;
		windowsToCheck.forEach(window => 
			window.tabs.forEach(tab => state.selectedTabs.add(tab.id)));
		// Only add mergeable windows
		(state.currentSearchTerm ? state.filteredWindows : state.allWindows)
			.forEach(w => { if (!w.incognito) state.selectedWindows.add(w.id); });
		updateSelectionUI();
		renderWindows();
	};

	const selectNoTabs = () => {
		state.selectedTabs.clear();
		state.selectedWindows.clear();
		updateSelectionUI();
		renderWindows();
	};

	const updateSelectionUI = () => {
		const selectionControls = document.getElementById('selectionControls');
		const selectionButton = document.getElementById('selectionModeBtn');
		const selectedCount = document.getElementById('selectedCount');
		
		if (state.selectionMode) {
			selectionControls.style.display = 'flex';
			selectionButton.innerHTML = `<i data-feather="x" class="me-1"></i><span>${getMessage('exit_selection')}</span>`;
			selectionButton.className = 'btn btn-outline-secondary';
		} else {
			selectionControls.style.display = 'none';
			selectionButton.innerHTML = `<i data-feather="check-square" class="me-1"></i><span>${getMessage('select_tabs')}</span>`;
			selectionButton.className = 'btn btn-outline-primary';
		}
		
		const visibleTabIds = getVisibleTabIds();
		const visibleSelectedCount = [...state.selectedTabs].filter(tabId => visibleTabIds.has(tabId)).length;
		selectedCount.textContent = visibleSelectedCount;
		
		['moveSelectedBtn', 'closeSelectedBtn'].forEach(id => {
			const button = document.getElementById(id);
			if (button) button.disabled = visibleSelectedCount === 0;
		});

		const mergeBtn = document.getElementById('mergeWindowsBtn');
		if (mergeBtn) mergeBtn.disabled = state.selectedWindows.size < 2;

		feather.replace();
	};

	// Enhanced move tabs functionality
	const moveSelectedTabs = async () => {
		const visibleTabIds = getVisibleTabIds();
		const visibleSelectedTabs = [...state.selectedTabs].filter(tabId => visibleTabIds.has(tabId));
		
		if (visibleSelectedTabs.length === 0) return;
		
		const modal = document.getElementById('moveTabsModal');
		const windowsList = document.getElementById('windowsList');
		document.getElementById('moveTabsCount').textContent = visibleSelectedTabs.length;
		
		// Build options HTML (label wraps entire option so whole card is clickable)
		const optionsHTML = [
			`<label class="window-option">
				<input type="radio" name="targetWindow" value="new">
				<i data-feather="plus-square"></i>
				<div>
					<strong>${getMessage('create_new_window')}</strong>
					<small class="d-block text-muted">Create a new browser window</small>
				</div>
			</label>`,
			...state.allWindows.map(window => {
				const isCurrentWindow = window.focused ? ' (Current)' : '';
				return `
					<label class="window-option">
						<input type="radio" name="targetWindow" value="${window.id}">
						<i data-feather="monitor"></i>
						<div>
							<strong>${getMessage('window')} ${window.id}${isCurrentWindow}</strong>
							<small class="d-block text-muted">${window.tabs.length} tabs • ${window.tabs.filter(t => t.pinned).length} pinned</small>
						</div>
					</label>
				`;
			})
		].join('');
		
		windowsList.innerHTML = optionsHTML;
		feather.replace();

		// Selection styling + keyboard support
		const updateOptionSelection = () => {
			windowsList.querySelectorAll('.window-option').forEach(opt => {
				const input = opt.querySelector('input[type="radio"]');
				opt.classList.toggle('selected', input.checked);
			});
		};
		windowsList.addEventListener('change', e => {
			if (e.target.name === 'targetWindow') updateOptionSelection();
		});
		windowsList.querySelectorAll('.window-option').forEach(opt => {
			opt.setAttribute('tabindex', '0');
			opt.addEventListener('keydown', e => {
				if (['Enter', ' '].includes(e.key)) {
					e.preventDefault();
					const input = opt.querySelector('input[type="radio"]');
					input.checked = true;
					input.dispatchEvent(new Event('change', { bubbles: true }));
					input.focus();
				}
			});
		});
		updateOptionSelection();

		modal.style.display = 'block';
		modal.setAttribute('aria-hidden', 'false');
		windowsList.querySelector('input[type="radio"]')?.focus();
	};

	const confirmMoveTabsAction = async () => {
		const selectedOption = document.querySelector('input[name="targetWindow"]:checked');
		if (!selectedOption) return;
		
		const targetValue = selectedOption.value;
		const visibleTabIds = getVisibleTabIds();
		const tabIds = [...state.selectedTabs].filter(tabId => visibleTabIds.has(tabId));
		
		if (tabIds.length === 0) {
			closeMoveTabsModal();
			return;
		}
		
		try {
			setLoadingState(true);
			
			if (targetValue === 'new') {
				const newWindow = await chromeAPI.createWindow({ tabId: tabIds[0] });
				
				// Move remaining tabs with delay for better reliability
				for (let i = 1; i < tabIds.length; i++) {
					try {
						await chromeAPI.moveTab(tabIds[i], { windowId: newWindow.id, index: -1 });
						await new Promise(resolve => setTimeout(resolve, 50));
					} catch (error) {
						console.error(`Error moving tab ${tabIds[i]}:`, error);
					}
				}
				
				await chromeAPI.updateWindow(newWindow.id, { focused: true });
				showToast(`Moved ${tabIds.length} tabs to new window`, 'success');
			} else {
				const targetWindowId = parseInt(targetValue);
				await chromeAPI.moveTab(tabIds, { windowId: targetWindowId, index: -1 });
				showToast(`Moved ${tabIds.length} tabs to window ${targetWindowId}`, 'success');
			}
			
			state.selectedTabs.clear();
			await loadWindowsAndTabs();
			updateSelectionUI();
			closeMoveTabsModal();
			
		} catch (error) {
			console.error("Error moving tabs:", error);
			showToast('Error moving tabs', 'danger');
		} finally {
			setLoadingState(false);
		}
	};

	const closeMoveTabsModal = () => {
		const modal = document.getElementById('moveTabsModal');
		modal.style.display = 'none';
		modal.setAttribute('aria-hidden', 'true');
	};

	// Merge selected windows
	const mergeSelectedWindows = async () => {
		// Filter out any incognito windows defensively
		const candidateIds = [...state.selectedWindows].filter(id => {
			const w = state.allWindows.find(w => w.id === id);
			return isMergeableWindow(w);
		});

		if (candidateIds.length < 2) {
			showToast('Select at least two non-incognito windows to merge', 'info', 2500);
			return;
		}

		if (!confirm(`Merge ${candidateIds.length} windows into one?`)) return;

		try {
			setLoadingState(true);
			// Pick focused mergeable window if present, else first
			const focusedWin = state.allWindows.find(w => w.focused && candidateIds.includes(w.id));
			const targetWindowId = focusedWin ? focusedWin.id : candidateIds[0];

			for (const wid of candidateIds) {
				if (wid === targetWindowId) continue;
				const win = state.allWindows.find(w => w.id === wid);
				if (!win) continue;
				for (const tab of win.tabs) {
					try {
						await chromeAPI.moveTab(tab.id, { windowId: targetWindowId, index: -1 });
						await new Promise(r => setTimeout(r, 20));
					} catch (err) {
						console.warn('Move tab failed', tab.id, err);
					}
				}
				try {
					await chrome.windows.remove(wid);
				} catch (err) {
					console.warn('Close window failed', wid, err);
				}
			}
			state.selectedWindows.clear();
			state.selectedTabs.clear();
			await loadWindowsAndTabs();
			updateSelectionUI();
			showToast('Windows merged', 'success');
		} catch (error) {
			console.error('Error merging windows:', error);
			showToast('Error merging windows', 'danger');
		} finally {
			setLoadingState(false);
		}
	};

	// Keyboard shortcuts with modern event handling
	const initKeyboardShortcuts = () => {
		const shortcuts = {
			'f': { ctrl: true, action: () => document.getElementById('searchInput').focus() },
			'Escape': { action: () => state.currentSearchTerm ? clearSearch() : state.selectionMode && toggleSelectionMode() },
			'a': { ctrl: true, condition: () => state.selectionMode, action: selectAllTabs },
			'Delete': { condition: () => state.selectionMode && state.selectedTabs.size > 0, action: closeSelectedTabs },
			's': { noInput: true, action: toggleSelectionMode },
			'r': { noInput: true, action: loadWindowsAndTabs }
		};

		document.addEventListener('keydown', e => {
			const shortcut = shortcuts[e.key];
			if (!shortcut) return;

			const ctrlPressed = e.ctrlKey || e.metaKey;
			const isInputFocused = e.target.matches('input, textarea');

			if (shortcut.ctrl && !ctrlPressed) return;
			if (shortcut.noInput && isInputFocused) return;
			if (shortcut.condition && !shortcut.condition()) return;

			e.preventDefault();
			shortcut.action();
		});
	};

	const clearSearch = () => {
		const searchInput = document.getElementById("searchInput");
		searchInput.value = "";
		state.currentSearchTerm = "";
		filterTabs("");
		renderWindows();
		updateSelectionUI();
		document.getElementById("clearSearchBtn").style.display = "none";
		searchInput.focus();
	};

	// Event listeners initialization with delegation
	const initEventListeners = () => {
		// Simple button handlers
		const buttonHandlers = {
			refreshBtn: loadWindowsAndTabs,
			closeBtn: () => window.close(),
			selectionModeBtn: toggleSelectionMode,
			selectAllBtn: selectAllTabs,
			selectNoneBtn: selectNoTabs,
			moveSelectedBtn: moveSelectedTabs,
			closeSelectedBtn: closeSelectedTabs,
			confirmMoveBtn: confirmMoveTabsAction,
			cancelMoveBtn: closeMoveTabsModal,
			closeMoveModalBtn: closeMoveTabsModal,
			mergeWindowsBtn: mergeSelectedWindows
		};

		Object.entries(buttonHandlers).forEach(([id, handler]) => {
			document.getElementById(id)?.addEventListener("click", handler);
		});

		// Modal backdrop click
		document.getElementById("moveTabsModal").addEventListener("click", e => {
			if (e.target.id === "moveTabsModal") closeMoveTabsModal();
		});

		// Search functionality with debouncing
		const searchInput = document.getElementById("searchInput");
		const clearSearchBtn = document.getElementById("clearSearchBtn");
		
		const debouncedSearch = debounce(searchTerm => {
			filterTabs(searchTerm);
			renderWindows();
			updateSelectionUI();
			clearSearchBtn.style.display = searchTerm ? "block" : "none";
		}, 150);
		
		searchInput.addEventListener("input", e => debouncedSearch(e.target.value));
		clearSearchBtn.addEventListener("click", clearSearch);

		// Keyboard help
		document.getElementById("keyboardHelpBtn")?.addEventListener("click", () => {
			showToast(`
				<strong>Keyboard Shortcuts:</strong><br>
				<kbd>Ctrl+F</kbd> Focus search<br>
				<kbd>Esc</kbd> Clear search/Exit selection<br>
				<kbd>S</kbd> Toggle selection mode<br>
				<kbd>R</kbd> Refresh<br>
				<kbd>Del</kbd> Close selected tabs
			`, 'info', 8000);
		});
	};

	// Initialize favicon styles (moved to CSS would be better)
	const initFaviconStyles = () => {
		if (document.getElementById('favicon-styles')) return; // Prevent duplicates
		
		const style = document.createElement('style');
		style.id = 'favicon-styles';
		style.textContent = `
			.tab-favicon { 
				width: 20px; height: 20px; min-width: 20px; min-height: 20px; 
				display: flex; align-items: center; justify-content: center; 
				border-radius: 3px; background-color: #f8f9fa; overflow: hidden; 
				font-size: 12px; font-weight: bold; color: #6c757d; 
			}
			.tab-favicon img { width: 16px; height: 16px; object-fit: contain; display: block; }
			.tab-favicon.default { background-color: #e9ecef; color: #495057; }
			.window-card.window-selected { outline: 2px solid #0d6efd; border-radius:4px; }
			.window-header .window-select input { width:16px; height:16px; cursor:pointer; }

			/* Move modal option cards */
			.window-option {
				display:flex; gap:.75rem; align-items:center;
				padding:.6rem .75rem; border:1px solid #dee2e6;
				border-radius:.5rem; cursor:pointer; background:#fff;
				transition:background .15s, border-color .15s;
				margin-bottom:.5rem;
			}
			.window-option:last-child { margin-bottom:0; }
			.window-option:hover { background:#f8f9fa; }
			.window-option.selected { border-color:#0d6efd; background:#e7f1ff; }
			.window-option input[type="radio"] { margin-right:.5rem; cursor:pointer; }
		`;
		document.head.appendChild(style);
	};

	// Ensure focused (current) window is first
	const prioritizeFocusedWindow = (windows) => {
		if (!Array.isArray(windows)) return [];
		const focusedIndex = windows.findIndex(w => w.focused);
		if (focusedIndex > 0) {
			const [focused] = windows.splice(focusedIndex, 1);
			windows.unshift(focused);
		}
		return windows;
	};

	// Helper to determine if a window can participate in merge (incognito excluded)
	const isMergeableWindow = (win) => win && !win.incognito;

	// Main initialization
	document.addEventListener("DOMContentLoaded", async () => {
		console.log('DOM Content Loaded - Initializing ZenTabs Manager');
		
		try {
			if (!chrome?.runtime) {
				throw new Error('Not running in a Chrome extension context');
			}
			
			// Initialize in order
			initFaviconStyles();
			await initI18n();
			updateSelectionUI();
			initEventListeners();
			initKeyboardShortcuts();
			await loadWindowsAndTabs();
			
			// Focus search after a short delay
			setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
			console.log('ZenTabs Manager initialization complete');
			
		} catch (error) {
			console.error('Error initializing ZenTabs Manager:', error);
			showToast(`Error loading ZenTabs Manager: ${error.message}`, 'danger');
			renderErrorState(error);
		}
	});
})();