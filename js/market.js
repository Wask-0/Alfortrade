// js/market.js
const { state, saveMarketState } = require('./store.js');
const { calculateFlippingOpportunities } = require('./flipping.js');
const {
    locationMap, getQualityName, getDisplayName, formatPrice,
    parseTime, shouldUpdate, extractTier, extractEnchant, getDisplayBuyPrice
} = require('./utils.js');

// ===== BATCHING ВХОДЯЩИХ ДАННЫХ =====
const pendingUpdates = [];
let renderTimer = null;
let flipTimer = null;

function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
        renderTimer = null;
        renderTable();
    }, 250); // рендер не чаще 4 раз в сек
}

function scheduleFlip() {
    if (flipTimer) return;
    flipTimer = setTimeout(() => {
        flipTimer = null;
        calculateFlippingOpportunities();
    }, 800); // флиппинг ещё реже — он тяжёлый
}

function flushPendingUpdates() {
    while (pendingUpdates.length) {
        const data = pendingUpdates.shift();
        applyMarketUpdate(data);
    }
}

function applyMarketUpdate(data) {
    const { itemId, locationId, auctionType, price, quality, timestamp, salesPerDay } = data;
    if (!itemId || !locationId) return;

    const cityKey = locationMap[locationId];
    if (!cityKey) return;

    const uniqueKey = `${itemId}_${quality}`;
    const dictItem = state.itemsDict[itemId] || {};

    if (!state.marketState[uniqueKey]) {
        state.marketState[uniqueKey] = {
            id: itemId,
            name: dictItem.name || itemId,
            tier: dictItem.tier || extractTier(itemId),
            enchantment: dictItem.enchantment !== undefined ? dictItem.enchantment : extractEnchant(itemId),
            quality: quality,
            blackMarket:  { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            caerleon:     { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            bridgewatch:  { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            lymhurst:     { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            fortSterling: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            thetford:     { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            martlock:     { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
            brecilien:    { sell: null, buy: null, sellUpdated: null, buyUpdated: null }
        };
    }

    const item = state.marketState[uniqueKey];
    const city = item[cityKey];
    if (!city) return;

    const isSell = (auctionType === "offer");
    if (isSell) {
        if (shouldUpdate(city.sell, city.sellUpdated, price, timestamp, true)) {
            city.sell = price;
            city.sellUpdated = timestamp;
        }
    } else {
        if (shouldUpdate(city.buy, city.buyUpdated, price, timestamp, false)) {
            city.buy = price;
            city.buyUpdated = timestamp;
        }
    }

    if (salesPerDay !== undefined && salesPerDay !== null) {
        const now = Date.now();
        const lastUpdate = city.lastSalesUpdate || 0;
        if ((now - lastUpdate) > 60000 || !city.salesPerDay || salesPerDay > city.salesPerDay) {
            city.salesPerDay = salesPerDay;
            city.lastSalesUpdate = now;
        }
    }
}

function processMarketData(data) {
    pendingUpdates.push(data);
    flushPendingUpdates();
    saveMarketState();
    scheduleRender();
    scheduleFlip();
}

// ===== ВИРТУАЛИЗИРОВАННЫЙ РЕНДЕР =====
const ROW_HEIGHT = 42;
const BUFFER_ROWS = 10;
let cachedItems = [];
let lastScrollPos = -1;

function renderTable(fullRebuild = false) {
    const tbody = document.getElementById('tableBody');
    const container = document.getElementById('marketTableContainer');
    if (!tbody || !container) return;

    // Перестраиваем кэш только при изменении фильтров
    if (fullRebuild || cachedItems._filterKey !== getFilterKey()) {
        cachedItems = Object.values(state.marketState).filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(state.searchQuery);
            const matchesQuality = state.selectedQuality === 'all' || item.quality.toString() === state.selectedQuality;
            return matchesSearch && matchesQuality;
        });
        cachedItems.sort((a, b) => {
            let cmp = 0;
            if (state.sortField === 'name') cmp = a.name.localeCompare(b.name);
            else if (state.sortField === 'quality') cmp = a.quality - b.quality;
            return state.sortDirection === 'asc' ? cmp : -cmp;
        });
        cachedItems._filterKey = getFilterKey();
    }

    const totalRows = cachedItems.length;
    const totalHeight = totalRows * ROW_HEIGHT;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const endIndex = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);

    // Фрагмент — пакетная вставка без reflow на каждой строке
    const fragment = document.createDocumentFragment();

    // Верхний spacer
    const topSpacer = document.createElement('tr');
    const topTd = document.createElement('td');
    topTd.colSpan = 10;
    topTd.style.height = (startIndex * ROW_HEIGHT) + 'px';
    topTd.style.padding = '0';
    topTd.style.border = '0';
    topSpacer.appendChild(topTd);
    fragment.appendChild(topSpacer);

    // Видимые строки
    for (let i = startIndex; i < endIndex; i++) {
        fragment.appendChild(buildRow(cachedItems[i]));
    }

    // Нижний spacer
    const bottomSpacer = document.createElement('tr');
    const bottomTd = document.createElement('td');
    bottomTd.colSpan = 10;
    bottomTd.style.height = ((totalRows - endIndex) * ROW_HEIGHT) + 'px';
    bottomTd.style.padding = '0';
    bottomTd.style.border = '0';
    bottomSpacer.appendChild(bottomTd);
    fragment.appendChild(bottomSpacer);

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

function getFilterKey() {
    return `${state.searchQuery}|${state.selectedQuality}|${state.sortField}|${state.sortDirection}`;
}

function buildRow(item) {
    const row = document.createElement('tr');
    const qualityName = getQualityName(item.quality);

    const cityCell = (cityData, cityKey) => {
        const buyDisplay = getDisplayBuyPrice(item, cityKey, state.marketState);
        const isInherited = buyDisplay !== null && buyDisplay > 0 &&
            (cityData.buy === null || cityData.buy === 0 || cityData.buy === undefined);

        if (cityData.sell === null && buyDisplay === null) {
            return `<td class="no-data">-</td><td class="no-data">-</td>`;
        }

        const spd = cityData.salesPerDay
            ? `<div class="spd-value" style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;"> ${cityData.salesPerDay}/день</div>`
            : '';

        const sell = cityData.sell !== null && cityData.sell > 0
            ? `<div class="price-value">${formatPrice(cityData.sell)}</div><div class="price-date">(${cityData.sellUpdated || '-'})</div>${spd}`
            : `<span class="no-data">-</span>`;

        const buy = buyDisplay !== null && buyDisplay > 0
            ? `<div class="price-value">${formatPrice(buyDisplay)}${isInherited ? '<span style="color: #f39c12; margin-left: 3px;" title="Цена унаследована от качества ниже">↓</span>' : ''}</div><div class="price-date">(${cityData.buyUpdated || '-'})</div>${spd}`
            : `<span class="no-data">-</span>`;

        return `<td>${sell}</td><td>${buy}</td>`;
    };

    row.innerHTML = `
        <td class="sticky-col-1 item-name" title="${getDisplayName(item.id)}">${getDisplayName(item.id)}</td>
        <td class="sticky-col-2 item-quality">${qualityName}</td>
        ${cityCell(item.blackMarket, 'blackMarket')}
        ${cityCell(item.caerleon, 'caerleon')}
        ${cityCell(item.bridgewatch, 'bridgewatch')}
        ${cityCell(item.lymhurst, 'lymhurst')}
        ${cityCell(item.fortSterling, 'fortSterling')}
        ${cityCell(item.thetford, 'thetford')}
        ${cityCell(item.martlock, 'martlock')}
        ${cityCell(item.brecilien, 'brecilien')}
    `;
    return row;
}

// Скролл-обработчик с throttling через requestAnimationFrame
let rafScheduled = false;
function onTableScroll() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
        rafScheduled = false;
        renderTable(false); // без пересчёта фильтров
    });
}

function initMarketFilters() {
    const searchInput = document.getElementById('searchInput');
    const qualitySelect = document.getElementById('qualitySelect');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value.trim().toLowerCase();
            renderTable(true);
        });
    }

    if (qualitySelect) {
        qualitySelect.addEventListener('change', (e) => {
            state.selectedQuality = e.target.value;
            renderTable(true);
        });
    }
}

