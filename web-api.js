/*
 * Webová náhrada za window.api z preload.js.
 *
 * V Electronu vystaví window.api preload přes contextBridge ještě před
 * načtením stránky, takže tenhle soubor nic nedělá. V prohlížeči
 * (GitHub Pages) window.api chybí, a tak ho doplníme z toho, co
 * prohlížeč umí: dialog na uložení/otevření souboru (nebo stažení),
 * tisk do PDF, přímý dotaz na ARES a klávesové zkratky místo menu.
 * Schránka se tu neřeší — renderer má pro ni vlastní záložní cestu
 * přes navigator.clipboard.
 */
(function () {
  if (window.api) return;

  const OFFER_TYPES = [{ description: 'Nabídka', accept: { 'application/json': ['.json'] } }];

  function safeFileName(name) {
    return (name || 'nabidka').replace(/[\\/:*?"<>|]/g, '-').trim() || 'nabidka';
  }

  function isAbort(err) {
    return err && err.name === 'AbortError';
  }

  /** Stažení souboru přes dočasný odkaz — funguje všude. */
  function download(fileName, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Výběr souboru přes skrytý <input type="file"> (Firefox, Safari). */
  function pickFileViaInput() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(input.files && input.files[0] ? input.files[0] : null);
        input.remove();
      });
      input.addEventListener('cancel', () => {
        resolve(null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function saveOffer(data, suggestedName) {
    const fileName = `${safeFileName(suggestedName)}.nabidka.json`;
    const json = JSON.stringify(data, null, 2);

    // Chrome/Edge: skutečný dialog „Uložit jako“.
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: OFFER_TYPES });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        return { ok: true, filePath: handle.name };
      } catch (err) {
        if (isAbort(err)) return { ok: false, canceled: true };
        console.warn('Dialog uložení selhal, soubor se stáhne:', err);
      }
    }

    download(fileName, json, 'application/json');
    return { ok: true, filePath: fileName };
  }

  async function loadOffer() {
    let file = null;

    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: OFFER_TYPES, multiple: false });
        file = await handle.getFile();
      } catch (err) {
        if (isAbort(err)) return { ok: false, canceled: true };
        console.warn('Dialog otevření selhal, zkouším <input type="file">:', err);
      }
    }

    if (!file) file = await pickFileViaInput();
    if (!file) return { ok: false, canceled: true };

    try {
      return { ok: true, data: JSON.parse(await file.text()), filePath: file.name };
    } catch (err) {
      return { ok: false, error: 'Soubor se nepodařilo načíst nebo není platná nabídka.' };
    }
  }

  /**
   * PDF v prohlížeči = tisk: nabídka se otevře v nové záložce a hned se
   * nabídne tisk, kde uživatel zvolí „Uložit jako PDF“. Vrací canceled,
   * aby appka nehlásila „PDF uloženo“ — soubor vzniká až v tiskovém dialogu.
   */
  async function exportPdf(html, suggestedName) {
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      return { ok: false, error: 'Prohlížeč zablokoval nové okno. Povol vyskakovací okna pro tuto stránku.' };
    }
    const title = `${safeFileName(suggestedName)}.pdf`;
    win.addEventListener('load', () => {
      try {
        win.document.title = title;
        win.focus();
        win.print();
      } catch (err) {
        console.warn('Tisk se nepodařilo spustit automaticky:', err);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
    return { ok: false, canceled: true };
  }

  const aresLookup = window.AresClient
    ? window.AresClient.createLookup((url, init) => window.fetch(url, init))
    : async () => ({ ok: false, error: 'Vyhledávání v ARES není k dispozici (chybí ares.js).' });

  /** Klávesové zkratky — stejné jako v menu Electronu. */
  function onMenuAction(callback) {
    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      let action = null;
      if (key === 'n') action = 'new';
      else if (key === 'o') action = 'load';
      else if (key === 's') action = 'save';
      else if (key === 'p') action = 'pdf';
      else if (key === 'enter') action = event.shiftKey ? 'add-row' : 'copy';
      if (!action) return;
      event.preventDefault();
      callback(action);
    });
  }

  window.api = {
    saveOffer,
    loadOffer,
    exportPdf,
    showItemInFolder: async () => {},
    aresLookup,
    onMenuAction,
    isWeb: true,
  };
})();
