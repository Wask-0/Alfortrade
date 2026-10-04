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