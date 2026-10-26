const { state, savePlannerItems } = require('./store.js');
const { getQualityName, formatPrice } = require('./utils.js');
const { ipcRenderer } = require('electron');

const statusLabels = {
    planned: 'В плане',
    buying: 'Покупается',
    selling: 'Продаётся',
    sold: 'Продано'
};

function getMethodLabel(method, type) {
    if (type === 'buy') return method === 'order' ? 'Заказ на покупку' : 'Быстрая покупка';
    return method === 'order' ? 'Заказ на продажу' : 'Быстрая продажа';
}

const cityKeyByDisplayName = {
  'Caerleon': 'caerleon',
  'Bridgewatch': 'bridgewatch',
  'Lymhurst': 'lymhurst',
  'Fort Sterling': 'fortSterling',
  'Thetford': 'thetford',
  'Martlock': 'martlock',
  'Brecilien': 'brecilien',
  'Black Market': 'blackMarket'
};

// Продажи в день для предмета в конкретном городе (по названию города)
function getSalesPerDayFor(itemId, quality, cityDisplayName) {
  const cityKey = cityKeyByDisplayName[cityDisplayName];
  if (!cityKey) return 0;
  const marketItem = state.marketState[`${itemId}_${quality}`];
  if (!marketItem || !marketItem[cityKey]) return 0;
  return marketItem[cityKey].salesPerDay || 0;
}

const statusOrder = ['planned', 'buying', 'selling', 'sold'];

function addToPlanner(flipItem) {
    const now = Date.now();
    const quantity = flipItem.quantity || 1;

    if (flipItem.isCrafted && flipItem.craftDetailsObj) {
        const parentUniqueId = `craft_${flipItem.itemId}_${now}`;

        // === СТРОКА 1: базовый предмет, который нужно зачаровать ===
        state.plannerItems.push({
            uniqueId: parentUniqueId,
            isCraftParent: true,
            craftTargetName: flipItem.itemName,
            craftTargetItemId: flipItem.itemId, 
            itemId: flipItem.craftDetailsObj.baseItemId || flipItem.itemId,
            itemName: flipItem.craftDetailsObj.baseItemName,
            quality: flipItem.quality,
            buyCity: flipItem.craftDetailsObj.baseCity,
            buyPriceRaw: flipItem.craftDetailsObj.basePrice,
            buyPriceDisplay: formatPrice(flipItem.craftDetailsObj.basePrice),
            buyCommissionDisplay: flipItem.craftDetailsObj.baseCommission > 0 ? `+${formatPrice(flipItem.craftDetailsObj.baseCommission)}` : '-',
            sellCity: flipItem.sellCity,
            netSellPrice: flipItem.netSellPrice,          // как для зачарованного
            commissionDeducted: flipItem.commissionDeducted,
            profitPercent: flipItem.profitPercent,        // как для зачарованного
            cleanProfit: flipItem.cleanProfit,            // как для зачарованного
            buyMethod: flipItem.buyMethod,
            sellMethod: flipItem.sellMethod,
            quantity: quantity,
            purchased: 0,
            status: 'planned'
        });

        // === СТРОКИ 2+: ресурсы для зачарования ===
        (flipItem.craftDetailsObj.materials || []).forEach((mat, idx) => {
            const unitPrice = Math.round(mat.totalCost / mat.count);
            state.plannerItems.push({
                uniqueId: `${parentUniqueId}_mat_${idx}`,
                parentUniqueId: parentUniqueId,
                isCraftMaterial: true,
                forItemName: flipItem.itemName,
                forItemQuality: flipItem.quality,
                itemName: mat.matName,
                quality: null,
                buyCity: mat.cityName,
                buyPriceRaw: unitPrice,
                buyPriceDisplay: formatPrice(unitPrice),
                buyCommissionDisplay: mat.commission > 0 ? `+${formatPrice(Math.round(mat.commission / mat.count))}` : '-',
                sellCity: flipItem.sellCity, // хранится для фильтра, в ячейке выводится предмет
                netSellPrice: null,
                profitPercent: null,
                cleanProfit: null,
                buyMethod: mat.isOrder ? 'order' : 'instant',
                sellMethod: null,
                quantity: mat.count * quantity, // 384 рун × количество предметов
                purchased: 0,
                status: 'planned'
            });
        });
    } else {
        // === Обычная сделка без зачарования ===
        const uniqueId = `${flipItem.itemId}_${flipItem.buyCity}_${flipItem.sellCity}_${now}`;
        state.plannerItems.push({ ...flipItem, uniqueId, purchased: 0, status: 'planned' });
    }

    savePlannerItems();
    renderPlannerTable();
}

