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
    
    // ИЗМЕНЕНО: убрана проверка TTL, показываем ВСЕ ордера
    for (const cityId in state.myOrdersByCity) {
        allOrders = allOrders.concat(state.myOrdersByCity[cityId].orders);
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
    // УДАЛЕНО: блок очистки устаревших городов при запуске
    // const now = Date.now();
    // let changed = false;
    // for (const cityId in state.myOrdersByCity) {
    //     if (now - state.myOrdersByCity[cityId].lastUpdate > state.MY_ORDERS_TTL) {
    //         delete state.myOrdersByCity[cityId];
    //         changed = true;
    //     }
    // }
    // if (changed) saveMyOrders();

    // ИЗМЕНЕНО: полностью переписан обработчик
    ipcRenderer.on('my-order-data-received', (event, data) => {
        if (!data) return;
        
        const currentTime = Date.now();
        
        // Проверяем, является ли это пакетом "MY ORDER" (массив ордеров города)
        const isMyOrderBatch = Array.isArray(data) && data.length > 0;
        
        if (isMyOrderBatch) {
            // Это специальный пакет MY ORDER
            const firstOrder = data[0];
            if (!firstOrder.locationId) return;
            
            const cityId = firstOrder.locationId;
            const lastUpdate = state.myOrdersByCity[cityId]?.lastUpdate || 0;
            const timeSinceLastUpdate = currentTime - lastUpdate;
            const shouldOverwrite = timeSinceLastUpdate > state.MY_ORDERS_TTL;
            
            if (shouldOverwrite) {
                // Прошло больше 3 минут - полностью перезаписываем
                state.myOrdersByCity[cityId] = {
                    orders: data.filter(o => o && o.orderId),
                    lastUpdate: currentTime
                };
            } else {
                // Прошло меньше 3 минут - добавляем/обновляем
                if (!state.myOrdersByCity[cityId]) {
                    state.myOrdersByCity[cityId] = { orders: [], lastUpdate: currentTime };
                }
                
                const cityData = state.myOrdersByCity[cityId];
                cityData.lastUpdate = currentTime;
                
                data.forEach(order => {
                    if (!order || !order.orderId) return;
                    
                    const existingIndex = cityData.orders.findIndex(o => o.orderId === order.orderId);
                    if (existingIndex !== -1) {
                        cityData.orders[existingIndex] = order;
                    } else {
                        cityData.orders.push(order);
                    }
                });
            }
            
        } else if (data.orderId && data.locationId) {
            // Это одиночный ордер
            
            const cityId = data.locationId;
            const lastUpdate = state.myOrdersByCity[cityId]?.lastUpdate || 0;
            const timeSinceLastUpdate = currentTime - lastUpdate;
            const shouldOverwrite = timeSinceLastUpdate > state.MY_ORDERS_TTL;
            
            if (shouldOverwrite) {
                // Прошло больше 3 минут - полностью перезаписываем этим одним ордером
                state.myOrdersByCity[cityId] = {
                    orders: [data],
                    lastUpdate: currentTime
                };
            } else {
                // Прошло меньше 3 минут - добавляем/обновляем
                if (!state.myOrdersByCity[cityId]) {
                    state.myOrdersByCity[cityId] = { orders: [], lastUpdate: currentTime };
                }
                
                const cityData = state.myOrdersByCity[cityId];
                cityData.lastUpdate = currentTime;
                
                const existingIndex = cityData.orders.findIndex(o => o.orderId === data.orderId);
                if (existingIndex !== -1) {
                    cityData.orders[existingIndex] = data;
                } else {
                    cityData.orders.push(data);
                }
            }
        }
        
        saveMyOrders();
        renderMyOrdersTable();
    });

    document.getElementById('my-orders-search')?.addEventListener('input', renderMyOrdersTable);
    document.getElementById('my-orders-city-filter')?.addEventListener('change', renderMyOrdersTable);
}

module.exports = { renderMyOrdersTable, initMyOrdersListener };