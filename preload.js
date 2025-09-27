const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkdock', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  save: (key, value) => ipcRenderer.invoke('store:save', { key, value }),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  importBookmarks: (from) => ipcRenderer.invoke('file:importBookmarks', from),
  exportData: () => ipcRenderer.invoke('file:export'),
  getTheme: () => ipcRenderer.invoke('ui:getTheme'),
  setTheme: (t) => ipcRenderer.invoke('ui:setTheme', t),
  on: (ch, cb) => ipcRenderer.on(ch, (_e, ...args) => cb(...args))
});