function changePurchased(uniqueId, delta) {
    const item = state.plannerItems.find(i => i.uniqueId === uniqueId);
    if (!item) return;

    const max = item.quantity || 0;
    const current = item.purchased || 0;
    item.purchased = Math.max(0, Math.min(max, current + delta));

    savePlannerItems();
    renderPlannerTable();
}

function changeStatus(uniqueId, direction) {
    const item = state.plannerItems.find(i => i.uniqueId === uniqueId);
    if (!item) return;
    
    let idx = statusOrder.indexOf(item.status);
    
    if (direction === 'next') {
        // Достигли "Продано" — дальше не двигаемся
        if (idx >= statusOrder.length - 1) return;
        idx += 1;
    } else {
        // Достигли "В плане" — дальше не двигаемся
        if (idx <= 0) return;
        idx -= 1;
    }
    
    item.status = statusOrder[idx];
    savePlannerItems();
    renderPlannerTable();
}

function renderPlannerTable() {
    const tbody = document.getElementById('planner-body');
    if (!tbody) return;

    const searchVal = (document.getElementById('planner-search')?.value || '').toLowerCase();
    const sortStatus = document.getElementById('planner-sort-status')?.value || 'all';
    const buyCityFilter = document.getElementById('planner-buy-city-filter')?.value || 'all';   // ← ДОБАВИТЬ
    const sellCityFilter = document.getElementById('planner-sell-city-filter')?.value || 'all'; // ← ДОБАВИТЬ

    let filtered = state.plannerItems.filter(item => {
        const name = (item.itemName || '').toLowerCase();
        const matchesSearch = name.includes(searchVal);
        const matchesStatus = sortStatus === 'all' || item.status === sortStatus;
        const matchesBuyCity = buyCityFilter === 'all' || item.buyCity === buyCityFilter;   // ← ДОБАВИТЬ
        const matchesSellCity = sellCityFilter === 'all' || item.sellCity === sellCityFilter; // ← ДОБАВИТЬ
        return matchesSearch && matchesStatus && matchesBuyCity && matchesSellCity;          // ← ОБНОВИТЬ
    });

    filtered.sort((a, b) => {
        return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 20px; color: #888;">Список пуст</td></tr>';
        return;
    }

    filtered.forEach(item => {
        const quantity = item.quantity || 1;
        const purchased = item.purchased || 0;
        const isMat = !!item.isCraftMaterial;

        const buySpd = (!isMat && item.itemId && item.quality) ? getSalesPerDayFor(item.itemId, item.quality, item.buyCity) : null;
        let sellSpd = null;
        if (!isMat && item.quality) {
            if (item.isCraftParent && item.craftTargetItemId) {
                sellSpd = getSalesPerDayFor(item.craftTargetItemId, item.quality, item.sellCity);
            } else if (item.itemId) {
                sellSpd = getSalesPerDayFor(item.itemId, item.quality, item.sellCity);
            }
        }


        let nameHtml = item.itemName;
        if (item.isCraftParent) nameHtml += ` <span class="craft-badge">✦ Зачаровать: ${item.craftTargetName}</span>`;
        if (isMat) nameHtml += ` <span class="craft-badge">Ресурс</span>`;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="col-item-name">${nameHtml}</td>
            <td class="item-quality">${item.quality ? getQualityName(item.quality) : '-'}</td>
            <td>
                <div class="city-name">${item.buyCity}</div>
                ${buySpd !== null ? `<div class="method-label">${buySpd}/день</div>` : ''}
                ${item.buyMethod ? `<div class="method-label">${getMethodLabel(item.buyMethod, 'buy')}</div>` : ''}
            </td>
            <td class="price-sell">
                ${item.buyPriceDisplay}
                ${item.buyPriceRaw ? `<div class="total-label">(${formatPrice(item.buyPriceRaw * quantity)})</div>` : ''}
            </td>
            ${isMat ? `
                <td>
                    <div class="city-name">Для: ${item.forItemName}</div>
                    <div class="method-label">${getQualityName(item.forItemQuality)}</div>
                </td>
                <td class="no-data">-</td>
                <td class="no-data">-</td>
            ` : `
                <td>
                    <div class="city-name">${item.sellCity}</div>
                    ${sellSpd !== null ? `<div class="method-label">${sellSpd}/день</div>` : ''}
                    ${item.sellMethod ? `<div class="method-label">${getMethodLabel(item.sellMethod, 'sell')}</div>` : ''}
                </td>
                <td class="price-buy">
                    ${formatPrice(item.netSellPrice)}
                    <div class="total-label">(${formatPrice(item.netSellPrice * quantity)})</div>
                </td>
                <td class="profit-cell">
                    <div class="profit-percent">${item.profitPercent}%</div>
                    <div class="clean-profit">+${formatPrice(item.cleanProfit)}</div>
                    <div class="total-label">(+${formatPrice(item.cleanProfit * quantity)})</div>
                </td>
            `}
            <td class="col-quantity">${quantity}</td>
            <td class="col-purchased">
                <div class="purchased-controls">
                    <button class="qty-btn" onclick="window.changePlannerPurchased('${item.uniqueId}', -1)" ${purchased <= 0 ? 'disabled' : ''}>−</button>
                    <span class="purchased-value">${purchased}</span>
                    <button class="qty-btn" onclick="window.changePlannerPurchased('${item.uniqueId}', 1)" ${purchased >= quantity ? 'disabled' : ''}>+</button>
                </div>
            </td>
            <td class="status-cell">
                <div class="status-text">${statusLabels[item.status]}</div>
                <div class="status-controls">
                    <button class="status-btn" onclick="window.changePlannerStatus('${item.uniqueId}', 'prev')" ${item.status === statusOrder[0] ? 'disabled' : ''}>◀</button>
                    <button class="status-btn" onclick="window.changePlannerStatus('${item.uniqueId}', 'next')" ${item.status === statusOrder[statusOrder.length - 1] ? 'disabled' : ''}>▶</button>
                </div>
            </td>
            <td class="action-cell">
                <button class="remove-from-plan-btn" onclick="window.removePlannerItem('${item.uniqueId}')">Удалить</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// ===== СВОДКА РЕСУРСОВ ДЛЯ ЗАЧАРОВАНИЯ =====
function renderCraftSummary() {
    const tbody = document.getElementById('craftSummaryBody');
    if (!tbody) return;

    // Учитываем только эти статусы
    const allowedStatuses = ['planned', 'buying'];
    const groups = {};

    state.plannerItems.forEach(mat => {
        if (!mat.isCraftMaterial) return;
        if (!allowedStatuses.includes(mat.status)) return; // пропускаем "продаётся" и "продано"

        const parent = state.plannerItems.find(i => i.uniqueId === mat.parentUniqueId);
        if (parent && parent.status === 'sold') return;

        // Группировка теперь раздельная по статусу
        const key = `${mat.itemName}|${mat.buyCity}|${mat.status}`;
        if (!groups[key]) {
            groups[key] = {
                matName: mat.itemName,
                city: mat.buyCity,
                status: mat.status,
                totalQty: 0,
                unitPrice: mat.buyPriceRaw || 0,
                targets: []
            };
        }
        groups[key].totalQty += mat.quantity || 0;

        const targetLabel = `${mat.forItemName} (${getQualityName(mat.forItemQuality)})${parent ? ` ×${parent.quantity || 1}` : ''}`;
        if (!groups[key].targets.includes(targetLabel)) groups[key].targets.push(targetLabel);
    });

    // Сортировка: сначала "В плане", затем "Покупается"
    const list = Object.values(groups).sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));

    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #888;">Нет ресурсов со статусами «В плане» или «Покупается»</td></tr>';
        return;
    }

    list.forEach(g => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="col-item-name">${g.matName}</td>
            <td><span class="status-badge ${g.status}">${statusLabels[g.status]}</span></td>
            <td><div class="city-name">${g.city}</div></td>
            <td class="col-quantity">${g.totalQty}</td>
            <td class="price-sell">${formatPrice(g.unitPrice)}</td>
            <td class="price-buy">${formatPrice(g.unitPrice * g.totalQty)}</td>
            <td>${g.targets.join('<br>')}</td>
        `;
        tbody.appendChild(row);
    });
}

function openCraftSummary() {
    renderCraftSummary();
    document.getElementById('craftSummaryModal')?.classList.add('open');
}

function closeCraftSummary() {
    document.getElementById('craftSummaryModal')?.classList.remove('open');
}

// ===== ЗАКУПКА ПРЕДМЕТОВ =====
// Локальное состояние для хранения выбранных количеств
let purchaseQuantities = {};

function getPurchaseKey(item) {
    // Используем строковое представление для всех значений, включая null
    return `${item.uniqueId}_${item.itemId}_${item.quality || 'null'}_${item.buyMethod}`;
}

function getPurchaseQuantity(item) {
    const key = getPurchaseKey(item);
    if (purchaseQuantities[key] !== undefined) {
        return purchaseQuantities[key];
    }
    return item.quantity || 0;
}

function updatePurchaseQuantity(uniqueId, itemId, quality, buyMethod, newQty, maxQty) {
    // Используем строковое представление для quality
    const qualityStr = quality === null || quality === undefined || quality === 'null' ? 'null' : quality.toString();
    const key = `${uniqueId}_${itemId}_${qualityStr}_${buyMethod}`;
    
    newQty = Math.max(0, Math.min(maxQty, newQty));
    purchaseQuantities[key] = newQty;
    
    // Обновляем только конкретную строку, а не всю таблицу
    updatePurchaseRow(uniqueId, itemId, qualityStr, buyMethod, newQty);
}

function updatePurchaseRow(uniqueId, itemId, qualityStr, buyMethod, newQty) {
    const item = state.plannerItems.find(i => i.uniqueId === uniqueId);
    if (!item) return;

    const row = document.querySelector(`tr[data-unique-id="${uniqueId}"]`);
    if (!row) return;

    const itemTotal = (item.buyPriceRaw || 0) * newQty;
    
    // Обновляем значение в поле ввода
    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) {
        qtyInput.value = newQty;
    }
    
    // Обновляем итоговую сумму в строке
    const totalCell = row.querySelector('.price-buy');
    if (totalCell) {
        totalCell.textContent = formatPrice(itemTotal);
    }
    
    // Обновляем общую сумму
    updateTotalAmount();
}

function updateTotalAmount() {
    const citySelect = document.getElementById('purchase-city-select');
    const totalAmountEl = document.getElementById('purchaseTotalAmount');
    if (!citySelect || !totalAmountEl) return;

    const selectedCity = citySelect.value;
    const allowedStatuses = ['planned', 'buying'];
    let totalAmount = 0;

    state.plannerItems.forEach(item => {
        if (!allowedStatuses.includes(item.status)) return;
        if (item.buyCity !== selectedCity) return;

        const qty = getPurchaseQuantity(item);
        totalAmount += (item.buyPriceRaw || 0) * qty;
    });

    totalAmountEl.textContent = formatPrice(totalAmount);
}

function renderPurchaseSummary() {
    const tbody = document.getElementById('purchaseBody');
    const citySelect = document.getElementById('purchase-city-select');
    const totalAmountEl = document.getElementById('purchaseTotalAmount');
    if (!tbody || !citySelect) return;

    const selectedCity = citySelect.value;
    const allowedStatuses = ['planned', 'buying'];
    const items = [];
    let totalAmount = 0;

    state.plannerItems.forEach(item => {
        // Включаем и обычные предметы, и ресурсы для зачарования
        if (!allowedStatuses.includes(item.status)) return;
        if (item.buyCity !== selectedCity) return;

        const qty = getPurchaseQuantity(item);
        const itemTotal = (item.buyPriceRaw || 0) * qty;
        totalAmount += itemTotal;

        items.push({
            ...item,
            purchaseQty: qty,
            maxQty: item.quantity || 0,
            itemTotal: itemTotal
        });
    });

    // Сортировка: сначала обычные предметы, потом ресурсы
    items.sort((a, b) => {
        if (a.isCraftMaterial && !b.isCraftMaterial) return 1;
        if (!a.isCraftMaterial && b.isCraftMaterial) return -1;
        return 0;
    });

    tbody.innerHTML = '';
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #888;">Нет предметов для закупки в этом городе</td></tr>';
        if (totalAmountEl) totalAmountEl.textContent = '0';
        return;
    }

    items.forEach(item => {
        const row = document.createElement('tr');
        row.dataset.uniqueId = item.uniqueId; // Добавляем data-атрибут для идентификации строки
        
        const isMat = !!item.isCraftMaterial;
        
        let nameHtml = item.itemName;
        if (isMat) {
            nameHtml += ' <span class="craft-badge" style="background: #ff9800; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 5px;">Ресурс</span>';
        }

        row.innerHTML = `
            <td class="col-item-name">${nameHtml}</td>
            <td>${item.quality ? getQualityName(item.quality) : '-'}</td>
            <td>${getMethodLabel(item.buyMethod, 'buy')}</td>
            <td class="col-quantity">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="qty-btn" data-action="decrease" data-unique-id="${item.uniqueId}" data-item-id="${item.itemId}" data-quality="${item.quality || 'null'}" data-buy-method="${item.buyMethod}" data-max-qty="${item.maxQty}" style="width: 28px; height: 28px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; display: flex; align-items: center; justify-content: center;">−</button>
                    <input type="number" class="qty-input" value="${item.purchaseQty}" min="0" max="${item.maxQty}" data-unique-id="${item.uniqueId}" data-item-id="${item.itemId}" data-quality="${item.quality || 'null'}" data-buy-method="${item.buyMethod}" data-max-qty="${item.maxQty}" style="width: 60px; padding: 4px 8px; background: #1a1a1a; color: white; border: 1px solid #555; border-radius: 4px; text-align: center;">
                    <button class="qty-btn" data-action="increase" data-unique-id="${item.uniqueId}" data-item-id="${item.itemId}" data-quality="${item.quality || 'null'}" data-buy-method="${item.buyMethod}" data-max-qty="${item.maxQty}" style="width: 28px; height: 28px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; display: flex; align-items: center; justify-content: center;">+</button>
                    <span style="color: #888; font-size: 12px;">из ${item.maxQty}</span>
                </div>
            </td>
            <td class="price-sell">${formatPrice(item.buyPriceRaw)}</td>
            <td class="price-buy">${formatPrice(item.itemTotal)}</td>
        `;
        tbody.appendChild(row);
    });

    if (totalAmountEl) {
        totalAmountEl.textContent = formatPrice(totalAmount);
    }

    // Добавляем обработчики для кнопок и инпутов
    document.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const uniqueId = e.currentTarget.dataset.uniqueId;
            const itemId = e.currentTarget.dataset.itemId;
            const qualityStr = e.currentTarget.dataset.quality;
            const buyMethod = e.currentTarget.dataset.buyMethod;
            const maxQty = parseInt(e.currentTarget.dataset.maxQty);
            
            const item = state.plannerItems.find(i => i.uniqueId === uniqueId);
            if (!item) return;

            const currentQty = getPurchaseQuantity(item);
            let newQty = currentQty;

            if (action === 'increase') {
                newQty = currentQty + 1;
            } else if (action === 'decrease') {
                newQty = currentQty - 1;
            }

            updatePurchaseQuantity(uniqueId, itemId, qualityStr, buyMethod, newQty, maxQty);
        });
    });

    document.querySelectorAll('.qty-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const uniqueId = e.currentTarget.dataset.uniqueId;
            const itemId = e.currentTarget.dataset.itemId;
            const qualityStr = e.currentTarget.dataset.quality;
            const buyMethod = e.currentTarget.dataset.buyMethod;
            const maxQty = parseInt(e.currentTarget.dataset.maxQty);
            
            let newQty = parseInt(e.currentTarget.value) || 0;
            updatePurchaseQuantity(uniqueId, itemId, qualityStr, buyMethod, newQty, maxQty);
        });
    });
}

function openPurchaseSummary() {
    // Сбрасываем выбранные количества при открытии
    purchaseQuantities = {};
    renderPurchaseSummary();
    document.getElementById('purchaseModal')?.classList.add('open');
}

function closePurchaseSummary() {
    document.getElementById('purchaseModal')?.classList.remove('open');
}

function startPurchaseBot() {
    const citySelect = document.getElementById('purchase-city-select');
    const selectedCity = citySelect?.value;

    if (!selectedCity) {
        alert('Выберите город для закупки');
        return;
    }

    const purchaseList = [];
    const allowedStatuses = ['planned', 'buying'];

    state.plannerItems.forEach(item => {
        if (!allowedStatuses.includes(item.status)) return;
        if (item.buyCity !== selectedCity) return;

        const qty = getPurchaseQuantity(item);
        if (qty <= 0) return;

        purchaseList.push({
            uniqueId: item.uniqueId,
            itemId: item.itemId,
            itemName: item.itemName,
            quality: item.quality,
            quantity: qty,
            maxQuantity: item.quantity,
            buyMethod: item.buyMethod,
            buyPrice: item.buyPriceRaw,
            isCraftMaterial: item.isCraftMaterial || false,
            forItemName: item.forItemName || null,
            forItemQuality: item.forItemQuality || null,
            enchantLevel: parseInt((item.itemId || '').split('@')[1], 10) || 0
        });
    });

    if (purchaseList.length === 0) {
        alert('Нет предметов для закупки в выбранном городе');
        return;
    }

    ipcRenderer.send('start-purchase-bot', { city: selectedCity, items: purchaseList });
}
function initPlanner() {
    document.getElementById('planner-search')?.addEventListener('input', renderPlannerTable);
    document.getElementById('planner-sort-status')?.addEventListener('change', renderPlannerTable);
    document.getElementById('planner-buy-city-filter')?.addEventListener('change', renderPlannerTable);  
    document.getElementById('planner-sell-city-filter')?.addEventListener('change', renderPlannerTable); 
    document.getElementById('openCraftSummaryBtn')?.addEventListener('click', openCraftSummary);
    document.getElementById('closeCraftSummaryBtn')?.addEventListener('click', closeCraftSummary);
    document.getElementById('openPurchaseBtn')?.addEventListener('click', openPurchaseSummary);
    document.getElementById('closePurchaseBtn')?.addEventListener('click', closePurchaseSummary);
    document.getElementById('purchase-city-select')?.addEventListener('change', renderPurchaseSummary);
    document.getElementById('startPurchaseBotBtn')?.addEventListener('click', startPurchaseBot);
    
    // Закрытие кликом по фону
    document.getElementById('craftSummaryModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'craftSummaryModal') closeCraftSummary();
    });
    document.getElementById('purchaseModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'purchaseModal') closePurchaseSummary();
    });

    ipcRenderer.on('purchase-bot-status', (e, s) => {
        const el = document.getElementById('purchaseBotStatus');
        if (el) el.textContent = s.text;
    });

    ipcRenderer.on('purchase-item-done', (e, data) => {
        const item = state.plannerItems.find(i => i.uniqueId === data.uniqueId);
        if (item) {
            item.purchased = Math.min(item.quantity || 0, (item.purchased || 0) + data.quantity);
            savePlannerItems();
            renderPlannerTable();
        }
    });
    
    window.changePlannerStatus = changeStatus;
    window.changePlannerPurchased = changePurchased;
    window.removePlannerItem = removeFromPlanner;
    renderPlannerTable();
}

function removeFromPlanner(uniqueId) {
    const idsToRemove = new Set([uniqueId]);
    state.plannerItems.forEach(i => {
        if (i.parentUniqueId === uniqueId) idsToRemove.add(i.uniqueId);
    });
    state.plannerItems = state.plannerItems.filter(i => !idsToRemove.has(i.uniqueId));
    savePlannerItems();
    renderPlannerTable();
}


module.exports = { addToPlanner, initPlanner, renderPlannerTable };