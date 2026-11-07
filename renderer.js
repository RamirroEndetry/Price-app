'use strict';

/* ================================================================== */
/*  Stav aplikace                                                      */
/* ================================================================== */

const STORAGE_KEY = 'priceTable.autosave.v2';
const SCHEMA_VERSION = 3;

/** Čítač čísel nabídek. Žije mimo autosave, aby přežil i „Novou nabídku“. */
const OFFER_NUMBER_KEY = 'priceTable.lastOfferNumber';

/** O kolik dní za datem vystavení končí platnost nabídky. */
const VALIDITY_DAYS = 14;

/**
 * Výchozí závěrečný text e-mailu. Předvyplní se u každé nové nabídky,
 * v panelu „Údaje nabídky“ se dá pro konkrétní nabídku upravit nebo smazat.
 */
const DEFAULT_CLOSING_TEXT =
  'Pokud bude nabídka pro Vás v pořádku, poprosím Vás jen o potvrzení a vše obratem zadám do našeho systému.\n\n' +
  'Děkuji za Vaši odpověď a přeji příjemný den.';

const state = {
  mode: 'rental',
  currency: 'CZK',
  eurRate: 25,
  vatRate: 21,
  showVat: true,
  durationUnit: 'den', // 'den' | 'mesic'
  discountMode: 'amount', // celková sleva dole: 'amount' (Kč/€) | 'pct' (%)
};

/** Sleva na řádku i celková se zadává buď v procentech, nebo v částce. */
function normalizeDiscountMode(value) {
  return value === 'pct' ? 'pct' : 'amount';
}

/**
 * Spočítá slevu ze základu podle režimu.
 * Procenta se ořezávají na 0–100, částka nikdy nepřesáhne základ.
 */
function discountAmountFrom(base, mode, value) {
  if (mode === 'pct') return round2(base * (clamp(value, 0, 100) / 100));
  return round2(Math.min(base, Math.max(0, value)));
}

/* ================================================================== */
/*  Výchozí data jednotlivých režimů                                   */
/*  days: '' = položka se nenásobí dobou                               */
/*  noOldPrice: true = u služeb (instalace, doprava, kauce…) nemá      */
/*  „původní cena“ smysl, tlačítko se nenabízí. Nové řádky ho mají.    */
/* ================================================================== */

const DEFAULTS = {
  rental: [
    { item: 'Pronájem panelu', qty: 1, days: 1, price: 0, oldPrice: 0 },
    { item: 'Instalace a montáž', qty: 1, days: '', price: 0, noOldPrice: true },
    { item: 'Doprava', qty: 1, days: '', price: 0, noOldPrice: true },
    { item: 'Kauce', qty: 1, days: '', price: 0, noOldPrice: true },
  ],
  sale: [
    { item: 'Prodej panelu', qty: 1, days: '', price: 0, oldPrice: 0 },
    { item: 'Příslušenství', qty: 1, days: '', price: 0, noOldPrice: true },
    { item: 'Montáž a zprovoznění', qty: 1, days: '', price: 0, noOldPrice: true },
    { item: 'Doprava', qty: 1, days: '', price: 0, noOldPrice: true },
  ],
  barter: [
    { kind: 'section', title: 'Pronájem techniky', key: 'equipment' },
    { item: '2x Ledview Outdoor', qty: 1, days: 1, price: 0 },
    { item: '4x Ledview Indoor', qty: 1, days: 1, price: 0 },
    { item: '5x Totem Extra touch 43"', qty: 1, days: 1, price: 0 },
    { item: '3x Totem Extra touch 55"', qty: 1, days: 1, price: 0 },
    { item: '6x iNavi 43"', qty: 1, days: 1, price: 0 },
    { kind: 'subtotal' },
    { kind: 'section', title: 'Doplňkové služby', key: 'services' },
    { item: 'Doprava a logistika (přívoz + odvoz nakládka)', qty: 1, days: 1, price: 4000 },
    { item: 'Montáž všech zařízení (20 ks)', qty: 1, days: 1, price: 44000 },
    { item: 'Demontáž a balení po akci', qty: 1, days: 1, price: 24000 },
    { item: 'Technik / operátor na místě (celý den)', qty: 1, days: 1, price: 18000 },
    { item: 'Konfigurace obsahu a technická příprava', qty: 1, days: 1, price: 17000 },
    { item: 'Příslušenství: kabely stojany napájení fixace', qty: 1, days: 1, price: 10000 },
    { kind: 'subtotal' },
  ],
};

/**
 * Starší nabídky a dnešní autosave příznak noOldPrice nemají – servisní
 * položky z výchozích dat poznáme podle názvu, aby se jim tlačítko taky nenabízelo.
 */
const NO_OLD_PRICE_ITEMS = new Set(
  Object.values(DEFAULTS).flat().filter((row) => row.noOldPrice).map((row) => row.item)
);

/* ================================================================== */
/*  DOM reference                                                      */
/* ================================================================== */

const el = {
  tableBody: document.getElementById('tableBody'),
  addRowBtn: document.getElementById('addRowBtn'),
  subtotal: document.getElementById('subtotal'),
  totalWithVat: document.getElementById('totalWithVat'),
  vatRow: document.getElementById('vatRow'),
  vatRowLabel: document.getElementById('vatRowLabel'),
  subtotalRow: document.getElementById('subtotalRow'),
  discountInput: document.getElementById('discountInput'),
  discountModeToggle: document.getElementById('discountModeToggle'),
  vatToggle: document.getElementById('vatToggle'),
  vatRateSelect: document.getElementById('vatRateSelect'),
  eurRateInput: document.getElementById('eurRateInput'),
  toast: document.getElementById('toast'),
  copyBtn: document.getElementById('copyBtn'),
  pdfBtn: document.getElementById('pdfBtn'),
  saveBtn: document.getElementById('saveBtn'),
  loadBtn: document.getElementById('loadBtn'),
  newBtn: document.getElementById('newBtn'),
  aresBtn: document.getElementById('aresBtn'),
  aresResults: document.getElementById('aresResults'),
  clientHint: document.getElementById('clientHint'),
  globalUnitToggle: document.getElementById('globalUnitToggle'),
  globalUnitLabel: document.getElementById('globalUnitLabel'),
  daysHeader: document.querySelector('.days-col-header'),
  meta: {
    client: document.getElementById('metaClient'),
    number: document.getElementById('metaNumber'),
    date: document.getElementById('metaDate'),
    validUntil: document.getElementById('metaValidUntil'),
    note: document.getElementById('metaNote'),
    address: document.getElementById('metaAddress'),
    installDate: document.getElementById('metaInstallDate'),
    removalDate: document.getElementById('metaRemovalDate'),
    eventDays: document.getElementById('metaEventDays'),
    graphics: document.getElementById('metaGraphics'),
    closing: document.getElementById('metaClosing'),
  },
  metaToggle: document.getElementById('metaToggle'),
  dockTotal: document.getElementById('dockTotal'),
  dockTotalLabel: document.getElementById('dockTotalLabel'),
  metaGrid: document.getElementById('metaGrid'),
};

/* ================================================================== */
/*  Pomocné funkce                                                     */
/* ================================================================== */

function currencySymbol() {
  return state.currency === 'EUR' ? '€' : 'Kč';
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatPrice(amount) {
  const value = round2(amount || 0);
  const hasDecimals = Math.abs(value % 1) > 0.0001;
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value) + ' ' + currencySymbol();
}

function formatNumber(n) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(n);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Skloňování dnů / měsíců včetně desetinných hodnot. */
function formatDuration(n, unit = state.durationUnit) {
  const isDay = unit === 'den';
  const num = formatNumber(n);

  if (!Number.isInteger(n)) return `${num} ${isDay ? 'dne' : 'měsíce'}`;
  if (n === 1) return `1 ${isDay ? 'den' : 'měsíc'}`;
  if (n >= 2 && n <= 4) return `${num} ${isDay ? 'dny' : 'měsíce'}`;
  return `${num} ${isDay ? 'dní' : 'měsíců'}`;
}

function durationColumnLabel() {
  return state.durationUnit === 'den' ? 'Dny' : 'Měsíce';
}

/**
 * „13. 10. – 14. 10. 2026“ — u stejného roku se rok tiskne jen jednou.
 * Když je vyplněné jen jedno datum, vrátí jen to.
 */
