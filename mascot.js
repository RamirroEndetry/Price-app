/*
 * Maskot v horní liště – krátký tanec postavičky (assets/mascot-dance.webm,
 * průhledné VP9 vyříznuté z green screenu) střídaný s klidovým snímkem
 * (assets/mascot-idle@Nx.png = první snímek videa v přesné velikosti; video navíc končí ve stejné
 * póze, ve které začíná, takže přechody sedí na pixel).
 *
 * Postavička chvíli stojí, pak stydlivě zamává, vrátí
 * se do klidu a za 6–11 s znovu. Najetí myší animaci spustí hned.
 * Při prefers-reduced-motion jen stojí; ve skrytém okně se nepřehrává.
 */
(function () {
  'use strict';

  const root = document.querySelector('.mascot');
  if (!root) return;
  const video = root.querySelector('.mascot-video');
  const idle = root.querySelector('.mascot-idle');
  const figure = root.querySelector('.mascot-figure');

  /*
    Ostrý klidový obrázek: rámeček musí mít přesně rozměr vybraného obrázku
    ve skutečných pixelech (např. 64 × 111 při 125 %) a ležet na celém pixelu.
    Už rozdíl 63,75 vs 64 px nutí prohlížeč celý obrázek převzorkovat a tím
    rozmazat. CSS rozměry ve style.css jsou jen výchozí hodnota pro 100 %.
  */
  function fitToPixels() {
    if (!idle || !figure || !idle.currentSrc) return;
    const probe = new Image();
    probe.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      figure.style.marginLeft = '0px';
      figure.style.width = `${probe.naturalWidth / dpr}px`;
      figure.style.height = `${probe.naturalHeight / dpr}px`;
      // Posun na celý pixel obrazovky (jen dolů/doleva o zlomek pixelu).
      const rect = figure.getBoundingClientRect();
      const fracX = (rect.left * dpr) % 1;
      const fracY = (rect.top * dpr) % 1;
      if (fracX > 0.01) figure.style.marginLeft = `${-fracX / dpr}px`;
      figure.style.bottom = `${-21 - (fracY > 0.01 ? (1 - fracY) / dpr : 0)}px`;
    };
    probe.src = idle.currentSrc;
  }

  if (idle) {
    if (idle.complete) fitToPixels();
    idle.addEventListener('load', fitToPixels);
    window.addEventListener('resize', fitToPixels);
    // Změna měřítka obrazovky (přetažení okna na jiný monitor apod.)
    const watchDpr = () => {
      window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        .addEventListener('change', () => { fitToPixels(); watchDpr(); }, { once: true });
    };
    watchDpr();
  }

  if (!video) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  let timer = 0;

  // Stav se bere přímo z videa, ne z vlastní proměnné – kdyby se přehrávání
  // přerušilo (pauza, chyba), postavička se nemůže „zaseknout“ v tanci.
  const isDancing = () => !video.paused && !video.ended;

  function rest() {
    root.classList.remove('is-dancing');
  }

  function scheduleNext(delayMs) {
    clearTimeout(timer);
    timer = setTimeout(dance, delayMs ?? 6000 + Math.random() * 5000);
  }

  function dance() {
    if (isDancing()) return;
    if (document.hidden) {
      scheduleNext(4000);
      return;
    }
    clearTimeout(timer);
    video.currentTime = 0;
    root.classList.add('is-dancing');
    const started = video.play();
    if (started && typeof started.catch === 'function') {
      // Přehrání se nepovedlo (např. chybí kodek) – zůstane klidová póza.
      started.catch(() => {
        rest();
        scheduleNext();
      });
    }
  }

  video.addEventListener('ended', () => {
    rest();
    scheduleNext();
  });

  // Přerušené přehrávání (ne konec) – vrátit klid a naplánovat další tanec.
  video.addEventListener('pause', () => {
    if (video.ended) return;
    rest();
    scheduleNext();
  });

  root.addEventListener('mouseenter', dance);

  scheduleNext(2500);
})();
