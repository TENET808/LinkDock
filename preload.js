const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkdock', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  save: (key, value) => ipcRenderer.invoke('store:save', { key, value }),
  getTheme: () => ipcRenderer.invoke('ui:getTheme'),
  setTheme: (theme) => ipcRenderer.invoke('ui:setTheme', theme),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  exportData: () => ipcRenderer.invoke('file:export'),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  // --- НОВЫЕ ФУНКЦИИ ДЛЯ ПРОВЕРКИ ССЫЛОК ---
  checkAllLinks: () => ipcRenderer.invoke('links:checkAll'), // Запустить проверку всех ссылок
  onLinkCheckProgress: (callback) => ipcRenderer.on('links:checkProgress', (event, ...args) => callback(...args)), // Получать прогресс проверки
  onStartLinkCheck: (callback) => ipcRenderer.on('links:startCheck', (event, ...args) => callback(...args)) // Для запуска из меню main-процесса
});