function formatEventDates(installIso, removalIso) {
  if (installIso && removalIso) {
    const sameYear = installIso.slice(0, 4) === removalIso.slice(0, 4);
    const first = sameYear ? formatDate(installIso).replace(/ \d{4}$/, '') : formatDate(installIso);
    return `${first} – ${formatDate(removalIso)}`;
  }
  return formatDate(installIso || removalIso);
}

/** „320x960“, „320 X 960px“ → „320 × 960 px“; jiný zápis se nechá, jak je. */
function formatResolution(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/^(\d+)\s*[x×X*]\s*(\d+)\s*(px)?\.?$/i);
  return m ? `${m[1]} × ${m[2]} px` : raw;
}

/**
 * Řádky o místě a termínu akce, které jdou nad hlavičku nabídky
 * (společné pro HTML i prostý text). Prázdná pole se vynechají.
 */
function eventInfoLines(meta) {
  const lines = [];
  if (meta.address) lines.push({ label: 'Adresa', value: meta.address });

  if (meta.eventDays > 0) lines.push({ label: 'Počet dní', value: formatDuration(meta.eventDays, 'den') });

  const dates = formatEventDates(meta.installDate, meta.removalDate);
  if (dates) {
    const label =
      meta.installDate && meta.removalDate ? 'Instalace/Deinstalace' : meta.installDate ? 'Instalace' : 'Deinstalace';
    lines.push({ label, value: dates });
  }
  return lines;
}

/** Věta o rozlišení grafiky, nebo '' když rozlišení není vyplněné. */
function graphicsSentence(meta, { html }) {
  const resolution = formatResolution(meta.graphics);
  if (!resolution) return '';
  const value = html ? `<strong>${escapeHtml(resolution)}</strong>` : resolution;
  return `Co se týče přípravy grafiky pro tento panel, tak je potřeba, aby grafika byla v rozlišení ${value}.`;
}

