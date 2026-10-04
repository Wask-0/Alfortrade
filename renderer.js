// renderer.js
const { ipcRenderer } = require('electron');
const { state, saveMarketState } = require('./js/store.js');
const { processMarketData, renderTable, initMarketFilters, initSorting, updateSortUI } = require('./js/market.js');
const { calculateFlippingOpportunities, initFlippingFilters, updateFlipSortUI } = require('./js/flipping.js');
const { renderMyOrdersTable, initMyOrdersListener } = require('./js/my-orders.js');

// ===== IPC СЛУШАТЕЛИ =====
ipcRenderer.on('dictionary-loaded', (event, dictionary) => {
    state.itemsDict = dictionary;
    console.log(`[Renderer] Словарь получен: ${Object.keys(state.itemsDict).length} записей`);
    
    let updatedCount = 0;
    for (const [key, item] of Object.entries(state.marketState)) {
        const parts = key.split('_');
        const qualitySuffix = parts.pop();
        const fullTechId = parts.join('_');
        
        const dictItem = state.itemsDict[fullTechId];
        if (dictItem) {
            item.id = fullTechId;
            item.name = dictItem.name || item.name;
            item.tier = dictItem.tier;
            const match = item.id?.match(/@(\d+)/);
            item.enchantment = dictItem.enchantment !== undefined ? dictItem.enchantment : (match ? parseInt(match[1]) : 0);
            updatedCount++;
        }
    }
    
    if (updatedCount > 0) {
        saveMarketState();
    }
    
    if (document.readyState !== 'loading') {
        renderTable();
        calculateFlippingOpportunities();
    }
});

ipcRenderer.on('market-data-received', (event, data) => {
    if (Array.isArray(data)) data.forEach(processMarketData);
    else processMarketData(data);
});

// ===== ФУНКЦИИ УПРАВЛЕНИЯ ОКНОМ И ТЕМОЙ =====
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;
    const themeIcon = themeToggle.querySelector('.theme-icon');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    
    themeToggle.addEventListener('click', () => {
        const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeIcon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
}

function initWindowControls() {
    document.getElementById('minimizeBtn')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
    document.getElementById('maximizeBtn')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
    document.getElementById('closeBtn')?.addEventListener('click', () => ipcRenderer.send('window-close'));
}

let backendRunning = false;
function initBackendControls() {
    const backendToggle = document.getElementById('backendToggle');
    if (!backendToggle) return;
    
    const btnIcon = backendToggle.querySelector('.btn-icon');
    const btnText = backendToggle.querySelector('.btn-text');
    const captureIndicator = document.getElementById('captureIndicator');
    const encryptionIndicator = document.getElementById('encryptionIndicator');

    backendToggle.addEventListener('click', () => {
        if (backendRunning) {
            ipcRenderer.send('stop-backend');
            backendRunning = false;
            btnIcon.textContent = '▶';
            btnText.textContent = 'Запустить сбор данных';
            backendToggle.classList.remove('active');
            captureIndicator?.classList.remove('active');
            encryptionIndicator?.classList.remove('encrypted');
        } else {
            ipcRenderer.send('start-backend');
            backendRunning = true;
            btnIcon.textContent = '⏹';
            btnText.textContent = 'Остановить сбор данных';
            backendToggle.classList.add('active');
            captureIndicator?.classList.add('active');
        }
    });

    ipcRenderer.on('backend-status', (event, status) => {
        if (status.running) {
            captureIndicator?.classList.add('active');
            if (!backendRunning) {
                backendRunning = true;
                btnIcon.textContent = '⏹';
                btnText.textContent = 'Остановить сбор данных';
                backendToggle.classList.add('active');
            }
        } else {
            captureIndicator?.classList.remove('active');
            backendRunning = false;
            btnIcon.textContent = '▶';
            btnText.textContent = 'Запустить сбор данных';
            backendToggle.classList.remove('active');
        }

        if (status.encrypted) encryptionIndicator?.classList.add('encrypted');
        else encryptionIndicator?.classList.remove('encrypted');
    });

    ipcRenderer.on('backend-error', (event, error) => {
        console.error('Backend error:', error);
        alert(error);
        backendRunning = false;
        btnIcon.textContent = '▶';
        btnText.textContent = 'Запустить сбор данных';
        backendToggle.classList.remove('active');
        captureIndicator?.classList.remove('active');
    });

    ipcRenderer.on('location-update', (event, location) => {
        const locationDisplay = document.getElementById('currentLocation');
        if (locationDisplay) {
            locationDisplay.textContent = location || 'Неизвестная локация';
            const indicator = document.getElementById('locationIndicator');
            if (indicator) {
                indicator.classList.remove('updated');
                setTimeout(() => indicator.classList.add('updated'), 10);
            }
        }
    });
}

function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pages.forEach(page => page.classList.remove('active'));
            
            const targetPage = document.getElementById(`page-${btn.dataset.page}`);
            if (targetPage) {
                targetPage.classList.add('active');
                if (btn.dataset.page === 'my-orders') renderMyOrdersTable();
                if (btn.dataset.page === 'flipping') calculateFlippingOpportunities();
            }
        });
    });
}

// ===== ГЛАВНАЯ ИНИЦИАЛИЗАЦИЯ =====
function initApp() {
    initThemeToggle();
    initWindowControls();
    initBackendControls();
    initNavigation();
    
    initMarketFilters();
    initSorting();
    updateSortUI();
    
    initFlippingFilters();
    updateFlipSortUI();
    
    initMyOrdersListener();
    
    renderTable();
    calculateFlippingOpportunities();
    renderMyOrdersTable();
}

// Запуск при готовности DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}