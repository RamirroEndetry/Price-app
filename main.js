const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { createLookup } = require('./ares');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#09090b',
    title: 'Generátor cenových nabídek',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(buildMenu());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(action) {
  if (mainWindow) mainWindow.webContents.send('menu:action', action);
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Nabídka',
      submenu: [
        { label: 'Nová', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Otevřít…', accelerator: 'CmdOrCtrl+O', click: () => send('load') },
        { label: 'Uložit…', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { type: 'separator' },
        { label: 'Zkopírovat pro e-mail', accelerator: 'CmdOrCtrl+Return', click: () => send('copy') },
        { label: 'Exportovat do PDF…', accelerator: 'CmdOrCtrl+P', click: () => send('pdf') },
        { type: 'separator' },
        { label: 'Přidat položku', accelerator: 'CmdOrCtrl+Shift+Return', click: () => send('add-row') },
        { type: 'separator' },
        { role: 'quit', label: 'Ukončit' },
      ],
    },
    {
      label: 'Úpravy',
      submenu: [
        { role: 'undo', label: 'Zpět' },
        { role: 'redo', label: 'Vpřed' },
        { type: 'separator' },
        { role: 'cut', label: 'Vyjmout' },
        { role: 'copy', label: 'Kopírovat' },
        { role: 'paste', label: 'Vložit' },
        { role: 'selectAll', label: 'Vybrat vše' },
      ],
    },
    {
      label: 'Zobrazení',
      submenu: [
        { role: 'resetZoom', label: 'Původní velikost' },
        { role: 'zoomIn', label: 'Přiblížit' },
        { role: 'zoomOut', label: 'Oddálit' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Celá obrazovka' },
        { role: 'toggleDevTools', label: 'Vývojářské nástroje' },
      ],
    },
  ]);
}

/* ------------------------------------------------------------------ */
/*  IPC: uložení / načtení nabídky                                     */
/* ------------------------------------------------------------------ */

function safeFileName(name) {
  return (name || 'nabidka').replace(/[\\/:*?"<>|]/g, '-').trim() || 'nabidka';
}

/* ------------------------------------------------------------------ */
/*  Nativní dialogy                                                    */
/*  Dialog je modální — po dobu, co je otevřený, je hlavní okno na     */
/*  úrovni Windows zakázané (IsWindowEnabled = false). Když se stihne  */
/*  otevřít druhý dialog, zůstane okno zablokované i po zavření toho   */
/*  prvního a aplikace vypadá, že tlačítka nedělají nic. Proto         */
/*  pouštíme vždy jen jeden dialog a před otevřením okno vytáhneme     */
/*  dopředu, aby se dialog neschoval za jiná okna.                     */
/* ------------------------------------------------------------------ */

let dialogOpen = false;

function liveWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

async function withDialog(run) {
  const parent = liveWindow();

  if (dialogOpen) {
    // Už jeden dialog běží — jen ho vytáhneme dopředu, další neotevíráme.
    if (parent) parent.focus();
    return { ok: false, canceled: true };
  }

  dialogOpen = true;
  try {
    if (parent) {
      if (parent.isMinimized()) parent.restore();
      parent.focus();
    }
    return await run(parent);
  } finally {
    dialogOpen = false;
  }
}

/** dialog.showSaveDialog / showOpenDialog neberou null jako rodiče. */
function showSave(parent, options) {
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
}

function showOpen(parent, options) {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

ipcMain.handle('offer:save', (_event, { data, suggestedName }) =>
  withDialog(async (parent) => {
    const { canceled, filePath } = await showSave(parent, {
      title: 'Uložit nabídku',
      defaultPath: `${safeFileName(suggestedName)}.nabidka.json`,
      filters: [{ name: 'Nabídka', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, filePath };
  })
);

ipcMain.handle('offer:load', () =>
  withDialog(async (parent) => {
    const { canceled, filePaths } = await showOpen(parent, {
      title: 'Otevřít nabídku',
      properties: ['openFile'],
      filters: [{ name: 'Nabídka', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    try {
      const raw = await fs.readFile(filePaths[0], 'utf8');
      return { ok: true, data: JSON.parse(raw), filePath: filePaths[0] };
    } catch (err) {
      return { ok: false, error: 'Soubor se nepodařilo načíst nebo není platná nabídka.' };
    }
  })
);

/* ------------------------------------------------------------------ */
/*  IPC: export do PDF                                                 */
/*  Renderuje se čistý HTML dokument (stejný jako pro e-mail),         */
/*  ne tmavé UI aplikace.                                              */
/* ------------------------------------------------------------------ */

ipcMain.handle('offer:export-pdf', (_event, { html, suggestedName }) =>
  withDialog(async (parent) => {
    const { canceled, filePath } = await showSave(parent, {
      title: 'Exportovat do PDF',
      defaultPath: `${safeFileName(suggestedName)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const tmpFile = path.join(app.getPath('temp'), `nabidka-${Date.now()}.html`);
    let pdfWin = null;

    try {
      await fs.writeFile(tmpFile, html, 'utf8');

      pdfWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: false,
        },
      });

      await pdfWin.loadFile(tmpFile);

      const buffer = await pdfWin.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5 },
        // Prázdná hlavička — bez ní by Chromium doplnil vlastní (název + datum).
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#888;' +
          'padding:0 0.5in;text-align:right;">' +
          'Strana <span class="pageNumber"></span> z <span class="totalPages"></span></div>',
      });

      await fs.writeFile(filePath, buffer);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    } finally {
      if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
      fs.unlink(tmpFile).catch(() => {});
    }
  })
);

ipcMain.handle('shell:show-item', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

/* ------------------------------------------------------------------ */
/*  IPC: zápis do schránky                                             */
/*  Nativní cesta je spolehlivější než navigator.clipboard, která      */
/*  vyžaduje aktivní fokus dokumentu.                                  */
/* ------------------------------------------------------------------ */

ipcMain.handle('clipboard:write', (_event, { html, text }) => {
  try {
    clipboard.write({ html, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/* ------------------------------------------------------------------ */
/*  IPC: vyhledání klienta v ARES                                      */
/*  Okno má síť záměrně vypnutou, proto se rejstříku ptá hlavní        */
/*  proces. Logika dotazu je ve sdíleném ares.js (používá ho i webová  */
/*  verze); net.fetch jde přes Chromium, takže respektuje systémový    */
/*  proxy.                                                             */
/* ------------------------------------------------------------------ */

const aresLookup = createLookup((url, init) => net.fetch(url, init));

ipcMain.handle('ares:lookup', (_event, query) => aresLookup(query));

/* ------------------------------------------------------------------ */
/*  Zabezpečení: žádná externí navigace, žádná nová okna               */
/* ------------------------------------------------------------------ */

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