/** Víceřádkový text → odstavce <p>; prázdný řádek odděluje odstavce. */
function textToHtmlParagraphs(text, style) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Escapuje text před vložením do HTML (e-mail, PDF). */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function numberOrZero(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/* ================================================================== */
/*  Hlavička nabídky: datum, platnost, číslo                           */
/* ================================================================== */

/** ISO datum (YYYY-MM-DD) v místním čase — toISOString() by v noci ujel o den. */
function toIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

/** Poledne jako základ, aby přechod na letní/zimní čas neposunul den. */
function addDaysIso(iso, days) {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Platnost se drží data vystavení, dokud si ji uživatel nepřepíše ručně. */
let validityLockedByUser = false;

/** Počet dní se dopočítává z termínu instalace/deinstalace, dokud ho uživatel nepřepíše. */
let eventDaysLockedByUser = false;

function daysBetweenIso(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = new Date(`${fromIso}T12:00:00`);
  const to = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function syncEventDays() {
  if (eventDaysLockedByUser) return;
  const diff = daysBetweenIso(el.meta.installDate.value, el.meta.removalDate.value);
  if (diff === null || diff < 0) return;
  // Instalace a deinstalace v týž den = 1 den akce.
  el.meta.eventDays.value = Math.max(1, diff);
}

function syncValidUntil() {
  if (validityLockedByUser) return;
  el.meta.validUntil.value = addDaysIso(el.meta.date.value, VALIDITY_DAYS);
}

/** Na kolik míst se doplňuje pořadí: 2026-004. */
const OFFER_NUMBER_DIGITS = 3;

function formatOfferNumber(year, seq) {
  return `${year}-${String(seq).padStart(OFFER_NUMBER_DIGITS, '0')}`;
}

/** Rozebere „2026-004“ na ročník a pořadí. */
function parseOfferNumber(value) {
  const text = String(value ?? '').trim();

  const withYear = /^(\d{4})-(\d+)$/.exec(text);
  if (withYear) return { year: Number(withYear[1]), seq: Number(withYear[2]) };

  // Holé pořadí (1, 2, 3…) bereme jako letošní řadu — jednak kvůli
  // dřívějšímu čítači, jednak když se číslo přepíše ručně nakrátko.
  const plain = /^(\d+)$/.exec(text);
  if (plain) return { year: new Date().getFullYear(), seq: Number(plain[1]) };

  return null;
}

/** Další číslo v řadě. Pořadí se drží ročníku — 1. ledna se začíná od 001. */
function nextOfferNumber() {
  const year = new Date().getFullYear();
  const last = parseOfferNumber(localStorage.getItem(OFFER_NUMBER_KEY));
  const seq = last && last.year === year ? last.seq + 1 : 1;
  return formatOfferNumber(year, seq);
}

/**
 * Zapamatuje si číslo, od kterého se bude počítat dál. Voláme jen při
 * založení nové nabídky a při ručním přepsání pole — otevření staré
 * nabídky ze souboru řadu úmyslně nevrací zpátky.
 */
function rememberOfferNumber(value) {
  const parsed = parseOfferNumber(value);
  if (!parsed || parsed.seq <= 0) return;
  try {
    localStorage.setItem(OFFER_NUMBER_KEY, formatOfferNumber(parsed.year, parsed.seq));
  } catch (err) {
    console.warn('Číslo nabídky se nepodařilo uložit:', err);
  }
}

/** Rozbalí sbalenou hlavičku, aby bylo vidět pole, na které upozorňujeme. */
function openMetaPanel() {
  if (!el.metaGrid.classList.contains('collapsed')) return;
  el.metaGrid.classList.remove('collapsed');
  el.metaToggle.setAttribute('aria-expanded', 'true');
}

/* ================================================================== */
/*  Klient z rejstříku ARES                                            */
/*  Do pole Klient jde napsat IČO nebo část názvu; Enter nebo tlačítko */
/*  doplní oficiální název a pod pole vypíše IČO, DIČ a sídlo, aby šlo */
/*  na první pohled zkontrolovat, že jde o správnou firmu. Ruční       */
/*  přepsání názvu tyhle údaje zahodí — už by nemusely sedět.          */
/* ================================================================== */

// Původní obsah tlačítka (ikona + text) – po hledání se vrací přes innerHTML.
const ARES_BUTTON_LABEL = el.aresBtn.innerHTML;

let clientInfo = { ico: '', dic: '', address: '' };
let aresBusy = false;

function setClientInfo(info) {
  clientInfo = {
    ico: String((info && info.ico) || ''),
    dic: String((info && info.dic) || ''),
    address: String((info && info.address) || ''),
  };
  renderClientHint();
}

function renderClientHint() {
  const parts = [];
  if (clientInfo.ico) parts.push(`IČO ${clientInfo.ico}`);
  if (clientInfo.dic) parts.push(`DIČ ${clientInfo.dic}`);
  if (clientInfo.address) parts.push(clientInfo.address);
  el.clientHint.textContent = parts.join(' · ');
}

function hideAresResults() {
  el.aresResults.classList.add('hidden');
  el.aresResults.replaceChildren();
}

function applyAresSubject(subject) {
  el.meta.client.value = subject.name;
  setClientInfo(subject);
  hideAresResults();
  scheduleAutosave();
  showToast(`Klient doplněn z ARES: ${subject.name}`);
  el.meta.client.focus();
}

function showAresResults(results, total) {
  const items = results.map((subject) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'ares-result';
    option.setAttribute('role', 'option');

    const name = document.createElement('strong');
    name.textContent = subject.name;
    const detail = document.createElement('small');
    detail.textContent = [subject.ico ? `IČO ${subject.ico}` : '', subject.address].filter(Boolean).join(' · ');

    option.append(name, detail);
    option.addEventListener('click', () => applyAresSubject(subject));
    return option;
  });

  if (total > results.length) {
    const more = document.createElement('div');
    more.className = 'ares-more';
    more.textContent = `Zobrazeno ${results.length} z ${total} firem — upřesni název, nebo zadej IČO.`;
    items.push(more);
  }

  el.aresResults.replaceChildren(...items);
  el.aresResults.classList.remove('hidden');
}

async function lookupClientInAres() {
  if (aresBusy) return;
  if (!requireApi('Vyhledání v ARES')) return;

  const query = el.meta.client.value.trim();
  if (!query) {
    showToast('Napiš IČO nebo název firmy a pak vyhledej.');
    el.meta.client.focus();
    return;
  }

  aresBusy = true;
  el.aresBtn.disabled = true;
  el.aresBtn.textContent = 'Hledám…';
  hideAresResults();

  let result;
  try {
    result = await window.api.aresLookup(query);
  } catch (err) {
    result = { ok: false, error: `Vyhledání v ARES selhalo: ${describeError(err)}` };
  } finally {
    aresBusy = false;
    el.aresBtn.disabled = false;
    el.aresBtn.innerHTML = ARES_BUTTON_LABEL;
  }

  if (!result || !result.ok) {
    showToast((result && result.error) || 'Vyhledání v ARES selhalo.');
    return;
  }
  if (!result.results.length) {
    showToast(result.byIco ? `IČO ${result.query} v ARES není.` : `„${query}“ v ARES nenalezeno.`);
    return;
  }
  if (result.results.length === 1) {
    applyAresSubject(result.results[0]);
    return;
  }
  showAresResults(result.results, result.total);
}

/**
 * Nabídka nesmí ven bez klienta — hlavní pojistka proti tomu, aby
 * odešla na firmu z předchozí nabídky. Vrací název, nebo null.
 */
function requireClient(action) {
  const client = el.meta.client.value.trim();
  if (client) return client;

  openMetaPanel();
  el.meta.client.focus();
  window.alert(`${action}: nejdřív vyplň klienta, ať nabídka nejde na špatnou firmu.`);
  return null;
}

/* ================================================================== */
/*  Sestavení řádku                                                    */
/*  Pozor: žádná data uživatele se nevkládají do innerHTML —           */
/*  šablona je statická a hodnoty se nastavují přes .value             */
/* ================================================================== */

const ROW_TEMPLATE = `
  <td class="drag-col">
    <div class="drag-handle" title="Přetáhnout pro změnu pořadí" draggable="true">⠿</div>
  </td>
  <td>
    <input type="text" class="item-input" placeholder="Název položky…" aria-label="Název položky" draggable="false">
  </td>
  <td>
    <input type="number" class="qty-input" min="1" step="1" placeholder="1" aria-label="Počet kusů" draggable="false">
  </td>
  <td class="days-cell">
    <input type="number" class="days-input" min="0" step="1" placeholder="—" aria-label="Doba trvání" draggable="false">
  </td>
  <td>
    <div class="price-cell">
      <input type="number" class="price-input" min="0" step="0.01" placeholder="0" aria-label="Cena za kus bez DPH" draggable="false">
      <button type="button" class="old-price-toggle" tabindex="-1">+ původní cena</button>
      <div class="old-price-container" hidden><span>původní cena</span><input type="number" class="old-price-input" min="0" step="0.01" placeholder="0" aria-label="Původní cena za kus" draggable="false"><span class="cur-symbol">Kč</span><button type="button" class="old-price-remove" tabindex="-1" title="Odebrat původní cenu">×</button></div>
    </div>
  </td>
  <td class="discount-pct-cell">
    <div class="discount-pct-container">
      <input type="number" class="discount-input-row" min="0" step="1" placeholder="0" aria-label="Sleva na řádku" draggable="false">
      <button type="button" class="discount-mode-toggle" tabindex="-1" title="Přepnout mezi procenty a částkou">%</button>
    </div>
  </td>
  <td class="row-total-cell">0 Kč</td>
  <td class="actions-col">
    <button type="button" class="btn btn-danger remove-row-btn" title="Odstranit položku" tabindex="-1">×</button>
  </td>
`;

/** Sladí popisek přepínače a omezení vstupu s režimem slevy daného řádku. */
function syncRowDiscountMode(tr) {
  const isPct = tr.dataset.discountMode === 'pct';
  const input = tr.querySelector('.discount-input-row');
  const toggle = tr.querySelector('.discount-mode-toggle');

  toggle.textContent = isPct ? '%' : currencySymbol();
  toggle.classList.toggle('is-amount', !isPct);
  input.setAttribute('aria-label', isPct ? 'Sleva v procentech' : 'Sleva částkou');

  if (isPct) {
    input.max = 100;
    input.step = 1;
    // Přepisujeme jen při skutečném překročení, ať to nebrání psaní (např. "12.5")
    const n = numberOrZero(input.value);
    if (input.value !== '' && n > 100) input.value = 100;
  } else {
    input.removeAttribute('max');
    input.step = 0.01;
  }
}

function setupZeroHandling(input) {
  input.addEventListener('focus', () => {
    if (input.value === '0') input.value = '';
  });
  input.addEventListener('blur', () => {
    if (input.value.trim() === '') input.value = '0';
  });
}

function createRow(data = {}) {
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = ROW_TEMPLATE;

  const itemInput = tr.querySelector('.item-input');
  const qtyInput = tr.querySelector('.qty-input');
  const daysInput = tr.querySelector('.days-input');
  const priceInput = tr.querySelector('.price-input');
  const oldPriceInput = tr.querySelector('.old-price-input');
  const oldPriceBox = tr.querySelector('.old-price-container');
  const oldPriceToggle = tr.querySelector('.old-price-toggle');
  const oldPriceRemove = tr.querySelector('.old-price-remove');
  const discountInput = tr.querySelector('.discount-input-row');
  const discountModeToggle = tr.querySelector('.discount-mode-toggle');

  itemInput.value = data.item ?? '';
  qtyInput.value = data.qty ?? 1;
  daysInput.value = data.days === null || data.days === undefined ? '' : data.days;
  priceInput.value = data.price ?? 0;

  // Zpětná kompatibilita: starší nabídky měly jen `discountPct`
  const discount = data.discount || { mode: 'pct', value: data.discountPct || 0 };
  tr.dataset.discountMode = normalizeDiscountMode(discount.mode);
  discountInput.value = discount.value ? discount.value : '';
  syncRowDiscountMode(tr);

  const hasOldPrice = data.oldPrice !== null && data.oldPrice !== undefined;
  if (hasOldPrice) {
    oldPriceInput.value = data.oldPrice;
    oldPriceBox.hidden = false;
    oldPriceToggle.hidden = true;
  }

  // Služby (instalace, doprava, kauce…) původní cenu nenabízejí. Kdyby ji
  // starší nabídka přesto měla vyplněnou, zobrazí se a půjde odebrat.
  const noOldPrice = data.noOldPrice ?? NO_OLD_PRICE_ITEMS.has(data.item);
  if (noOldPrice) {
    tr.dataset.noOldPrice = '1';
    oldPriceToggle.hidden = true;
  }

  // Validace při opuštění pole
  qtyInput.addEventListener('blur', () => {
    const n = parseFloat(qtyInput.value);
    qtyInput.value = Number.isFinite(n) && n > 0 ? n : 1;
    recalculate();
  });
  daysInput.addEventListener('blur', () => {
    if (daysInput.value.trim() === '') return;
    const n = parseFloat(daysInput.value);
    daysInput.value = Number.isFinite(n) && n > 0 ? n : '';
    recalculate();
  });
  discountInput.addEventListener('blur', () => {
    if (discountInput.value.trim() === '') return;
    const n = Math.max(0, parseFloat(discountInput.value) || 0);
    discountInput.value = tr.dataset.discountMode === 'pct' ? clamp(n, 0, 100) : n;
    recalculate();
  });

  discountModeToggle.addEventListener('click', () => {
    tr.dataset.discountMode = tr.dataset.discountMode === 'pct' ? 'amount' : 'pct';
    syncRowDiscountMode(tr);
    recalculate();
  });

  setupZeroHandling(priceInput);
  setupZeroHandling(oldPriceInput);

  [itemInput, qtyInput, daysInput, priceInput, oldPriceInput, discountInput].forEach((input) => {
    input.addEventListener('input', recalculate);
  });

  oldPriceToggle.addEventListener('click', () => {
    oldPriceBox.hidden = false;
    oldPriceToggle.hidden = true;
    oldPriceInput.value = oldPriceInput.value || 0;
    oldPriceInput.focus();
    recalculate();
  });

  oldPriceRemove.addEventListener('click', () => {
    oldPriceBox.hidden = true;
    oldPriceToggle.hidden = tr.dataset.noOldPrice === '1';
    oldPriceInput.value = 0;
    recalculate();
  });

  tr.querySelector('.remove-row-btn').addEventListener('click', () => {
    tr.remove();
    recalculate();
  });

  if (data.locked) {
    itemInput.readOnly = true;
    tr.classList.add('locked-row');
  }

  return tr;
}

function createSectionHeader(title, key) {
  const tr = document.createElement('tr');
  tr.className = 'section-header-row';
  tr.dataset.sectionKey = key;
  const td = document.createElement('td');
  td.className = 'section-header';
  td.colSpan = 8;
  td.textContent = title;
  tr.appendChild(td);
  return tr;
}

function createSectionSubtotal() {
  const tr = document.createElement('tr');
  tr.className = 'section-subtotal-row';
  tr.innerHTML = `
    <td class="subtotal-label">Mezisoučet sekce:</td>
    <td class="subtotal-value">0 Kč</td>
    <td></td>
  `;
  return tr;
}

/* ================================================================== */
/*  Čtení modelu z DOM — jediný zdroj pravdy pro výpočty i exporty     */
/* ================================================================== */

function readModel() {
  const usesDuration = state.mode !== 'sale';
  const rows = [];
  let currentSection = null;

  for (const tr of Array.from(el.tableBody.children)) {
    if (tr.classList.contains('section-header-row')) {
      currentSection = { key: tr.dataset.sectionKey || '', title: tr.querySelector('.section-header').textContent };
      rows.push({ kind: 'section', title: currentSection.title, sectionKey: currentSection.key, node: tr });
      continue;
    }

    if (tr.classList.contains('section-subtotal-row')) {
      rows.push({ kind: 'subtotal', sectionKey: currentSection ? currentSection.key : '', node: tr });
      continue;
    }

    const itemInput = tr.querySelector('.item-input');
    const qtyInput = tr.querySelector('.qty-input');
    const priceInput = tr.querySelector('.price-input');
    if (!itemInput || !qtyInput || !priceInput) continue;

    const daysRaw = tr.querySelector('.days-input').value.trim();
    const hasDuration = usesDuration && daysRaw !== '' && numberOrZero(daysRaw) > 0;
    const days = hasDuration ? numberOrZero(daysRaw) : null;

    const oldPriceBox = tr.querySelector('.old-price-container');
    const oldPriceValue = numberOrZero(tr.querySelector('.old-price-input').value);
    const oldPrice = !oldPriceBox.hidden && oldPriceValue > 0 ? oldPriceValue : null;

    const qty = Math.max(0, numberOrZero(qtyInput.value));
    const price = numberOrZero(priceInput.value);

    const discountMode = normalizeDiscountMode(tr.dataset.discountMode);
    const discountValue = Math.max(0, numberOrZero(tr.querySelector('.discount-input-row').value));

    const base = round2(qty * (hasDuration ? days : 1) * price);
    const discountAmount = discountAmountFrom(base, discountMode, discountValue);
    const total = round2(base - discountAmount);

    // Sekce se určuje podle aktuální pozice v tabulce, ne podle původního zařazení
    const sectionKey = currentSection ? currentSection.key : '';
    tr.dataset.section = sectionKey;

    rows.push({
      kind: 'item',
      node: tr,
      item: itemInput.value,
      qty,
      days,
      hasDuration,
      price,
      oldPrice,
      discountMode,
      discountValue,
      discountAmount,
      base,
      total,
      sectionKey,
      locked: itemInput.readOnly,
      noOldPrice: tr.dataset.noOldPrice === '1',
    });
  }

  const itemsTotal = round2(rows.filter((r) => r.kind === 'item').reduce((sum, r) => sum + r.total, 0));
  const discountValue = Math.abs(numberOrZero(el.discountInput.value));
  const discount = discountAmountFrom(itemsTotal, state.discountMode, discountValue);
  const subtotal = Math.max(0, round2(itemsTotal - discount));
  const vat = round2(subtotal * (state.vatRate / 100));

  return {
    rows,
    itemsTotal,
    discount,
    discountValue,
    discountMode: state.discountMode,
    subtotal,
    vat,
    totalWithVat: round2(subtotal + vat),
    usesDuration,
    meta: {
      client: el.meta.client.value.trim(),
      clientIco: clientInfo.ico,
      clientDic: clientInfo.dic,
      clientAddress: clientInfo.address,
      number: el.meta.number.value.trim(),
      date: el.meta.date.value,
      validUntil: el.meta.validUntil.value,
      note: el.meta.note.value.trim(),
      address: el.meta.address.value.trim(),
      installDate: el.meta.installDate.value,
      removalDate: el.meta.removalDate.value,
      eventDays: numberOrZero(el.meta.eventDays.value),
      graphics: el.meta.graphics.value.trim(),
      closing: el.meta.closing.value.trim(),
    },
  };
}

/** Mezisoučet sekce = položky téže sekce, které stojí nad daným řádkem. */
function sectionSubtotalFor(model, subtotalIndex) {
  const target = model.rows[subtotalIndex];
  let sum = 0;
  for (let i = 0; i < subtotalIndex; i++) {
    const row = model.rows[i];
    if (row.kind === 'item' && row.sectionKey === target.sectionKey) sum += row.total;
  }
  return round2(sum);
}

/* ================================================================== */
/*  Vykreslení                                                         */
/* ================================================================== */

function recalculate() {
  const model = readModel();

  model.rows.forEach((row, index) => {
    if (row.kind === 'item') {
      row.node.querySelector('.row-total-cell').textContent = formatPrice(row.total);
    } else if (row.kind === 'subtotal') {
      row.node.querySelector('.subtotal-value').textContent = formatPrice(sectionSubtotalFor(model, index));
    }
  });

  el.subtotal.textContent = formatPrice(model.subtotal);
  el.totalWithVat.textContent = formatPrice(model.totalWithVat);
  el.vatRowLabel.textContent =
    state.vatRate === 0 ? 'Celkem (DPH 0 %)' : `Celkem s DPH (${state.vatRate} %)`;

  // Spodní lišta ukazuje částku, kterou klient uvidí jako výslednou.
  if (el.dockTotal) {
    el.dockTotal.textContent = formatPrice(state.showVat ? model.totalWithVat : model.subtotal);
    el.dockTotalLabel.textContent = state.showVat ? el.vatRowLabel.textContent : 'Celkem bez DPH';
  }

  el.discountModeToggle.textContent = state.discountMode === 'pct' ? '%' : currencySymbol();
  el.discountModeToggle.classList.toggle('is-amount', state.discountMode !== 'pct');
  el.tableBody.querySelectorAll('tr.item-row').forEach(syncRowDiscountMode);
  document.querySelectorAll('.cur-symbol').forEach((node) => {
    node.textContent = currencySymbol();
  });

  scheduleAutosave();
  return model;
}

/** Sladí colspany a viditelnost sloupců s aktuálním režimem. */
function applyLayout() {
  const usesDuration = state.mode !== 'sale';
  el.daysHeader.style.display = usesDuration ? '' : 'none';
  el.tableBody.querySelectorAll('.days-cell').forEach((cell) => {
    cell.style.display = usesDuration ? '' : 'none';
  });

  // drag + položka + ks + doba + cena + sleva% = 6 sloupců před součtem
  const leadingCols = usesDuration ? 6 : 5;
  document.querySelectorAll('.summary-row .label').forEach((label) => {
    label.colSpan = leadingCols;
  });
  el.tableBody.querySelectorAll('.section-subtotal-row .subtotal-label').forEach((label) => {
    label.colSpan = leadingCols;
  });
  el.tableBody.querySelectorAll('.section-header').forEach((header) => {
    header.colSpan = usesDuration ? 8 : 7;
  });

  el.vatRow.style.display = state.showVat ? '' : 'none';
  el.subtotalRow.classList.toggle('vats', !state.showVat);

  ['rental', 'sale', 'barter'].forEach((mode) => {
    document.getElementById(`${mode}ModeBtn`).classList.toggle('active', state.mode === mode);
  });
  document.getElementById('czkCurrencyBtn').classList.toggle('active', state.currency === 'CZK');
  document.getElementById('eurCurrencyBtn').classList.toggle('active', state.currency === 'EUR');
  el.globalUnitLabel.textContent = state.durationUnit === 'den' ? 'DNY' : 'MĚSÍCE';
}

/* ================================================================== */
/*  Režimy                                                             */
/* ================================================================== */

function buildRowsFromSpec(spec) {
  el.tableBody.innerHTML = '';
  spec.forEach((entry) => {
    if (entry.kind === 'section') {
      el.tableBody.appendChild(createSectionHeader(entry.title, entry.key));
    } else if (entry.kind === 'subtotal') {
      el.tableBody.appendChild(createSectionSubtotal());
    } else {
      el.tableBody.appendChild(createRow(entry));
    }
  });
}

function hasUserContent() {
  return Array.from(el.tableBody.querySelectorAll('.price-input')).some(
    (input) => numberOrZero(input.value) !== 0
  );
}

function setMode(mode, { rebuild = true, confirmLoss = false } = {}) {
  if (confirmLoss && hasUserContent()) {
    const ok = window.confirm('Přepnutím režimu se tabulka nahradí výchozími položkami. Pokračovat?');
    if (!ok) return;
  }

  state.mode = mode;
  if (rebuild) buildRowsFromSpec(DEFAULTS[mode]);
  applyLayout();
  recalculate();
}

/* ================================================================== */
/*  Měna a přepočet                                                    */
/* ================================================================== */

function convertAllPrices(factor) {
  el.tableBody.querySelectorAll('.price-input, .old-price-input').forEach((input) => {
    const value = numberOrZero(input.value);
    input.value = value === 0 ? 0 : round2(value * factor);
  });

  // Procentní slevy se kurzem nepřepočítávají, částkové ano
  el.tableBody.querySelectorAll('tr.item-row').forEach((tr) => {
    if (tr.dataset.discountMode === 'pct') return;
    const input = tr.querySelector('.discount-input-row');
    const value = numberOrZero(input.value);
    if (value !== 0) input.value = round2(value * factor);
  });

  if (state.discountMode !== 'pct') {
    const discount = numberOrZero(el.discountInput.value);
    if (discount !== 0) el.discountInput.value = round2(discount * factor);
  }
}

function switchCurrency(currency) {
  if (state.currency === currency) return;

  const rate = numberOrZero(el.eurRateInput.value);
  if (rate <= 0) {
    window.alert('Zadejte platný kurz (kolik Kč stojí 1 €).');
    el.eurRateInput.focus();
    return;
  }

  if (hasUserContent()) {
    const question =
      currency === 'EUR'
        ? `Přepočítat všechny ceny z Kč na € kurzem ${formatNumber(rate)} Kč/€?\n\nOK = přepočítat, Zrušit = jen změnit symbol měny.`
        : `Přepočítat všechny ceny z € na Kč kurzem ${formatNumber(rate)} Kč/€?\n\nOK = přepočítat, Zrušit = jen změnit symbol měny.`;
    if (window.confirm(question)) {
      convertAllPrices(currency === 'EUR' ? 1 / rate : rate);
    }
  }

  state.currency = currency;
  applyLayout();
  recalculate();
}

/* ================================================================== */
/*  Drag & drop                                                        */
/* ================================================================== */

let draggedRow = null;

el.tableBody.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('.drag-handle');
  if (!handle) {
    event.preventDefault();
    return;
  }
  const row = handle.closest('tr');
  if (!row) return;

  draggedRow = row;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', '');
  document.body.classList.add('dragging-active');
});

