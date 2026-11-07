/*
 * Maskot v horní liště – krátký tanec postavičky (assets/mascot-dance.webm,
 * průhledné VP9 vyříznuté z green screenu) střídaný s klidovým snímkem
 * (assets/mascot-idle.png = první snímek videa; video navíc končí ve stejné
 * póze, ve které začíná, takže přechody sedí na pixel).
 *
 * Postavička chvíli stojí a dýchá (CSS), pak stydlivě zamává, vrátí
 * se do klidu a za 6–11 s znovu. Najetí myší animaci spustí hned.
 * Při prefers-reduced-motion jen stojí; ve skrytém okně se nepřehrává.
 */
(function () {
  'use strict';

  const root = document.querySelector('.mascot');
  if (!root) return;
  const video = root.querySelector('.mascot-video');
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
