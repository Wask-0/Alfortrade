const { ipcRenderer } = require('electron');

// Словарь для красивого отображения качества
const qualityMap = {
  1: "Обычное",
  2: "Хорошее",
  3: "Выдающееся",
  4: "Отличное",
  5: "Шедевр"
};

function getQualityName(q) {
  return qualityMap[q] || 'Неизвестно';
}

// Загрузка и миграция сохранённых данных при старте
const savedData = localStorage.getItem('albionMarketState');
let rawMarketState = savedData ? JSON.parse(savedData) : {};

// Миграция: если ключ не содержит '_', считаем, что это старая запись с качеством 1
const marketState = {};
for (const [key, value] of Object.entries(rawMarketState)) {
  if (!key.includes('_')) {
    marketState[`${key}_1`] = { ...value, quality: 1 };
  } else {
    marketState[key] = value;
  }
}
localStorage.setItem('albionMarketState', JSON.stringify(marketState));

for (const key of Object.keys(marketState)) {
  if (!marketState[key].id) {
    marketState[key].id = key.split('_')[0];
  }
}

// Словарь локаций
const locationMap = {
  "3003": "blackMarket", "3005": "caerleon", "2004": "bridgewatch",
  "1002": "lymhurst", "4002": "fortSterling", "0007": "thetford",
  "3008": "martlock", "5003": "brecilien",
  "Black Market": "blackMarket", "Caerleon": "caerleon",
  "Bridgewatch": "bridgewatch", "Lymhurst": "lymhurst",
  "Fort Sterling": "fortSterling", "Thetford": "thetford",
  "Martlock": "martlock", "Brecilien": "brecilien"
};

// Переменные для фильтрации
let searchQuery = '';
let selectedQuality = 'all';
let flipBuyCity = 'any';
let flipSellCity = 'blackMarket';
let flipProfitPercent = 0;

let sortField = 'name'; 
let sortDirection = 'asc'; 

let flipSortField = 'profitPercent'; 
let flipSortDirection = 'desc';      
let useEnchantCrafting = false;

// Настройки зачарования
let enchantBuyMethod = 'instant'; // instant или order
let enchantResourceCity = 'target'; // target, source, any

let itemsDict = {};

function parseTime(timeStr) {
  if (!timeStr) return 0;
  const [datePart, hourPart] = timeStr.split(" ");
  const [y, m, d] = datePart.split(".");
  return new Date(`${y}-${m}-${d}T${hourPart}:00:00`).getTime();
}

function shouldUpdate(currentPrice, currentUpdated, newPrice, newUpdated, isSell) {
  if (currentPrice === null || currentPrice === undefined) return true;
  if (!currentUpdated) return true;

  const oldTime = parseTime(currentUpdated);
  const newTime = parseTime(newUpdated);
  const diffMinutes = (newTime - oldTime) / 60000;

  if (diffMinutes >= 1) return true;
  if (isSell && newPrice < currentPrice) return true;
  if (!isSell && newPrice > currentPrice) return true;

  return false;
}

