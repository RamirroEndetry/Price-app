/*
 * Vesmírné pozadí – procedurální mlhovina, hvězdné pole s pásem Mléčné dráhy,
 * scintilující jasné hvězdy a meteory. Stejný generátor jako v aplikaci
 * Generátor objednávek (tam src/utils/sky.js), převedený na obyčejný skript,
 * protože tahle appka nemá bundler.
 *
 * Mlhovina a hvězdy se kreslí jednou do statických canvasů a CSS mlhovinu jen
 * pomalu posouvá (transform). Živý canvas překresluje ~60 scintilujících hvězd
 * ~15× za sekundu přes časovač a plné snímky (requestAnimationFrame) zapíná
 * jen během letu meteoru. Ve skrytém okně se nekreslí nic. Při
 * prefers-reduced-motion se obloha vykreslí jednou a stojí.
 */
(function () {
    'use strict';

    /**
     * Procedurální vesmír – mlhovina, hvězdné pole a meteory.
     *
     * Všechno je generované ze semínka, takže obloha vypadá při každém spuštění
     * i po změně velikosti okna stejně (souřadnice jsou v rozsahu 0–1).
     * Mlhovina a hvězdy se kreslí jen jednou do statických canvasů; každý snímek
     * se překresluje jen pár desítek blikajících hvězd a meteory.
     */

    /* ---------- Náhoda se semínkem ---------- */

    const mulberry32 = (seed) => () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    /* ---------- Perlinův šum 2D ---------- */

    const createNoise = (seed) => {
        const random = mulberry32(seed);
        const perm = new Uint8Array(512);
        const base = Array.from({ length: 256 }, (_, i) => i);
        for (let i = 255; i > 0; i -= 1) {
            const j = Math.floor(random() * (i + 1));
            [base[i], base[j]] = [base[j], base[i]];
        }
        for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];

        const grad = (hash, x, y) => {
            switch (hash & 7) {
                case 0: return x + y;
                case 1: return -x + y;
                case 2: return x - y;
                case 3: return -x - y;
                case 4: return x;
                case 5: return -x;
                case 6: return y;
                default: return -y;
            }
        };
        const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

        const noise = (x, y) => {
            const xi = Math.floor(x);
            const yi = Math.floor(y);
            const X = xi & 255;
            const Y = yi & 255;
            const xf = x - xi;
            const yf = y - yi;
            const u = fade(xf);
            const v = fade(yf);
            const aa = perm[perm[X] + Y];
            const ab = perm[perm[X] + Y + 1];
            const ba = perm[perm[X + 1] + Y];
            const bb = perm[perm[X + 1] + Y + 1];
            const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
            const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
            return x1 + v * (x2 - x1);
        };

        /** Fraktální šum v rozsahu přibližně −1…1. */
        const fbm = (x, y, octaves = 5) => {
            let sum = 0;
            let amp = 0.5;
            let freq = 1;
            let norm = 0;
            for (let o = 0; o < octaves; o += 1) {
                sum += amp * noise(x * freq, y * freq);
                norm += amp;
                amp *= 0.5;
                freq *= 2.03;
            }
            return sum / norm;
        };

        return fbm;
    };

    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const smoothstep = (a, b, v) => {
        const t = clamp01((v - a) / (b - a));
        return t * t * (3 - 2 * t);
    };
    const mix = (a, b, t) => a + (b - a) * t;

    /* ---------- Pás Mléčné dráhy ---------- */

    // Úhlopříčný pás zleva dole doprava nahoru – hustší hvězdy i plyn.
    const bandWeight = (x, y, aspect) => {
        const px = x * aspect;
        const nx = -0.42;
        const ny = -0.91;
        const d = (px - 0.55 * aspect) * nx + (y - 0.52) * ny;
        return Math.exp(-((d / 0.33) ** 2));
    };

    /* ---------- Mlhovina ---------- */

    const PALETTES = {
        dark: {
            violet: [104, 70, 214],
            magenta: [214, 36, 120],
            teal: [34, 160, 196],
            core: [255, 205, 235],
            intensity: 0.92
        },
        light: {
            violet: [170, 140, 255],
            magenta: [255, 120, 190],
            teal: [110, 205, 245],
            core: [255, 255, 255],
            intensity: 0.5
        }
    };

    /**
     * Vykreslí mlhovinu do canvasu (w × h v CSS pixelech).
     * Počítá se v pětinovém rozlišení s doménovým zkreslením šumu (vlákna plynu),
     * tmavými prachovými pruhy a jasnějšími jádry, pak se rozmaže a zvětší.
     */
    const renderNebula = (canvas, w, h, { theme = 'dark', seed = 7, detail = 1 } = {}) => {
        const palette = PALETTES[theme] || PALETTES.dark;
        const fbm = createNoise(seed);
        const dust = createNoise(seed + 101);
        const hue = createNoise(seed + 202);

        const step = 5;
        const cw = Math.max(1, Math.ceil(w / step));
        const ch = Math.max(1, Math.ceil(h / step));
        const small = document.createElement('canvas');
        small.width = cw;
        small.height = ch;
        const sctx = small.getContext('2d');
        const img = sctx.createImageData(cw, ch);
        const data = img.data;
        const aspect = w / h;
        const scale = 2.6 * detail;

        for (let j = 0; j < ch; j += 1) {
            const y = j / ch;
            for (let i = 0; i < cw; i += 1) {
                const x = i / cw;
                const px = x * aspect * scale;
                const py = y * scale;

                // Doménové zkreslení – z kulatých skvrn dělá vlákna a závoje.
                const qx = fbm(px + 1.7, py + 9.2, 4);
                const qy = fbm(px + 8.3, py + 2.8, 4);
                const d = fbm(px + 3.2 * qx, py + 3.2 * qy, 5) * 0.5 + 0.5;

                const band = bandWeight(x, y, aspect);
                let density = smoothstep(0.46, 0.9, d) ** 1.7 * (0.18 + 0.82 * band);

                // Prachové pruhy pohlcují světlo.
                const lane = dust(px * 1.9 + 4, py * 1.9 - 3, 5);
                density *= 1 - 0.78 * smoothstep(0.02, 0.38, lane);

                // Barva plynu: fialová → magenta → tyrkys podle pomalého šumu.
                const t = clamp01(hue(px * 0.7, py * 0.7, 3) * 1.6 + 0.5);
                let r;
                let g;
                let b;
                if (t < 0.5) {
                    const k = smoothstep(0.15, 0.5, t);
                    r = mix(palette.teal[0], palette.violet[0], k);
                    g = mix(palette.teal[1], palette.violet[1], k);
                    b = mix(palette.teal[2], palette.violet[2], k);
                } else {
                    const k = smoothstep(0.5, 0.85, t);
                    r = mix(palette.violet[0], palette.magenta[0], k);
                    g = mix(palette.violet[1], palette.magenta[1], k);
                    b = mix(palette.violet[2], palette.magenta[2], k);
                }

                // Hustá místa svítí – emisní jádra do bíla.
                const core = density ** 2.6;
                r = mix(r, palette.core[0], core * 0.7);
                g = mix(g, palette.core[1], core * 0.7);
                b = mix(b, palette.core[2], core * 0.7);

                const o = (j * cw + i) * 4;
                data[o] = r;
                data[o + 1] = g;
                data[o + 2] = b;
                data[o + 3] = clamp01(density * 1.1 * palette.intensity) * 255;
            }
        }
        sctx.putImageData(img, 0, 0);

        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.filter = 'blur(5px)';
        ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
        // Druhý ostřejší průchod vrací drobnou strukturu vláken.
        ctx.filter = 'blur(1.5px)';
        ctx.globalAlpha = 0.45;
        ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
    };

    /* ---------- Hvězdy ---------- */

    // Barvy podle teploty: modrobílé (horké) … oranžové (chladné).
    const STAR_COLORS = [
        { rgb: [190, 210, 255], weight: 0.12 },
        { rgb: [225, 232, 255], weight: 0.22 },
        { rgb: [255, 250, 244], weight: 0.34 },
        { rgb: [255, 236, 205], weight: 0.2 },
        { rgb: [255, 212, 170], weight: 0.12 }
    ];

    const pickColor = (r) => {
        let acc = 0;
        for (const c of STAR_COLORS) {
            acc += c.weight;
            if (r <= acc) return c.rgb;
        }
        return STAR_COLORS[2].rgb;
    };

    /**
     * Vygeneruje hvězdy pro plochu w × h. Jasnost má mocninné rozložení – hodně
     * slabých, málo jasných – a v pásu Mléčné dráhy je jich víc.
     */
    const generateStars = (w, h, seed = 42) => {
        const random = mulberry32(seed);
        const aspect = w / h;
        const target = Math.round((w * h) / 1300);
        const stars = [];
        let attempts = 0;

        while (stars.length < target && attempts < target * 4) {
            attempts += 1;
            const x = random();
            const y = random();
            const band = bandWeight(x, y, aspect);
            // V pásu je hvězd až ~3× víc.
            if (random() > 0.32 + 0.68 * band) continue;

            const m = random() ** 4.2; // mocninné rozložení jasnosti
            stars.push({
                x,
                y,
                mag: m,
                radius: 0.35 + m * 1.5,
                alpha: 0.18 + 0.82 * Math.min(1, m * 1.5 + random() * 0.12),
                color: pickColor(random()),
                phase: random() * Math.PI * 2,
                speed: 0.6 + random() * 1.8,
                twinkle: false,
                spikes: false
            });
        }

        // Nejjasnější hvězdy scintilují na živém canvasu; jen hrstka má paprsky.
        const bright = stars.slice().sort((a, b) => b.mag - a.mag);
        bright.slice(0, 60).forEach((s) => { s.twinkle = true; });
        bright.slice(0, Math.max(4, Math.round(target / 220))).forEach((s) => { s.spikes = true; });

        return stars;
    };

    /** Mlhavá záře nahusto posetých, nerozlišitelných hvězd v pásu. */
    const drawMilkyGlow = (ctx, w, h, theme, seed) => {
        if (theme !== 'dark') return;
        const random = mulberry32(seed + 9);
        const aspect = w / h;
        for (let k = 0; k < 2600; k += 1) {
            const x = random();
            const y = random();
            if (random() > bandWeight(x, y, aspect) * 0.9) continue;
            ctx.fillStyle = `rgba(220, 225, 255, ${0.05 + random() * 0.12})`;
            ctx.fillRect(x * w, y * h, 0.8, 0.8);
        }
    };

    /** Jedna hvězda: jádro + halo, u jasných i jemné difrakční paprsky. */
    const drawStar = (ctx, s, w, h, alpha, theme) => {
        const x = s.x * w;
        const y = s.y * h;
        const [r, g, b] = theme === 'dark' ? s.color : [110, 90, 190];
        const a = alpha * (theme === 'dark' ? 1 : 0.55);

        if (s.radius < 0.9) {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            ctx.fillRect(x - s.radius, y - s.radius, s.radius * 2, s.radius * 2);
            return;
        }

        const halo = s.radius * (2.4 + s.mag * 2.2);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, halo);
        grad.addColorStop(0, `rgba(255, 255, 255, ${a})`);
        grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, ${a * 0.85})`);
        grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${a * 0.18})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, halo, 0, Math.PI * 2);
        ctx.fill();

        // Difrakční paprsky jen u nejjasnějších – jako na fotkách teleskopů.
        if (s.spikes && theme === 'dark') {
            const len = halo * (1.8 + s.mag * 1.6);
            ctx.lineWidth = 0.6;
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const spike = ctx.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
                spike.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
                spike.addColorStop(0.5, `rgba(255, 255, 255, ${a * 0.35})`);
                spike.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
                ctx.strokeStyle = spike;
                ctx.beginPath();
                ctx.moveTo(x - dx * len, y - dy * len);
                ctx.lineTo(x + dx * len, y + dy * len);
                ctx.stroke();
            }
        }
    };

    /** Statické hvězdy (bez scintilujících) do canvasu. */
    const renderStars = (canvas, stars, w, h, dpr, theme, seed = 42) => {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawMilkyGlow(ctx, w, h, theme, seed);
        for (const s of stars) {
            if (!s.twinkle) drawStar(ctx, s, w, h, s.alpha, theme);
        }
    };

    /**
     * Scintilace: součet dvou nesoudělných sinusovek s náhodnou fází –
     * nepravidelné mihotání místo pravidelného pulzování.
     */
    const twinkleAlpha = (s, t) => {
        const flicker = 0.5 * Math.sin(t * s.speed + s.phase) + 0.5 * Math.sin(t * s.speed * 2.37 + s.phase * 1.7);
        return s.alpha * (0.72 + 0.28 * flicker);
    };

    /* ---------- Meteory ---------- */

    /**
     * Nový meteor. Všechny přilétají ze stejného radiantu (jako skutečný roj),
     * jen s malým rozptylem směru. Občas jasný bolid s nazelenalou hlavou.
     */
    const spawnMeteor = (w, h, random, radiant) => {
        const fireball = random() < 0.12;
        const spread = (random() - 0.5) * 0.35;
        const angle = radiant.angle + spread;
        const speed = (fireball ? 900 : 1100) + random() * 900; // px/s
        const life = (fireball ? 1.1 : 0.45) + random() * 0.6; // s
        return {
            x: random() * w * 1.1 - w * 0.05,
            y: random() * h * 0.55 - h * 0.05,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life,
            age: 0,
            length: (fireball ? 260 : 120) + random() * 160,
            width: fireball ? 2.4 : 1 + random() * 0.8,
            fireball
        };
    };

    /** Vykreslí meteor: zužující se stopa, jasná hlava, náběh a dohasnutí. */
    const drawMeteor = (ctx, m, theme) => {
        const p = m.age / m.life;
        // Rychlý náběh, pomalejší dohasnutí.
        const brightness = p < 0.15 ? p / 0.15 : (1 - p) ** 1.4 / 0.85 ** 1.4;
        if (brightness <= 0) return;

        const speed = Math.hypot(m.vx, m.vy);
        const ux = m.vx / speed;
        const uy = m.vy / speed;
        const tail = m.length * Math.min(1, p * 3.5);
        const hx = m.x;
        const hy = m.y;
        const tx = hx - ux * tail;
        const ty = hy - uy * tail;
        const dark = theme === 'dark';
        const headRgb = m.fireball ? '210, 255, 225' : dark ? '255, 255, 255' : '150, 90, 255';
        const trailRgb = m.fireball ? '160, 230, 255' : dark ? '200, 215, 255' : '176, 77, 255';

        // Široká slabá záře pod stopou.
        const glow = ctx.createLinearGradient(hx, hy, tx, ty);
        glow.addColorStop(0, `rgba(${trailRgb}, ${0.22 * brightness})`);
        glow.addColorStop(1, `rgba(${trailRgb}, 0)`);
        ctx.strokeStyle = glow;
        ctx.lineWidth = m.width * 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Ostrá stopa.
        const trail = ctx.createLinearGradient(hx, hy, tx, ty);
        trail.addColorStop(0, `rgba(${headRgb}, ${brightness})`);
        trail.addColorStop(0.25, `rgba(${trailRgb}, ${0.55 * brightness})`);
        trail.addColorStop(1, `rgba(${trailRgb}, 0)`);
        ctx.strokeStyle = trail;
        ctx.lineWidth = m.width;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Hlava.
        const headR = m.width * (m.fireball ? 4 : 2.6);
        const head = ctx.createRadialGradient(hx, hy, 0, hx, hy, headR);
        head.addColorStop(0, `rgba(${headRgb}, ${brightness})`);
        head.addColorStop(1, `rgba(${headRgb}, 0)`);
        ctx.fillStyle = head;
        ctx.beginPath();
        ctx.arc(hx, hy, headR, 0, Math.PI * 2);
        ctx.fill();
    };


    /* ---------- Připojení k <div class="sky"> ---------- */

    const NEBULA_OVERSCAN = 1.1; // mlhovina je o 10 % větší, aby při posunu neukázala okraj
    const IDLE_FRAME_MS = 66; // ~15 fps na pomalé mihotání hvězd
    const MEAN_METEOR_GAP_S = 6.5;

    function mount(root) {
        const make = (className) => {
            const canvas = document.createElement('canvas');
            canvas.className = className;
            root.appendChild(canvas);
            return canvas;
        };
        const far = make('sky-nebula sky-nebula-far');
        const near = make('sky-nebula sky-nebula-near');
        const starsCanvas = make('sky-layer');
        const live = make('sky-layer');
        const liveCtx = live.getContext('2d');

        const theme = 'dark';
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const random = mulberry32((Date.now() & 0xffff) + 1);
        // Radiant roje – meteory letí šikmo dolů, celou relaci stejným směrem.
        const radiant = { angle: random() < 0.5 ? 0.62 : Math.PI - 0.62 };

        let stars = [];
        let width = 0;
        let height = 0;
        let dpr = 1;
        let meteors = [];
        let nextMeteorAt = performance.now() / 1000 + 1.5 + random() * 3;
        let lastTick = 0;
        let resizeTimer = 0;

        function build() {
            width = window.innerWidth;
            height = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            renderNebula(far, width * NEBULA_OVERSCAN, height * NEBULA_OVERSCAN, { theme, seed: 7, detail: 0.85 });
            renderNebula(near, width * NEBULA_OVERSCAN, height * NEBULA_OVERSCAN, { theme, seed: 23, detail: 1.6 });
            stars = generateStars(width, height, 42);
            renderStars(starsCanvas, stars, width, height, dpr, theme);
            live.width = Math.round(width * dpr);
            live.height = Math.round(height * dpr);
            liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function drawLive(t) {
            liveCtx.clearRect(0, 0, width, height);
            for (const s of stars) {
                if (s.twinkle) drawStar(liveCtx, s, width, height, reduceMotion ? s.alpha : twinkleAlpha(s, t), theme);
            }
            liveCtx.globalCompositeOperation = 'lighter';
            for (const m of meteors) drawMeteor(liveCtx, m, theme);
            liveCtx.globalCompositeOperation = 'source-over';
        }

        // Bez meteoru stačí pomalé mihotání přes časovač, plné snímky jen za letu.
        function schedule() {
            const t = performance.now() / 1000;
            if (meteors.length > 0 || nextMeteorAt - t < IDLE_FRAME_MS / 1000) {
                requestAnimationFrame(tick);
            } else {
                setTimeout(tick, IDLE_FRAME_MS);
            }
        }

        function tick() {
            if (document.hidden) {
                lastTick = 0;
                setTimeout(tick, 500);
                return;
            }
            const t = performance.now() / 1000;
            const dt = lastTick ? Math.min(0.1, t - lastTick) : 0;
            lastTick = t;

            if (t >= nextMeteorAt) {
                meteors.push(spawnMeteor(width, height, random, radiant));
                const gap = random() < 0.15
                    ? 0.3 + random() * 0.9
                    : Math.min(16, Math.max(2.5, -Math.log(1 - random()) * MEAN_METEOR_GAP_S));
                nextMeteorAt = t + gap;
            }
            for (const m of meteors) {
                m.age += dt;
                m.x += m.vx * dt;
                m.y += m.vy * dt;
            }
            meteors = meteors.filter((m) => m.age < m.life);

            drawLive(t);
            schedule();
        }

        build();
        if (reduceMotion) drawLive(0);
        else tick();

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                build();
                if (reduceMotion) drawLive(0);
            }, 200);
        });
    }

    document.querySelectorAll('.sky').forEach(mount);
})();
