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
  return qualityMap[q] || 'Неизвестно'; // Или просто '', или 'N/A'
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

let sortField = 'name'; // 'name' или 'quality'
let sortDirection = 'asc'; // 'asc' или 'desc'

let flipSortField = 'profitPercent'; // 'profitPercent' или 'cleanProfit'
let flipSortDirection = 'desc';      // 'desc' или 'asc'

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
  const { itemId, locationId, auctionType, price, quality, enchant, timestamp } = data;
  
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
      id: itemId, // Сохраняем ПОЛНЫЙ технический ID (T4_2H_BOW)
      name: dictItem.name || itemId,
      tier: dictItem.tier || extractTier(itemId),
      enchant: dictItem.enchant !== undefined ? dictItem.enchant : 0,
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
  
  // Фильтрация по названию и качеству
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
    
    // Универсальная функция отрисовки двух колонок (Продажа / Покупка)
    const formatCell = (cityData) => {
      if (cityData.sell === null && cityData.buy === null) {
        return `<td class="no-data">-</td><td class="no-data">-</td>`;
      }
      
      const sellHtml = cityData.sell !== null 
        ? `<div class="price-value">${formatPrice(cityData.sell)}</div><div class="price-date">(${cityData.sellUpdated || '-'})</div>` 
        : `<span class="no-data">-</span>`;
        
      const buyHtml = cityData.buy !== null 
        ? `<div class="price-value">${formatPrice(cityData.buy)}</div><div class="price-date">(${cityData.buyUpdated || '-'})</div>` 
        : `<span class="no-data">-</span>`;
        
      return `<td>${sellHtml}</td><td>${buyHtml}</td>`;
    };

    // Теперь Black Market рисуется так же, как и остальные города
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

// Глобальные переменные состояния флиппинга (убедись, что они объявлены)
let hasPremium = true;
let buyMethod = 'instant'; // 'instant' или 'order'
let sellMethod = 'instant'; // 'instant' или 'order'

