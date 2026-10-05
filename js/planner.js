const { state, savePlannerItems } = require('./store.js');
const { formatPrice } = require('./utils.js');

const statusLabels = {
    planned: 'В плане',
    buying: 'Покупается',
    selling: 'Продаётся',
    sold: 'Продано'
};
const statusOrder = ['planned', 'buying', 'selling', 'sold'];

function addToPlanner(flipItem) {
    const uniqueId = `${flipItem.itemId}_${flipItem.buyCity}_${flipItem.sellCity}_${Date.now()}`;
    const exists = state.plannerItems.some(i => i.uniqueId === uniqueId);
    if (!exists) {
        state.plannerItems.push({ ...flipItem, uniqueId, status: 'planned' });
        savePlannerItems();
    }
}

function changeStatus(uniqueId, direction) {
    const item = state.plannerItems.find(i => i.uniqueId === uniqueId);
    if (!item) return;
    
    let idx = statusOrder.indexOf(item.status);
    if (direction === 'next') {
        idx = (idx + 1) % statusOrder.length;
    } else {
        idx = (idx - 1 + statusOrder.length) % statusOrder.length;
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

    let filtered = state.plannerItems.filter(item => {
        const name = (item.itemName || '').toLowerCase();
        const matchesSearch = name.includes(searchVal);
        const matchesStatus = sortStatus === 'all' || item.status === sortStatus;
        return matchesSearch && matchesStatus;
    });

    // Сортировка по порядку статусов
    filtered.sort((a, b) => {
        return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 20px; color: #888;">Список пуст</td></tr>';
        return;
    }

    filtered.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="col-item-name">${item.itemName} <span class="item-meta">T${item.tier} ${item.enchant > 0 ? '@'+item.enchant : ''}</span></td>
            <td>${item.buyCity}</td>
            <td class="price-sell">${item.buyPriceDisplay}</td>
            <td>${item.sellCity}</td>
            <td class="price-buy">${formatPrice(item.netSellPrice)}</td>
            <td class="profit-cell">
                <div class="profit-percent">${item.profitPercent}%</div>
                <div class="clean-profit">+${formatPrice(item.cleanProfit)}</div>
            </td>
            <td class="status-cell">
                <div class="status-text">${statusLabels[item.status]}</div>
                <div class="status-controls">
                    <button class="status-btn" onclick="window.changePlannerStatus('${item.uniqueId}', 'prev')">◀</button>
                    <button class="status-btn" onclick="window.changePlannerStatus('${item.uniqueId}', 'next')">▶</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function initPlanner() {
    document.getElementById('planner-search')?.addEventListener('input', renderPlannerTable);
    document.getElementById('planner-sort-status')?.addEventListener('change', renderPlannerTable);
    
    // Делаем функцию доступной глобально для onclick в HTML
    window.changePlannerStatus = changeStatus;
    renderPlannerTable();
}

module.exports = { addToPlanner, initPlanner, renderPlannerTable };