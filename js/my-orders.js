// js/my-orders.js
const { ipcRenderer } = require('electron');
const { state, saveMyOrders } = require('./store.js');
const { getQualityName, getLocationName, formatPrice } = require('./utils.js');

function renderMyOrdersTable() {
  const tbody = document.getElementById('my-orders-body');
  if (!tbody) return;
  const searchInput = document.getElementById('my-orders-search');
  const cityFilterInput = document.getElementById('my-orders-city-filter');
  const searchVal = searchInput ? searchInput.value.toLowerCase() : '';
  const cityFilter = cityFilterInput ? cityFilterInput.value : 'all';

  let allOrders = [];
  for (const cityId in state.myOrdersByCity) {
    if (Date.now() - state.myOrdersByCity[cityId].lastUpdate <= state.MY_ORDERS_TTL) {
      allOrders = allOrders.concat(state.myOrdersByCity[cityId].orders);
    }
  }

  const filtered = allOrders.filter(order => {
    const name = (state.itemsDict[order.itemId]?.name || order.itemId).toLowerCase();
    return name.includes(searchVal) && (cityFilter === 'all' || order.locationId === cityFilter);
  });

  filtered.sort((a, b) => {
    if (a.auctionType !== b.auctionType) return a.auctionType === 'offer' ? -1 : 1;
    return b.price - a.price;
  });

  tbody.innerHTML = '';
  filtered.forEach(order => {
    const dictItem = state.itemsDict[order.itemId] || {};
    const itemName = dictItem.name || order.itemId;
    const amount = order.amount || 0;
    const typeLabel = order.auctionType === 'offer' ? 'Продажа' : 'Покупка';
    const typeColor = order.auctionType === 'offer' ? '#ffcc00' : '#00ccff';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="col-item-name">${itemName}</td>
      <td class="col-quality">${getQualityName(order.quality)}</td>
      <td class="col-price">${formatPrice(order.price)}</td>
      <td class="col-amount">${amount > 0 ? amount : '-'}</td>
      <td class="col-city">${getLocationName(order.locationId)}</td>
      <td class="col-type" style="color: ${typeColor}; font-weight: bold;">${typeLabel}</td>
    `;
    tbody.appendChild(row);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #888;">Нет активных ордеров</td></tr>';
  }
}

function initMyOrdersListener() {
  const now = Date.now();
  let changed = false;
  for (const cityId in state.myOrdersByCity) {
    if (now - state.myOrdersByCity[cityId].lastUpdate > state.MY_ORDERS_TTL) {
      delete state.myOrdersByCity[cityId];
      changed = true;
    }
  }
  if (changed) saveMyOrders();

  ipcRenderer.on('my-order-data-received', (event, order) => {
    if (!order || !order.orderId || !order.locationId) return;
    const cityId = order.locationId;
    const currentTime = Date.now();
    if (!state.myOrdersByCity[cityId]) state.myOrdersByCity[cityId] = { orders: [], lastUpdate: currentTime };
    const cityData = state.myOrdersByCity[cityId];
    if (currentTime - cityData.lastUpdate > state.MY_ORDERS_TTL) cityData.orders = [];
    cityData.lastUpdate = currentTime;
    const existingIds = new Set(cityData.orders.map(o => o.orderId));
    if (!existingIds.has(order.orderId)) cityData.orders.push(order);
    saveMyOrders();
    renderMyOrdersTable();
  });

  document.getElementById('my-orders-search')?.addEventListener('input', renderMyOrdersTable);
  document.getElementById('my-orders-city-filter')?.addEventListener('change', renderMyOrdersTable);
}

module.exports = { renderMyOrdersTable, initMyOrdersListener };