function calculateFlippingOpportunities() {
  const results = [];
  const taxRate = hasPremium ? 0.04 : 0.08;
  const orderFee = 0.025;

  // Получаем текущие значения фильтров из мультиселектов
  const selectedTiers = Array.from(document.querySelectorAll('#tierSelect input:checked')).map(cb => parseInt(cb.value));
  const selectedEnchants = Array.from(document.querySelectorAll('#enchantSelect input:checked')).map(cb => parseInt(cb.value));
  
  // Если ничего не выбрано, считаем что выбраны ВСЕ (чтобы фильтр не блокировал вывод)
  const filterByTier = selectedTiers.length > 0;
  const filterByEnchant = selectedEnchants.length > 0;


  // Список городов для поиска минимальной цены покупки
  const allRoyalCities = ['caerleon', 'bridgewatch', 'lymhurst', 'fortSterling', 'thetford', 'martlock', 'brecilien'];
  
  // Перебираем все предметы из таблицы рынка
  Object.values(marketState).forEach(item => {
        // 1. Определяем цену ПОКУПКИ
    let buyPrice = null;
    let buyCityName = '';

    
    const itemTier = item.tier || 0;
    const itemEnchant = item.enchant || 0;

    // === ФИЛЬТРАЦИЯ ПО ТИРУ И ЗАЧАРОВАНИЮ ===
    if (filterByTier && !selectedTiers.includes(itemTier)) return;
    if (filterByEnchant && !selectedEnchants.includes(itemEnchant)) return;

    if (flipBuyCity === 'any') {
      // Ищем минимальную цену среди королевских городов
      let minPrice = Infinity;
      let bestCity = '';
      
      allRoyalCities.forEach(city => {
        const cityData = item[city];
        if (!cityData) return;

        // ВАЖНО: Выбираем поле в зависимости от способа покупки!
        const priceToCheck = buyMethod === 'order' ? cityData.buy : cityData.sell;
        
        if (priceToCheck !== null && priceToCheck < minPrice) {
          minPrice = priceToCheck;
          bestCity = city;
        }
      });
      
      if (minPrice !== Infinity) {
        buyPrice = minPrice;
        buyCityName = getCityDisplayName(bestCity);
      }
    } else {
      // Конкретный город покупки
      const cityData = item[flipBuyCity];
      if (cityData) {
        // ВАЖНО: Выбираем поле в зависимости от способа покупки!
        buyPrice = buyMethod === 'order' ? cityData.buy : cityData.sell;
        buyCityName = getCityDisplayName(flipBuyCity);
      }
    }

    // Если не нашли цену покупки — пропускаем предмет
    if (!buyPrice) return;

    // Корректируем цену покупки (комиссия за выставление ордера)
    let actualBuyCost = buyPrice;
    let buyCommission = 0;

    if (buyMethod === 'order') {
      // Заказ на покупку: цена request + 2.5% комиссии
      buyCommission = buyPrice * orderFee;
      actualBuyCost = buyPrice + buyCommission;
    } else {
      // Быстрая покупка: цена offer, комиссия 0
      buyCommission = 0;
      actualBuyCost = buyPrice;
    }

        // 2. Определяем цену ПРОДАЖИ
    let sellPrice = null;
    let sellCityName = '';

    if (flipSellCity === 'any') {
      // Ищем максимальную цену среди всех городов + Black Market
      let maxPrice = -Infinity;
      let bestCity = '';
      
      [...allRoyalCities, 'blackMarket'].forEach(city => {
        const cityData = item[city];
        if (!cityData) return;

        // ВАЖНО: Выбираем поле в зависимости от способа продажи!
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
      // Конкретный город продажи
      const cityData = item[flipSellCity];
      if (cityData) {
        // ВАЖНО: Выбираем поле в зависимости от способа продажи!
        sellPrice = sellMethod === 'order' ? cityData.sell : cityData.buy;
        sellCityName = getCityDisplayName(flipSellCity);
      }
    }

    // Если не нашли цену продажи — пропускаем предмет
    if (!sellPrice) return;

    // Корректируем цену продажи
    let grossSellRevenue = sellPrice;
    if (sellMethod === 'order') {
      // Заказ на продажу: цена offer - 2.5% комиссии
      grossSellRevenue = sellPrice * (1 - orderFee);
    }
    // При быстрой продаже берется цена buy без дополнительной комиссии за ордер
    const netSellRevenue = grossSellRevenue * (1 - taxRate); 

    // 3. Расчет прибыли
    const profit = netSellRevenue - actualBuyCost;
    const profitPercent = (profit / actualBuyCost) * 100;

    // 4. Фильтрация по желаемой прибыли
    if (profitPercent >= flipProfitPercent && profit > 0) {
      results.push({
        itemName: item.name, // Берем готовое красивое имя
        tier: itemTier,
        enchant: itemEnchant,
        quality: item.quality,
        buyCity: buyCityName,
        buyPriceDisplay: formatPrice(actualBuyCost), // Цена покупки с учетом комиссии
        buyCommissionDisplay: buyCommission > 0 ? `+${formatPrice(buyCommission)}` : '-', // Комиссия
        sellCity: sellCityName,
        netSellPrice: Math.round(netSellRevenue),
        commissionDeducted: Math.round(grossSellRevenue - netSellRevenue),
        profitPercent: profitPercent.toFixed(1),
        cleanProfit: Math.round(profit)
      });
    }
  });

  // Сортируем по проценту прибыли (по убыванию)
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

// Вспомогательная функция для красивых названий городов
function getCityDisplayName(cityKey) {
  const names = {
    caerleon: 'Caerleon', bridgewatch: 'Bridgewatch', lymhurst: 'Lymhurst',
    fortSterling: 'Fort Sterling', thetford: 'Thetford', martlock: 'Martlock',
    brecilien: 'Brecilien', blackMarket: 'Black Market'
  };
  return names[cityKey] || cityKey;
}

// Извлечение тира из ID предмета (если нет в словаре)
function extractTier(itemId) {
  const match = itemId.match(/^T(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function renderFlippingResults(results) {
  const wrapper = document.querySelector('#page-flipping .flipping-results');
  if (!wrapper) return;

  if (results.length === 0) {
    wrapper.innerHTML = `
      <p style="color: var(--text-primary); opacity: 0.5; font-size: 14px;">
        Нет сделок с прибылью ≥ ${flipProfitPercent}%
      </p>`;
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
          <div class="city-name">${r.buyCity}</div>
          <div class="buy-price">${r.buyPriceDisplay}</div>
          <div class="buy-commission">${r.buyCommissionDisplay}</div>
        </td>
        <td class="arrow-cell">➜</td>
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
}

function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const pages = document.querySelectorAll('.page');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Убираем активный класс у всех кнопок
      navBtns.forEach(b => b.classList.remove('active'));
      // Добавляем активный класс нажатой кнопке
      btn.classList.add('active');

      // Скрываем все страницы
      pages.forEach(page => page.classList.remove('active'));
      
      // Показываем нужную страницу
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
      // Если кликнули по тому же полю - меняем направление
      if (sortField === 'name') {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        // Если переключились с другого поля - начинаем с ASC
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
  
  // Всегда показываем стрелку вниз, так как сортировка всегда desc
  header.classList.remove('asc');
  header.classList.add('desc');
  
  // Опционально: меняем текст заголовка для ясности
  const arrowSpan = header.querySelector('.sort-arrow');
  if (flipSortField === 'profitPercent') {
    header.childNodes[0].textContent = 'Прибыль (%) ';
  } else {
    header.childNodes[0].textContent = 'Чистая прибыль ';
  }
}

function updateSortUI() {
  const nameHeader = document.getElementById('sortByName');
  
  // Сбрасываем все классы
  nameHeader.classList.remove('active', 'asc', 'desc');
  
  // Добавляем нужные
  nameHeader.classList.add('active', sortDirection);
}

ipcRenderer.on('dictionary-loaded', (event, dictionary) => {
  itemsDict = dictionary;
  console.log(`[Renderer] Словарь получен: ${Object.keys(itemsDict).length} записей`);
  
  let updatedCount = 0;
  
  // Перебираем ВСЕ записи в marketState по их КЛЮЧАМ
  for (const [key, item] of Object.entries(marketState)) {
    // Ключ в LS имеет формат "TECHNICAL_ID_QUALITY" (например, T4_2H_BOW_1)
    // Убираем последнее _число, чтобы получить чистый технический ID
    const parts = key.split('_');
    const qualitySuffix = parts.pop(); // Удаляем качество (1, 2, 3...)
    const fullTechId = parts.join('_'); // Собираем обратно: T4_2H_BOW
    
    const dictItem = itemsDict[fullTechId];
    
    if (dictItem) {
      // Принудительно обновляем данные из словаря
      item.id = fullTechId; // Исправляем сломанный ID
      item.name = dictItem.name || item.name;
      item.tier = dictItem.tier;
      item.enchant = dictItem.enchant !== undefined ? dictItem.enchant : 0;
      
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

// Функция получения отображаемого имени
function getDisplayName(itemId) {
  if (itemsDict[itemId]) {
    return itemsDict[itemId].name;
  }
  // Если нет в словаре - возвращаем оригинальный ID
  return itemId;
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initWindowControls();
  initBackendControls();
  initNavigation();
  initSorting();
  updateSortUI(); 

  // --- Инициализация фильтров РЫНКА ---
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

  // --- Инициализация фильтров ФЛИППИНГА ---
  
  // 1. Города и процент прибыли
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

  // 2. Переключатель Премиума (используем ГЛОБАЛЬНУЮ переменную)
  const premiumBtns = document.querySelectorAll('.premium-btn');
  premiumBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      premiumBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hasPremium = btn.dataset.value === 'true'; // Обновляем глобальную переменную
      calculateFlippingOpportunities();
    });
  });

  // 3. Скорость реализации (пока заглушка, но пересчет можно добавить позже)
  const speedSelect = document.getElementById('speedSelect');
  if (speedSelect) {
    speedSelect.addEventListener('change', (e) => {
      console.log('Скорость реализации:', e.target.value);
      // calculateFlippingOpportunities(); // Раскомментируй, когда добавишь логику скорости
    });
  }

  // 4. Мультиселекты (Тир и Зачарование)
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
        // При изменении любого чекбокса пересчитываем таблицу флиппинга
        calculateFlippingOpportunities(); 
      });
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) options.classList.remove('open');
    });
  }

  initMultiSelect('tierSelect', 'Выберите уровни...');
  initMultiSelect('enchantSelect', 'Выберите зачарование...');

  // 5. Способы покупки и продажи (вынесены отдельно!)
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
        
        // Обновляем глобальные переменные
        if (label === 'Способ покупки') buyMethod = currentValue;
        if (label === 'Способ продажи') sellMethod = currentValue;
        
        calculateFlippingOpportunities();
      });
    });

    return () => currentValue;
  }

  const getBuyMethod = initTradeToggle('buyMethodToggle', 'instant', 'Способ покупки');
  const getSellMethod = initTradeToggle('sellMethodToggle', 'instant', 'Способ продажи');

  // 6. Переключатель Зачарования
  const enchantBtns = document.querySelectorAll('.enchant-btn');
  let shouldEnchant = true; 

  enchantBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      enchantBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      shouldEnchant = btn.dataset.value === 'true';
      console.log('Зачарование:', shouldEnchant ? 'Включено' : 'Выключено');
      // Пока не влияет на расчет, но можно добавить позже
    });
  });

  document.addEventListener('click', (e) => {
    const sortHeader = e.target.closest('#flipSortHeader');
    if (sortHeader) {
      // Переключаем поле сортировки
      flipSortField = flipSortField === 'profitPercent' ? 'cleanProfit' : 'profitPercent';
      
      // Направление ВСЕГДА остается от большего к меньшему
      flipSortDirection = 'desc'; 
      
      updateFlipSortUI();
      calculateFlippingOpportunities();
    }
  });

  // Первичный расчет при загрузке страницы (чтобы таблица появилась сразу)
  calculateFlippingOpportunities(); 
});