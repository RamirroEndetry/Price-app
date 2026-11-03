/*
 * Vyhledání firmy v ARES (registr ekonomických subjektů MF ČR).
 *
 * Jeden modul pro obě prostředí: v Electronu ho načítá hlavní proces
 * (require) a volá přes net.fetch, ve webové verzi ho načítá stránka
 * (<script>) a volá přes window.fetch. ARES posílá CORS hlavičky
 * Access-Control-Allow-Origin: *, takže přímý dotaz z prohlížeče funguje.
 *
 * Odpověď se ořeže jen na to, co appka potřebuje: název, IČO, DIČ a sídlo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AresClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ARES_BASE = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
  const ARES_TIMEOUT_MS = 10000;
  const ARES_MAX_RESULTS = 10;

  function aresSubject(subject) {
    const seat = (subject && subject.sidlo) || {};
    return {
      ico: String((subject && subject.ico) || ''),
      name: String((subject && subject.obchodniJmeno) || '').trim(),
      dic: String((subject && subject.dic) || ''),
      address: String(seat.textovaAdresa || ''),
    };
  }

  /**
   * Vrátí funkci lookup(query) → { ok, byIco, query, results, total } | { ok: false, error }.
   * @param {(url: string, init: object) => Promise<Response>} fetchImpl  net.fetch nebo window.fetch
   */
  function createLookup(fetchImpl) {
    async function aresFetch(url, init = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ARES_TIMEOUT_MS);
      try {
        return await fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: { Accept: 'application/json', ...(init.headers || {}) },
        });
      } finally {
        clearTimeout(timer);
      }
    }

    return async function lookup(query) {
      const q = String(query || '').trim();
      if (!q) return { ok: false, error: 'Zadej IČO nebo název firmy.' };

      const digits = q.replace(/\s+/g, '');
      const byIco = /^\d{1,8}$/.test(digits);

      try {
        if (byIco) {
          // ARES chce vždy 8 číslic — IČO psané bez úvodních nul doplníme.
          const ico = digits.padStart(8, '0');
          const res = await aresFetch(`${ARES_BASE}/${ico}`);
          if (res.status === 404) return { ok: true, byIco, query: ico, results: [], total: 0 };
          if (!res.ok) return { ok: false, error: `ARES odpověděl chybou ${res.status}.` };
          const subject = aresSubject(await res.json());
          const results = subject.name ? [subject] : [];
          return { ok: true, byIco, query: ico, results, total: results.length };
        }

        const res = await aresFetch(`${ARES_BASE}/vyhledat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ obchodniJmeno: q, pocet: ARES_MAX_RESULTS, start: 0 }),
        });
        if (!res.ok) return { ok: false, error: `ARES odpověděl chybou ${res.status}.` };
        const data = await res.json();
        const results = (data.ekonomickeSubjekty || []).map(aresSubject).filter((s) => s.name);
        return { ok: true, byIco, query: q, results, total: Number(data.pocetCelkem) || results.length };
      } catch (err) {
        const timedOut = err && err.name === 'AbortError';
        return {
          ok: false,
          error: timedOut
            ? 'ARES neodpověděl včas, zkus to za chvíli znovu.'
            : 'Nepodařilo se spojit s ARES — zkontroluj připojení k internetu.',
        };
      }
    };
  }

  return { createLookup };
});