function initSorting() {
    const nameHeader = document.getElementById('sortByName');
    if (nameHeader) {
        nameHeader.addEventListener('click', () => {
            if (state.sortField === 'name') {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortField = 'name';
                state.sortDirection = 'asc';
            }
            updateSortUI();
            renderTable(true);
        });
    }
}

function updateSortUI() {
    const nameHeader = document.getElementById('sortByName');
    if (nameHeader) {
        nameHeader.classList.remove('active', 'asc', 'desc');
        nameHeader.classList.add('active', state.sortDirection);
    }
}

// ===== EXPORT/IMPORT (без изменений) =====
const { ipcRenderer } = require('electron');

function initMarketExportImport() {
    const exportBtn = document.getElementById('exportMarketData');
    const importBtn = document.getElementById('importMarketData');

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            ipcRenderer.send('export-market-data', state.marketState);
        });
    }

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            ipcRenderer.send('import-market-data');
        });
    }

    ipcRenderer.on('market-data-imported', (event, importedData) => {
        if (!importedData || typeof importedData !== 'object') {
            alert('Ошибка: файл не содержит корректных данных рынка');
            return;
        }
        const newMarketState = {};
        for (const [key, value] of Object.entries(importedData)) {
            if (!key.includes('_')) {
                newMarketState[`${key}_1`] = { ...value, quality: 1 };
            } else {
                newMarketState[key] = value;
            }
        }
        Object.assign(state.marketState, newMarketState);
        saveMarketState();
        renderTable(true);
        if (window.calculateFlippingOpportunities) window.calculateFlippingOpportunities();
        alert(`Успешно импортировано ${Object.keys(newMarketState).length} предметов`);
    });

    ipcRenderer.on('market-data-exported', (event, success, message) => {
        if (success) alert('Данные успешно экспортированы');
        else alert(`Ошибка экспорта: ${message}`);
    });
}

// ===== ИНИЦИАЛИЗАЦИЯ СКРОЛЛА =====
function initScrollHandler() {
    const container = document.getElementById('marketTableContainer');
    if (container) {
        container.addEventListener('scroll', onTableScroll, { passive: true });
    }
}

module.exports = { processMarketData, renderTable, initMarketFilters, initSorting, updateSortUI, initMarketExportImport, initScrollHandler };