// js/flipping.js
const { state } = require('./store.js');
const { getQualityName, getCityDisplayName, formatPrice, getDisplayName } = require('./utils.js');

function getFallbackBuyPrice(item, cityKey) {
  const cityData = item[cityKey];
  if (!cityData) return null;
  if (cityData.buy !== null && cityData.buy > 0) return cityData.buy;
  const lowerQuality = item.quality - 1;
  if (lowerQuality < 1) return null;
  const lowerKey = `${item.id}_${lowerQuality}`;
  const lowerItem = state.marketState[lowerKey];
  if (lowerItem && lowerItem[cityKey] && lowerItem[cityKey].buy !== null) {
    return lowerItem[cityKey].buy + 1;
  }
  return null;
}

function getSalesForCity(item, cityKey) {
  if (!cityKey || !item[cityKey]) return 0;
  return item[cityKey].salesPerDay || 0;
}

function calculateFlippingOpportunities() {
  const results = [];
  const taxRate = state.flipSettings.hasPremium ? 0.04 : 0.08;
  const orderFee = 0.025;

  const selectedTiers = Array.from(document.querySelectorAll('#tierSelect input:checked')).map(cb => parseInt(cb.value));
  const selectedEnchants = Array.from(document.querySelectorAll('#enchantSelect input:checked')).map(cb => parseInt(cb.value));
  const speedSelect = document.getElementById('speedSelect');
  const selectedSpeed = speedSelect ? parseInt(speedSelect.value) : 0;

  const filterByTier = selectedTiers.length > 0;
  const filterByEnchant = selectedEnchants.length > 0;
  const allRoyalCities = ['caerleon', 'bridgewatch', 'lymhurst', 'fortSterling', 'thetford', 'martlock', 'brecilien'];

  Object.values(state.marketState).forEach(item => {
    let effectiveBuyPrice = null;
    let buyCityName = '';
    let isCrafted = false;
    let craftDetailsObj = null;
    const itemTier = item.tier || 0;
    const itemEnchant = item.enchantment || 0;

    if (filterByTier && !selectedTiers.includes(itemTier)) return;
    if (filterByEnchant && !selectedEnchants.includes(itemEnchant)) return;

    if (state.flipSettings.useEnchantCrafting && item.enchantment > 0 && item.enchantment <= 3) {
      let bestCraftCost = Infinity;
      let bestCraftDetails = null;

      for (let baseEnchant = 0; baseEnchant < item.enchantment; baseEnchant++) {
        const baseId = baseEnchant === 0 ? item.id.replace(/@\d+$/, '') : item.id.replace(/@\d+$/, `@${baseEnchant}`);
        const baseKey = `${baseId}_${item.quality}`;
        const baseItem = state.marketState[baseKey];
        if (!baseItem) continue;

        let basePrice = null;
        let baseCityName = '';
        let baseCommission = 0;

        if (state.flipSettings.buyCity === 'any') {
          let minP = Infinity;
          allRoyalCities.forEach(city => {
            const cd = baseItem[city];
            if (!cd) return;
            const p = state.flipSettings.buyMethod === 'order' ? cd.buy : cd.sell;
            if (p !== null && p !== undefined && p < minP) { minP = p; baseCityName = getCityDisplayName(city); }
          });
          if (minP !== Infinity) basePrice = minP;
        } else {
          const cd = baseItem[state.flipSettings.buyCity];
          if (cd) { basePrice = state.flipSettings.buyMethod === 'order' ? cd.buy : cd.sell; baseCityName = getCityDisplayName(state.flipSettings.buyCity); }
        }
        if (basePrice === null) continue;
        if (state.flipSettings.buyMethod === 'order') baseCommission = basePrice * orderFee;

        let upgradeCost = 0;
        let validChain = true;
        let materialsList = [];

        for (let e = baseEnchant; e < item.enchantment; e++) {
          let matType = '';
          if (e === 0) matType = 'RUNE';
          else if (e === 1) matType = 'SOUL';
          else if (e === 2) matType = 'RELIC';
          else { validChain = false; break; }

          const matId = `T${item.tier}_${matType}`;
          const targetItemDict = state.itemsDict[item.id];
          let countNeeded = targetItemDict?.enchantMatCount || 100;
          let matPrice = null;
          let matCityName = '';
          const matMarketKey = `${matId}_1`;
          const matMarketItem = state.marketState[matMarketKey];

          if (matMarketItem) {
            let resourceCities = [];
            if (state.flipSettings.enchantResourceCity === 'target') {
              resourceCities = state.flipSettings.sellCity === 'blackMarket' ? ['caerleon'] : [state.flipSettings.sellCity];
            } else if (state.flipSettings.enchantResourceCity === 'source') {
              resourceCities = state.flipSettings.buyCity === 'any' ? allRoyalCities : [state.flipSettings.buyCity];
            } else {
              resourceCities = [...allRoyalCities];
            }
            let minMatPrice = Infinity;
            resourceCities.forEach(city => {
              const cd = matMarketItem[city];
              if (!cd) return;
              const p = state.flipSettings.enchantBuyMethod === 'order' ? cd.buy : cd.sell;
              if (p !== null && p !== undefined && p < minMatPrice) { minMatPrice = p; matCityName = getCityDisplayName(city); }
            });
            if (minMatPrice !== Infinity) matPrice = minMatPrice;
          }
          if (matPrice === null) { validChain = false; break; }

          const stepTotal = matPrice * countNeeded;
          let matCommission = state.flipSettings.enchantBuyMethod === 'order' ? stepTotal * orderFee : 0;
          upgradeCost += stepTotal + matCommission;
          materialsList.push({ cityName: matCityName, count: countNeeded, matName: getDisplayName(matId), totalCost: stepTotal, commission: matCommission, isOrder: state.flipSettings.enchantBuyMethod === 'order' });
        }
        if (!validChain) continue;

        const totalCraftCost = basePrice + baseCommission + upgradeCost;
        if (totalCraftCost < bestCraftCost) {
          bestCraftCost = totalCraftCost;
          const baseDictItem = state.itemsDict[baseId];
          bestCraftDetails = { totalCost: totalCraftCost, baseCity: baseCityName, baseItemName: baseDictItem ? baseDictItem.name : item.name, basePrice: basePrice, baseCommission: baseCommission, materials: materialsList };
        }
      }

      let directBuyPrice = null;
      let directBuyCity = '';
      if (state.flipSettings.buyCity === 'any') {
        let minP = Infinity;
        allRoyalCities.forEach(city => {
          const cd = item[city];
          if (!cd) return;
          const p = state.flipSettings.buyMethod === 'order' ? cd.buy : cd.sell;
          if (p !== null && p !== undefined && p < minP) { minP = p; directBuyCity = getCityDisplayName(city); }
        });
        if (minP !== Infinity) directBuyPrice = minP;
      } else {
        const cd = item[state.flipSettings.buyCity];
        if (cd) { directBuyPrice = state.flipSettings.buyMethod === 'order' ? cd.buy : cd.sell; directBuyCity = getCityDisplayName(state.flipSettings.buyCity); }
      }

      if (bestCraftCost < Infinity && (directBuyPrice === null || bestCraftCost < directBuyPrice)) {
        effectiveBuyPrice = bestCraftCost; isCrafted = true; craftDetailsObj = bestCraftDetails; buyCityName = bestCraftDetails.baseCity;
      } else if (directBuyPrice !== null) {
        effectiveBuyPrice = directBuyPrice; buyCityName = directBuyCity; isCrafted = false;
      }
    } else {
      if (state.flipSettings.buyCity === 'any') {
        let minPrice = Infinity;
        let bestCity = '';
        allRoyalCities.forEach(city => {
          const cityData = item[city];
          if (!cityData) return;
          let priceToCheck = state.flipSettings.buyMethod === 'order' ? getFallbackBuyPrice(item, city) : cityData.sell;
          if (priceToCheck !== null && priceToCheck < minPrice) { minPrice = priceToCheck; bestCity = city; }
        });
        if (minPrice !== Infinity) { effectiveBuyPrice = minPrice; buyCityName = getCityDisplayName(bestCity); }
      } else {
        const cityData = item[state.flipSettings.buyCity];
        if (cityData) { effectiveBuyPrice = state.flipSettings.buyMethod === 'order' ? getFallbackBuyPrice(item, state.flipSettings.buyCity) : cityData.sell; buyCityName = getCityDisplayName(state.flipSettings.buyCity); }
      }
    }

    if (!effectiveBuyPrice) return;

    let actualBuyCost = effectiveBuyPrice;
    let buyCommission = 0;
    if (state.flipSettings.buyMethod === 'order') { buyCommission = effectiveBuyPrice * orderFee; actualBuyCost = effectiveBuyPrice + buyCommission; }

    let sellPrice = null;
    let sellCityName = '';
    let actualSellCityKey = '';

    if (state.flipSettings.sellCity === 'any') {
      let maxPrice = -Infinity;
      let bestCity = '';
      [...allRoyalCities, 'blackMarket'].forEach(city => {
        const cityData = item[city];
        if (!cityData) return;
        const priceToCheck = state.flipSettings.sellMethod === 'order' ? cityData.sell : cityData.buy;
        if (priceToCheck !== null && priceToCheck > maxPrice) { maxPrice = priceToCheck; bestCity = city; }
      });
      if (maxPrice !== -Infinity) { sellPrice = maxPrice; sellCityName = getCityDisplayName(bestCity); actualSellCityKey = bestCity; }
    } else {
      const cityData = item[state.flipSettings.sellCity];
      if (cityData) { sellPrice = state.flipSettings.sellMethod === 'order' ? cityData.sell : cityData.buy; sellCityName = getCityDisplayName(state.flipSettings.sellCity); actualSellCityKey = state.flipSettings.sellCity; }
    }

    if (!sellPrice) return;

    let grossSellRevenue = sellPrice;
    if (state.flipSettings.sellMethod === 'order') grossSellRevenue = sellPrice * (1 - orderFee);
    const netSellRevenue = grossSellRevenue * (1 - taxRate);
    const profit = netSellRevenue - actualBuyCost;
    const profitPercent = (profit / actualBuyCost) * 100;
    const spd = getSalesForCity(item, actualSellCityKey);

    if (selectedSpeed > 0) {
      let isAllowed = false;
      const salesCount = Number(spd) || 0;
      if (selectedSpeed === 5 && salesCount === 0) isAllowed = true;
      else if (salesCount >= 24 && selectedSpeed === 2) isAllowed = true;
      else if (salesCount >= 4 && selectedSpeed === 3) isAllowed = true;
      else if (salesCount >= 1 && selectedSpeed === 4) isAllowed = true;
      else if (salesCount >= 96 && selectedSpeed === 1) isAllowed = true;
      if (!isAllowed) return;
    }

    if (profitPercent >= state.flipSettings.profitPercent && profit > 0) {
      let finalDisplayPrice = isCrafted && craftDetailsObj ? formatPrice(craftDetailsObj.totalCost) : formatPrice(actualBuyCost);
      results.push({
        itemId: item.id, itemName: item.name, tier: itemTier, enchant: itemEnchant, quality: item.quality,
        salesPerDay: getSalesForCity(item, state.flipSettings.sellCity === 'any' ? 'blackMarket' : state.flipSettings.sellCity),
        buyCity: buyCityName, buyPriceDisplay: finalDisplayPrice,
        buyCommissionDisplay: buyCommission > 0 ? `+${formatPrice(buyCommission)}` : '-',
        sellCity: sellCityName, netSellPrice: Math.round(netSellRevenue),
        commissionDeducted: Math.round(grossSellRevenue - netSellRevenue),
        profitPercent: profitPercent.toFixed(1), cleanProfit: Math.round(profit),
        isCrafted: isCrafted, craftDetailsObj: craftDetailsObj
      });
    }
  });

  results.sort((a, b) => {
    let valA, valB;
    if (state.flipSortField === 'profitPercent') { valA = parseFloat(a.profitPercent); valB = parseFloat(b.profitPercent); }
    else { valA = a.cleanProfit; valB = b.cleanProfit; }
    return state.flipSortDirection === 'asc' ? valA - valB : valB - valA;
  });

  renderFlippingResults(results);
}

