// js/store.js
const savedData = localStorage.getItem('albionMarketState');
let rawMarketState = savedData ? JSON.parse(savedData) : {};

const marketState = {};
for (const [key, value] of Object.entries(rawMarketState)) {
  if (!key.includes('_')) {
    marketState[`${key}_1`] = { ...value, quality: 1 };
  } else {
    marketState[key] = value;
  }
}

for (const key of Object.keys(marketState)) {
  if (!marketState[key].id) {
    marketState[key].id = key.split('_')[0];
  }
}
localStorage.setItem('albionMarketState', JSON.stringify(marketState));

const state = {
  itemsDict: {},
  marketState: marketState,
  myOrdersByCity: JSON.parse(localStorage.getItem('albionMyOrders') || '{}'),
  MY_ORDERS_TTL: 3 * 60 * 1000,
  flipSettings: {
    buyCity: 'any',
    sellCity: 'blackMarket',
    profitPercent: 0,
    hasPremium: true,
    buyMethod: 'instant',
    sellMethod: 'instant',
    useEnchantCrafting: false,
    enchantBuyMethod: 'instant',
    enchantResourceCity: 'target'
  },
  searchQuery: '',
  selectedQuality: 'all',
  sortField: 'name',
  sortDirection: 'asc',
  flipSortField: 'profitPercent',
  flipSortDirection: 'desc'
};

function saveMarketState() {
  localStorage.setItem('albionMarketState', JSON.stringify(state.marketState));
}

function saveMyOrders() {
  localStorage.setItem('albionMyOrders', JSON.stringify(state.myOrdersByCity));
}

// CommonJS экспорт
module.exports = { state, saveMarketState, saveMyOrders };