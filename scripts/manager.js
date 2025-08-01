(() => {
    let allWindows = [];
    let filteredWindows = [];
    let totalTabs = 0;
    let totalPinned = 0;
    let messages = {};
    let currentSearchTerm = '';
    let selectedTabs = new Set();
    let selectionMode = false;
    let isLoading = false;

    // Utility functions
    const promisify = (fn) => (...args) => new Promise((resolve, reject) => {
        fn(...args, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    const chromeAPI = {
        getWindows: promisify(chrome.windows.getAll),
        updateWindow: promisify(chrome.windows.update),
        createWindow: promisify(chrome.windows.create),
        updateTab: promisify(chrome.tabs.update),
        removeTab: promisify(chrome.tabs.remove),
        moveTab: promisify(chrome.tabs.move)
    };

    const getDomainFromUrl = (url) => {
        try { return new URL(url).hostname; } catch { return url; }
    };

    const debounce = (fn, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    };

    // I18n initialization
    const initI18n = async () => {
        try {
            const result = await new Promise((resolve, reject) => {
                chrome.storage.sync.get(["language"], (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(result);
                    }
                });
            });
            const { language = "en" } = result;
            messages = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`)).then(res => res.json());
            
            document.querySelectorAll("[data-i18n]").forEach(el => {
                const key = el.getAttribute("data-i18n");
                if (messages[key]) el.textContent = messages[key].message;
            });
            
            document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
                const key = el.getAttribute("data-i18n-placeholder");
                if (messages[key]) el.placeholder = messages[key].message;
            });
        } catch (error) {
            console.warn("Could not load i18n messages:", error);
        }
    };

    const getMessage = (key, ...substitutions) => {
        if (!messages[key]) return key;
        let message = messages[key].message;
        substitutions.forEach((sub, index) => {
            message = message.replace(`$${index + 1}`, sub);
        });
        return message;
    };

    // Favicon styles
    const initFaviconStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .tab-favicon { width: 20px; height: 20px; min-width: 20px; min-height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 3px; background-color: #f8f9fa; overflow: hidden; font-size: 12px; font-weight: bold; color: #6c757d; }
            .tab-favicon img { width: 16px; height: 16px; object-fit: contain; display: block; }
            .tab-favicon.default { background-color: #e9ecef; color: #495057; }
        `;
        document.head.appendChild(style);
    };

    // Enhanced notification system
    const showToast = (message, type = 'info', duration = 3000) => {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    <i data-feather="${type === 'success' ? 'check-circle' : type === 'danger' ? 'alert-circle' : 'info'}"></i>
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        feather.replace();
        
        if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
            const bsToast = new bootstrap.Toast(toast, { delay: duration });
            bsToast.show();
            toast.addEventListener('hidden.bs.toast', () => toast.remove());
        } else {
            toast.style.display = 'block';
            setTimeout(() => toast.remove(), duration);
        }
    };

    // Keyboard shortcuts
    const initKeyboardShortcuts = () => {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                document.getElementById('searchInput').focus();
            } else if (e.key === 'Escape') {
                currentSearchTerm ? clearSearch() : selectionMode && toggleSelectionMode();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'a' && selectionMode) {
                e.preventDefault();
                selectAllTabs();
            } else if (e.key === 'Delete' && selectionMode && selectedTabs.size > 0) {
                closeSelectedTabs();
            } else if (!e.target.matches('input, textarea')) {
                if (e.key === 's') { e.preventDefault(); toggleSelectionMode(); }
                else if (e.key === 'r') { e.preventDefault(); loadWindowsAndTabs(); }
            }
        });
    };

    const clearSearch = () => {
        const searchInput = document.getElementById("searchInput");
        searchInput.value = "";
        currentSearchTerm = "";
        filterTabs("");
        renderWindows();
        updateSelectionUI();
        document.getElementById("clearSearchBtn").style.display = "none";
        searchInput.focus();
    };

    // Loading states
    const setLoadingState = (loading) => {
        isLoading = loading;
        const loadingState = document.getElementById("loadingState");
        const refreshBtn = document.getElementById("refreshBtn");
        
        if (loadingState) loadingState.style.display = loading ? 'block' : 'none';
        refreshBtn.classList.toggle('loading', loading);
        refreshBtn.disabled = loading;
    };

    const getVisibleTabIds = () => {
        const visibleTabs = new Set();
        (currentSearchTerm ? filteredWindows : allWindows).forEach(window => {
            window.tabs.forEach(tab => visibleTabs.add(tab.id));
        });
        return visibleTabs;
    };

    const cleanupSelectedTabs = () => {
        const visibleTabIds = getVisibleTabIds();
        selectedTabs = new Set([...selectedTabs].filter(tabId => visibleTabIds.has(tabId)));
    };

    // Tab creation
    const createTabElement = (tab) => {
        const tabDiv = document.createElement("div");
        tabDiv.className = `tab-item ${tab.active ? "active" : ""} ${tab.pinned ? "pinned" : ""} ${selectedTabs.has(tab.id) ? "selected" : ""}`;
        tabDiv.setAttribute("data-tab-id", tab.id);
        tabDiv.setAttribute("role", "listitem");
        tabDiv.setAttribute("tabindex", "0");

        const domain = getDomainFromUrl(tab.url);
        const faviconHtml = tab.favIconUrl 
            ? `<img src="${tab.favIconUrl}" alt="" data-domain="${domain}">`
            : domain.charAt(0).toUpperCase();

        tabDiv.innerHTML = `
            <div class="tab-selection" style="display: ${selectionMode ? 'flex' : 'none'}">
                <input type="checkbox" class="tab-checkbox" ${selectedTabs.has(tab.id) ? 'checked' : ''} aria-label="Select tab">
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

        // Handle favicon error
        const faviconImg = tabDiv.querySelector('.tab-favicon img');
        if (faviconImg) {
            faviconImg.addEventListener('error', function() {
                const domain = this.getAttribute('data-domain');
                this.parentElement.classList.add('default');
                this.parentElement.innerHTML = domain.charAt(0).toUpperCase();
            });
        }

        const checkbox = tabDiv.querySelector('.tab-checkbox');
        const handleSelection = (checked) => {
            if (checked) {
                selectedTabs.add(tab.id);
                tabDiv.classList.add('selected');
            } else {
                selectedTabs.delete(tab.id);
                tabDiv.classList.remove('selected');
            }
            updateSelectionUI();
        };

        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            handleSelection(e.target.checked);
        });

        tabDiv.addEventListener("click", (e) => {
            if (!e.target.closest(".tab-actions") && !e.target.closest(".tab-selection")) {
                if (selectionMode) {
                    checkbox.checked = !checkbox.checked;
                    handleSelection(checkbox.checked);
                } else {
                    switchToTab(tab.id, tab.windowId);
                }
            }
        });

        tabDiv.addEventListener("keydown", (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (selectionMode) {
                    checkbox.checked = !checkbox.checked;
                    handleSelection(checkbox.checked);
                } else {
                    switchToTab(tab.id, tab.windowId);
                }
            }
        });

        tabDiv.querySelector(".switch-tab").addEventListener("click", (e) => {
            e.stopPropagation();
            switchToTab(tab.id, tab.windowId);
        });

        tabDiv.querySelector(".close-tab").addEventListener("click", (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });

        return tabDiv;
    };

    // Window creation
    const createWindowElement = (windowData) => {
        const windowDiv = document.createElement("div");
        windowDiv.className = "window-card";
        windowDiv.setAttribute("data-window-id", windowData.id);
        windowDiv.setAttribute("role", "region");
        windowDiv.setAttribute("aria-label", `Window ${windowData.id}`);

        const pinnedTabs = windowData.tabs.filter(tab => tab.pinned).length;

        windowDiv.innerHTML = `
            <div class="window-header">
                <div class="window-info">
                    <i data-feather="monitor"></i>
                    <div>
                        <div class="window-title">${getMessage('window')} ${windowData.id} ${windowData.focused ? `(${getMessage('current_window')})` : ""}</div>
                        <div class="window-stats">${windowData.tabs.length} ${getMessage('tabs').toLowerCase()} • ${pinnedTabs} ${getMessage('pinned').toLowerCase()}</div>
                    </div>
                </div>
                <div class="window-actions">
                    <div class="window-selection-controls" style="display: ${selectionMode ? 'flex' : 'none'}">
                        <button class="btn btn-outline-light btn-sm select-all-window" data-window-id="${windowData.id}">
                            <i data-feather="check-square"></i> ${getMessage('select_all')}
                        </button>
                        <button class="btn btn-outline-light btn-sm select-none-window" data-window-id="${windowData.id}">
                            <i data-feather="square"></i> ${getMessage('select_none')}
                        </button>
                    </div>
                    <button class="btn btn-outline-light focus-window" data-window-id="${windowData.id}">
                        <i data-feather="airplay"></i> ${getMessage('focus_window')}
                    </button>
                    <button class="btn btn-outline-light sort-window" data-window-id="${windowData.id}">
                        <i data-feather="shuffle"></i> ${getMessage('sort_window')}
                    </button>
                </div>
            </div>
            <div class="tabs-grid" role="list" aria-label="Tabs in window ${windowData.id}"></div>
        `;

        const tabsGrid = windowDiv.querySelector(".tabs-grid");
        windowData.tabs.forEach(tab => tabsGrid.appendChild(createTabElement(tab)));

        // Add event listeners
        windowDiv.querySelector(".focus-window").addEventListener("click", () => focusWindow(windowData.id));
        windowDiv.querySelector(".sort-window").addEventListener("click", () => sortWindow(windowData.id));
        windowDiv.querySelector(".select-all-window").addEventListener("click", () => selectAllTabsInWindow(windowData.id));
        windowDiv.querySelector(".select-none-window").addEventListener("click", () => selectNoTabsInWindow(windowData.id));

        return windowDiv;
    };

    const filterTabs = (searchTerm) => {
        currentSearchTerm = searchTerm.toLowerCase().trim();
        
        if (!currentSearchTerm) {
            filteredWindows = [...allWindows];
        } else {
            filteredWindows = allWindows.map(window => {
                const matchingTabs = window.tabs.filter(tab => {
                    const title = (tab.title || '').toLowerCase();
                    const url = (tab.url || '').toLowerCase();
                    const domain = getDomainFromUrl(tab.url).toLowerCase();
                    return title.includes(currentSearchTerm) || url.includes(currentSearchTerm) || domain.includes(currentSearchTerm);
                });
                return matchingTabs.length > 0 ? { ...window, tabs: matchingTabs } : null;
            }).filter(Boolean);
        }
        cleanupSelectedTabs();
    };

    const updateStats = () => {
        const windowsToShow = currentSearchTerm ? filteredWindows : allWindows;
        const tabsToShow = windowsToShow.reduce((sum, win) => sum + win.tabs.length, 0);
        const pinnedToShow = windowsToShow.reduce((sum, win) => sum + win.tabs.filter(tab => tab.pinned).length, 0);
        
        document.getElementById("windowCount").textContent = windowsToShow.length;
        document.getElementById("tabCount").textContent = tabsToShow;
        document.getElementById("pinnedCount").textContent = pinnedToShow;
    };

    const renderWindows = () => {
        const container = document.getElementById("windowsContainer");
        container.innerHTML = "";

        const windowsToRender = currentSearchTerm ? filteredWindows : allWindows;

        if (windowsToRender.length === 0) {
            const messageKey = currentSearchTerm ? 'no_search_results' : 'no_windows_found';
            const descriptionKey = currentSearchTerm ? 'no_search_results_description' : 'no_windows_description';
            
            container.innerHTML = `
                <div class="empty-state">
                    <i data-feather="${currentSearchTerm ? 'search' : 'inbox'}"></i>
                    <h3>${getMessage(messageKey)}</h3>
                    <p>${getMessage(descriptionKey)}</p>
                </div>
            `;
        } else {
            windowsToRender.forEach(windowData => container.appendChild(createWindowElement(windowData)));
        }

        feather.replace();
        updateStats();
    };

    // Enhanced window loading with better error handling
    const loadWindowsAndTabs = async () => {
        if (isLoading) return;
        
        try {
            setLoadingState(true);
            
            if (!chrome?.windows || !chrome?.tabs) {
                throw new Error('Chrome extension APIs not available');
            }
            
            const windows = await chromeAPI.getWindows({ populate: true, windowTypes: ["normal"] });
            
            allWindows = windows || [];
            totalTabs = allWindows.reduce((sum, win) => sum + win.tabs.length, 0);
            totalPinned = allWindows.reduce((sum, win) => sum + win.tabs.filter(tab => tab.pinned).length, 0);
            
            console.log('Loaded windows:', allWindows.length, 'Total tabs:', totalTabs);
            
            filterTabs(currentSearchTerm);
            renderWindows();
            
            if (totalTabs === 0) showToast('No tabs found', 'info');
        } catch (error) {
            console.error("Error loading windows and tabs:", error);
            showToast(`Error loading tabs: ${error.message}`, 'danger');
            
            const container = document.getElementById("windowsContainer");
            if (container) {
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
                
                // Add event listener for retry button
                const retryBtn = container.querySelector('#retryLoadBtn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', loadWindowsAndTabs);
                }
            }
        } finally {
            setLoadingState(false);
        }
    };

    // Tab operations
    const switchToTab = async (tabId, windowId) => {
        try {
            await chromeAPI.updateWindow(windowId, { focused: true });
            await chromeAPI.updateTab(tabId, { active: true });
        } catch (error) {
            console.error("Error switching to tab:", error);
            showToast('Error switching to tab', 'danger');
        }
    };

    const closeTab = async (tabId) => {
        try {
            await chromeAPI.removeTab(tabId);
            selectedTabs.delete(tabId);
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
        const tabsToClose = [...selectedTabs].filter(tabId => visibleTabIds.has(tabId));
        
        if (tabsToClose.length === 0) return;
        if (!confirm(`Close ${tabsToClose.length} selected tabs?`)) return;
        
        try {
            setLoadingState(true);
            await chromeAPI.removeTab(tabsToClose);
            selectedTabs.clear();
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

    const focusWindow = async (windowId) => {
        try {
            await chromeAPI.updateWindow(windowId, { focused: true });
            showToast('Window focused', 'success', 1500);
        } catch (error) {
            console.error("Error focusing window:", error);
            showToast('Error focusing window', 'danger');
        }
    };

    const sortWindow = async (windowId) => {
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
        selectionMode = !selectionMode;
        selectedTabs.clear();
        updateSelectionUI();
        renderWindows();
        showToast(selectionMode ? 'Selection mode enabled' : 'Selection mode disabled', 'info', 1500);
    };

    const selectAllTabsInWindow = (windowId) => {
        const windowsToCheck = currentSearchTerm ? filteredWindows : allWindows;
        const windowData = windowsToCheck.find(w => w.id === windowId);
        if (windowData) {
            windowData.tabs.forEach(tab => selectedTabs.add(tab.id));
            updateSelectionUI();
            renderWindows();
        }
    };

    const selectNoTabsInWindow = (windowId) => {
        const windowsToCheck = currentSearchTerm ? filteredWindows : allWindows;
        const windowData = windowsToCheck.find(w => w.id === windowId);
        if (windowData) {
            windowData.tabs.forEach(tab => selectedTabs.delete(tab.id));
            updateSelectionUI();
            renderWindows();
        }
    };

    const selectAllTabs = () => {
        const windowsToCheck = currentSearchTerm ? filteredWindows : allWindows;
        windowsToCheck.forEach(window => {
            window.tabs.forEach(tab => selectedTabs.add(tab.id));
        });
        updateSelectionUI();
        renderWindows();
    };

    const selectNoTabs = () => {
        selectedTabs.clear();
        updateSelectionUI();
        renderWindows();
    };

    const updateSelectionUI = () => {
        const selectionControls = document.getElementById('selectionControls');
        const selectionButton = document.getElementById('selectionModeBtn');
        const selectedCount = document.getElementById('selectedCount');
        
        if (selectionMode) {
            selectionControls.style.display = 'flex';
            selectionButton.innerHTML = `<i data-feather="x" class="me-1"></i><span>${getMessage('exit_selection')}</span>`;
            selectionButton.className = 'btn btn-outline-secondary';
        } else {
            selectionControls.style.display = 'none';
            selectionButton.innerHTML = `<i data-feather="check-square" class="me-1"></i><span>${getMessage('select_tabs')}</span>`;
            selectionButton.className = 'btn btn-outline-primary';
        }
        
        const visibleTabIds = getVisibleTabIds();
        const visibleSelectedCount = [...selectedTabs].filter(tabId => visibleTabIds.has(tabId)).length;
        selectedCount.textContent = visibleSelectedCount;
        
        ['moveSelectedBtn', 'closeSelectedBtn'].forEach(id => {
            const button = document.getElementById(id);
            if (button) button.disabled = visibleSelectedCount === 0;
        });
        
        feather.replace();
    };

    // Move tabs modal
    const moveSelectedTabs = async () => {
        const visibleTabIds = getVisibleTabIds();
        const visibleSelectedTabs = [...selectedTabs].filter(tabId => visibleTabIds.has(tabId));
        
        if (visibleSelectedTabs.length === 0) return;
        
        const modal = document.getElementById('moveTabsModal');
        const windowsList = document.getElementById('windowsList');
        document.getElementById('moveTabsCount').textContent = visibleSelectedTabs.length;
        
        windowsList.innerHTML = `
            <div class="window-option">
                <input type="radio" name="targetWindow" value="new" id="newWindow">
                <label for="newWindow">
                    <i data-feather="plus-square"></i>
                    <div>
                        <strong>${getMessage('create_new_window')}</strong>
                        <small class="d-block text-muted">Create a new browser window</small>
                    </div>
                </label>
            </div>
        `;
        
        allWindows.forEach(window => {
            const isCurrentWindow = window.focused ? ' (Current)' : '';
            windowsList.innerHTML += `
                <div class="window-option">
                    <input type="radio" name="targetWindow" value="${window.id}" id="window${window.id}">
                    <label for="window${window.id}">
                        <i data-feather="monitor"></i>
                        <div>
                            <strong>${getMessage('window')} ${window.id}${isCurrentWindow}</strong>
                            <small class="d-block text-muted">${window.tabs.length} tabs • ${window.tabs.filter(t => t.pinned).length} pinned</small>
                        </div>
                    </label>
                </div>
            `;
        });
        
        feather.replace();
        modal.style.display = 'block';
        modal.setAttribute('aria-hidden', 'false');
        windowsList.querySelector('input[type="radio"]')?.focus();
    };

    const confirmMoveTabsAction = async () => {
        const selectedOption = document.querySelector('input[name="targetWindow"]:checked');
        if (!selectedOption) return;
        
        const targetValue = selectedOption.value;
        const visibleTabIds = getVisibleTabIds();
        const tabIds = [...selectedTabs].filter(tabId => visibleTabIds.has(tabId));
        
        if (tabIds.length === 0) {
            closeMoveTabsModal();
            return;
        }
        
        try {
            setLoadingState(true);
            if (targetValue === 'new') {
                const newWindow = await chromeAPI.createWindow({ tabId: tabIds[0] });
                await new Promise(resolve => setTimeout(resolve, 100));
                
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
            
            selectedTabs.clear();
            await loadWindowsAndTabs();
            updateSelectionUI();
            closeMoveTabsModal();
            setTimeout(loadWindowsAndTabs, 200);
            
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

    // Event listeners initialization
    const initEventListeners = () => {
        document.getElementById("refreshBtn").addEventListener("click", loadWindowsAndTabs);
        document.getElementById("closeBtn").addEventListener("click", () => window.close());
        
        // Selection controls
        document.getElementById("selectionModeBtn").addEventListener("click", toggleSelectionMode);
        document.getElementById("selectAllBtn").addEventListener("click", selectAllTabs);
        document.getElementById("selectNoneBtn").addEventListener("click", selectNoTabs);
        document.getElementById("moveSelectedBtn").addEventListener("click", moveSelectedTabs);
        document.getElementById("closeSelectedBtn")?.addEventListener("click", closeSelectedTabs);
        
        // Modal controls
        document.getElementById("confirmMoveBtn").addEventListener("click", confirmMoveTabsAction);
        document.getElementById("cancelMoveBtn").addEventListener("click", closeMoveTabsModal);
        document.getElementById("closeMoveModalBtn").addEventListener("click", closeMoveTabsModal);
        document.getElementById("moveTabsModal").addEventListener("click", (e) => {
            if (e.target.id === "moveTabsModal") closeMoveTabsModal();
        });
        
        // Search functionality
        const searchInput = document.getElementById("searchInput");
        const clearSearchBtn = document.getElementById("clearSearchBtn");
        
        const debouncedSearch = debounce((searchTerm) => {
            filterTabs(searchTerm);
            renderWindows();
            updateSelectionUI();
            clearSearchBtn.style.display = searchTerm ? "block" : "none";
        }, 150);
        
        searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));
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

    document.addEventListener("DOMContentLoaded", async () => {
        console.log('DOM Content Loaded - Initializing ZenTabs Manager');
        
        try {
            setLoadingState(true);
            
            if (!chrome?.runtime) {
                throw new Error('Not running in a Chrome extension context');
            }
            
            updateSelectionUI();
            initFaviconStyles();
            await initI18n();
            initEventListeners();
            initKeyboardShortcuts();
            await loadWindowsAndTabs();
            updateSelectionUI();
            
            setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
            showToast('ZenTabs Manager loaded successfully', 'success', 2000);
            console.log('ZenTabs Manager initialization complete');
            
        } catch (error) {
            console.error('Error initializing ZenTabs Manager:', error);
            showToast(`Error loading ZenTabs Manager: ${error.message}`, 'danger');
            
            const container = document.getElementById("windowsContainer");
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i data-feather="alert-triangle"></i>
                        <h3>Initialization Error</h3>
                        <p>Failed to initialize ZenTabs Manager.</p>
                        <p class="text-muted small">${error.message}</p>
                        <button class="btn btn-primary mt-3" id="reloadPageBtn">
                            <i data-feather="refresh-cw" class="me-1"></i>Reload Page
                        </button>
                    </div>
                `;
                feather.replace();
                
                // Add event listener for reload button
                const reloadBtn = container.querySelector('#reloadPageBtn');
                if (reloadBtn) {
                    reloadBtn.addEventListener('click', () => location.reload());
                }
            }
        } finally {
            setLoadingState(false);
        }
    });
})();