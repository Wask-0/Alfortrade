// js/utils.js
import { state } from './store.js';

export const qualityMap = {
  1: "Обычное", 2: "Хорошее", 3: "Выдающееся", 4: "Отличное", 5: "Шедевр"
};

export const locationMap = {
  "3003": "blackMarket", "3005": "caerleon", "2004": "bridgewatch",
  "1002": "lymhurst", "4002": "fortSterling", "0007": "thetford",
  "3008": "martlock", "5003": "brecilien",
  "Black Market": "blackMarket", "Caerleon": "caerleon",
  "Bridgewatch": "bridgewatch", "Lymhurst": "lymhurst",
  "Fort Sterling": "fortSterling", "Thetford": "thetford",
  "Martlock": "martlock", "Brecilien": "brecilien"
};

export const locationIdToName = {
  "3003": "Black Market", "3005": "Caerleon", "2004": "Bridgewatch",
  "1002": "Lymhurst", "4002": "Fort Sterling", "0007": "Thetford",
  "3008": "Martlock", "5003": "Brecilien"
};

export function getQualityName(q) {
  return qualityMap[q] || 'Неизвестно';
}

export function getLocationName(id) {
  return locationIdToName[id] || id;
}

export function getCityDisplayName(cityKey) {
  const names = {
    caerleon: 'Caerleon', bridgewatch: 'Bridgewatch', lymhurst: 'Lymhurst',
    fortSterling: 'Fort Sterling', thetford: 'Thetford', martlock: 'Martlock',
    brecilien: 'Brecilien', blackMarket: 'Black Market'
  };
  return names[cityKey] || cityKey;
}

export function extractTier(itemId) {
  const match = itemId?.match(/^T(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

export function extractEnchant(itemId) {
  if (!itemId) return 0;
  const match = itemId.match(/@(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

export function getDisplayName(itemId) {
  if (state.itemsDict[itemId]) {
    return state.itemsDict[itemId].name;
  }
  return itemId;
}

export function formatPrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return '-';
  const displayPrice = Math.round(rawPrice / 10000);
  return displayPrice.toLocaleString('ru-RU');
}

export function parseTime(timeStr) {
  if (!timeStr) return 0;
  const [datePart, hourPart] = timeStr.split(" ");
  const [y, m, d] = datePart.split(".");
  return new Date(`${y}-${m}-${d}T${hourPart}:00:00`).getTime();
}

export function shouldUpdate(currentPrice, currentUpdated, newPrice, newUpdated, isSell) {
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