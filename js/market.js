// js/market.js
const { state, saveMarketState } = require('./store.js');
const { calculateFlippingOpportunities } = require('./flipping.js');
const {
  locationMap, getQualityName, getDisplayName, formatPrice,
  parseTime, shouldUpdate, extractTier, extractEnchant, getDisplayBuyPrice
} = require('./utils.js');

let renderTimeout = null;

function processMarketData(data) {
  const { itemId, locationId, auctionType, price, quality, timestamp, salesPerDay } = data;

  if (!itemId || !locationId) {
    console.warn("[Frontend] Отброшены данные: отсутствует itemId или locationId", data);
    return;
  }

  const cityKey = locationMap[locationId];
  if (!cityKey) {
    console.warn(`[Frontend] Отброшены данные: неизвестный город locationId="${locationId}"`, data);
    return;
  }

  const uniqueKey = `${itemId}_${quality}`;
  const dictItem = state.itemsDict[itemId] || {};

  if (!state.marketState[uniqueKey]) {
    state.marketState[uniqueKey] = {
      id: itemId,
      name: dictItem.name || itemId,
      tier: dictItem.tier || extractTier(itemId),
      enchantment: dictItem.enchantment !== undefined ? dictItem.enchantment : extractEnchant(itemId),
      quality: quality,
      blackMarket: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      caerleon: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      bridgewatch: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      lymhurst: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      fortSterling: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      thetford: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      martlock: { sell: null, buy: null, sellUpdated: null, buyUpdated: null },
      brecilien: { sell: null, buy: null, sellUpdated: null, buyUpdated: null }
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
    const oneMinute = 60 * 1000;
    const lastSalesUpdate = city.lastSalesUpdate || 0;
    const isTimePassed = (now - lastSalesUpdate) > oneMinute;
    const isNewValueHigher = !city.salesPerDay || salesPerDay > city.salesPerDay;
    if (isTimePassed || isNewValueHigher) {
      city.salesPerDay = salesPerDay;
      city.lastSalesUpdate = now;
    }
  }

  saveMarketState();

  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    renderTable();
    calculateFlippingOpportunities();
    renderTimeout = null;
  }, 100);
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allItems = Object.values(state.marketState);

  const filteredItems = allItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(state.searchQuery);
    const matchesQuality = state.selectedQuality === 'all' || item.quality.toString() === state.selectedQuality;
    return matchesSearch && matchesQuality;
  });

  const sortedItems = filteredItems.sort((a, b) => {
    let comparison = 0;
    if (state.sortField === 'name') comparison = a.name.localeCompare(b.name);
    else if (state.sortField === 'quality') comparison = a.quality - b.quality;
    return state.sortDirection === 'asc' ? comparison : -comparison;
  });

  sortedItems.forEach(item => {
    const row = document.createElement('tr');
    const qualityName = getQualityName(item.quality);

    const formatCell = (cityData, cityKey) => {
      // Для sell используем прямую цену
      // Для buy — наследуем от нижнего качества если прямой цены нет
      const buyDisplay = getDisplayBuyPrice(item, cityKey, state.marketState);
      const isBuyInherited = buyDisplay !== null && buyDisplay > 0 && 
                             (cityData.buy === null || cityData.buy === 0 || cityData.buy === undefined);

      if (cityData.sell === null && buyDisplay === null) {
        return `<td class="no-data">-</td><td class="no-data">-</td>`;
      }
      
      const spdHtml = cityData.salesPerDay
        ? `<div class="spd-value" style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;"> ${cityData.salesPerDay}/день</div>`
        : '';
        
      const sellHtml = cityData.sell !== null && cityData.sell > 0
        ? `<div class="price-value">${formatPrice(cityData.sell)}</div><div class="price-date">(${cityData.sellUpdated || '-'})</div>${spdHtml}`
        : `<span class="no-data">-</span>`;
        
      const buyHtml = buyDisplay !== null && buyDisplay > 0
        ? `<div class="price-value">${formatPrice(buyDisplay)}${isBuyInherited ? '<span style="color: #f39c12; margin-left: 3px;" title="Цена унаследована от качества ниже">↓</span>' : ''}</div><div class="price-date">(${cityData.buyUpdated || '-'})</div>${spdHtml}`
        : `<span class="no-data">-</span>`;
        
      return `<td>${sellHtml}</td><td>${buyHtml}</td>`;
    };

    row.innerHTML = `
      <td class="sticky-col-1 item-name" title="${getDisplayName(item.id)}">${getDisplayName(item.id)}</td>
      <td class="sticky-col-2 item-quality">${qualityName}</td>
      ${formatCell(item.blackMarket, 'blackMarket')}
      ${formatCell(item.caerleon, 'caerleon')}
      ${formatCell(item.bridgewatch, 'bridgewatch')}
      ${formatCell(item.lymhurst, 'lymhurst')}
      ${formatCell(item.fortSterling, 'fortSterling')}
      ${formatCell(item.thetford, 'thetford')}
      ${formatCell(item.martlock, 'martlock')}
      ${formatCell(item.brecilien, 'brecilien')}
    `;
    tbody.appendChild(row);
  });
}

function initMarketFilters() {
  const searchInput = document.getElementById('searchInput');
  const qualitySelect = document.getElementById('qualitySelect');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderTable();
    });
  }
  if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
      state.selectedQuality = e.target.value;
      renderTable();
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
      renderTable();
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
    renderTable();
    
    if (window.calculateFlippingOpportunities) {
      window.calculateFlippingOpportunities();
    }

    const itemCount = Object.keys(newMarketState).length;
    alert(`Успешно импортировано ${itemCount} предметов`);
  });

  ipcRenderer.on('market-data-exported', (event, success, message) => {
    if (success) {
      alert('Данные успешно экспортированы');
    } else {
      alert(`Ошибка экспорта: ${message}`);
    }
  });
}

module.exports = { processMarketData, renderTable, initMarketFilters, initSorting, updateSortUI, initMarketExportImport };