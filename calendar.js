/*
 * Vlastní kalendář k polím <input type="date">.
 *
 * Datum jde dál psát ručně; ikonka v poli otevře kalendář ve stylu aplikace.
 * Vestavěný kalendář prohlížeče se v Electronu neotevíral spolehlivě a hlavně
 * neumí říct, ve kterém měsíci má začít. Tenhle začíná:
 *   1. v měsíci vyplněné hodnoty,
 *   2. jinak v měsíci referenčního data (deinstalace → instalace),
 *   3. jinak v aktuálním měsíci.
 *
 * Výběr nastaví input.value a vyšle událost „input“ – stejně jako ruční zápis,
 * takže se spustí dopočet platnosti, počtu dní i automatické uložení.
 *
 * Použití: DateCalendar.attach(input, {
 *   reference: () => '2026-12-10',   // zvýrazněný den + výchozí měsíc
 *   referenceLabel: 'Instalace',
 *   min: () => '2026-12-10',         // dřívější dny nejdou vybrat
 * });
 */
(function () {
  'use strict';

  const MONTHS = [
    'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
    'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
  ];
  const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

  const ICON_CALENDAR =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>';
  const ICON_PREV =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  const ICON_NEXT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

  const pad = (n) => String(n).padStart(2, '0');
  const toIso = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const today = () => {
    const d = new Date();
    return toIso(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const parseMonth = (iso) => {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso || '');
    return m ? { year: Number(m[1]), month: Number(m[2]) - 1 } : null;
  };
  const formatLong = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '';
  };

  /** Otevřený kalendář – vždy nejvýš jeden. */
  let active = null;

  function close() {
    if (!active) return;
    active.popup.remove();
    active.trigger.classList.remove('is-open');
    active.trigger.setAttribute('aria-expanded', 'false');
    active.wrapper.classList.remove('has-calendar');
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    active = null;
  }

  function onOutside(event) {
    if (active && !active.wrapper.contains(event.target)) close();
  }

  function onKey(event) {
    if (event.key === 'Escape' && active) {
      event.stopPropagation();
      const { trigger } = active;
      close();
      trigger.focus();
    }
  }

  function render(state) {
    const { popup, input, options, view } = state;
    const value = input.value;
    const reference = options.reference();
    const min = options.min();
    const now = today();

    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7; // týden začíná pondělím
    const count = new Date(view.year, view.month + 1, 0).getDate();

    popup.replaceChildren();

    const head = document.createElement('div');
    head.className = 'calendar-head';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'calendar-nav';
    prev.setAttribute('aria-label', 'Předchozí měsíc');
    prev.innerHTML = ICON_PREV;
    prev.addEventListener('click', () => shift(state, -1));
    const title = document.createElement('span');
    title.className = 'calendar-title';
    title.textContent = `${MONTHS[view.month]} `;
    const year = document.createElement('span');
    year.textContent = String(view.year);
    title.appendChild(year);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'calendar-nav';
    next.setAttribute('aria-label', 'Další měsíc');
    next.innerHTML = ICON_NEXT;
    next.addEventListener('click', () => shift(state, 1));
    head.append(prev, title, next);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    WEEKDAYS.forEach((name) => {
      const span = document.createElement('span');
      span.className = 'calendar-weekday';
      span.textContent = name;
      grid.appendChild(span);
    });
    for (let i = 0; i < offset; i += 1) grid.appendChild(document.createElement('span'));
    for (let day = 1; day <= count; day += 1) {
      const iso = toIso(view.year, view.month, day);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day';
      btn.textContent = String(day);
      btn.setAttribute('aria-label', formatLong(iso));
      if (iso === value) btn.classList.add('is-selected');
      if (iso === now) btn.classList.add('is-today');
      if (iso === reference) {
        btn.classList.add('is-reference');
        if (options.referenceLabel) btn.title = options.referenceLabel;
      }
      if (reference && value && iso > reference && iso < value) btn.classList.add('is-between');
      if (min && iso < min) btn.disabled = true;
      btn.addEventListener('click', () => pick(state, iso));
      grid.appendChild(btn);
    }

    const foot = document.createElement('div');
    foot.className = 'calendar-foot';
    const legend = document.createElement('span');
    if (reference && options.referenceLabel) {
      legend.className = 'calendar-legend';
      const dot = document.createElement('i');
      legend.append(dot, ` ${options.referenceLabel} ${formatLong(reference)}`);
    }
    const actions = document.createElement('div');
    actions.className = 'calendar-actions';
    if (value) actions.appendChild(link('Vymazat', () => pick(state, '')));
    if (!min || now >= min) actions.appendChild(link('Dnes', () => pick(state, now)));
    foot.append(legend, actions);

    popup.append(head, grid, foot);
  }

  function link(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-link';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function shift(state, delta) {
    const d = new Date(state.view.year, state.view.month + delta, 1);
    state.view = { year: d.getFullYear(), month: d.getMonth() };
    render(state);
  }

  function pick(state, iso) {
    const { input, trigger } = state;
    input.value = iso;
    // Stejná událost jako při psaní – spustí dopočty i automatické uložení.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    trigger.focus();
  }

  function open(state) {
    close();
    const { input, options, wrapper, trigger } = state;
    state.view = parseMonth(input.value) || parseMonth(options.reference()) || parseMonth(today());
    state.popup = document.createElement('div');
    state.popup.className = 'calendar';
    state.popup.setAttribute('role', 'dialog');
    state.popup.setAttribute('aria-label', 'Kalendář');
    // Klik do kalendáře nesmí „aktivovat“ <label> kolem pole.
    state.popup.addEventListener('click', (event) => event.preventDefault());
    render(state);
    wrapper.appendChild(state.popup);
    wrapper.classList.add('has-calendar');
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    active = state;
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }

  function attach(input, options = {}) {
    const opts = {
      reference: options.reference || (() => ''),
      referenceLabel: options.referenceLabel || '',
      min: options.min || (() => ''),
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'date-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'date-trigger';
    trigger.setAttribute('aria-label', 'Otevřít kalendář');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = 'Vybrat v kalendáři';
    trigger.innerHTML = ICON_CALENDAR;
    wrapper.appendChild(trigger);

    const state = { input, options: opts, wrapper, trigger, popup: null, view: null };
    trigger.addEventListener('click', (event) => {
      event.preventDefault(); // neaktivovat <label>
      if (active === state) close();
      else open(state);
    });

    // Minimum i pro ruční zápis (pole se pak označí jako neplatné).
    const syncMin = () => {
      const min = opts.min();
      if (min) input.min = min;
      else input.removeAttribute('min');
    };
    syncMin();
    return { syncMin };
  }

  window.DateCalendar = { attach, close };
})();