function processMarketData(data) {
  const { itemId, locationId, auctionType, price, quality, enchantment, timestamp, salesPerDay } = data;

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
  const dictItem = itemsDict[itemId] || {};

  if (!marketState[uniqueKey]) {
    marketState[uniqueKey] = {
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

  const item = marketState[uniqueKey];
  const city = item[cityKey];
  if (!city) return;

  // Обновление цен
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

  // --- ЛОГИКА: Сохраняем продажи в день ---
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

  localStorage.setItem('albionMarketState', JSON.stringify(marketState));
  renderTable();
}

function formatPrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return '-';
  const displayPrice = Math.round(rawPrice / 10000);
  return displayPrice.toLocaleString('ru-RU');
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  const allItems = Object.values(marketState);
  
  const filteredItems = allItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery);
    const matchesQuality = selectedQuality === 'all' || item.quality.toString() === selectedQuality;
    return matchesSearch && matchesQuality;
  });

  const sortedItems = filteredItems.sort((a, b) => {
    let comparison = 0;
    
    if (sortField === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === 'quality') {
      comparison = a.quality - b.quality;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  sortedItems.forEach(item => {
    const row = document.createElement('tr');
    const qualityName = getQualityName(item.quality);
    
    const formatCell = (cityData) => {
      if (cityData.sell === null && cityData.buy === null) {
        return `<td class="no-data">-</td><td class="no-data">-</td>`;
      }
      
      const spdHtml = cityData.salesPerDay 
        ? `<div class="spd-value" style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;"> ${cityData.salesPerDay}/день</div>` 
        : '';
        
      const sellHtml = cityData.sell !== null 
        ? `<div class="price-value">${formatPrice(cityData.sell)}</div><div class="price-date">(${cityData.sellUpdated || '-'})</div>${spdHtml}` 
        : `<span class="no-data">-</span>`;
        
      const buyHtml = cityData.buy !== null 
        ? `<div class="price-value">${formatPrice(cityData.buy)}</div><div class="price-date">(${cityData.buyUpdated || '-'})</div>${spdHtml}` 
        : `<span class="no-data">-</span>`;
        
      return `<td>${sellHtml}</td><td>${buyHtml}</td>`;
    };

    row.innerHTML = `
      <td class="sticky-col-1 item-name">${getDisplayName(item.name)}</td>
      <td class="sticky-col-2 item-quality">${qualityName}</td>
      ${formatCell(item.blackMarket)}
      ${formatCell(item.caerleon)}
      ${formatCell(item.bridgewatch)}
      ${formatCell(item.lymhurst)}
      ${formatCell(item.fortSterling)}
      ${formatCell(item.thetford)}
      ${formatCell(item.martlock)}
      ${formatCell(item.brecilien)}
    `;
    tbody.appendChild(row);
  });
}

let hasPremium = true;
let buyMethod = 'instant';
let sellMethod = 'instant';

const speedSelect = document.getElementById('speedSelect');
if (speedSelect) {
  speedSelect.addEventListener('change', () => {
    calculateFlippingOpportunities();
  });
}

function getFallbackBuyPrice(item, cityKey) {
  const cityData = item[cityKey];
  if (!cityData) return null;

  if (cityData.buy !== null && cityData.buy > 0) {
    return cityData.buy;
  }

  const lowerQuality = item.quality - 1;
  if (lowerQuality < 1) return null;

  const lowerKey = `${item.id}_${lowerQuality}`;
  const lowerItem = marketState[lowerKey];
  
  if (lowerItem && lowerItem[cityKey] && lowerItem[cityKey].buy !== null) {
    return lowerItem[cityKey].buy + 1;
  }

  return null;
}

function calculateFlippingOpportunities() {
  const results = [];
  const taxRate = hasPremium ? 0.04 : 0.08;
  const orderFee = 0.025;

  const selectedTiers = Array.from(document.querySelectorAll('#tierSelect input:checked')).map(cb => parseInt(cb.value));
  const selectedEnchants = Array.from(document.querySelectorAll('#enchantSelect input:checked')).map(cb => parseInt(cb.value));
  const selectedSpeed = speedSelect ? parseInt(speedSelect.value) : 0;

  const filterByTier = selectedTiers.length > 0;
  const filterByEnchant = selectedEnchants.length > 0;
  const allRoyalCities = ['caerleon', 'bridgewatch', 'lymhurst', 'fortSterling', 'thetford', 'martlock', 'brecilien'];
  
  Object.values(marketState).forEach(item => {
    let effectiveBuyPrice = null;
    let craftDetails = '';
    let buyCityName = '';
    let isCrafted = false;
    let craftDetailsObj = null;
    
    const itemTier = item.tier || 0;
    const itemEnchant = item.enchantment || 0;

    if (filterByTier && !selectedTiers.includes(itemTier)) return;
    if (filterByEnchant && !selectedEnchants.includes(itemEnchant)) return;

    if (useEnchantCrafting && item.enchantment > 0 && item.enchantment <= 3) {
        let bestCraftCost = Infinity;
        let bestBaseEnchant = -1;
        let bestCraftDetails = null; 
        
        // 1. Пытаемся найти лучший вариант крафта
        for (let baseEnchant = 0; baseEnchant < item.enchantment; baseEnchant++) {
            const baseId = baseEnchant === 0 
                ? item.id.replace(/@\d+$/, '') 
                : item.id.replace(/@\d+$/, `@${baseEnchant}`);
            
            const baseKey = `${baseId}_${item.quality}`;
            const baseItem = marketState[baseKey];
            
            if (!baseItem) continue;
            
            // Поиск цены базы
            let basePrice = null;
            let baseCityName = '';
            let baseCommission = 0;
            
            if (flipBuyCity === 'any') {
                let minP = Infinity;
                allRoyalCities.forEach(city => {
                    const cd = baseItem[city];
                    if (!cd) return;
                    const p = buyMethod === 'order' ? cd.buy : cd.sell;
                    if (p !== null && p !== undefined && p < minP) {
                        minP = p;
                        baseCityName = getCityDisplayName(city);
                    }
                });
                if (minP !== Infinity) basePrice = minP;
            } else {
                const cd = baseItem[flipBuyCity];
                if (cd) {
                    basePrice = buyMethod === 'order' ? cd.buy : cd.sell;
                    baseCityName = getCityDisplayName(flipBuyCity);
                }
            }
            
            if (basePrice === null) continue;

            if (buyMethod === 'order') baseCommission = basePrice * orderFee;
            
            // Расчет стоимости материалов
            let upgradeCost = 0;
            let validChain = true;
            let materialsList = []; 
            
            for (let e = baseEnchant; e < item.enchantment; e++) {
                let matType = '';
                if (e === 0) matType = 'RUNE';
                else if (e === 1) matType = 'SOUL';
                else if (e === 2) matType = 'RELIC';
                else { validChain = false; break; }
                
                const matId = `T${item.tier}_${matType}`;
                const targetItemDict = itemsDict[item.id];
                let countNeeded = targetItemDict?.enchantMatCount || 100;

                let matPrice = null;
                let matCityName = '';
                const matMarketKey = `${matId}_1`;
                const matMarketItem = marketState[matMarketKey];
                
                if (matMarketItem) {
                    let resourceCities = [];
                    if (enchantResourceCity === 'target') resourceCities = [flipSellCity === 'any' ? 'blackMarket' : flipSellCity];
                    else if (enchantResourceCity === 'source') resourceCities = flipBuyCity === 'any' ? allRoyalCities : [flipBuyCity];
                    else resourceCities = [...allRoyalCities, 'blackMarket'];

                    let minMatPrice = Infinity;
                    resourceCities.forEach(city => {
                        const cd = matMarketItem[city];
                        if (!cd) return;
                        const p = enchantBuyMethod === 'order' ? cd.buy : cd.sell;
                        if (p !== null && p !== undefined && p < minMatPrice) {
                            minMatPrice = p;
                            matCityName = getCityDisplayName(city);
                        }
                    });
                    if (minMatPrice !== Infinity) matPrice = minMatPrice;
                }
                
                if (matPrice === null) { validChain = false; break; }
                
                const stepTotal = matPrice * countNeeded;
                let matCommission = enchantBuyMethod === 'order' ? stepTotal * orderFee : 0;
                upgradeCost += stepTotal + matCommission;
                
                materialsList.push({
                    cityName: matCityName, count: countNeeded, matName: getDisplayName(matId),
                    totalCost: stepTotal, commission: matCommission, isOrder: enchantBuyMethod === 'order'
                });
            }
            
            if (!validChain) continue;
            
            const totalCraftCost = basePrice + baseCommission + upgradeCost;
            
            if (totalCraftCost < bestCraftCost) {
                bestCraftCost = totalCraftCost;
                bestBaseEnchant = baseEnchant;
                const baseDictItem = itemsDict[baseId]; 
                bestCraftDetails = {
                    totalCost: totalCraftCost,
                    baseCity: baseCityName,
                    baseItemName: baseDictItem ? baseDictItem.name : item.name,
                    basePrice: basePrice, baseCommission: baseCommission,
                    materials: materialsList
                };
            }
        }
        
        // 2. Находим лучшую цену ПРЯМОЙ покупки (стандартный алгоритм)
        let directBuyPrice = null;
        let directBuyCity = '';
        
        if (flipBuyCity === 'any') {
            let minP = Infinity;
            allRoyalCities.forEach(city => {
                const cd = item[city];
                if (!cd) return;
                const p = buyMethod === 'order' ? cd.buy : cd.sell;
                if (p !== null && p !== undefined && p < minP) {
                    minP = p;
                    directBuyCity = getCityDisplayName(city);
                }
            });
            if (minP !== Infinity) directBuyPrice = minP;
        } else {
            const cd = item[flipBuyCity];
            if (cd) {
                directBuyPrice = buyMethod === 'order' ? cd.buy : cd.sell;
                directBuyCity = getCityDisplayName(flipBuyCity);
            }
        }

        // 3. СРАВНИВАЕМ И ВЫБИРАЕМ ЛУЧШИЙ ВАРИАНТ
        if (bestCraftCost < Infinity && (directBuyPrice === null || bestCraftCost < directBuyPrice)) {
            // КРАФТ ВЫГОДНЕЕ
            effectiveBuyPrice = bestCraftCost;
            isCrafted = true;
            craftDetailsObj = bestCraftDetails;
            buyCityName = bestCraftDetails.baseCity; // Берем город из крафта
        } else if (directBuyPrice !== null) {
            // ПРЯМАЯ ПОКУПКА ВЫГОДНЕЕ (или крафт невозможен)
            // ПРОГОНЯЕМ ПО СТАНДАРТНОМУ АЛГОРИТМУ
            effectiveBuyPrice = directBuyPrice;
            buyCityName = directBuyCity; // Город из прямой покупки
            isCrafted = false; // Сбрасываем флаг крафта
        }
    } else {
        // === СТАНДАРТНАЯ ЛОГИКА (если зачарование выключено или enchant=0) ===
        if (flipBuyCity === 'any') {
            let minPrice = Infinity;
            let bestCity = '';
            allRoyalCities.forEach(city => {
                const cityData = item[city];
                if (!cityData) return;
                let priceToCheck = buyMethod === 'order' ? getFallbackBuyPrice(item, city) : cityData.sell;
                if (priceToCheck !== null && priceToCheck < minPrice) {
                    minPrice = priceToCheck;
                    bestCity = city;
                }
            });
            if (minPrice !== Infinity) {
                effectiveBuyPrice = minPrice;
                buyCityName = getCityDisplayName(bestCity);
            }
        } else {
            const cityData = item[flipBuyCity];
            if (cityData) {
                effectiveBuyPrice = buyMethod === 'order' ? getFallbackBuyPrice(item, flipBuyCity) : cityData.sell;
                buyCityName = getCityDisplayName(flipBuyCity);
            }
        }
    }

    if (!effectiveBuyPrice) return;

    let actualBuyCost = effectiveBuyPrice;
    let buyCommission = 0;

    if (buyMethod === 'order') {
      buyCommission = effectiveBuyPrice * orderFee;
      actualBuyCost = effectiveBuyPrice + buyCommission;
    }

    let sellPrice = null;
    let sellCityName = '';

    if (flipSellCity === 'any') {
      let maxPrice = -Infinity;
      let bestCity = '';
      
      [...allRoyalCities, 'blackMarket'].forEach(city => {
        const cityData = item[city];
        if (!cityData) return;
        const priceToCheck = sellMethod === 'order' ? cityData.sell : cityData.buy;
        
        if (priceToCheck !== null && priceToCheck > maxPrice) {
          maxPrice = priceToCheck;
          bestCity = city;
        }
      });
      
      if (maxPrice !== -Infinity) {
        sellPrice = maxPrice;
        sellCityName = getCityDisplayName(bestCity);
      }
    } else {
      const cityData = item[flipSellCity];
      if (cityData) {
        sellPrice = sellMethod === 'order' ? cityData.sell : cityData.buy;
        sellCityName = getCityDisplayName(flipSellCity);
      }
    }

    if (!sellPrice) return;

    let grossSellRevenue = sellPrice;
    if (sellMethod === 'order') {
      grossSellRevenue = sellPrice * (1 - orderFee);
    }
    const netSellRevenue = grossSellRevenue * (1 - taxRate); 

    const profit = netSellRevenue - actualBuyCost;
    const profitPercent = (profit / actualBuyCost) * 100;

    // --- ФИЛЬТРАЦИЯ ПО СКОРОСТИ ---
    const spd = item.salesPerDay || 0;
    if (selectedSpeed > 0) {
      let isAllowed = false;
      if (spd >= 96) isAllowed = true; 
      else if (spd >= 24 && selectedSpeed >= 2) isAllowed = true;
      else if (spd >= 4 && selectedSpeed >= 3) isAllowed = true;
      else if (spd >= 1 && selectedSpeed >= 4) isAllowed = true;
      else if (spd === 0 && selectedSpeed === 5) isAllowed = true;

      if (!isAllowed) return; 
    }

    if (profitPercent >= flipProfitPercent && profit > 0) {
      
      // ИСПРАВЛЕНИЕ: Формируем отображаемую цену прямо здесь
      let finalDisplayPrice = '';
      if (isCrafted && craftDetailsObj) {
          // Если крафт - показываем общую сумму трат
          finalDisplayPrice = formatPrice(craftDetailsObj.totalCost);
      } else {
          // Если обычная покупка - показываем цену с комиссией
          finalDisplayPrice = formatPrice(actualBuyCost);
      }
      results.push({
        itemName: item.name,
        tier: itemTier,
        enchant: itemEnchant,
        quality: item.quality,
        salesPerDay: item.salesPerDay || 0,
        buyCity: buyCityName,
        buyPriceDisplay: finalDisplayPrice, 
        buyCommissionDisplay: buyCommission > 0 ? `+${formatPrice(buyCommission)}` : '-',
        sellCity: sellCityName,
        netSellPrice: Math.round(netSellRevenue),
        commissionDeducted: Math.round(grossSellRevenue - netSellRevenue),
        profitPercent: profitPercent.toFixed(1),
        cleanProfit: Math.round(profit),
        isCrafted: isCrafted,
        craftDetailsObj: craftDetailsObj,
        craftDetails: craftDetails
      });
    }
  });

  results.sort((a, b) => {
    let valA, valB;
    if (flipSortField === 'profitPercent') {
      valA = parseFloat(a.profitPercent);
      valB = parseFloat(b.profitPercent);
    } else {
      valA = a.cleanProfit;
      valB = b.cleanProfit;
    }
    return flipSortDirection === 'asc' ? valA - valB : valB - valA;
  });

  renderFlippingResults(results);
}

function getCityDisplayName(cityKey) {
  const names = {
    caerleon: 'Caerleon', bridgewatch: 'Bridgewatch', lymhurst: 'Lymhurst',
    fortSterling: 'Fort Sterling', thetford: 'Thetford', martlock: 'Martlock',
    brecilien: 'Brecilien', blackMarket: 'Black Market'
  };
  return names[cityKey] || cityKey;
}

function extractTier(itemId) {
  const match = itemId.match(/^T(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function extractEnchant(itemId) {
  if (!itemId) return 0;
  const match = itemId.match(/@(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function renderFlippingResults(results) {
  const wrapper = document.querySelector('#page-flipping .flipping-results');
  if (!wrapper) return;

  if (results.length === 0) {
    wrapper.innerHTML = `<p style="color: var(--text-primary); opacity: 0.5; font-size: 14px;">Нет сделок с прибылью ≥ ${flipProfitPercent}%</p>`;
    return;
  }

  let html = `
    <table class="flipping-table">
      <thead>
        <tr>
          <th>Предмет</th>
          <th>Покупка</th>
          <th></th>
          <th>Продажа</th>
          <th class="profit-col sortable-flip" id="flipSortHeader">
            <span class="sort-label">Прибыль (%)</span> <span class="sort-arrow"></span>
          </th>
        </tr>
      </thead>
      <tbody>`;

  results.forEach(r => {
    html += `
      <tr>
        <td class="item-cell">
          <div class="item-name">${r.itemName}</div>
          <div class="item-meta">T${r.tier} | +${r.enchant} | ${getQualityName(r.quality)}</div>
        </td>
        <td class="city-cell buy-info">
          ${r.isCrafted && r.craftDetailsObj ? `
            <!-- 1. ОБЩАЯ СУММА ТРАТ -->
            <div class="craft-total-sum">${formatPrice(r.craftDetailsObj.totalCost)}</div>
            
            <!-- 2. БАЗОВЫЙ ПРЕДМЕТ -->
            <div class="craft-base-row">
              <span class="city-name">${r.craftDetailsObj.baseCity}</span>
              <span class="craft-item-name">(${r.craftDetailsObj.baseItemName})</span>
            </div>
            <div class="buy-price">${formatPrice(r.craftDetailsObj.basePrice)}</div>
            
            <!-- Комиссия базы (если есть) -->
            ${r.craftDetailsObj.baseCommission > 0 ? `
              <div class="base-commission">+${formatPrice(r.craftDetailsObj.baseCommission)}</div>
            ` : ''}

            <!-- 3. МАТЕРИАЛЫ -->
            ${r.craftDetailsObj.materials.map(mat => {
                const matStepTotal = mat.totalCost + mat.commission; 
                return `
              <div class="craft-mat-row">
                <div class="mat-header">
                  <span class="city-name-small">${mat.cityName}</span>
                  <span class="mat-count">(${mat.count} шт.)</span>
                </div>
                <div class="mat-info-line">
                  <span class="mat-name">${mat.matName}</span>
                  
                  <!-- Итоговая цена + Комиссия справа -->
                  <div class="mat-cost-group">
                    <span class="mat-cost">${formatPrice(matStepTotal)}</span>
                    ${mat.isOrder ? `<span class="order-plus">+${formatPrice(mat.commission)}</span>` : ''}
                  </div>
                </div>
              </div>
            `}).join('')}
          ` : `
            <!-- Обычный режим -->
            <div class="city-name">${r.buyCity}</div>
            <div class="buy-price">${r.buyPriceDisplay}</div>
            <div class="buy-commission">${r.buyCommissionDisplay}</div>
          `}
        </td>
        <td class="arrow-cell">
          <div style="font-size: 16px;">➜</div>
          <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">
            ${r.salesPerDay}/день
          </div>
        </td>
        <td class="sell-cell">
          <div class="sell-city">${r.sellCity}</div>
          <div class="sell-price">${formatPrice(r.netSellPrice)}</div>
          <div class="sell-commission">-${formatPrice(r.commissionDeducted)}</div>
        </td>
        <td class="profit-cell">
          <div class="profit-percent">${r.profitPercent}%</div>
          <div class="clean-profit">+${formatPrice(r.cleanProfit)}</div>
        </td>
      </tr>`;
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

ipcRenderer.on('market-data-received', (event, data) => {
  if (Array.isArray(data)) data.forEach(processMarketData);
  else processMarketData(data);
});

function initThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
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
  document.getElementById('minimizeBtn').addEventListener('click', () => ipcRenderer.send('window-minimize'));
  document.getElementById('maximizeBtn').addEventListener('click', () => ipcRenderer.send('window-maximize'));
  document.getElementById('closeBtn').addEventListener('click', () => ipcRenderer.send('window-close'));
}

let backendRunning = false;

function initBackendControls() {
  const backendToggle = document.getElementById('backendToggle');
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
      captureIndicator.classList.remove('active');
      encryptionIndicator.classList.remove('encrypted');
    } else {
      ipcRenderer.send('start-backend');
      backendRunning = true;
      btnIcon.textContent = '⏹';
      btnText.textContent = 'Остановить сбор данных';
      backendToggle.classList.add('active');
      captureIndicator.classList.add('active');
    }
  });

  ipcRenderer.on('backend-status', (event, status) => {
    if (status.running) {
      captureIndicator.classList.add('active');
      if (!backendRunning) {
        backendRunning = true;
        btnIcon.textContent = '⏹';
        btnText.textContent = 'Остановить сбор данных';
        backendToggle.classList.add('active');
      }
    } else {
      captureIndicator.classList.remove('active');
      backendRunning = false;
      btnIcon.textContent = '▶';
      btnText.textContent = 'Запустить сбор данных';
      backendToggle.classList.remove('active');
    }

    if (status.encrypted) {
      encryptionIndicator.classList.add('encrypted');
    } else {
      encryptionIndicator.classList.remove('encrypted');
    }
  });

  ipcRenderer.on('backend-error', (event, error) => {
    console.error('Backend error:', error);
    alert(error);
    backendRunning = false;
    btnIcon.textContent = '▶';
    btnText.textContent = 'Запустить сбор данных';
    backendToggle.classList.remove('active');
    captureIndicator.classList.remove('active');
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
      const pageId = `page-${btn.dataset.page}`;
      const targetPage = document.getElementById(pageId);
      if (targetPage) {
        targetPage.classList.add('active');
      }
    });
  });
}

function initSorting() {
  const nameHeader = document.getElementById('sortByName');
  if (nameHeader) {
    nameHeader.addEventListener('click', () => {
      if (sortField === 'name') {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = 'name';
        sortDirection = 'asc';
      }
      updateSortUI();
      renderTable();
    });
  }
}

function updateFlipSortUI() {
  const header = document.getElementById('flipSortHeader');
  if (!header) return;
  header.classList.remove('asc');
  header.classList.add('desc');
  if (flipSortField === 'profitPercent') {
    header.childNodes[0].textContent = 'Прибыль (%) ';
  } else {
    header.childNodes[0].textContent = 'Чистая прибыль ';
  }
}

function updateSortUI() {
  const nameHeader = document.getElementById('sortByName');
  nameHeader.classList.remove('active', 'asc', 'desc');
  nameHeader.classList.add('active', sortDirection);
}

ipcRenderer.on('dictionary-loaded', (event, dictionary) => {
  itemsDict = dictionary;
  console.log(`[Renderer] Словарь получен: ${Object.keys(itemsDict).length} записей`);
  
  let updatedCount = 0;
  for (const [key, item] of Object.entries(marketState)) {
    const parts = key.split('_');
    const qualitySuffix = parts.pop();
    const fullTechId = parts.join('_');
    
    const dictItem = itemsDict[fullTechId];
    if (dictItem) {
      item.id = fullTechId;
      item.name = dictItem.name || item.name;
      item.tier = dictItem.tier;
      item.enchantment = dictItem.enchantment !== undefined ? dictItem.enchantment : extractEnchant(item.id);
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    console.log(`[Fix] Восстановлено и обновлено ${updatedCount} предметов`);
    localStorage.setItem('albionMarketState', JSON.stringify(marketState));
  }
  
  renderTable();
  calculateFlippingOpportunities();
});

function getDisplayName(itemId) {
  if (itemsDict[itemId]) {
    return itemsDict[itemId].name;
  }
  return itemId;
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initWindowControls();
  initBackendControls();
  initNavigation();
  initSorting();
  updateSortUI(); 

  const searchInput = document.getElementById('searchInput');
  const qualitySelect = document.getElementById('qualitySelect');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderTable();
    });
  }

  if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
      selectedQuality = e.target.value;
      renderTable();
    });
  }

  const buyCitySelect = document.getElementById('buyCitySelect');
  const sellCitySelect = document.getElementById('sellCitySelect');
  const profitInput = document.getElementById('profitPercentInput');

  if (buyCitySelect) buyCitySelect.addEventListener('change', (e) => {
    flipBuyCity = e.target.value;
    calculateFlippingOpportunities();
  });

  if (sellCitySelect) sellCitySelect.addEventListener('change', (e) => {
    flipSellCity = e.target.value;
    calculateFlippingOpportunities();
  });

  if (profitInput) profitInput.addEventListener('input', (e) => {
    flipProfitPercent = parseFloat(e.target.value) || 0;
    calculateFlippingOpportunities();
  });

  const premiumBtns = document.querySelectorAll('.premium-btn');
  premiumBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      premiumBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hasPremium = btn.dataset.value === 'true';
      calculateFlippingOpportunities();
    });
  });

  function initMultiSelect(selectId, headerText) {
    const container = document.getElementById(selectId);
    if (!container) return;
    const header = container.querySelector('.multi-select-header');
    const options = container.querySelector('.multi-select-options');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multi-select-options').forEach(opt => {
        if (opt !== options) opt.classList.remove('open');
      });
      options.classList.toggle('open');
    });

    const updateHeader = () => {
      const checked = Array.from(checkboxes).filter(cb => cb.checked);
      if (checked.length === 0) {
        header.textContent = headerText;
      } else if (checked.length <= 3) {
        header.textContent = checked.map(cb => cb.parentElement.textContent.trim()).join(', ');
      } else {
        header.textContent = `Выбрано: ${checked.length}`;
      }
    };

    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        updateHeader();
        calculateFlippingOpportunities(); 
      });
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) options.classList.remove('open');
    });
  }

  initMultiSelect('tierSelect', 'Выберите уровни...');
  initMultiSelect('enchantSelect', 'Выберите зачарование...');

  function initTradeToggle(toggleId, defaultValue, label) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return null;
    const buttons = toggle.querySelectorAll('.trade-btn');
    let currentValue = defaultValue;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentValue = btn.dataset.value;
        if (label === 'Способ покупки') buyMethod = currentValue;
        if (label === 'Способ продажи') sellMethod = currentValue;
        calculateFlippingOpportunities();
      });
    });
    return () => currentValue;
  }

  // Инициализация переключателя зачарования (исправлен ID на enchantMethodToggle)
  const enchantToggle = document.getElementById('enchantMethodToggle');
  if (enchantToggle) {
      const buttons = enchantToggle.querySelectorAll('.enchant-btn');
      
      // Функция для управления видимостью строк
      const updateEnchantVisibility = (isVisible) => {
          const rows = document.querySelectorAll('.enchant-setting-row');
          rows.forEach(row => {
              row.style.display = isVisible ? 'block' : 'none';
          });
      };

      // Устанавливаем начальное состояние
      updateEnchantVisibility(useEnchantCrafting);

      buttons.forEach(btn => {
          btn.addEventListener('click', () => {
              buttons.forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              
              useEnchantCrafting = btn.dataset.value === 'true';
              updateEnchantVisibility(useEnchantCrafting);
              
              calculateFlippingOpportunities();
          });
      });
  }

  // Инициализация способа покупки ресурсов
  const enchantBuyToggle = document.getElementById('enchantBuyMethodToggle');
  if (enchantBuyToggle) {
      const btns = enchantBuyToggle.querySelectorAll('.trade-btn');
      btns.forEach(b => {
          b.addEventListener('click', () => {
              btns.forEach(x => x.classList.remove('active'));
              b.classList.add('active');
              enchantBuyMethod = b.dataset.value;
              calculateFlippingOpportunities();
          });
      });
  }

  // Инициализация города ресурсов
  const enchantCitySelect = document.getElementById('enchantResourceCity');
  if (enchantCitySelect) {
      enchantCitySelect.addEventListener('change', (e) => {
          enchantResourceCity = e.target.value;
          calculateFlippingOpportunities();
      });
  }

  const getBuyMethod = initTradeToggle('buyMethodToggle', 'instant', 'Способ покупки');
  const getSellMethod = initTradeToggle('sellMethodToggle', 'instant', 'Способ продажи');

  document.addEventListener('click', (e) => {
    const sortHeader = e.target.closest('#flipSortHeader');
    if (sortHeader) {
      flipSortField = flipSortField === 'profitPercent' ? 'cleanProfit' : 'profitPercent';
      flipSortDirection = 'desc'; 
      updateFlipSortUI();
      calculateFlippingOpportunities();
    }
  });

  calculateFlippingOpportunities(); 
});