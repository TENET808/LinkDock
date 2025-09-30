const { app, BrowserWindow, ipcMain, dialog, shell, Menu, globalShortcut, nativeTheme, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater'); // ВКЛЮЧЕНО
const http = require('http'); // Добавлено для HTTP HEAD запросов
const https = require('https'); // Добавлено для HTTPS HEAD запросов


// --- ХРАНИЛИЩЕ ---
const store = new Store({
  name: 'linkdock-data',
  defaults: {
    ui: { 
      bounds: { width: 1100, height: 700 }, 
      theme: 'light',
      minimizeToTray: false 
    },
    groups: [ { id: 'default', name: 'Общее', order: 0 } ],
    bookmarks: [],
    windows: {}
  }
});

let mainWindow;
let tray = null;

// --- ФУНКЦИЯ СОЗДАНИЯ ТРЕЯ ---
function createTray() {
  const iconPath = path.join(__dirname, 'build/icon.png'); 
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Развернуть', click: () => {
      if (mainWindow) mainWindow.show();
    }},
    { type: 'separator' },
    { label: 'Выход', click: () => { 
        app.isQuitting = true;
        app.quit(); 
      } 
    }
  ]);
  tray.setToolTip('LinkDock');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) mainWindow.show();
  });
}

// --- ФУНКЦИЯ СОЗДАНИЯ ГЛАВНОГО ОКНА ---
function createMainWindow(){
  const { bounds } = store.get('ui');
  mainWindow = new BrowserWindow({
    width: bounds.width || 1100,
    height: bounds.height || 700,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'build/icon.png'),
    title: 'LinkDock'
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  mainWindow.on('close', (event) => {
    store.set('ui.bounds', mainWindow.getBounds());
    if (store.get('ui.minimizeToTray') && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const template = [
    { label: 'Файл', submenu: [
      { label: 'Импорт JSON', click: ()=> mainWindow.webContents.send('ui:importJSON') },
      { label: 'Экспорт', click: ()=> mainWindow.webContents.send('ui:export') },
      { type: 'separator' },
      { role: 'quit', label: 'Выход' }
    ]},
    { label: 'Правка', submenu: [ { role:'undo', label:'Отменить' }, { role:'redo', label:'Повторить' }, { type:'separator' }, { role:'copy', label:'Копировать' }, { role:'paste', label:'Вставить' }, { role:'selectAll', label:'Выделить всё' } ] },
    { label: 'Вид', submenu: [
      { label: 'Светлая тема', type: 'radio', checked: store.get('ui.theme')==='light', click: ()=> setTheme('light') },
      { label: 'Тёмная тема',  type: 'radio', checked: store.get('ui.theme')==='dark',  click: ()=> setTheme('dark')  },
      { type:'separator' },
      { role:'reload', label:'Перезагрузить' },
      { role:'toggleDevTools', label:'Инструменты разработчика' }
    ]},
    { label: 'Настройки', submenu: [
      { 
        label: 'Сворачивать в трей', 
        type: 'checkbox', 
        checked: store.get('ui.minimizeToTray'),
        click: (item) => store.set('ui.minimizeToTray', item.checked)
      }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  globalShortcut.register('Control+K', () => mainWindow.webContents.send('ui:focusSearch'));
}

function setTheme(theme){
  store.set('ui.theme', theme);
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
  if (mainWindow) mainWindow.webContents.send('ui:theme', theme);
}

function backupData() {
  const dataPath = store.path;
  if (!fs.existsSync(dataPath)) return;
  const backupDir = path.join(path.dirname(dataPath), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `linkdock-data-backup-${timestamp}.json`);
  try {
    fs.copyFileSync(dataPath, backupPath);
  } catch (err) {
    console.error('Failed to create backup:', err);
  }
}

// --- ЛОГИКА ПРОВЕРКИ ССЫЛОК ---
async function checkLinkStatus(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      method: 'HEAD', // Используем HEAD-запрос для получения только заголовков
      timeout: 10000, // Таймаут 10 секунд
      maxRedirects: 5 // Максимум 5 редиректов
    };

    const req = protocol.request(url, options, (res) => {
      // 2xx, 3xx коды обычно означают, что ссылка "живая"
      if (res.statusCode >= 200 && res.statusCode < 400) {
        resolve('ok');
      } else if (res.statusCode >= 400 && res.statusCode < 500) {
        resolve('broken'); // 4xx ошибки - битая ссылка
      } else {
        resolve('unknown'); // Другие ошибки сервера
      }
      res.resume(); // Потребляем данные ответа, чтобы избежать утечек памяти
    });

    req.on('error', (err) => {
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ERR_INVALID_URL') {
        resolve('broken'); // DNS-ошибка, отказ в соединении, неверный URL
      } else if (err.code === 'ETIMEDOUT') {
        resolve('timeout'); // Таймаут
      } else {
        resolve('error'); // Другие сетевые ошибки
      }
    });

    req.on('timeout', () => {
      req.destroy();
      resolve('timeout');
    });

    req.end();
  });
}

// IPC-обработчик для запуска проверки всех ссылок
ipcMain.handle('links:checkAll', async (event) => {
  const bookmarks = store.get('bookmarks');
  const results = [];
  const chunkSize = 10; // Проверяем по 10 ссылок одновременно
  
  for (let i = 0; i < bookmarks.length; i += chunkSize) {
    const chunk = bookmarks.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (bookmark) => {
      const status = await checkLinkStatus(bookmark.url);
      bookmark.lastCheckStatus = status; // Добавляем новый статус к закладке
      bookmark.lastCheckDate = new Date().toISOString(); // Дата последней проверки
      results.push({ id: bookmark.id, status, url: bookmark.url });
      return bookmark;
    });
    // Ждем завершения текущей пачки перед началом следующей, чтобы избежать перегрузки
    await Promise.all(chunkPromises);
    // Отправляем промежуточный прогресс в рендерер (опционально)
    if (mainWindow) {
        mainWindow.webContents.send('links:checkProgress', { 
            processed: Math.min(i + chunkSize, bookmarks.length), 
            total: bookmarks.length 
        });
    }
  }

  store.set('bookmarks', bookmarks); // Сохраняем обновленные закладки
  return { ok: true, results };
});


// --- ELECTRON ЖИЗНЕННЫЙ ЦИКЛ ---
app.whenReady().then(() => {
  createTray();
  setTheme(store.get('ui.theme'));
  createMainWindow();
  autoUpdater.checkForUpdatesAndNotify();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { backupData(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- УТИЛИТЫ ---
function urlHash(url){ return Buffer.from(url).toString('base64').slice(0, 24); }

function createLinkWindow(url){
  const hash = urlHash(url);
  const winBounds = store.get(`windows.${hash}`) || { width: 1200, height: 800 };
  const partition = `persist:link-${hash}`;
  const win = new BrowserWindow({ ...winBounds, webPreferences: { partition, sandbox: false }, title: url });
  win.loadURL(url);
  win.on('close', () => store.set(`windows.${hash}` , win.getBounds()));
  return win;
}

// --- IPC ОБРАБОТЧИКИ ---
ipcMain.handle('store:getAll', () => store.store);
ipcMain.handle('store:save', (e, payload) => { store.set(payload.key, payload.value); return true; });
ipcMain.handle('ui:getTheme', () => store.get('ui.theme'));
ipcMain.handle('ui:setTheme', (e, theme) => { setTheme(theme); return true; });
ipcMain.handle('link:open', (e, url) => { try { createLinkWindow(url); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });

ipcMain.handle('dialog:showDeleteGroup', async (e, groupName) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Удаление группы',
    message: `Вы уверены, что хотите удалить группу "${groupName}"?`,
    detail: 'Выберите, что сделать с закладками внутри этой группы.',
    buttons: ['Отмена', 'Переместить закладки в "Общее"', 'Удалить группу и все закладки'],
    defaultId: 0,
    cancelId: 0
  });
  return response;
});

ipcMain.handle('file:importBookmarks', async (e, from) => {
  try {
    if (from === 'chrome' || from === 'edge'){
      const local = process.env.LOCALAPPDATA;
      const map = {
        chrome: path.join(local, 'Google/Chrome/User Data/Default/Bookmarks'),
        edge:   path.join(local, 'Microsoft/Edge/User Data/Default/Bookmarks')
      };
      const p = map[from];
      if (!fs.existsSync(p)) throw new Error('Файл закладок не найден');
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const list = [];
      function walk(node, groupPath=[]){
        if (!node) return;
        if (node.type === 'url') list.push({ title: node.name, url: node.url, groupPath: groupPath.join(' / ') || 'Импорт' });
        else if (node.children){ const gp = node.name ? [...groupPath, node.name] : groupPath; node.children.forEach(ch => walk(ch, gp)); }
      }
      ['bookmark_bar','other','synced'].forEach(k => walk(raw?.roots?.[k]));
      applyImportedList(list);
      return { ok: true, added: list.length };
    }
    if (from === 'firefox'){
      const ff = path.join(process.env.APPDATA, 'Mozilla/Firefox');
      const profilesIni = path.join(ff, 'profiles.ini');
      if (!fs.existsSync(profilesIni)) throw new Error('Firefox профиль не найден');
      const ini = fs.readFileSync(profilesIni, 'utf-8');
      const prof = /Path=(.*)/.exec(ini)?.[1];
      if (!prof) throw new Error('Не удалось определить профиль Firefox');
      const dbPath = path.join(ff, prof, 'places.sqlite');
      if (!fs.existsSync(dbPath)) throw new Error('places.sqlite не найден');
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(`SELECT b.title as title, p.url as url, f.title as folder FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk LEFT JOIN moz_bookmarks f ON f.id = b.parent WHERE b.type = 1 AND p.url LIKE 'http%'`).all();
      db.close();
      const list = rows.map(r => ({ title: r.title || r.url, url: r.url, groupPath: r.folder || 'Firefox' }));
      applyImportedList(list);
      return { ok: true, added: list.length };
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Выберите JSON с закладками', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled) return { ok: false, error: 'Отменено' };
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    if (!raw.bookmarks || !raw.groups) throw new Error('Неверный формат файла');
    store.set('groups', raw.groups);
    store.set('bookmarks', raw.bookmarks);
    return { ok: true, imported: raw.bookmarks.length };
  } catch (err){ return { ok: false, error: String(err) }; }
});

function applyImportedList(list){
  const groups = store.get('groups');
  const bookmarks = store.get('bookmarks');
  const ensureGroup = (name) => {
    let g = groups.find(x => x.name === name);
    if (!g){ g = { id: `g_${Date.now()}_${Math.random().toString(16).slice(2)}`, name, order: groups.length }; groups.push(g); }
    return g.id;
  };
  const existingUrls = new Set(bookmarks.map(b => b.url));
  list.forEach(b => {
    if (b.url && !existingUrls.has(b.url)) {
      const gid = ensureGroup(b.groupPath);
      bookmarks.push({ id: `b_${Date.now()}_${Math.random().toString(16).slice(2)}`, title: b.title, url: b.url, groupId: gid, tags: [], pinned: false });
      existingUrls.add(b.url);
    }
  });
  store.set('groups', groups);
  store.set('bookmarks', bookmarks);
}

ipcMain.handle('file:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Сохранить экспорт', filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: 'linkdock-export.json' });
  if (canceled) return { ok: false, error: 'Отменено' };
  fs.writeFileSync(filePath, JSON.stringify({ groups: store.get('groups'), bookmarks: store.get('bookmarks') }, null, 2), 'utf-8');
  shell.showItemInFolder(filePath);
  return { ok: true, path: filePath };
});

autoUpdater.on('update-downloaded', () => { if (mainWindow) mainWindow.webContents.send('ui:updateReady'); });