el.tableBody.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!draggedRow) return;

  const row = event.target.closest('tr');
  if (!row || row === draggedRow || row.parentNode !== el.tableBody) return;

  event.dataTransfer.dropEffect = 'move';
  const rows = Array.from(el.tableBody.children);
  if (rows.indexOf(draggedRow) < rows.indexOf(row)) {
    el.tableBody.insertBefore(draggedRow, row.nextSibling);
  } else {
    el.tableBody.insertBefore(draggedRow, row);
  }
});

el.tableBody.addEventListener('dragenter', (event) => event.preventDefault());
el.tableBody.addEventListener('drop', (event) => event.preventDefault());

el.tableBody.addEventListener('dragend', () => {
  el.tableBody.querySelectorAll('.dragging').forEach((row) => row.classList.remove('dragging'));
  document.body.classList.remove('dragging-active');
  draggedRow = null;
  recalculate(); // přepočítá i zařazení do sekcí podle nové pozice
});

/* ================================================================== */
/*  Export do HTML pro e-mail / PDF                                    */
/* ================================================================== */

const EMAIL_STYLES = {
  th: 'padding:10px 12px;border-bottom:2px solid #dee2e6;font-family:Arial,Helvetica,sans-serif;font-size:13px;',
  td: 'padding:10px 12px;border-bottom:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;font-size:14px;',
};

