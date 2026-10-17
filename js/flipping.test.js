// Мок окружения: при подключении js/flipping.js модуль store.js читает localStorage
global.localStorage = { getItem: () => null, setItem: () => {} };

const { calculateOpportunities } = require('../js/flipping.js');

// Две реализации поставщика налогов (подмена из ПЗ №2 МДК 01.04)
const StandardTaxProvider = { taxRate: 0.04, orderFee: 0.025 };  // премиум
const NoPremiumTaxProvider = { taxRate: 0.08, orderFee: 0.025 }; // без премиума

const settings = { threshold: 0, sellMethod: 'order' };

// Фикстура: покупка 100 000, продажа 150 000
const fixture = { itemA: { id: 'T8_BAG', buyPrice: 100000, sellPrice: 150000 } };

describe('Расчёт флиппинга (FR-FLIP-01..03)', () => {
  test('1. Штатный случай: премиум, продажа заказом', () => {
    const r = calculateOpportunities(fixture, settings, StandardTaxProvider);
    expect(r).toHaveLength(1);
    expect(r[0].netSell).toBe(140400); // 150000 × 0.975 × 0.96 — независимый расчёт
    expect(r[0].profit).toBe(40400);
  });

  test('2. Штатный случай без премиума', () => {
    const r = calculateOpportunities(fixture, settings, NoPremiumTaxProvider);
    expect(r[0].netSell).toBe(134550); // 150000 × 0.975 × 0.92
    expect(r[0].profit).toBe(34550);
  });

  test('3. Ошибочный вход: нет цены продажи', () => {
    const r = calculateOpportunities(
      { a: { id: 'X', buyPrice: 100000, sellPrice: null } },
      settings, StandardTaxProvider
    );
    expect(r).toEqual([]);
  });

  test('4. Ошибочный вход: цена покупки 0', () => {
    const r = calculateOpportunities(
      { a: { id: 'X', buyPrice: 0, sellPrice: 150000 } },
      settings, StandardTaxProvider
    );
    expect(r).toEqual([]);
  });

  test('5. Граница: порог равен прибыли в процентах (40.4)', () => {
    const r = calculateOpportunities(fixture, { ...settings, threshold: 40.4 }, StandardTaxProvider);
    expect(r).toHaveLength(1);
  });

  test('6. Граница: порог выше прибыли (40.5)', () => {
    const r = calculateOpportunities(fixture, { ...settings, threshold: 40.5 }, StandardTaxProvider);
    expect(r).toEqual([]);
  });

  test('7. Отрицательная прибыль исключается', () => {
    const r = calculateOpportunities(
      { a: { id: 'X', buyPrice: 100000, sellPrice: 100000 } },
      settings, StandardTaxProvider
    );
    expect(r).toEqual([]); // чистая продажа 93600 < покупки
  });

  test('8. Пустой вход', () => {
    expect(calculateOpportunities({}, settings, StandardTaxProvider)).toEqual([]);
  });

  test('9. Сортировка по убыванию прибыли', () => {
    const data = {
      low:  { id: 'A', buyPrice: 100000, sellPrice: 120000 },
      high: { id: 'B', buyPrice: 100000, sellPrice: 150000 },
    };
    const r = calculateOpportunities(data, settings, StandardTaxProvider);
    expect(r.map(x => x.id)).toEqual(['B', 'A']);
  });

  // Тест 10 добавлен после анализа покрытия и засева D6
  test('10. Мгновенный способ продажи', () => {
    const r = calculateOpportunities(fixture, { ...settings, sellMethod: 'instant' }, StandardTaxProvider);
    expect(r[0].netSell).toBe(144000); // 150000 × 0.96, без комиссии ордера
    expect(r[0].profit).toBe(44000);
  });
});