const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess = null;
let backendRunning = false;

let botRunning = false;
let botPaused = false;
let botStopRequested = false;
let resumeCallback = null;

// ===== НАТИВНЫЙ ВВОД (SendInput через C++) =====
let humanInput = null;
try {
    humanInput = require('./native/vigem-input/build/Release/human_input.node');
    console.log('[Main] human_input загружен');
} catch (e) {
    console.error('[Main] Не удалось загрузить human_input:', e.message);
}

// ===== ЛОКАЛЬНЫЙ СЕРВЕР ДЛЯ ПРИЕМА ДАННЫХ ОТ GO =====
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/market-update') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (mainWindow) {
                    mainWindow.webContents.send('market-data-received', data);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
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
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
    } else if (req.method === 'POST' && req.url === '/my-order-update') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                console.log('[Main] Получен личный ордер:', data.itemId);
                if (mainWindow) {
                    mainWindow.webContents.send('my-order-data-received', data);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                console.error('[Main] Ошибка парсинга ордера:', e);
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(3000, '127.0.0.1', () => {
    console.log('Локальный сервер запущен на порту 3000');
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 800,
        frame: false,
        backgroundColor: '#0c0c0c',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Загружаем словарь предметов
    let itemsDictionary = {};
    try {
        const dictPath = path.join(__dirname, 'items-dictionary.json');
        const rawData = fs.readFileSync(dictPath, 'utf-8');
        itemsDictionary = JSON.parse(rawData);
        console.log(`[Main] Словарь предметов загружен: ${Object.keys(itemsDictionary).length} записей`);
    } catch (e) {
        console.warn('[Main] Не удалось загрузить items-dictionary.json:', e.message);
    }

    mainWindow.loadFile('index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('dictionary-loaded', itemsDictionary);
    });
}

app.whenReady().then(() => {
    createWindow();

    // Глобальный хоткей F9: Пауза / Продолжить
    globalShortcut.register('F9', () => {
        if (!botRunning) return;
        if (botPaused) {
            botPaused = false;
            if (resumeCallback) {
                resumeCallback();
                resumeCallback = null;
            }
            sendBotStatus('▶ Продолжение (F9)', true, false);
        } else {
            botPaused = true;
            sendBotStatus('⏸ ПАУЗА (F9)', true, true);
        }
    });

    // Глобальный хоткей F10: Экстренная остановка
    globalShortcut.register('F10', () => {
        if (botRunning) {
            botStopRequested = true;
            botPaused = false;
            if (resumeCallback) {
                resumeCallback();
                resumeCallback = null;
            }
            sendBotStatus('🛑 СТОП (F10)', false, false);
        }
    });
});

// Не забываем снимать хоткеи при закрытии приложения, чтобы не ломать ОС
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (backendProcess) {
        backendProcess.kill();
    }
    server.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ===== УПРАВЛЕНИЕ БЭКЕНДОМ =====
ipcMain.on('start-backend', () => {
    if (backendRunning) return;

    const backendPath = path.join(__dirname, 'albion-bridge.exe');
    const powershell = spawn('powershell.exe', [
        '-Command',
        `Start-Process -FilePath "${backendPath}" -Verb RunAs -WindowStyle Hidden`
    ]);

    powershell.on('close', (code) => {
        if (code === 0) {
            backendRunning = true;
            if (mainWindow) {
                mainWindow.webContents.send('backend-status', {
                    running: true,
                    encrypted: false
                });
            }
        } else {
            if (mainWindow) {
                mainWindow.webContents.send('backend-error', 'Не удалось запустить бэкенд. Проверьте, что файл albion-bridge.exe находится в папке приложения.');
            }
        }
    });

    backendProcess = powershell;
});

ipcMain.on('stop-backend', () => {
    if (backendProcess) {
        const killProcess = spawn('taskkill', ['/F', '/IM', 'albion-bridge.exe']);
        killProcess.on('close', () => {
            backendRunning = false;
            backendProcess = null;
            if (mainWindow) {
                mainWindow.webContents.send('backend-status', {
                    running: false,
                    encrypted: false
                });
            }
        });
    }
});

// ===== УПРАВЛЕНИЕ ОКНОМ =====
ipcMain.on('window-minimize', () => {
    mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.on('window-close', () => {
    if (backendProcess) {
        backendProcess.kill();
    }
    areaOverlays.forEach(w => w.close());
    areaOverlays = [];
    mainWindow.close();
});

// ===== ЭКСПОРТ И ИМПОРТ ДАННЫХ РЫНКА =====
const { dialog } = require('electron');

ipcMain.on('export-market-data', async (event, marketData) => {
    try {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const dateSuffix = `${day}.${month}`;

        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Экспорт данных рынка',
            defaultPath: path.join(__dirname, `market-data_${dateSuffix}.json`),
            filters: [
                { name: 'JSON файлы', extensions: ['json'] },
                { name: 'Все файлы', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePath) {
            const jsonData = JSON.stringify(marketData, null, 2);
            fs.writeFileSync(result.filePath, jsonData, 'utf-8');
            event.reply('market-data-exported', true, 'Данные успешно сохранены');
        }
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        event.reply('market-data-exported', false, error.message);
    }
});

ipcMain.on('import-market-data', async (event) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Импорт данных рынка',
            filters: [
                { name: 'JSON файлы', extensions: ['json'] },
                { name: 'Все файлы', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const importedData = JSON.parse(fileContent);
            event.reply('market-data-imported', importedData);
        }
    } catch (error) {
        console.error('Ошибка импорта:', error);
        dialog.showErrorBox('Ошибка импорта', error.message);
    }
});

// ===== ЧТЕНИЕ/ЗАПИСЬ ОБЛАСТЕЙ В ФАЙЛ =====
const AREAS_FILE = path.join(__dirname, 'bot-areas.json');

ipcMain.handle('load-areas', async () => {
    try {
        if (fs.existsSync(AREAS_FILE)) {
            return JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[Main] Ошибка чтения областей:', e);
    }
    return [];
});

ipcMain.handle('save-areas', async (event, areas) => {
    try {
        fs.writeFileSync(AREAS_FILE, JSON.stringify(areas, null, 2), 'utf-8');
        return { ok: true };
    } catch (e) {
        console.error('[Main] Ошибка сохранения областей:', e);
        return { ok: false, error: e.message };
    }
});

// ===== ЭКРАННОЙ ОВЕРЛЕЙ ВЫБОРА ОБЛАСТЕЙ (ВСЕ МОНИТОРЫ) =====
const { screen } = require('electron');
let areaOverlays = [];

ipcMain.on('open-areas-overlay', () => {
    if (areaOverlays.length) return;

    screen.getAllDisplays().forEach(display => {
        const b = display.bounds;
        const w = new BrowserWindow({
            x: b.x, y: b.y, width: b.width, height: b.height,
            transparent: true,
            frame: false,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            hasShadow: false,
            alwaysOnTop: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });

        w.setAlwaysOnTop(true, 'screen-saver');
        w.setVisibleOnAllWorkspaces(true);
        w.loadFile('areas-overlay.html');

        w.on('closed', () => {
            areaOverlays = areaOverlays.filter(x => x !== w);
            if (areaOverlays.length === 0 && mainWindow && mainWindow.isMinimized()) {
                mainWindow.restore();
            }
        });

        areaOverlays.push(w);
    });

    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-areas-overlay', () => {
    areaOverlays.forEach(w => w.close());
    areaOverlays = [];
});

ipcMain.handle('get-display-bounds', (e) => {
    const win = areaOverlays.find(w => w.webContents.id === e.sender.id);
    const b = win ? win.getBounds() : screen.getPrimaryDisplay().bounds;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
});

ipcMain.on('areas-sync', (e, areas) => {
    areaOverlays.forEach(w => {
        if (w.webContents.id !== e.sender.id) {
            w.webContents.send('areas-sync', areas);
        }
    });
});

// ===== БОТЫ =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MOUSE_SPEED = 1300;

const SEQUENCE_FILE = path.join(__dirname, 'bot-sequence.json');

// Логнормальное распределение для таймингов
function logNormal(mu, sigma) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(mu + sigma * z);
}

function bezier(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function randomPoint(a) {
    const m = 2;
    return {
        x: Math.round(a.x + m + Math.random() * Math.max(1, a.w - m * 2)),
        y: Math.round(a.y + m + Math.random() * Math.max(1, a.h - m * 2))
    };
}

// === ЯДРО УПРАВЛЕНИЯ СОСТОЯНИЕМ БОТА ===
// Эта функция вызывается перед КАЖДЫМ шагом (движением, кликом, паузой)
async function checkBotState() {
    if (botStopRequested) {
        throw new Error('BOT_STOPPED'); // Прерываем всё дерево вызовов
    }
    if (botPaused) {
        sendBotStatus('⏸ ПАУЗА (Ожидание...)', true);
        // Замораживаем выполнение до вызова resumeCallback
        await new Promise(resolve => {
            resumeCallback = resolve;
        });
        if (botStopRequested) throw new Error('BOT_STOPPED');
        sendBotStatus('▶ Продолжение...', true);
    }
}

// Обёртка над sleep, которая умеет прерываться стопом и ставиться на паузу
async function interruptibleSleep(ms) {
    const interval = 50; // Проверяем состояние каждые 50мс
    let elapsed = 0;
    while (elapsed < ms) {
        await checkBotState();
        if (botStopRequested) throw new Error('BOT_STOPPED');
        
        const step = Math.min(interval, ms - elapsed);
        await sleep(step);
        elapsed += step;
    }
}

async function moveMouseTo(targetX, targetY, baseSpeed) {
    if (!humanInput) return;
    
    await checkBotState(); // Проверка перед началом движения
    
    const pos = humanInput.getCursorPos();
    let sx = pos.x, sy = pos.y;
    const dx = targetX - sx, dy = targetY - sy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 2) return;

    const speed = baseSpeed * (0.75 + Math.random() * 0.5);
    const bow = dist * (0.08 + Math.random() * 0.14);
    const sign = Math.random() < 0.5 ? 1 : -1;
    const nx = -dy / dist, ny = dx / dist;
    const c1x = sx + dx * 0.25 + nx * bow * sign;
    const c1y = sy + dy * 0.25 + ny * bow * sign;
    const k = 0.4 + Math.random() * 0.6;
    const c2x = sx + dx * 0.75 - nx * bow * sign * k;
    const c2y = sy + dy * 0.75 - ny * bow * sign * k;

    const duration = (dist / speed) * 1000 * (0.85 + Math.random() * 0.35);
    const steps = Math.max(12, Math.floor(duration / 12));
    let lastX = sx, lastY = sy;

    for (let i = 1; i <= steps; i++) {
        await checkBotState(); // Проверка на каждом шаге курсора!
        
        const t = i / steps;
        const e = smoothstep(t);
        let bx = bezier(e, sx, c1x, c2x, targetX);
        let by = bezier(e, sy, c1y, c2y, targetY);
        if (i < steps) {
            bx += (Math.random() - 0.5) * 1.8;
            by += (Math.random() - 0.5) * 1.8;
        }
        const mx = Math.round(bx - lastX);
        const my = Math.round(by - lastY);
        if (mx !== 0 || my !== 0) {
            humanInput.moveRelative(mx, my);
            lastX += mx;
            lastY += my;
        }
        let delay = (duration / steps) * (0.6 + Math.random() * 0.8);
        if (Math.random() < 0.06) delay += 25 + Math.random() * 60;
        
        await interruptibleSleep(Math.max(1, delay)); // Прерываемый сон
    }

    if (Math.random() < 0.35) {
        await checkBotState();
        const ox = targetX + Math.round((Math.random() - 0.5) * 8);
        const oy = targetY + Math.round((Math.random() - 0.5) * 8);
        const cur = humanInput.getCursorPos();
        humanInput.moveRelative(ox - cur.x, oy - cur.y);
        await interruptibleSleep(40 + Math.random() * 70);
    }

    await checkBotState();
    const final = humanInput.getCursorPos();
    humanInput.moveRelative(targetX - final.x, targetY - final.y);
}

async function clickAt(x, y, baseSpeed) {
    if (!humanInput) return;
    await moveMouseTo(x, y, baseSpeed);
    
    await checkBotState();
    const aimDelay = logNormal(Math.log(40), 0.4);
    await interruptibleSleep(aimDelay);
    
    await checkBotState();
    const holdTime = logNormal(Math.log(30), 0.3);
    humanInput.mouseDown(0);
    await interruptibleSleep(holdTime); // Даже зажатие кнопки можно прервать/поставить на паузу
    humanInput.mouseUp(0);
}

function resolveSequence(sequenceData) {
    const blocks = sequenceData.blocks;
    const visited = new Set();
    function expand(blockName) {
        if (visited.has(blockName)) throw new Error(`Циклическая ссылка в блоке "${blockName}"`);
        visited.add(blockName);
        const block = blocks[blockName];
        if (!block) throw new Error(`Блок "${blockName}" не найден в bot-sequence.json`);
        const result = [];
        for (const item of block) {
            if (typeof item === 'string' && item.startsWith('@')) {
                result.push(...expand(item.slice(1)));
            } else if (typeof item === 'number') {
                result.push(item);
            }
        }
        visited.delete(blockName);
        return result;
    }
    return expand(sequenceData.entryPoint);
}

function showCountdown(ms) {
    return new Promise(resolve => {
        const wins = screen.getAllDisplays().map(d => {
            const b = d.bounds;
            const w = new BrowserWindow({
                x: b.x, y: b.y, width: b.width, height: b.height,
                transparent: true, frame: false, alwaysOnTop: true,
                skipTaskbar: true, hasShadow: false,
                resizable: false, movable: false, focusable: false,
                webPreferences: { nodeIntegration: false, contextIsolation: true }
            });
            w.setAlwaysOnTop(true, 'screen-saver');
            w.setIgnoreMouseEvents(true);
            w.loadFile('countdown.html');
            return w;
        });
        setTimeout(() => {
            wins.forEach(w => { try { w.close(); } catch (e) {} });
            resolve();
        }, ms);
    });
}

function sendBotStatus(text, running, paused = false) {
    if (mainWindow) mainWindow.webContents.send('test-bot-status', { text, running, paused });
}

// === IPC ОБРАБОТЧИКИ УПРАВЛЕНИЯ ===
ipcMain.on('pause-test-bot', () => {
    if (botRunning && !botPaused) {
        botPaused = true;
        sendBotStatus('⏸ ПАУЗА', true, true);
    }
});

ipcMain.on('resume-test-bot', () => {
    if (botRunning && botPaused) {
        botPaused = false;
        if (resumeCallback) {
            resumeCallback();
            resumeCallback = null;
        }
        sendBotStatus('▶ Продолжение...', true, false);
    }
});

ipcMain.on('stop-test-bot', () => {
    if (botRunning) {
        botStopRequested = true;
        botPaused = false;
        if (resumeCallback) {
            resumeCallback();
            resumeCallback = null;
        }
    }
});

ipcMain.handle('start-test-bot', async () => {
    if (botRunning) return { ok: false, error: 'Бот уже работает' };
    if (!humanInput) return { ok: false, error: 'Модуль human_input не загружен.' };

    let areas;
    try {
        areas = JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
    } catch (e) {
        return { ok: false, error: 'Файл bot-areas.json не найден.' };
    }

    let clickIds;
    try {
        const seqData = JSON.parse(fs.readFileSync(SEQUENCE_FILE, 'utf-8'));
        clickIds = resolveSequence(seqData);
    } catch (e) {
        return { ok: false, error: `Ошибка последовательности: ${e.message}` };
    }

    if (clickIds.length === 0) return { ok: false, error: 'Последовательность пуста' };
    for (const id of clickIds) {
        if (id < 1 || id > areas.length) return { ok: false, error: `ID ${id} вне диапазона областей` };
    }

    // Сброс флагов перед стартом
    botRunning = true;
    botPaused = false;
    botStopRequested = false;
    resumeCallback = null;

    sendBotStatus(`Отсчёт 3 сек... (${clickIds.length} кликов)`, true);
    await showCountdown(3000);

    try {
        for (let i = 0; i < clickIds.length; i++) {
            await checkBotState(); // Проверка перед каждым новым кликом
            
            const id = clickIds[i];
            const area = areas[id - 1];
            const p = randomPoint(area);
            
            sendBotStatus(`[${i+1}/${clickIds.length}] Клик: ${area.name || 'ID'+id}`, true);
            await clickAt(p.x, p.y, MOUSE_SPEED);

            const pause = logNormal(Math.log(200), 0.5);
            await interruptibleSleep(pause);
        }
        sendBotStatus('✅ Выполнено успешно', false);
    } catch (err) {
        if (err.message === 'BOT_STOPPED') {
            sendBotStatus('🛑 Остановлено пользователем', false);
        } else {
            sendBotStatus('❌ Ошибка выполнения', false);
            console.error(err);
        }
    } finally {
        botRunning = false;
        botPaused = false;
        botStopRequested = false;
        resumeCallback = null;
    }

    return { ok: true };
});