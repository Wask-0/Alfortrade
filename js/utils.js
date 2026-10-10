// js/utils.js
const { state } = require('./store.js');

const qualityMap = {
  1: "Обычное", 2: "Хорошее", 3: "Выдающееся", 4: "Отличное", 5: "Шедевр"
};

const locationMap = {
  "3003": "blackMarket", "3005": "caerleon", "2004": "bridgewatch",
  "1002": "lymhurst", "4002": "fortSterling", "0007": "thetford",
  "3008": "martlock", "5003": "brecilien",
  "Black Market": "blackMarket", "Caerleon": "caerleon",
  "Bridgewatch": "bridgewatch", "Lymhurst": "lymhurst",
  "Fort Sterling": "fortSterling", "Thetford": "thetford",
  "Martlock": "martlock", "Brecilien": "brecilien"
};

const locationIdToName = {
  "3003": "Black Market", "3005": "Caerleon", "2004": "Bridgewatch",
  "1002": "Lymhurst", "4002": "Fort Sterling", "0007": "Thetford",
  "3008": "Martlock", "5003": "Brecilien"
};

const PRICE_STEP = 10000;

function getQualityName(q) {
  return qualityMap[q] || 'Неизвестно';
}

function getLocationName(id) {
  return locationIdToName[id] || id;
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
  const match = itemId?.match(/^T(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function extractEnchant(itemId) {
  if (!itemId) return 0;
  const match = itemId.match(/@(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function getDisplayName(itemId) {
  if (state.itemsDict[itemId]) {
    return state.itemsDict[itemId].name;
  }
  return itemId;
}

function formatPrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return '-';
  const displayPrice = Math.round(rawPrice / 10000);
  return displayPrice.toLocaleString('ru-RU');
}

function parseTime(timeStr) {
  if (!timeStr) return 0;
  const [datePart, hourPart] = timeStr.split(" ");
  const [y, m, d] = datePart.split(".");
  return new Date(`${y}-${m}-${d}T${hourPart}:00:00`).getTime();
}

function shouldUpdate(currentPrice, currentUpdated, newPrice, newUpdated, isSell) {
  // Никогда не принимать нулевые или невалидные цены
  if (newPrice === null || newPrice === undefined || newPrice <= 0) {
    return false;
  }
  
  // Если текущей цены нет - принять новую
  if (currentPrice === null || currentPrice === undefined || currentPrice <= 0) {
    return true;
  }
  
  // Если нет времени обновления - принять
  if (!currentUpdated) return true;
  
  const oldTime = parseTime(currentUpdated);
  const newTime = parseTime(newUpdated);
  const diffMinutes = (newTime - oldTime) / 60000;
  
  // Через 10 минут разрешить любое обновление (данные устарели)
  if (diffMinutes >= 10) {
    return true;
  }
  
  // В течение 10 минут - обновлять только если цена лучше
  if (isSell && newPrice < currentPrice) return true; // Для продажи - ниже лучше
  if (!isSell && newPrice > currentPrice) return true; // Для покупки - выше лучше
  
  return false;
}

function getDisplayBuyPrice(item, cityKey, marketState) {
  const cityData = item[cityKey];
  if (!cityData) return null;
  
  // Прямая книга — показываем реальный верх чужих ордеров
  if (cityData.buy !== null && cityData.buy > 0) {
    return cityData.buy;
  }
  
  // Книги нет — наследуем от нижнего качества + 1 серебро,
  // чтобы наш ордер перебивал верх нижней книги
  const lowerQuality = item.quality - 1;
  if (lowerQuality < 1) return null;
  
  const lowerKey = `${item.id}_${lowerQuality}`;
  const lowerItem = marketState[lowerKey];
  
  if (lowerItem && lowerItem[cityKey] && lowerItem[cityKey].buy > 0) {
    return lowerItem[cityKey].buy + PRICE_STEP; // ← +1 НАСЛЕДОВАНИЕ
  }
  
  return null;
}

module.exports = {
  qualityMap, locationMap, locationIdToName,
  getQualityName, getLocationName, getCityDisplayName,
  extractTier, extractEnchant, getDisplayName,
  formatPrice, parseTime, shouldUpdate,
  getDisplayBuyPrice, PRICE_STEP
};