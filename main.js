const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess = null;
let backendRunning = false;

// Состояние для мульти-бота
let botsRuntimeState = {};

// ===== НАТИВНЫЙ ВВОД =====
let humanInput = null;
try {
    humanInput = require('./native/vigem-input/build/Release/human_input.node');
    console.log('[Main] human_input загружен');
} catch (e) {
    console.error('[Main] ОШИБКА: human_input не найден! Боты не будут работать.');
}

// ===== ЛОКАЛЬНЫЙ СЕРВЕР =====
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'POST' && req.url === '/market-update') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (mainWindow) mainWindow.webContents.send('market-data-received', data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(400); res.end('Invalid JSON'); }
        });
    } else if (req.method === 'POST' && req.url === '/status') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const status = JSON.parse(body);
                if (mainWindow) {
                    mainWindow.webContents.send('backend-status', status);
                    mainWindow.webContents.send('location-update', status.currentLocation);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(400); res.end('Invalid JSON'); }
        });
    } else if (req.method === 'POST' && req.url === '/my-order-update') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (mainWindow) mainWindow.webContents.send('my-order-data-received', data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(400); res.end('Invalid JSON'); }
        });
    } else {
        res.writeHead(404); res.end();
    }
});

server.listen(3000, '127.0.0.1', () => console.log('Сервер на порту 3000'));

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 800, frame: false, backgroundColor: '#0c0c0c',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    let itemsDictionary = {};
    try {
        itemsDictionary = JSON.parse(fs.readFileSync(path.join(__dirname, 'items-dictionary.json'), 'utf-8'));
    } catch (e) { console.warn('Нет словаря предметов'); }

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('dictionary-loaded', itemsDictionary);
    });
}

app.whenReady().then(() => {
    createWindow();

    // F9: Пауза / Продолжить (для всех активных ботов)
    globalShortcut.register('F9', () => {
        for (const [botId, state] of Object.entries(botsRuntimeState)) {
            if (state.running) {
                if (state.paused) {
                    state.paused = false;
                    if (state.resumeCallback) { state.resumeCallback(); state.resumeCallback = null; }
                    sendBotStatus(botId, '▶ Продолжение (F9)', true, false);
                } else {
                    state.paused = true;
                    sendBotStatus(botId, '⏸ ПАУЗА (F9)', true, true);
                }
            }
        }
    });

    // F10: Стоп (для всех активных ботов)
    globalShortcut.register('F10', () => {
        for (const [botId, state] of Object.entries(botsRuntimeState)) {
            if (state.running) {
                state.stopRequested = true;
                state.paused = false;
                if (state.resumeCallback) { state.resumeCallback(); state.resumeCallback = null; }
            }
        }
    });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
    if (backendProcess) backendProcess.kill();
    server.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ===== БЭКЕНД =====
ipcMain.on('start-backend', () => {
    if (backendRunning) return;
    const backendPath = path.join(__dirname, 'albion-bridge.exe');
    const ps = spawn('powershell.exe', ['-Command', `Start-Process -FilePath "${backendPath}" -Verb RunAs -WindowStyle Hidden`]);
    ps.on('close', (code) => {
        backendRunning = (code === 0);
        if (mainWindow) mainWindow.webContents.send('backend-status', { running: backendRunning, encrypted: false });
        if (code !== 0 && mainWindow) mainWindow.webContents.send('backend-error', 'Ошибка запуска бэкенда');
    });
    backendProcess = ps;
});

ipcMain.on('stop-backend', () => {
    if (backendProcess) {
        spawn('taskkill', ['/F', '/IM', 'albion-bridge.exe']).on('close', () => {
            backendRunning = false; backendProcess = null;
            if (mainWindow) mainWindow.webContents.send('backend-status', { running: false, encrypted: false });
        });
    }
});

// ===== ОКНО =====
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => {
    if (backendProcess) backendProcess.kill();
    areaOverlays.forEach(w => w.close()); areaOverlays = [];
    mainWindow.close();
});

// ===== ЭКСПОРТ / ИМПОРТ =====
const { dialog } = require('electron');
ipcMain.on('export-market-data', async (event, marketData) => {
    try {
        const now = new Date();
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: path.join(__dirname, `market-data_${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.json`),
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (!result.canceled && result.filePath) {
            fs.writeFileSync(result.filePath, JSON.stringify(marketData, null, 2), 'utf-8');
            event.reply('market-data-exported', true);
        }
    } catch (e) { event.reply('market-data-exported', false, e.message); }
});

ipcMain.on('import-market-data', async (event) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
        if (!result.canceled && result.filePaths.length > 0) {
            event.reply('market-data-imported', JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')));
        }
    } catch (e) { dialog.showErrorBox('Ошибка', e.message); }
});

