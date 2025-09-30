const { app, BrowserWindow, ipcMain, dialog, shell, Menu, globalShortcut, nativeTheme, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

// --- ХРАНИЛИЩЕ ---
const store = new Store({
  name: 'linkdock-data',
  defaults: {
    ui: { 
      bounds: { width: 1100, height: 700 }, 
      theme: 'light',
      minimizeToTray: false // Настройка для трея
    },
    groups: [ { id: 'default', name: 'Общее', order: 0 } ],
    bookmarks: [],
    windows: {}
  }
});

let mainWindow;
let tray = null; // Переменная для хранения иконки в трее

// --- ФУНКЦИЯ СОЗДАНИЯ ТРЕЯ ---
function createTray() {
  const iconPath = path.join(__dirname, 'build/icon.png');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Развернуть', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Выход', click: () => { 
        app.isQuitting = true; // Устанавливаем флаг, что выход инициирован пользователем
        app.quit(); 
      } 
    }
  ]);
  tray.setToolTip('LinkDock');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    // По клику показываем окно, если оно было скрыто
    if (mainWindow) {
      mainWindow.show();
    }
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

  // ОБНОВЛЕННЫЙ ОБРАБОТЧИК ЗАКРЫТИЯ ОКНА
  mainWindow.on('close', (event) => {
    store.set('ui.bounds', mainWindow.getBounds());
    // Если опция включена и выход не из меню трея
    if (store.get('ui.minimizeToTray') && !app.isQuitting) {
      event.preventDefault(); // Отменяем стандартное закрытие
      mainWindow.hide();      // Просто скрываем окно
    }
    // Если опция выключена или выход из меню, окно закроется штатно
  });

  // ОБНОВЛЕННЫЙ ШАБЛОН МЕНЮ
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


// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (без изменений) ---
function setTheme(theme){ /* ... */ }
function backupData() { /* ... */ }
function urlHash(url){ /* ... */ }
function createLinkWindow(url){ /* ... */ }

// --- СОБЫТИЯ ЖИЗНЕННОГО ЦИКЛА ПРИЛОЖЕНИЯ ---
app.whenReady().then(() => {
  createTray();
  setTheme(store.get('ui.theme'));
  createMainWindow();
  autoUpdater.checkForUpdatesAndNotify();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  // Устанавливаем флаг, чтобы обработчик 'close' знал, что нужно закрыть приложение
  app.isQuitting = true;
});

app.on('will-quit', () => {
  backupData();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => { 
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


// --- ОБРАБОТЧИКИ IPC ---
ipcMain.handle('store:getAll', () => store.store);
ipcMain.handle('store:save', (e, payload) => { store.set(payload.key, payload.value); return true; });
ipcMain.handle('ui:getTheme', () => store.get('ui.theme'));
ipcMain.handle('ui:setTheme', (e, theme) => { setTheme(theme); return true; });
ipcMain.handle('link:open', (e, url) => { try { createLinkWindow(url); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });

// НОВЫЙ ОБРАБОТЧИК ДЛЯ ДИАЛОГА УДАЛЕНИЯ
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
  return response; // 0: Отмена, 1: Переместить, 2: Удалить всё
});

ipcMain.handle('file:importBookmarks', async (e, from) => {
  // ... (весь код импорта из Chrome/Edge/Firefox/JSON без изменений)
});


// ОБНОВЛЕННАЯ ФУНКЦИЯ ИМПОРТА С ДЕДУПЛИКАЦИЕЙ
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

ipcMain.handle('file:export', async () => { /* ... */ });
autoUpdater.on('update-downloaded', () => { if (mainWindow) mainWindow.webContents.send('ui:updateReady'); });
