const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');


let mainWindow;
let backendProcess = null;
let backendRunning = false;

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
  } else if(req.method==='POST' && req.url==='/my-order-update'){
      let body='';
      req.on('data',chunk=>{body+=chunk.toString();});
      req.on('end',()=>{
          try{
              const data=JSON.parse(body);
              console.log('[Main] Получен личный ордер:', data.itemId); // Дебаг
              if(mainWindow){
                  mainWindow.webContents.send('my-order-data-received', data);
              }
              res.writeHead(200,{'Content-Type': 'application/json'});
              res.end(JSON.stringify({status: 'ok'}));
          }catch(e){
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

  // Отправляем словарь в рендерер после загрузки страницы
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('dictionary-loaded', itemsDictionary);
  });
}

app.whenReady().then(createWindow);

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

  // Запуск через PowerShell с правами администратора
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
    // Находим и убиваем процесс albion-bridge.exe
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
    // Формируем дату: день.месяц (без года)
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

// Границы ТОГО монитора, на котором открыто данное окно оверлея
ipcMain.handle('get-display-bounds', (e) => {
  const win = areaOverlays.find(w => w.webContents.id === e.sender.id);
  const b = win ? win.getBounds() : screen.getPrimaryDisplay().bounds;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});

// Синхронизация областей между окнами на разных мониторах
ipcMain.on('areas-sync', (e, areas) => {
  areaOverlays.forEach(w => {
    if (w.webContents.id !== e.sender.id) {
      w.webContents.send('areas-sync', areas);
    }
  });
});

// ===== БОТЫ =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let botRunning = false;

// Базовая скорость мыши (пикселей в секунду). Фактическая каждый раз ±15-35%
const MOUSE_SPEED = 1300;

function randomPoint(a) {
  const m = 2;
  return {
    x: Math.round(a.x + m + Math.random() * Math.max(1, a.w - m * 2)),
    y: Math.round(a.y + m + Math.random() * Math.max(1, a.h - m * 2))
  };
}

// Человекоподобное перемещение мыши к абсолютным координатам
function moveMouseTo(targetX, targetY, speed) {
  return new Promise((resolve) => {
    const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseSim {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint u, int e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
}
'@

$rand = New-Object System.Random
$cur = New-Object MouseSim+POINT
[MouseSim]::GetCursorPos([ref]$cur)
$sx = $cur.X; $sy = $cur.Y
$tx = ${targetX}; $ty = ${targetY}; $speed = ${speed}

$dx = $tx - $sx; $dy = $ty - $sy
$dist = [Math]::Sqrt($dx*$dx + $dy*$dy)
if ($dist -lt 2) { exit }

# --- кривая Безье со случайным прогибом (рука не водит идеально прямо) ---
$bow  = $dist * (0.08 + $rand.NextDouble() * 0.14)
$sign = 1; if ($rand.Next(2) -eq 0) { $sign = -1 }
$nx = -$dy / $dist; $ny = $dx / $dist
$c1x = $sx + $dx * 0.25 + $nx * $bow * $sign
$c1y = $sy + $dy * 0.25 + $ny * $bow * $sign
$k  = 0.4 + $rand.NextDouble() * 0.6
$c2x = $sx + $dx * 0.75 - $nx * $bow * $sign * $k
$c2y = $sy + $dy * 0.75 - $ny * $bow * $sign * $k

# --- длительность: от скорости со случайным разбросом ---
$duration = ($dist / $speed) * 1000 * (0.85 + $rand.NextDouble() * 0.35)
$steps = [int][Math]::Max($duration / 12, 12)

for ($i = 1; $i -le $steps; $i++) {
  $t = $i / $steps
  $e = $t * $t * (3 - 2 * $t)          # плавный разгон и торможение
  $u = 1 - $e
  $bx = $u*$u*$u*$sx + 3*$u*$u*$e*$c1x + 3*$u*$e*$e*$c2x + $e*$e*$e*$tx
  $by = $u*$u*$u*$sy + 3*$u*$u*$e*$c1y + 3*$u*$e*$e*$c2y + $e*$e*$e*$ty
  if ($i -lt $steps) {                  # микро-дрожание руки в середине пути
    $bx += ($rand.NextDouble() - 0.5) * 1.8
    $by += ($rand.NextDouble() - 0.5) * 1.8
  }
  [MouseSim]::GetCursorPos([ref]$cur)
  $mx = [int]($bx - $cur.X); $my = [int]($by - $cur.Y)
  if ($mx -ne 0 -or $my -ne 0) { [MouseSim]::mouse_event(0x0001, $mx, $my, 0, 0) }
  $delay = ($duration / $steps) * (0.6 + $rand.NextDouble() * 0.8)   # неровный ритм шагов
  if ($rand.NextDouble() -lt 0.06) { $delay += 25 + $rand.Next(60) } # редкие микро-паузы
  Start-Sleep -Milliseconds ([Math]::Max(1, [int]$delay))
}

# --- иногда проскок мимо цели с возвратом (человек промахивается) ---
if ($rand.NextDouble() -lt 0.35) {
  $ox = $tx + [int](($rand.NextDouble() - 0.5) * 8)
  $oy = $ty + [int](($rand.NextDouble() - 0.5) * 8)
  [MouseSim]::GetCursorPos([ref]$cur)
  [MouseSim]::mouse_event(0x0001, ($ox - $cur.X), ($oy - $cur.Y), 0, 0)
  Start-Sleep -Milliseconds (40 + $rand.Next(70))
}

# --- точная финальная точка ---
[MouseSim]::GetCursorPos([ref]$cur)
[MouseSim]::mouse_event(0x0001, ($tx - $cur.X), ($ty - $cur.Y), 0, 0)
`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
    ps.on('close', () => resolve());
    ps.on('error', () => resolve());
  });
}

// Клик: случайная выдержка перед нажатием и случайная длительность зажатия
function clickAt(x, y, speed) {
  return new Promise(async (resolve) => {
    await moveMouseTo(x, y, speed);
    await sleep(60 + Math.random() * 120);   // "человек" целится перед кликом
    const hold = 40 + Math.floor(Math.random() * 60);
    const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseSim {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint u, int e);
}
'@
[MouseSim]::mouse_event(0x02, 0, 0, 0, 0)
Start-Sleep -Milliseconds ${hold}
[MouseSim]::mouse_event(0x04, 0, 0, 0, 0)
`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
    ps.on('close', () => resolve());
    ps.on('error', () => resolve());
  });
}

// Отсчёт поверх всех окон на всех мониторах
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

function sendBotStatus(text, running) {
  if (mainWindow) mainWindow.webContents.send('test-bot-status', { text, running });
}

ipcMain.handle('start-test-bot', async () => {
  if (botRunning) return { ok: false, error: 'Бот уже работает' };

  let areas;
  try {
    areas = JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
  } catch (e) {
    return { ok: false, error: 'Файл bot-areas.json не найден. Сначала разметьте области.' };
  }

  const targets = areas.slice(0, 3);
  if (targets.length < 3) return { ok: false, error: 'В bot-areas.json меньше 3 областей' };

  botRunning = true;
  sendBotStatus('Отсчёт 3 секунды...', true);
  await showCountdown(3000);

  for (const a of targets) {
    const p = randomPoint(a);
    sendBotStatus(`Клик: ${a.name} (${p.x}, ${p.y})`, true);
    await clickAt(p.x, p.y, MOUSE_SPEED);
    await sleep(300 + Math.random() * 400);   // неровная пауза между кликами
  }

  sendBotStatus('Готово', false);
  botRunning = false;
  return { ok: true };
});