// ===== ОБЛАСТИ =====
const AREAS_FILE = path.join(__dirname, 'bot-areas.json');
ipcMain.handle('load-areas', async () => {
    try { return fs.existsSync(AREAS_FILE) ? JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8')) : []; } catch (e) { return []; }
});
ipcMain.handle('save-areas', async (event, areas) => {
    try { fs.writeFileSync(AREAS_FILE, JSON.stringify(areas, null, 2), 'utf-8'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

// ===== ОВЕРЛЕЙ ОБЛАСТЕЙ =====
const { screen } = require('electron');
let areaOverlays = [];
ipcMain.on('open-areas-overlay', () => {
    if (areaOverlays.length) return;
    screen.getAllDisplays().forEach(display => {
        const b = display.bounds;
        const w = new BrowserWindow({
            x: b.x, y: b.y, width: b.width, height: b.height,
            transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        w.setAlwaysOnTop(true, 'screen-saver');
        w.loadFile('areas-overlay.html');
        w.on('closed', () => {
            areaOverlays = areaOverlays.filter(x => x !== w);
            if (areaOverlays.length === 0 && mainWindow?.isMinimized()) mainWindow.restore();
        });
        areaOverlays.push(w);
    });
    if (mainWindow) mainWindow.minimize();
});
ipcMain.on('close-areas-overlay', () => { areaOverlays.forEach(w => w.close()); areaOverlays = []; });
ipcMain.handle('get-display-bounds', (e) => {
    const win = areaOverlays.find(w => w.webContents.id === e.sender.id);
    const b = win ? win.getBounds() : screen.getPrimaryDisplay().bounds;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
});
ipcMain.on('areas-sync', (e, areas) => {
    areaOverlays.forEach(w => { if (w.webContents.id !== e.sender.id) w.webContents.send('areas-sync', areas); });
});

// ===== БОТЫ (МУЛЬТИ-СИСТЕМА) =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BOTS_CONFIG_FILE = path.join(__dirname, 'bots-config.json');
const MOUSE_SPEED = 1300;

function logNormal(mu, sigma) {
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(mu + sigma * z);
}
function bezier(t, p0, p1, p2, p3) { const u = 1 - t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function randomPoint(a) {
    const m = 2;
    return { x: Math.round(a.x + m + Math.random() * Math.max(1, a.w - m*2)), y: Math.round(a.y + m + Math.random() * Math.max(1, a.h - m*2)) };
}

async function moveMouseTo(targetX, targetY, baseSpeed, checkStateFn, sleepFn) {
    if (!humanInput) return;
    await checkStateFn();
    
    const pos = humanInput.getCursorPos();
    let sx = pos.x, sy = pos.y;
    const dx = targetX - sx, dy = targetY - sy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 2) return;

    const speed = baseSpeed * (0.75 + Math.random() * 0.5);

    // Прогиб траектории: маленький процент + абсолютный потолок.
    // Курсор идёт почти прямо, отклонение не больше MAX_BOW px в любую сторону.
    const MAX_BOW = 10;
    const bow = Math.min(dist * (0.015 + Math.random() * 0.025), MAX_BOW);
    const sign = Math.random() < 0.5 ? 1 : -1;
    const nx = -dy / dist, ny = dx / dist;

    // Контрольные точки ближе к прямой (0.3 / 0.7 вместо 0.25 / 0.75)
    const c1x = sx + dx * 0.3 + nx * bow * sign;
    const c1y = sy + dy * 0.3 + ny * bow * sign;
    const k = 0.4 + Math.random() * 0.6;
    const c2x = sx + dx * 0.7 - nx * bow * sign * k;
    const c2y = sy + dy * 0.7 - ny * bow * sign * k;

    const duration = (dist / speed) * 1000 * (0.85 + Math.random() * 0.35);
    const steps = Math.max(12, Math.floor(duration / 12));
    let lastX = sx, lastY = sy;

    for (let i = 1; i <= steps; i++) {
        await checkStateFn();
        const e = smoothstep(i / steps);
        let bx = bezier(e, sx, c1x, c2x, targetX) + (i < steps ? (Math.random()-0.5)*1.2 : 0);
        let by = bezier(e, sy, c1y, c2y, targetY) + (i < steps ? (Math.random()-0.5)*1.2 : 0);
        
        const mx = Math.round(bx - lastX), my = Math.round(by - lastY);
        if (mx !== 0 || my !== 0) { humanInput.moveRelative(mx, my); lastX += mx; lastY += my; }
        
        let delay = (duration / steps) * (0.6 + Math.random() * 0.8);
        if (Math.random() < 0.06) delay += 25 + Math.random() * 60;
        await sleepFn(Math.max(1, delay));
    }

    // Overshoot уменьшен: ±3px вместо ±4, остаётся в пределах целевой области
    if (Math.random() < 0.35) {
        await checkStateFn();
        const cur = humanInput.getCursorPos();
        humanInput.moveRelative(targetX + (Math.random()-0.5)*6 - cur.x, targetY + (Math.random()-0.5)*6 - cur.y);
        await sleepFn(40 + Math.random() * 70);
    }

    await checkStateFn();
    const final = humanInput.getCursorPos();
    humanInput.moveRelative(targetX - final.x, targetY - final.y);
}

// Разворачивание последовательности КОНКРЕТНОГО бота
function resolveBotSequence(botConfig) {
    const macros = botConfig.macros || {};
    const visited = new Set();
    
    function expand(item) {
        // 1. Обычный клик (число)
        if (typeof item === 'number') return [{ type: 'click', target: item }];
        
        // 2. Строковые команды (движение или макрос)
        if (typeof item === 'string') {
            // Движение: "m1" или "m1:500" (m = move, 1 = ID, 500 = wait ms)
            if (item.startsWith('m')) {
                const parts = item.slice(1).split(':');
                const targetId = parseInt(parts[0], 10);
                const waitTime = parts.length > 1 ? parseInt(parts[1], 10) : 0;
                
                if (isNaN(targetId)) throw new Error(`Ошибка в команде движения "${item}" у бота ${botConfig.name}`);
                return [{ type: 'move', target: targetId, wait: waitTime }];
            }
            
            // Ссылка на макрос: "@block1"
            if (item.startsWith('@')) {
                const name = item.slice(1);
                if (visited.has(name)) throw new Error(`Циклическая ссылка в макросе "${name}"`);
                visited.add(name);
                if (!macros[name]) throw new Error(`Макрос "${name}" не найден у бота ${botConfig.name}`);
                const result = macros[name].flatMap(expand);
                visited.delete(name);
                return result;
            }
        }
        
        return [];
    }
    return botConfig.sequence.flatMap(expand);
}

function showCountdown(ms) {
    return new Promise(resolve => {
        const wins = screen.getAllDisplays().map(d => {
            const b = d.bounds;
            const w = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
            w.setAlwaysOnTop(true, 'screen-saver'); w.setIgnoreMouseEvents(true); w.loadFile('countdown.html');
            return w;
        });
        setTimeout(() => { wins.forEach(w => w.close()); resolve(); }, ms);
    });
}

function sendBotStatus(botId, text, running, paused = false) {
    if (mainWindow) mainWindow.webContents.send('test-bot-status', { botId, text, running, paused });
}

// --- IPC: Список ботов ---
ipcMain.handle('get-bots-list', async () => {
    try {
        const data = JSON.parse(fs.readFileSync(BOTS_CONFIG_FILE, 'utf-8'));
        return data.bots.map(b => ({ id: b.id, name: b.name, description: b.description }));
    } catch (e) { return []; }
});

// --- IPC: Управление ---
function getBotState(botId) {
    if (!botsRuntimeState[botId]) botsRuntimeState[botId] = { running: false, paused: false, stopRequested: false, resumeCallback: null };
    return botsRuntimeState[botId];
}

ipcMain.on('pause-test-bot', (event, botId) => {
    const state = getBotState(botId);
    if (state.running && !state.paused) { state.paused = true; sendBotStatus(botId, '⏸ ПАУЗА', true, true); }
});

ipcMain.on('resume-test-bot', (event, botId) => {
    const state = getBotState(botId);
    if (state.running && state.paused) {
        state.paused = false;
        if (state.resumeCallback) { state.resumeCallback(); state.resumeCallback = null; }
        sendBotStatus(botId, '▶ Продолжение...', true, false);
    }
});

ipcMain.on('stop-test-bot', (event, botId) => {
    const state = getBotState(botId);
    if (state.running) {
        state.stopRequested = true; state.paused = false;
        if (state.resumeCallback) { state.resumeCallback(); state.resumeCallback = null; }
    }
});

// --- IPC: Запуск ---
ipcMain.handle('start-test-bot', async (event, botId) => {
    const state = getBotState(botId);
    if (state.running) return { ok: false, error: 'Бот уже работает' };
    if (!humanInput) return { ok: false, error: 'Модуль human_input не загружен.' };

    let areas, botsData;
    try {
        areas = JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
        botsData = JSON.parse(fs.readFileSync(BOTS_CONFIG_FILE, 'utf-8'));
    } catch (e) { return { ok: false, error: 'Ошибка чтения конфигов.' }; }

    const botConfig = botsData.bots.find(b => b.id === botId);
    if (!botConfig) return { ok: false, error: 'Бот не найден' };

    let actions; // Теперь это массив объектов { type, target, wait }
    try { actions = resolveBotSequence(botConfig); } catch (e) { return { ok: false, error: e.message }; }

    // Валидация ID
    for (const act of actions) {
        if (act.target < 1 || act.target > areas.length) return { ok: false, error: `ID ${act.target} вне диапазона областей` };
    }

    state.running = true; state.paused = false; state.stopRequested = false; state.resumeCallback = null;
    sendBotStatus(botId, `Отсчёт 3 сек... (${actions.length} действий)`, true);
    await showCountdown(3000);

    const checkState = async () => {
        if (state.stopRequested) throw new Error('BOT_STOPPED');
        if (state.paused) {
            sendBotStatus(botId, '⏸ ПАУЗА', true, true);
            await new Promise(resolve => { state.resumeCallback = resolve; });
            if (state.stopRequested) throw new Error('BOT_STOPPED');
            sendBotStatus(botId, '▶ Продолжение...', true, false);
        }
    };

    const iSleep = async (ms) => {
        let elapsed = 0;
        while (elapsed < ms) {
            await checkState();
            if (state.stopRequested) throw new Error('BOT_STOPPED');
            const step = Math.min(50, ms - elapsed);
            await sleep(step);
            elapsed += step;
        }
    };

    try {
        for (let i = 0; i < actions.length; i++) {
            await checkState();
            const action = actions[i];
            const area = areas[action.target - 1];
            const p = randomPoint(area);
            
            const actionText = action.type === 'click' ? 'Клик' : 'Движение';
            sendBotStatus(botId, `[${i+1}/${actions.length}] ${actionText}: ${area.name || 'ID'+action.target}`, true);
            
            // 1. Всегда двигаем мышь к цели
            await moveMouseTo(p.x, p.y, MOUSE_SPEED, checkState, iSleep);
            
            // 2. Если это КЛИК — делаем паузу прицеливания и кликаем
            if (action.type === 'click') {
                await checkState();
                await iSleep(logNormal(Math.log(40), 0.4)); // Прицеливание
                
                await checkState();
                const holdTime = logNormal(Math.log(30), 0.3);
                humanInput.mouseDown(0);
                await iSleep(holdTime);
                humanInput.mouseUp(0);
                
                // Пауза после клика перед следующим действием
                await iSleep(logNormal(Math.log(200), 0.5));
            } 
            // 3. Если это ДВИЖЕНИЕ — просто ждём указанное время (если есть)
            else if (action.type === 'move') {
                if (action.wait > 0) {
                    await iSleep(action.wait);
                }
                // Небольшая фиксированная пауза после движения, чтобы не дёргалось мгновенно
                await iSleep(100 + Math.random() * 100); 
            }
        }
        sendBotStatus(botId, '✅ Готово', false);
    } catch (err) {
        if (err.message === 'BOT_STOPPED') sendBotStatus(botId, '🛑 Остановлено', false);
        else { sendBotStatus(botId, '❌ Ошибка', false);}
    } finally {
        state.running = false; state.paused = false; state.stopRequested = false; state.resumeCallback = null;
    }
    return { ok: true };
});

// ===== БОТ ЗАКУПКИ =====
const purchaseBot = require('./js/purchase-bot.js');

ipcMain.on('start-purchase-bot', async (event, task) => {
    const state = getBotState('purchase');   // F9/F10 подхватят автоматически
    if (state.running) return;
    state.running = true; state.paused = false; state.stopRequested = false;

    const send = (text, running = true, paused = false) =>
        event.sender.send('purchase-bot-status', { text, running, paused });

    send('Старт через 3 сек...');
    await showCountdown(3000);

    const ctx = {
        humanInput,
        moveMouseTo,
        sleep,
        mouseSpeed: MOUSE_SPEED,
        check: async () => {
            while (state.paused && !state.stopRequested) await sleep(200);
            if (state.stopRequested) throw new Error('stop');
        },
        status: send,
        onItemDone: (item) => event.sender.send('purchase-item-done', { uniqueId: item.uniqueId, quantity: item.quantity })
    };

    try {
        await purchaseBot.run(task, ctx);
    } catch (e) {
        send(state.stopRequested ? 'Остановлено (F10)' : `Ошибка: ${e.message}`, false);
    }
    state.running = false;
});