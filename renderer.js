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
  return qualityMap[q] || `Q${q}`;
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

  if (!marketState[uniqueKey]) {
    marketState[uniqueKey] = {
      name: getDisplayName(itemId),
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
  
  // Перерисовываем таблицу с новыми названиями
  renderTable();
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
  
  // Инициализация фильтров
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

  if (buyCitySelect) {
    buyCitySelect.addEventListener('change', (e) => {
      flipBuyCity = e.target.value;
      // TODO: Здесь будет запуск расчета флиппинга
      console.log('Город покупки:', flipBuyCity);
    });
  }

  if (sellCitySelect) {
    sellCitySelect.addEventListener('change', (e) => {
      flipSellCity = e.target.value;
      // TODO: Здесь будет запуск расчета флиппинга
      console.log('Город продажи:', flipSellCity);
    });
  }

  if (profitInput) {
    profitInput.addEventListener('input', (e) => {
      flipProfitPercent = parseFloat(e.target.value) || 0;
      // TODO: Здесь будет запуск расчета флиппинга
      console.log('Процент прибыли:', flipProfitPercent);
    });
  }

  initSorting();
  updateSortUI(); 

  initNavigation();

  renderTable();

    // --- Логика переключателя Премиума ---
  const premiumBtns = document.querySelectorAll('.premium-btn');
  let hasPremium = true; // По умолчанию "Да"

  premiumBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      premiumBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hasPremium = btn.dataset.value === 'true';
      console.log('Премиум:', hasPremium);
      // TODO: Запуск расчета
    });
  });

  // --- Логика Скорости реализации ---
  const speedSelect = document.getElementById('speedSelect');
  if (speedSelect) {
    speedSelect.addEventListener('change', (e) => {
      console.log('Скорость реализации:', e.target.value);
      // TODO: Запуск расчета
    });
  }

  // --- Логика Мультиселектов (Уровень и Зачарование) ---
  function initMultiSelect(selectId, headerText) {
    const container = document.getElementById(selectId);
    if (!container) return;

    const header = container.querySelector('.multi-select-header');
    const options = container.querySelector('.multi-select-options');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');

    // Открытие/закрытие списка
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      // Закрываем другие открытые списки
      document.querySelectorAll('.multi-select-options').forEach(opt => {
        if (opt !== options) opt.classList.remove('open');
      });
      options.classList.toggle('open');
    });

    // Обновление текста заголовка при выборе
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
        // Собираем значения
        const values = Array.from(checkboxes)
          .filter(c => c.checked)
          .map(c => parseInt(c.value));
        console.log(`${selectId}:`, values);
        // TODO: Запуск расчета
      });
    });

    // Закрытие при клике вне списка
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        options.classList.remove('open');
      }
    });
  }

  initMultiSelect('tierSelect', 'Выберите уровни...');
  initMultiSelect('enchantSelect', 'Выберите зачарование...');

    // --- Логика способов покупки и продажи ---
  function initTradeToggle(toggleId, defaultValue, label) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;
    
    const buttons = toggle.querySelectorAll('.trade-btn');
    let currentValue = defaultValue;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentValue = btn.dataset.value;
        console.log(`${label}:`, currentValue);
        // TODO: Запуск расчета флиппинга
      });
    });

      // --- Логика переключателя Зачарования ---
  const enchantBtns = document.querySelectorAll('.enchant-btn');
  let shouldEnchant = true; // По умолчанию "Зачаровывать"

  enchantBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      enchantBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      shouldEnchant = btn.dataset.value === 'true';
      console.log('Зачарование:', shouldEnchant ? 'Включено' : 'Выключено');
      // TODO: Запуск расчета флиппинга
    });
  });

    return () => currentValue; // Возвращаем функцию-геттер
  }

  const getBuyMethod = initTradeToggle('buyMethodToggle', 'instant', 'Способ покупки');
  const getSellMethod = initTradeToggle('sellMethodToggle', 'instant', 'Способ продажи');
});