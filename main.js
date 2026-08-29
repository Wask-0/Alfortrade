const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

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
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
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

  mainWindow.loadFile('index.html');
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
  mainWindow.close();
});