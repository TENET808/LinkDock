const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkdock', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  save: (key, value) => ipcRenderer.invoke('store:save', { key, value }),
  getTheme: () => ipcRenderer.invoke('ui:getTheme'),
  setTheme: (theme) => ipcRenderer.invoke('ui:setTheme', theme),
  
  // ИСПРАВЛЕНО: Теперь соответствует вызову openExternalLink в вашем renderer.js
  openExternalLink: (url) => ipcRenderer.invoke('link:open', url), 

  exportData: () => ipcRenderer.invoke('file:export'),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  
  // ВЕРНУТО: Ваш IPC-вызов для модального окна удаления группы
  showDeleteGroupDialog: (groupName) => ipcRenderer.invoke('dialog:showDeleteGroup', groupName),
  
  // ВЕРНУТО: Ваш IPC-вызов для импорта закладок
  importBookmarks: (kind) => ipcRenderer.invoke('file:importBookmarks', kind),

  // НОВЫЕ ФУНКЦИИ ДЛЯ ПРОВЕРКИ ССЫЛОК (оставляем, как обсуждали)
  checkAllLinks: () => ipcRenderer.invoke('links:checkAll'),
  onLinkCheckProgress: (callback) => ipcRenderer.on('links:checkProgress', (event, ...args) => callback(...args)),
  onStartLinkCheck: (callback) => ipcRenderer.on('links:startCheck', (event, ...args) => callback(...args))
});