/** „−10 %“ nebo „−1 000 Kč“ podle režimu slevy na řádku. */
function formatRowDiscount(row) {
  return row.discountMode === 'pct'
    ? `−${formatNumber(clamp(row.discountValue, 0, 100))} %`
    : `−${formatPrice(row.discountAmount)}`;
}

/** Popisek celkové slevy — u procent doplní i sazbu. */
function totalDiscountLabel(model) {
  return model.discountMode === 'pct'
    ? `Sleva (${formatNumber(clamp(model.discountValue, 0, 100))} %)`
    : 'Sleva';
}

const EMAIL_PARAGRAPH_STYLE =
  'margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.6;';

/**
 * @param {object} options
 * @param {boolean} options.includeClosing Závěrečný text patří do e-mailu, do PDF ne.
 */
function buildEmailTable(model, { includeClosing = true } = {}) {
  const showDuration = model.usesDuration;
  const hasAnyDiscount = model.rows.some((r) => r.kind === 'item' && r.discountAmount > 0);
  const columnCount = 3 + (showDuration ? 1 : 0) + (hasAnyDiscount ? 1 : 0) + 1;
  const labelSpan = columnCount - 1;

  let html = '';

  // Místo a termín akce
  const eventLines = eventInfoLines(model.meta);
  if (eventLines.length) {
    const rows = eventLines.map((l) => `<strong>${escapeHtml(l.label)}: ${escapeHtml(l.value)}</strong>`);
    html += `<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.6;">${rows.join('<br>')}</p>`;
  }

  // Hlavička nabídky
  const metaLines = [];
  if (model.meta.number) metaLines.push(`<strong>Nabídka č. ${escapeHtml(model.meta.number)}</strong>`);
  if (model.meta.client) metaLines.push(`Pro: ${escapeHtml(model.meta.client)}`);
  if (model.meta.date) metaLines.push(`Datum: ${escapeHtml(formatDate(model.meta.date))}`);
  if (model.meta.validUntil) metaLines.push(`Platnost do: ${escapeHtml(formatDate(model.meta.validUntil))}`);

  if (metaLines.length) {
    html += `<p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333;line-height:1.6;">${metaLines.join('<br>')}</p>`;
  }

  html += `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:700px;border-collapse:collapse;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#f8f9fa;">
          <th align="left" style="${EMAIL_STYLES.th}">Položka</th>
          <th align="center" style="${EMAIL_STYLES.th}">Ks</th>
          ${showDuration ? `<th align="center" style="${EMAIL_STYLES.th}">${escapeHtml(durationColumnLabel())}</th>` : ''}
          <th align="right" style="${EMAIL_STYLES.th}">Cena/ks bez DPH</th>
          ${hasAnyDiscount ? `<th align="center" style="${EMAIL_STYLES.th}">Sleva</th>` : ''}
          <th align="right" style="${EMAIL_STYLES.th}">Celkem bez DPH</th>
        </tr>
      </thead>
      <tbody>`;

  model.rows.forEach((row, index) => {
    if (row.kind === 'section') {
      html += `<tr style="background-color:#f1f3f5;">
          <td colspan="${columnCount}" style="${EMAIL_STYLES.td}font-weight:bold;">${escapeHtml(row.title)}</td>
        </tr>`;
      return;
    }

    if (row.kind === 'subtotal') {
      html += `<tr style="background-color:#f8f9fa;">
          <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}font-weight:bold;color:#666666;">Mezisoučet:</td>
          <td align="right" style="${EMAIL_STYLES.td}font-weight:bold;">${escapeHtml(formatPrice(sectionSubtotalFor(model, index)))}</td>
        </tr>`;
      return;
    }

    let priceCell = escapeHtml(formatPrice(row.price));
    if (row.oldPrice) {
      priceCell += `<br><span style="font-size:12px;color:#666666;font-style:italic;">(původní cena ${escapeHtml(formatPrice(row.oldPrice))})</span>`;
    }

    html += `<tr>
        <td style="${EMAIL_STYLES.td}">${escapeHtml(row.item || '—')}</td>
        <td align="center" style="${EMAIL_STYLES.td}">${escapeHtml(formatNumber(row.qty))}</td>
        ${showDuration ? `<td align="center" style="${EMAIL_STYLES.td}">${row.hasDuration ? escapeHtml(formatDuration(row.days)) : '—'}</td>` : ''}
        <td align="right" style="${EMAIL_STYLES.td}">${priceCell}</td>
        ${hasAnyDiscount ? `<td align="center" style="${EMAIL_STYLES.td}${row.discountAmount > 0 ? 'color:#16a34a;font-weight:bold;' : 'color:#999999;'}">${row.discountAmount > 0 ? escapeHtml(formatRowDiscount(row)) : '—'}</td>` : ''}
        <td align="right" style="${EMAIL_STYLES.td}font-weight:bold;">${escapeHtml(formatPrice(row.total))}</td>
      </tr>`;
  });

  html += '</tbody><tfoot>';

  if (model.discount > 0) {
    html += `<tr>
        <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}color:#666666;font-style:italic;">Mezisoučet</td>
        <td align="right" style="${EMAIL_STYLES.td}color:#666666;font-style:italic;">${escapeHtml(formatPrice(model.itemsTotal))}</td>
      </tr>
      <tr>
        <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}color:#dc2626;font-weight:bold;">${escapeHtml(totalDiscountLabel(model))}</td>
        <td align="right" style="${EMAIL_STYLES.td}color:#dc2626;font-weight:bold;">− ${escapeHtml(formatPrice(model.discount))}</td>
      </tr>`;
  }

  if (state.showVat && state.vatRate > 0) {
    html += `<tr>
        <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}font-weight:bold;">Celkem bez DPH</td>
        <td align="right" style="${EMAIL_STYLES.td}font-weight:bold;">${escapeHtml(formatPrice(model.subtotal))}</td>
      </tr>
      <tr style="background-color:#f8f9fa;">
        <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}font-weight:bold;color:#3b82f6;">Celkem s DPH (${state.vatRate} %)</td>
        <td align="right" style="${EMAIL_STYLES.td}font-weight:bold;color:#3b82f6;font-size:18px;">${escapeHtml(formatPrice(model.totalWithVat))}</td>
      </tr>`;
  } else {
    html += `<tr style="background-color:#f8f9fa;">
        <td colspan="${labelSpan}" align="right" style="${EMAIL_STYLES.td}font-weight:bold;color:#3b82f6;">Celkem bez DPH</td>
        <td align="right" style="${EMAIL_STYLES.td}font-weight:bold;color:#3b82f6;font-size:18px;">${escapeHtml(formatPrice(model.subtotal))}</td>
      </tr>`;
  }

  html += '</tfoot></table>';

  if (state.vatRate === 0) {
    html += `<p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;">Přenesená daňová povinnost — daň odvede příjemce plnění.</p>`;
  }

  if (model.meta.note) {
    html += `<p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555555;line-height:1.6;">${escapeHtml(model.meta.note)}</p>`;
  }

  const graphics = graphicsSentence(model.meta, { html: true });
  if (graphics) {
    html += `<p style="${EMAIL_PARAGRAPH_STYLE}">${graphics}</p>`;
  }

  if (includeClosing && model.meta.closing) {
    html += textToHtmlParagraphs(model.meta.closing, EMAIL_PARAGRAPH_STYLE);
  }

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#333333;max-width:700px;">${html}</div>`;
}

