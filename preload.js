const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveOffer: (data, suggestedName) => ipcRenderer.invoke('offer:save', { data, suggestedName }),
  loadOffer: () => ipcRenderer.invoke('offer:load'),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('offer:export-pdf', { html, suggestedName }),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
  writeClipboard: (html, text) => ipcRenderer.invoke('clipboard:write', { html, text }),
  aresLookup: (query) => ipcRenderer.invoke('ares:lookup', query),
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:action', (_event, action) => callback(action));
  },
});
