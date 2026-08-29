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
// Сохраняем миграцию
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

  // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Уникальный ключ теперь включает качество
  const uniqueKey = `${itemId}_${quality}`;

  if (!marketState[uniqueKey]) {
    marketState[uniqueKey] = {
      name: itemId,
      quality: quality, // Сохраняем качество в объекте
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

  const sortedItems = Object.values(marketState).sort((a, b) => {
    if (a.name === b.name) {
      return b.quality - a.quality;
    }
    return a.name.localeCompare(b.name);
  });

  sortedItems.forEach(item => {
    const row = document.createElement('tr');
    const qualityName = getQualityName(item.quality);
    
    const formatCell = (cityData) => {
    if (cityData.sell === null && cityData.buy === null) {
        return `<td class="no-data" colspan="2">Нет данных</td>`;
    }
    
    const sellHtml = cityData.sell !== null 
        ? `<div class="price-value">${formatPrice(cityData.sell)}</div><div class="price-date">(${cityData.sellUpdated || '-'})</div>` 
        : `<span class="no-data">-</span>`;
        
    const buyHtml = cityData.buy !== null 
        ? `<div class="price-value">${formatPrice(cityData.buy)}</div><div class="price-date">(${cityData.buyUpdated || '-'})</div>` 
        : `<span class="no-data">-</span>`;
        
    return `<td>${sellHtml}</td><td>${buyHtml}</td>`;
    };

    const bmData = item.blackMarket;
    const bmVal = bmData.sell !== null ? bmData.sell : bmData.buy;
    const bmTime = bmData.sell !== null ? bmData.sellUpdated : bmData.buyUpdated;
    const bmHtml = bmVal !== null 
      ? `<div class="price-value">${formatPrice(bmVal)}</div><div class="price-date">(${bmTime || '-'})</div>` 
      : `<span class="no-data">Нет данных</span>`;

    row.innerHTML = `
      <td class="sticky-col-1 item-name">${item.name}</td>
      <td class="sticky-col-2 item-quality">${qualityName}</td>
      <td>${bmHtml}</td>
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

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initWindowControls();
  initBackendControls();
  renderTable();
});