function buildPlainText(model) {
  const lines = [];

  const eventLines = eventInfoLines(model.meta);
  if (eventLines.length) {
    eventLines.forEach((l) => lines.push(`${l.label}: ${l.value}`));
    lines.push('');
  }

  if (model.meta.number) lines.push(`Nabídka č. ${model.meta.number}`);
  if (model.meta.client) lines.push(`Pro: ${model.meta.client}`);
  if (model.meta.date) lines.push(`Datum: ${formatDate(model.meta.date)}`);
  if (model.meta.validUntil) lines.push(`Platnost do: ${formatDate(model.meta.validUntil)}`);
  if (lines.length) lines.push('');

  model.rows.forEach((row, index) => {
    if (row.kind === 'section') {
      lines.push('', `--- ${row.title} ---`);
    } else if (row.kind === 'subtotal') {
      lines.push(`Mezisoučet: ${formatPrice(sectionSubtotalFor(model, index))}`);
    } else {
      const parts = [`${formatNumber(row.qty)} ks`];
      if (row.hasDuration) parts.push(formatDuration(row.days));
      if (row.discountAmount > 0) parts.push(`sleva ${formatRowDiscount(row).replace('−', '')}`);

      let text = `${row.item || '—'}: ${parts.join(', ')} á ${formatPrice(row.price)} = ${formatPrice(row.total)}`;
      if (row.oldPrice) text += ` (původní cena/ks ${formatPrice(row.oldPrice)})`;
      lines.push(text);
    }
  });

  if (model.discount > 0) {
    lines.push('', `Mezisoučet: ${formatPrice(model.itemsTotal)}`, `${totalDiscountLabel(model)}: − ${formatPrice(model.discount)}`);
  }

  lines.push('', `Celkem bez DPH: ${formatPrice(model.subtotal)}`);
  if (state.showVat && state.vatRate > 0) {
    lines.push(`Celkem s DPH (${state.vatRate} %): ${formatPrice(model.totalWithVat)}`);
  }
  if (state.vatRate === 0) {
    lines.push('Přenesená daňová povinnost — daň odvede příjemce plnění.');
  }
  if (model.meta.note) lines.push('', model.meta.note);

  const graphics = graphicsSentence(model.meta, { html: false });
  if (graphics) lines.push('', graphics);

  if (model.meta.closing) lines.push('', model.meta.closing);

  return lines.join('\n');
}