function renderFlippingResults(results) {
  const wrapper = document.querySelector('#page-flipping .flipping-results');
  if (!wrapper) return;
  if (results.length === 0) {
    wrapper.innerHTML = `<p style="color: var(--text-primary); opacity: 0.5; font-size: 14px;">Нет сделок с прибылью ≥ ${state.flipSettings.profitPercent}%</p>`;
    return;
  }

  let html = `
    <table class="flipping-table">
      <thead><tr>
        <th>Предмет</th><th>Покупка</th><th></th><th>Продажа</th>
        <th class="profit-col sortable-flip" id="flipSortHeader"><span class="sort-label">Прибыль (%)</span> <span class="sort-arrow"></span></th>
        <th class="action-col">Действия</th>
      </tr></thead><tbody>`;

  results.forEach(r => {
    html += `
      <tr>
        <td class="item-cell"><div class="item-name">${r.itemName}</div><div class="item-meta">T${r.tier} | +${r.enchant} | ${getQualityName(r.quality)}</div></td>
        <td class="city-cell buy-info">
          ${r.isCrafted && r.craftDetailsObj ? `
            <div class="craft-total-sum">${formatPrice(r.craftDetailsObj.totalCost)}</div>
            <div class="craft-base-row"><span class="city-name">${r.craftDetailsObj.baseCity}</span> <span class="craft-item-name">(${r.craftDetailsObj.baseItemName})</span></div>
            <div class="buy-price">${formatPrice(r.craftDetailsObj.basePrice)}</div>
            ${r.craftDetailsObj.baseCommission > 0 ? `<div class="base-commission">+${formatPrice(r.craftDetailsObj.baseCommission)}</div>` : ''}
            ${r.craftDetailsObj.materials.map(mat => {
              const matStepTotal = mat.totalCost + mat.commission;
              return `<div class="craft-mat-row"><div class="mat-header"><span class="city-name-small">${mat.cityName}</span> <span class="mat-count">(${mat.count} шт.)</span></div><div class="mat-info-line"><span class="mat-name">${mat.matName}</span><div class="mat-cost-group"><span class="mat-cost">${formatPrice(matStepTotal)}</span>${mat.isOrder ? `<span class="order-plus">+${formatPrice(mat.commission)}</span>` : ''}</div></div></div>`;
            }).join('')}
          ` : `
            <div class="city-name">${r.buyCity}</div>
            <div class="buy-price">${r.buyPriceDisplay}</div>
            <div class="buy-commission">${r.buyCommissionDisplay}</div>
          `}
        </td>
        <td class="arrow-cell"><div style="font-size: 16px;">➜</div><div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${(r.salesPerDay !== undefined && r.salesPerDay !== null) ? r.salesPerDay : 0}/день</div></td>
        <td class="sell-cell"><div class="sell-city">${r.sellCity}</div><div class="sell-price">${formatPrice(r.netSellPrice)}</div><div class="sell-commission">-${formatPrice(r.commissionDeducted)}</div></td>
        <td class="profit-cell"><div class="profit-percent">${r.profitPercent}%</div><div class="clean-profit">+${formatPrice(r.cleanProfit)}</div></td>
        <td class="action-cell"><button class="add-to-plan-btn" data-item-id="${r.itemId}" data-buy-city="${r.buyCity}" data-sell-city="${r.sellCity}">В план</button></td>
      </tr>`;
  });

  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

function updateFlipSortUI() {
  const header = document.getElementById('flipSortHeader');
  if (!header) return;
  header.classList.remove('asc');
  header.classList.add('desc');
  header.childNodes[0].textContent = state.flipSortField === 'profitPercent' ? 'Прибыль (%) ' : 'Чистая прибыль ';
}

function initFlippingFilters() {
  const speedSelect = document.getElementById('speedSelect');
  if (speedSelect) speedSelect.addEventListener('change', calculateFlippingOpportunities);

  const buyCitySelect = document.getElementById('buyCitySelect');
  const sellCitySelect = document.getElementById('sellCitySelect');
  const profitInput = document.getElementById('profitPercentInput');

  if (buyCitySelect) buyCitySelect.addEventListener('change', (e) => { state.flipSettings.buyCity = e.target.value; calculateFlippingOpportunities(); });
  if (sellCitySelect) sellCitySelect.addEventListener('change', (e) => { state.flipSettings.sellCity = e.target.value; calculateFlippingOpportunities(); });
  if (profitInput) profitInput.addEventListener('input', (e) => { state.flipSettings.profitPercent = parseFloat(e.target.value) || 0; calculateFlippingOpportunities(); });

  const premiumBtns = document.querySelectorAll('.premium-btn');
  premiumBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      premiumBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.flipSettings.hasPremium = btn.dataset.value === 'true';
      calculateFlippingOpportunities();
    });
  });

  function initMultiSelect(selectId, headerText) {
    const container = document.getElementById(selectId);
    if (!container) return;
    const header = container.querySelector('.multi-select-header');
    const options = container.querySelector('.multi-select-options');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multi-select-options').forEach(opt => { if (opt !== options) opt.classList.remove('open'); });
      options.classList.toggle('open');
    });
    const updateHeader = () => {
      const checked = Array.from(checkboxes).filter(cb => cb.checked);
      if (checked.length === 0) header.textContent = headerText;
      else if (checked.length <= 3) header.textContent = checked.map(cb => cb.parentElement.textContent.trim()).join(', ');
      else header.textContent = `Выбрано: ${checked.length}`;
    };
    checkboxes.forEach(cb => { cb.addEventListener('change', () => { updateHeader(); calculateFlippingOpportunities(); }); });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) options.classList.remove('open'); });
  }

  initMultiSelect('tierSelect', 'Выберите уровни...');
  initMultiSelect('enchantSelect', 'Выберите зачарование...');

  function initTradeToggle(toggleId, label) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;
    const buttons = toggle.querySelectorAll('.trade-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.value;
        if (label === 'Способ покупки') state.flipSettings.buyMethod = val;
        if (label === 'Способ продажи') state.flipSettings.sellMethod = val;
        if (label === 'Способ закупки ресурсов') state.flipSettings.enchantBuyMethod = val;
        calculateFlippingOpportunities();
      });
    });
  }

  initTradeToggle('buyMethodToggle', 'Способ покупки');
  initTradeToggle('sellMethodToggle', 'Способ продажи');
  initTradeToggle('enchantBuyMethodToggle', 'Способ закупки ресурсов');

  const enchantToggle = document.getElementById('enchantMethodToggle');
  if (enchantToggle) {
    const buttons = enchantToggle.querySelectorAll('.enchant-btn');
    const updateEnchantVisibility = (isVisible) => {
      document.querySelectorAll('.enchant-setting-row').forEach(row => { row.style.display = isVisible ? 'block' : 'none'; });
    };
    updateEnchantVisibility(state.flipSettings.useEnchantCrafting);
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.flipSettings.useEnchantCrafting = btn.dataset.value === 'true';
        updateEnchantVisibility(state.flipSettings.useEnchantCrafting);
        calculateFlippingOpportunities();
      });
    });
  }

  const enchantCitySelect = document.getElementById('enchantResourceCity');
  if (enchantCitySelect) {
    enchantCitySelect.addEventListener('change', (e) => { state.flipSettings.enchantResourceCity = e.target.value; calculateFlippingOpportunities(); });
  }

  document.addEventListener('click', (e) => {
    const sortHeader = e.target.closest('#flipSortHeader');
    if (sortHeader) {
      state.flipSortField = state.flipSortField === 'profitPercent' ? 'cleanProfit' : 'profitPercent';
      state.flipSortDirection = 'desc';
      updateFlipSortUI();
      calculateFlippingOpportunities();
    }
  });
}

module.exports = { calculateFlippingOpportunities, renderFlippingResults, updateFlipSortUI, initFlippingFilters };