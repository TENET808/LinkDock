const { app, BrowserWindow, ipcMain, dialog, shell, Menu, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store({
  name: 'linkdock-data',
  defaults: {
    ui: { bounds: { width: 1100, height: 700 }, theme: 'light' },
    groups: [ { id: 'default', name: 'Общее', order: 0 } ],
    bookmarks: [],
    windows: {}
  }
});

let mainWindow;

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
    title: 'LinkDock'
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', () => {
    store.set('ui.bounds', mainWindow.getBounds());
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
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `linkdock-data-backup-${timestamp}.json`);
  
  try {
    fs.copyFileSync(dataPath, backupPath);
    console.log(`Backup created at: ${backupPath}`);
  } catch (err) {
    console.error('Failed to create backup:', err);
  }
}

app.whenReady().then(() => {
  setTheme(store.get('ui.theme'));
  createMainWindow();
  // автообновления — для установочной версии
  autoUpdater.checkForUpdatesAndNotify();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  backupData();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function urlHash(url){ return Buffer.from(url).toString('base64').slice(0, 24); }

function createLinkWindow(url){
  const hash = urlHash(url);
  const winBounds = store.get(`windows.${hash}`) || { width: 1200, height: 800 };
  const partition = `persist:link-${hash}`;

  const win = new BrowserWindow({
    ...winBounds,
    webPreferences: { partition, sandbox: false },
    title: url
  });
  win.loadURL(url);
  win.on('close', () => store.set(`windows.${hash}` , win.getBounds()));
  return win;
}

ipcMain.handle('store:getAll', () => store.store);
ipcMain.handle('store:save', (e, payload) => { store.set(payload.key, payload.value); return true; });
ipcMain.handle('ui:getTheme', () => store.get('ui.theme'));
ipcMain.handle('ui:setTheme', (e, theme) => { setTheme(theme); return true; });

ipcMain.handle('link:open', (e, url) => { try { createLinkWindow(url); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });

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
      const rows = db.prepare(`
        SELECT b.title as title, p.url as url, f.title as folder
        FROM moz_bookmarks b
        JOIN moz_places p ON p.id = b.fk
        LEFT JOIN moz_bookmarks f ON f.id = b.parent
        WHERE b.type = 1 AND p.url LIKE 'http%'
      `).all();
      db.close();
      const list = rows.map(r => ({ title: r.title || r.url, url: r.url, groupPath: r.folder || 'Firefox' }));
      applyImportedList(list);
      return { ok: true, added: list.length };
    }

    // JSON
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Выберите JSON с закладками',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
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
  list.forEach(b => {
    const gid = ensureGroup(b.groupPath);
    bookmarks.push({ id: `b_${Date.now()}_${Math.random().toString(16).slice(2)}`, title: b.title, url: b.url, groupId: gid, tags: [], pinned: false });
  });
  store.set('groups', groups);
  store.set('bookmarks', bookmarks);
}

ipcMain.handle('file:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Сохранить экспорт',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    defaultPath: 'linkdock-export.json'
  });
  if (canceled) return { ok: false, error: 'Отменено' };
  fs.writeFileSync(filePath, JSON.stringify({ groups: store.get('groups'), bookmarks: store.get('bookmarks') }, null, 2), 'utf-8');
  shell.showItemInFolder(filePath);
  return { ok: true, path: filePath };
});

autoUpdater.on('update-downloaded', () => { if (mainWindow) mainWindow.webContents.send('ui:updateReady'); });