function buildPdfDocument(model) {
  // Název dokumentu (metadata PDF), v těle se číslo nabídky tiskne v hlavičce tabulky.
  const title = model.meta.number ? `Nabídka ${model.meta.number}` : 'Cenová nabídka';
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; }
    body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { font-family: Arial, Helvetica, sans-serif; font-size: 20px; margin: 0 0 16px 0; color: #111827; }

    /* --------------------------------------------------------------
       E-mailová šablona je stavěná pro Outlook (pevných 700 px, volné
       zalamování). Na A4 se kvůli tomu rozpadá, proto ji tady pro tisk
       přesazujeme. Samotný buildEmailTable() se nemění — e-mailový
       výstup musí zůstat beze změny.
       -------------------------------------------------------------- */

    /* Na stránce je k dispozici víc místa než 700 px, využijeme ho. */
    .doc > div, .doc table { max-width: none !important; }

    /* Kompaktnější sazba, aby se sloupce vešly bez lámání. */
    .doc th, .doc td { font-size: 11.5px !important; padding: 7px 9px !important; }

    /* Čísla, ceny a slevy nikdy nelámat přes dva řádky. */
    .doc th[align="center"], .doc th[align="right"],
    .doc td[align="center"], .doc td[align="right"] { white-space: nowrap; }

    /* Hlavička tabulky se opakuje na každé stránce… */
    .doc thead { display: table-header-group; }

    /* …ale souhrn ne. Chromium tiskne <tfoot> jako table-footer-group,
       takže se „Celkem“ objevovalo na patě každé stránky a nabídka
       vypadala, že končí už na první straně. */
    .doc tfoot { display: table-row-group; }

    /* Řádek položky se nesmí rozlomit mezi stránkami. */
    .doc tr { break-inside: avoid; page-break-inside: avoid; }

    /* Nadpis sekce nenechávat osamocený na konci stránky. */
    .doc tbody tr[style*="f1f3f5"] { break-after: avoid; page-break-after: avoid; }
  </style>
</head>
<body>
  <h1>Cenová nabídka</h1>
  <div class="doc">${buildEmailTable(model, { includeClosing: false })}</div>
</body>
</html>`;
}

/* ================================================================== */
/*  Akce                                                               */
/* ================================================================== */

let toastTimer = null;

function showToast(message = 'Tabulka byla zkopírována do schránky!') {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3000);
}

async function copyForEmail() {
  const client = requireClient('Kopírování pro e-mail');
  if (!client) return;

  const model = recalculate();
  const html = buildEmailTable(model);
  const text = buildPlainText(model);
  const done = `Zkopírováno — nabídka pro ${client}`;

  // Nativní schránka Electronu je spolehlivější (nepotřebuje fokus dokumentu),
  // navigator.clipboard zůstává jako záloha.
  if (window.api && window.api.writeClipboard) {
    try {
      const result = await window.api.writeClipboard(html, text);
      if (result && result.ok) {
        showToast(done);
        return;
      }
    } catch (err) {
      console.warn('Nativní schránka selhala, zkouším navigator.clipboard:', err);
    }
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    showToast(done);
  } catch (err) {
    console.warn('navigator.clipboard selhal, zkouším kopírování přes výběr:', err);
    if (copyViaSelection(html)) {
      showToast(done);
      return;
    }
    console.error('Kopírování selhalo:', err);
    window.alert('Chyba při kopírování do schránky.');
  }
}

/**
 * Poslední záchrana pro webovou verzi: zkopíruje HTML přes výběr a
 * execCommand('copy'). Nepotřebuje oprávnění ke schránce, stačí, že
 * akci vyvolal uživatel kliknutím.
 */
function copyViaSelection(html) {
  const host = document.createElement('div');
  host.contentEditable = 'true';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  host.innerHTML = html;
  document.body.appendChild(host);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(host);
  selection.removeAllRanges();
  selection.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  selection.removeAllRanges();
  host.remove();
  return ok;
}

function suggestedFileName(model) {
  const parts = ['Nabidka'];
  if (model.meta.number) parts.push(model.meta.number);
  if (model.meta.client) parts.push(model.meta.client);
  return parts.join(' - ');
}

/**
 * Most do hlavního procesu. Když chybí, akce se dřív tiše přeskočila
 * a tlačítko navenek „nedělalo nic“ — radši to řekneme nahlas.
 */
function requireApi(action) {
  if (window.api) return true;
  window.alert(`${action} není k dispozici — chybí propojení s hlavním procesem aplikace.`);
  return false;
}

function describeError(err) {
  return err && err.message ? err.message : String(err);
}

async function exportPdf() {
  if (!requireApi('Export do PDF')) return;
  const client = requireClient('Export do PDF');
  if (!client) return;

  const model = recalculate();

  let result;
  try {
    result = await window.api.exportPdf(buildPdfDocument(model), suggestedFileName(model));
  } catch (err) {
    window.alert(`Export do PDF selhal: ${describeError(err)}`);
    return;
  }

  if (result.ok) {
    showToast(`PDF uloženo — nabídka pro ${client}`);
  } else if (!result.canceled) {
    window.alert(`Export do PDF selhal: ${result.error}`);
  }
}

/* ================================================================== */
/*  Serializace / perzistence                                          */
/* ================================================================== */

function serialize() {
  const model = readModel();
  return {
    version: SCHEMA_VERSION,
    mode: state.mode,
    currency: state.currency,
    eurRate: numberOrZero(el.eurRateInput.value) || 25,
    vatRate: state.vatRate,
    showVat: state.showVat,
    durationUnit: state.durationUnit,
    discountMode: state.discountMode,
    discount: model.discountValue,
    meta: model.meta,
    rows: model.rows.map((row) => {
      if (row.kind === 'section') return { kind: 'section', title: row.title, key: row.sectionKey };
      if (row.kind === 'subtotal') return { kind: 'subtotal' };
      return {
        kind: 'item',
        item: row.item,
        qty: row.qty,
        days: row.hasDuration ? row.days : '',
        price: row.price,
        oldPrice: row.oldPrice,
        discount: { mode: row.discountMode, value: row.discountValue },
        locked: row.locked,
        noOldPrice: row.noOldPrice,
      };
    }),
  };
}

function deserialize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) {
    throw new Error('Neplatná data nabídky.');
  }

  state.mode = ['rental', 'sale', 'barter'].includes(data.mode) ? data.mode : 'rental';
  state.currency = data.currency === 'EUR' ? 'EUR' : 'CZK';
  state.vatRate = [0, 12, 21].includes(Number(data.vatRate)) ? Number(data.vatRate) : 21;
  state.showVat = data.showVat !== false;
  state.durationUnit = data.durationUnit === 'mesic' ? 'mesic' : 'den';
  state.discountMode = normalizeDiscountMode(data.discountMode);

  el.eurRateInput.value = Number(data.eurRate) > 0 ? data.eurRate : 25;
  el.vatRateSelect.value = String(state.vatRate);
  el.vatToggle.checked = state.showVat;
  el.discountInput.value = numberOrZero(data.discount);

  const meta = data.meta || {};
  el.meta.client.value = meta.client || '';
  setClientInfo({ ico: meta.clientIco, dic: meta.clientDic, address: meta.clientAddress });
  el.meta.number.value = meta.number || '';
  el.meta.date.value = meta.date || '';
  el.meta.validUntil.value = meta.validUntil || '';
  el.meta.note.value = meta.note || '';
  el.meta.address.value = meta.address || '';
  el.meta.installDate.value = meta.installDate || '';
  el.meta.removalDate.value = meta.removalDate || '';
  el.meta.eventDays.value = Number(meta.eventDays) > 0 ? meta.eventDays : '';
  el.meta.graphics.value = meta.graphics || '';
  // Starší nabídky závěrečný text neznají → výchozí; vědomě smazaný ('') zůstane prázdný.
  el.meta.closing.value = typeof meta.closing === 'string' ? meta.closing : DEFAULT_CLOSING_TEXT;

  // Uloženou platnost bereme jako danou; když chybí, dopočítá se z data.
  // Čítač čísel se otevřením starší nabídky záměrně nevrací zpátky.
  validityLockedByUser = Boolean(meta.validUntil);
  syncValidUntil();

  eventDaysLockedByUser = Number(meta.eventDays) > 0;
  syncEventDays();

  buildRowsFromSpec(data.rows);
  applyLayout();
  recalculate();
  syncDateLimits();
}

let autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      // savedOn drží den, kdy se naposledy pracovalo — viz restoreAutosave()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...serialize(), savedOn: todayIso() }));
    } catch (err) {
      console.warn('Automatické uložení selhalo:', err);
    }
  }, 400);
}

/**
 * Rozpracovaná nabídka se obnoví jen v rámci téhož dne (pád appky,
 * restart). Druhý den se úmyslně zahodí — jinak by ráno naskočila
 * včerejší nabídka s včerejší firmou i datem a hrozilo by odeslání
 * na špatného klienta.
 */
function restoreAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (data.savedOn !== todayIso()) return false;

    deserialize(data);
    return true;
  } catch (err) {
    console.warn('Obnovení rozpracované nabídky selhalo:', err);
    return false;
  }
}

async function saveToFile() {
  if (!requireApi('Uložení nabídky')) return;
  const client = requireClient('Uložení nabídky');
  if (!client) return;

  const data = serialize();

  let result;
  try {
    result = await window.api.saveOffer(data, suggestedFileName({ meta: data.meta }));
  } catch (err) {
    window.alert(`Uložení selhalo: ${describeError(err)}`);
    return;
  }

  if (result.ok) {
    showToast(`Uloženo — nabídka pro ${client}`);
  } else if (!result.canceled) {
    window.alert('Uložení selhalo.');
  }
}

async function loadFromFile() {
  if (!requireApi('Otevření nabídky')) return;

  let result;
  try {
    result = await window.api.loadOffer();
  } catch (err) {
    window.alert(`Načtení selhalo: ${describeError(err)}`);
    return;
  }

  if (!result.ok) {
    if (!result.canceled) window.alert(result.error || 'Načtení selhalo.');
    return;
  }
  try {
    deserialize(result.data);
    showToast('Nabídka byla načtena.');
  } catch (err) {
    window.alert('Soubor neobsahuje platnou nabídku.');
  }
}

/**
 * Vyčistí hlavičku a předvyplní ji pro novou nabídku: prázdný klient
 * (vyplní se vědomě), další číslo v řadě, dnešní datum a platnost +14 dní.
 */
function prepareNewOfferMeta() {
  Object.values(el.meta).forEach((input) => {
    input.value = '';
  });
  setClientInfo(null);
  hideAresResults();

  const number = nextOfferNumber();
  el.meta.number.value = number;
  rememberOfferNumber(number);

  el.meta.date.value = todayIso();
  validityLockedByUser = false;
  syncValidUntil();

  el.meta.closing.value = DEFAULT_CLOSING_TEXT;
  eventDaysLockedByUser = false;
  syncDateLimits();
}

function newOffer() {
  if (hasUserContent() && !window.confirm('Opravdu založit novou nabídku? Rozpracovaná data budou smazána.')) {
    return;
  }
  prepareNewOfferMeta();
  el.discountInput.value = 0;
  buildRowsFromSpec(DEFAULTS[state.mode]);
  applyLayout();
  recalculate();
  showToast(`Nová nabídka č. ${el.meta.number.value} — vyplň klienta.`);
  openMetaPanel();
  el.meta.client.focus();
}

/* ================================================================== */
/*  Události                                                           */
/* ================================================================== */

el.addRowBtn.addEventListener('click', () => addRow({ focus: true }));

function addRow({ focus = false } = {}) {
  const row = createRow({ qty: 1, days: state.mode === 'sale' ? '' : 1, price: 0 });

  // V barteru vložíme položku dovnitř poslední sekce, ne až za její mezisoučet
  const subtotals = el.tableBody.querySelectorAll('.section-subtotal-row');
  const lastSubtotal = subtotals[subtotals.length - 1];
  if (lastSubtotal) {
    el.tableBody.insertBefore(row, lastSubtotal);
  } else {
    el.tableBody.appendChild(row);
  }

  applyLayout();
  recalculate();
  if (focus) row.querySelector('.item-input').focus();
}

['rental', 'sale', 'barter'].forEach((mode) => {
  document.getElementById(`${mode}ModeBtn`).addEventListener('click', () => {
    if (state.mode === mode) return;
    setMode(mode, { confirmLoss: true });
  });
});

document.getElementById('czkCurrencyBtn').addEventListener('click', () => switchCurrency('CZK'));
document.getElementById('eurCurrencyBtn').addEventListener('click', () => switchCurrency('EUR'));

el.globalUnitToggle.addEventListener('click', () => {
  state.durationUnit = state.durationUnit === 'den' ? 'mesic' : 'den';
  applyLayout();
  recalculate();
});

el.vatToggle.addEventListener('change', (event) => {
  state.showVat = event.target.checked;
  applyLayout();
  recalculate();
});

el.vatRateSelect.addEventListener('change', (event) => {
  state.vatRate = Number(event.target.value);
  applyLayout();
  recalculate();
});

el.eurRateInput.addEventListener('input', scheduleAutosave);

el.discountModeToggle.addEventListener('click', () => {
  state.discountMode = state.discountMode === 'pct' ? 'amount' : 'pct';
  if (state.discountMode === 'pct') {
    el.discountInput.max = 100;
    if (numberOrZero(el.discountInput.value) > 100) el.discountInput.value = 100;
  } else {
    el.discountInput.removeAttribute('max');
  }
  recalculate();
});

el.discountInput.addEventListener('input', recalculate);
el.discountInput.addEventListener('focus', () => {
  if (el.discountInput.value === '0') el.discountInput.value = '';
});
el.discountInput.addEventListener('blur', () => {
  if (el.discountInput.value.trim() === '') el.discountInput.value = '0';
});

Object.values(el.meta).forEach((input) => input.addEventListener('input', scheduleAutosave));

// Platnost drží krok s datem vystavení…
el.meta.date.addEventListener('input', syncValidUntil);

// …dokud si ji uživatel nepřepíše ručně (programové .value = událost nespouští).
el.meta.validUntil.addEventListener('input', () => {
  validityLockedByUser = true;
});

// Ruční přepsání čísla určuje, odkud se počítá dál.
el.meta.number.addEventListener('input', () => rememberOfferNumber(el.meta.number.value));

// Počet dní sleduje termín instalace/deinstalace…
el.meta.installDate.addEventListener('input', syncEventDays);
el.meta.removalDate.addEventListener('input', syncEventDays);

// …dokud ho uživatel nepřepíše ručně (smazání pole dopočet zase uvolní).
el.meta.eventDays.addEventListener('input', () => {
  eventDaysLockedByUser = el.meta.eventDays.value.trim() !== '';
  if (!eventDaysLockedByUser) syncEventDays();
});

// Vyhledání klienta v ARES: tlačítko nebo Enter v poli Klient.
el.aresBtn.addEventListener('click', lookupClientInAres);

el.meta.client.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    lookupClientInAres();
  } else if (event.key === 'Escape') {
    hideAresResults();
  } else if (event.key === 'ArrowDown' && !el.aresResults.classList.contains('hidden')) {
    event.preventDefault();
    const first = el.aresResults.querySelector('.ares-result');
    if (first) first.focus();
  }
});

// Ruční přepsání názvu = údaje z ARES už nemusí sedět, pryč s nimi.
el.meta.client.addEventListener('input', () => {
  setClientInfo(null);
  hideAresResults();
});

// Pohyb šipkami v seznamu nalezených firem.
el.aresResults.addEventListener('keydown', (event) => {
  const options = Array.from(el.aresResults.querySelectorAll('.ares-result'));
  const index = options.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' && index < options.length - 1) {
    event.preventDefault();
    options[index + 1].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (index > 0) options[index - 1].focus();
    else el.meta.client.focus();
  } else if (event.key === 'Escape') {
    hideAresResults();
    el.meta.client.focus();
  }
});

// Kliknutí mimo seznam ho zavře.
document.addEventListener('click', (event) => {
  if (!event.target.closest('.client-lookup')) hideAresResults();
});

el.metaToggle.addEventListener('click', () => {
  const collapsed = el.metaGrid.classList.toggle('collapsed');
  el.metaToggle.setAttribute('aria-expanded', String(!collapsed));
});

el.copyBtn.addEventListener('click', copyForEmail);
el.pdfBtn.addEventListener('click', exportPdf);
el.saveBtn.addEventListener('click', saveToFile);
el.loadBtn.addEventListener('click', loadFromFile);
el.newBtn.addEventListener('click', newOffer);

// Enter v posledním řádku přidá další položku
el.tableBody.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const row = event.target.closest('tr.item-row');
  if (!row) return;

  const itemRows = el.tableBody.querySelectorAll('tr.item-row');
  if (itemRows[itemRows.length - 1] === row) {
    event.preventDefault();
    addRow({ focus: true });
  }
});

// Kolečko myši nesmí měnit hodnoty číselných polí
document.addEventListener(
  'wheel',
  (event) => {
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT' && active.type === 'number' && active === event.target) {
      active.blur();
    }
  },
  { passive: true }
);

// Akce z hlavního menu (klávesové zkratky)
if (window.api) {
  window.api.onMenuAction((action) => {
    const actions = {
      new: newOffer,
      save: saveToFile,
      load: loadFromFile,
      copy: copyForEmail,
      pdf: exportPdf,
      'add-row': () => addRow({ focus: true }),
    };
    if (actions[action]) actions[action]();
  });
}

/* ================================================================== */
/*  Kalendáře u dat                                                    */
/*  Deinstalace začíná v měsíci instalace a dřívější dny nepustí,      */
/*  platnost se drží data vystavení. Výběr vyšle událost „input“ jako  */
/*  ruční zápis, takže dopočty i autosave fungují beze změny.          */
/* ================================================================== */

let calendars = null;

if (window.DateCalendar) {
  calendars = {
    date: DateCalendar.attach(el.meta.date),
    validUntil: DateCalendar.attach(el.meta.validUntil, {
      reference: () => el.meta.date.value,
      referenceLabel: 'Vystaveno',
      min: () => el.meta.date.value,
    }),
    installDate: DateCalendar.attach(el.meta.installDate),
    removalDate: DateCalendar.attach(el.meta.removalDate, {
      reference: () => el.meta.installDate.value,
      referenceLabel: 'Instalace',
      min: () => el.meta.installDate.value,
    }),
  };
  el.meta.date.addEventListener('input', syncDateLimits);
  el.meta.installDate.addEventListener('input', syncDateLimits);
}

/** Minimum u platnosti a deinstalace i pro ruční zápis (pole se pak označí). */
function syncDateLimits() {
  if (!calendars) return;
  calendars.validUntil.syncMin();
  calendars.removalDate.syncMin();
}

/* ================================================================== */
/*  Start                                                              */
/* ================================================================== */

if (!restoreAutosave()) {
  prepareNewOfferMeta();
  setMode('rental');
}
