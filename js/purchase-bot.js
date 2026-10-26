// js/purchase-bot.js — бот закупки (main-процесс)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AREAS_FILE = path.join(ROOT, 'bot-areas.json');
const DICT_FILE = path.join(ROOT, 'items-dictionary.json');
const SEQ_FILE = path.join(ROOT, 'purchase-sequences.json');

function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return fallback; }
}

function substitute(str, item) {
    return String(str)
        .replace(/%ITEM_NAME%/g, item.itemName || '')
        .replace(/%QUANTITY%/g, String(item.quantity || 1))
        .replace(/%CITY%/g, item.buyCity || '')
        .replace(/%ENCHANT_LEVEL%/g, String(item.enchantLevel || 0));
}

// Раскрытие последовательности в плоский список шагов
function expandSequence(sequence, macros, item, visited, out) {
    (sequence || []).forEach(raw => {
        if (typeof raw === 'number') { out.push({ type: 'clickId', id: raw }); return; }
        if (typeof raw !== 'string') return;
        const cmd = substitute(raw, item);

        if (cmd.startsWith('@')) {
            const name = cmd.slice(1);
            if (visited.has(name)) throw new Error(`Циклическая ссылка в макросе "${name}"`);
            if (!macros[name]) throw new Error(`Макрос "${name}" не найден`);
            visited.add(name);
            expandSequence(macros[name], macros, item, visited, out);
            visited.delete(name);
        } else if (cmd.startsWith('wait:')) {
            out.push({ type: 'wait', ms: parseInt(cmd.slice(5), 10) || 0 });
        } else if (cmd.startsWith('click:')) {
            out.push({ type: 'clickName', name: cmd.slice(6).trim() });
        } else if (cmd.startsWith('move:')) {
            const parts = cmd.slice(5).split(':');
            out.push({ type: 'moveName', name: parts[0].trim(), wait: parseInt(parts[1], 10) || 0 });
        } else if (cmd.startsWith('m')) {
            const parts = cmd.slice(1).split(':');
            out.push({ type: 'moveId', id: parseInt(parts[0], 10), wait: parseInt(parts[1], 10) || 0 });
        }
    });
}

// Маршрут предмета: way из словаря + enchanted-блок + хвост способа покупки
function buildRoute(item) {
    const dict = loadJSON(DICT_FILE, {});
    const common = loadJSON(SEQ_FILE, {});

    const way = (dict[item.itemId] || {}).way;
    if (!Array.isArray(way)) throw new Error(`для ${item.itemId} не прописан way`);

    const macros = {};
    const out = [];
    const visited = new Set();

    // 1. Личный маршрут предмета
    expandSequence(way, macros, item, visited, out);

    // 2. Зачарование (1..4), если есть
    const lvl = item.enchantLevel || 0;
    if (lvl > 0) {
        const ench = (common.enchanted || {})[String(lvl)] || (common.enchanted || {})[lvl];
        if (Array.isArray(ench)) expandSequence(ench, macros, item, visited, out);
    }

    // 3. Качество (1..5)
    const q = item.quality || 1;
    const qSeq = (common.quality || {})[String(q)] || (common.quality || {})[q];
    if (Array.isArray(qSeq)) expandSequence(qSeq, macros, item, visited, out);

    // 4. Одно действие способа покупки
    const action = (common.byMethod || {})[item.buyMethod];
    if (action !== undefined && action !== null) {
        expandSequence(Array.isArray(action) ? action : [action], macros, item, visited, out);
    }

    return out;
}

function findArea(what) {
    return loadJSON(AREAS_FILE, []).find(a => a.id === what || a.name === what);
}

function randomPoint(a) {
    const m = 2;
    return {
        x: Math.round(a.x + m + Math.random() * Math.max(1, a.w - m * 2)),
        y: Math.round(a.y + m + Math.random() * Math.max(1, a.h - m * 2))
    };
}

async function execStep(step, ctx) {
    if (step.type === 'wait') { await ctx.sleep(step.ms); return; }

    const area = findArea(step.id !== undefined ? step.id : step.name);
    if (!area) throw new Error(`Область не найдена: ${step.id !== undefined ? step.id : step.name}`);
    const p = randomPoint(area);
    await ctx.moveMouseTo(p.x, p.y, ctx.mouseSpeed, ctx.check, ctx.sleep);

    if (step.type === 'clickId' || step.type === 'clickName') {
        ctx.humanInput.mouseDown(0);
        await ctx.sleep(40 + Math.random() * 60);
        ctx.humanInput.mouseUp(0);
        await ctx.sleep(80 + Math.random() * 120);
    } else if (step.wait) {
        await ctx.sleep(step.wait);
    }
}

async function run(task, ctx) {
    const items = task.items || [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await ctx.check();

        let steps;
        try {
            steps = buildRoute(item);
        } catch (e) {
            ctx.status(`Пропуск ${item.itemName}: ${e.message}`);
            await ctx.sleep(500);
            continue;
        }

        ctx.status(`[${i + 1}/${items.length}] ${item.itemName} ×${item.quantity}`);
        for (const step of steps) {
            await ctx.check();
            await execStep(step, ctx);
        }
        ctx.onItemDone(item);
        await ctx.sleep(400 + Math.random() * 500);
    }
    ctx.status('Закупка завершена', false);
}

module.exports = { run, buildRoute };