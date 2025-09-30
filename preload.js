const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('linkdock', {
  // Store methods
  getAll: () => ipcRenderer.invoke('store:getAll'),
  save: (key, value) => ipcRenderer.invoke('store:save', { key, value }),

  // UI methods
  getTheme: () => ipcRenderer.invoke('ui:getTheme'),
  setTheme: (theme) => ipcRenderer.invoke('ui:setTheme', theme),
  on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),

  // Link actions
  openLink: (url) => shell.openExternal(url),
  openInAppBrowser: (url) => ipcRenderer.invoke('link:open', url),
  checkAllLinks: () => ipcRenderer.invoke('links:checkAll'), // НОВОЕ: Для запуска проверки ссылок
  onLinkCheckProgress: (callback) => ipcRenderer.on('links:checkProgress', (event, ...args) => callback(...args)), // НОВОЕ: Для получения прогресса

  // Dialogs
  showDeleteGroupDialog: (groupName) => ipcRenderer.invoke('dialog:showDeleteGroup', groupName),

  // File operations
  importBookmarks: (from) => ipcRenderer.invoke('file:importBookmarks', from),
  exportData: () => ipcRenderer.invoke('file:export')
});
