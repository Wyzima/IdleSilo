// Scène dessinée en canvas : tous les silos sur une même image, un par vignette.
// Chaque vignette montre un silo en coupe, sa vis d'Archimède et son camion.
window.IdleSilo = window.IdleSilo || {};

(() => {
  'use strict';

  // Dimensions d'une vignette en unités de dessin (le sol est à y = 0).
  const UW = 840;            // largeur utile (le convoi exceptionnel tient dedans)
  const SKY = 320;           // hauteur au-dessus du sol
  const GROUND = 44;         // épaisseur du sol
  const UH = SKY + GROUND;
  const GAP = 10;            // espace entre vignettes (px)

  // Silo
  const SILO = { l: 30, r: 130, top: -238, coneTop: -104, out: -60, outL: 70, outR: 90 };
  // Vis : du pied du silo à l'aplomb de la benne
  const SCREW_A = { x: 86, y: -46 };
  const SCREW_B = { x: 366, y: -164 };
  const SCREW_LEN = Math.hypot(SCREW_B.x - SCREW_A.x, SCREW_B.y - SCREW_A.y);
  const SCREW_ANGLE = Math.atan2(SCREW_B.y - SCREW_A.y, SCREW_B.x - SCREW_A.x);
  const PITCH = 20;
  // Camion
  const TRUCK_X = 300;
  const BED_TOP = -88, BED_BOTTOM = -42, WHEEL_R = 15;

  // ---------- Couleurs ----------
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // amt > 0 éclaircit, amt < 0 assombrit
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = v => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // Ambiances du décor (personnalisation « Décor »)
  const BACKDROPS = {
    matin: { sky: ['#e9d7a8', '#f6ecd3', '#fbf6ea'], sun: '255,248,225', hills: '#d9d3c0', skyline: '#c9c3b2',
      ground: ['#8e8a82', '#6f6b64'], curb: '#b9b3a6', pad: '#c8c2b5', road: 'rgba(240,226,180,.85)', cloud: 'rgba(255,255,255,.55)' },
    midi: { sky: ['#6fa9e0', '#b3d4f0', '#e4f0f8'], sun: '255,255,255', hills: '#b5c7a3', skyline: '#a3adb8',
      ground: ['#8b8984', '#6a6864'], curb: '#bdb9b0', pad: '#cfcac0', road: 'rgba(255,255,255,.85)', cloud: 'rgba(255,255,255,.85)' },
    couchant: { sky: ['#4b3163', '#d9725a', '#f7c07a'], sun: '255,196,130', hills: '#8a5a5f', skyline: '#6a4658',
      ground: ['#6d6260', '#4a4341'], curb: '#8f817b', pad: '#a7968c', road: 'rgba(255,214,160,.8)', cloud: 'rgba(255,190,160,.45)' },
    hiver: { sky: ['#b9c9d8', '#dbe5ee', '#f3f6f9'], sun: '255,255,255', hills: '#f4f7fa', skyline: '#aeb9c4',
      ground: ['#e9eef2', '#c7d0d8'], curb: '#ffffff', pad: '#dfe5ea', road: 'rgba(150,165,180,.6)', cloud: 'rgba(255,255,255,.75)', snow: true },
    nuit: { sky: ['#0a1230', '#1b2a56', '#34406e'], sun: '220,230,255', hills: '#1c2640', skyline: '#121a30',
      ground: ['#3b3b40', '#232327'], curb: '#55555c', pad: '#4a4a52', road: 'rgba(255,220,120,.7)', cloud: 'rgba(200,210,255,.10)', stars: true, lights: true },
  };
  // Couleurs par défaut (écrasées par les personnalisations achetées)
  const DEFAULT_THEME = {
    bg: 'matin',
    truck: { bedTop: '#f1c555', bedBot: '#b8861a', rail: '#8a6412', cabTop: '#f3c650', cabBot: '#c99317', stripe: '#111111' },
    silo: { light: '#eceae4', dark: '#8a8d91', roofLight: '#e6e4de', roofDark: '#6c7075', ring: '#7d8187' },
    screw: { hi: '#c0303f', mid: '#8a1322', lo: '#4a0811', core: '#6d0d19' },
  };
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function createScene(canvas, hooks) {
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let dpr = 1, cssW = 0, cssH = 0;
    let availW = 0, availH = 0;
    // Logo Exventys pour les bennes (le fichier a une marge blanche en bas).
    const logo = new Image();
    let logoReady = false;
    logo.onload = () => { logoReady = true; };
    logo.src = 'img/logo-exventys.jpg';
    let layout = { cols: 1, tw: 0, th: 0, s: 1, cells: 0 };
    let tiles = [];          // [{x, y, w, h, kind: 'unit'|'pad', index}]
    let bgCache = null;      // fond d'une vignette, mis en cache
    let bgKey = '';
    let time = 0;
    let lastView = null;
    let T = DEFAULT_THEME;   // thème de couleurs en cours
    const units = [];        // état visuel de chaque silo (particules, phase de la vis…)
    const floaters = [];

    function unitFx(i) {
      if (!units[i]) {
        // Grains de texture du matériau dans le silo, tirés une fois pour toutes.
        const speckles = Array.from({ length: 90 }, () => ({
          x: rand(SILO.l + 2, SILO.r - 2), y: rand(SILO.top, SILO.out), r: rand(0.8, 1.8), k: rand(-0.25, 0.2),
        }));
        units[i] = { phase: 0, grains: [], falling: [], dust: [], spawn: 0, bump: 0, speckles, wheelTurn: 0 };
      }
      return units[i];
    }

    // ---------- Mise en page ----------
    function resize() {
      const parent = canvas.parentElement;
      const rect = parent.getBoundingClientRect();
      availW = Math.max(240, Math.floor(rect.width));
      // Sur mobile, le cadre prend la hauteur du dessin, dans la limite de son max-height.
      const maxH = parseFloat(getComputedStyle(parent).maxHeight);
      availH = Math.max(120, Math.floor(Number.isFinite(maxH) ? maxH : rect.height));
      relayout(layout.cells || 1, true);
    }

    // Choisit le nombre de colonnes qui donne les plus grandes vignettes
    // tout en faisant tenir toute la scène dans l'espace disponible.
    function relayout(cells, force) {
      if (!force && cells === layout.cells) return;
      let best = null;
      for (let cols = 1; cols <= cells; cols++) {
        const rows = Math.ceil(cells / cols);
        const tw = (availW - GAP * (cols - 1)) / cols;
        const th = (availH - GAP * (rows - 1)) / rows;
        const s = Math.min(1.15, tw / (UW + 28), th / UH);
        if (!best || s > best.s + 1e-6) best = { cols, rows, s };
      }
      const { cols, rows, s } = best;
      // Vignettes un peu plus larges que le dessin, sans dépasser la place.
      const tw = Math.min((availW - GAP * (cols - 1)) / cols, (UW + 28) * s * 1.35);
      const th = Math.floor(UH * s);
      cssW = Math.floor(cols * tw + GAP * (cols - 1));
      cssH = rows * th + GAP * (rows - 1);
      canvas.style.width = `${cssW}px`;
      layout = { cols, tw, th, s, cells };
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
      tiles = [];
      for (let i = 0; i < cells; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        tiles.push({ x: c * (tw + GAP), y: r * (th + GAP), w: tw, h: th });
      }
      bgKey = '';
    }

    // ---------- Fond (ciel, horizon industriel, sol) ----------
    function buildBackground(w, h, s) {
      const B = BACKDROPS[T.bg] || BACKDROPS.matin;
      const key = `${w}x${h}@${dpr}:${T.bg}`;
      if (key === bgKey) return;
      bgKey = key;
      bgCache = document.createElement('canvas');
      bgCache.width = Math.round(w * dpr);
      bgCache.height = Math.round(h * dpr);
      const g = bgCache.getContext('2d');
      g.scale(dpr, dpr);
      const groundY = h - GROUND * s;

      // Ciel
      const sky = g.createLinearGradient(0, 0, 0, groundY);
      sky.addColorStop(0, B.sky[0]);
      sky.addColorStop(0.55, B.sky[1]);
      sky.addColorStop(1, B.sky[2]);
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // Étoiles (tirage fixe pour que la vignette ne scintille pas)
      if (B.stars) {
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        g.fillStyle = 'rgba(255,255,255,.8)';
        for (let k = 0; k < 70; k++) g.fillRect(rnd() * w, rnd() * groundY * 0.75, 1.4, 1.4);
      }
      // Soleil (ou lune) diffus
      const sun = g.createRadialGradient(w * 0.82, groundY * 0.3, 0, w * 0.82, groundY * 0.3, 90 * s + 40);
      sun.addColorStop(0, `rgba(${B.sun},.95)`);
      sun.addColorStop(1, `rgba(${B.sun},0)`);
      g.fillStyle = sun;
      g.fillRect(0, 0, w, groundY);
      if (B.stars) {
        g.fillStyle = '#f4f1e0';
        g.beginPath(); g.arc(w * 0.82, groundY * 0.3, 14 * s + 4, 0, Math.PI * 2); g.fill();
      }

      // Collines lointaines
      g.fillStyle = B.hills;
      g.beginPath();
      g.moveTo(0, groundY);
      for (let x = 0; x <= w; x += 20) {
        g.lineTo(x, groundY - (38 + 16 * Math.sin(x / 70) + 10 * Math.sin(x / 23)) * s);
      }
      g.lineTo(w, groundY);
      g.fill();

      // Silhouettes d'usine : hangars, cheminées, silos lointains
      g.fillStyle = B.skyline;
      const base = groundY - 20 * s;
      const shapes = [
        [0.46, 80, 34], [0.53, 50, 58], [0.60, 110, 26], [0.71, 26, 70], [0.75, 60, 40], [0.9, 90, 30],
      ];
      for (const [fx, sw, sh] of shapes) {
        g.fillRect(w * fx, base - sh * s, sw * s, sh * s + 20 * s);
      }
      for (const fx of [0.585, 0.64, 0.88]) {
        g.fillRect(w * fx, base - 110 * s, 9 * s, 110 * s);
      }
      for (const fx of [0.79, 0.815, 0.84]) {
        const x = w * fx;
        g.fillRect(x, base - 64 * s, 16 * s, 64 * s);
        g.beginPath();
        g.ellipse(x + 8 * s, base - 64 * s, 8 * s, 5 * s, 0, Math.PI, 0);
        g.fill();
      }
      // Fenêtres éclairées la nuit
      if (B.lights) {
        g.fillStyle = 'rgba(255,214,120,.85)';
        for (const [fx, sw, sh] of shapes) {
          for (let k = 0; k < sw / 14; k++) g.fillRect(w * fx + (4 + k * 14) * s, base - sh * s + 8 * s, 5 * s, 4 * s);
        }
      }
      // Neige sur les toits
      if (B.snow) {
        g.fillStyle = '#ffffff';
        for (const [fx, sw, sh] of shapes) g.fillRect(w * fx - 2, base - sh * s - 3 * s, sw * s + 4, 4 * s);
      }

      // Sol : enrobé, bordure, marquage
      const gr = g.createLinearGradient(0, groundY, 0, h);
      gr.addColorStop(0, B.ground[0]);
      gr.addColorStop(1, B.ground[1]);
      g.fillStyle = gr;
      g.fillRect(0, groundY, w, h - groundY);
      g.fillStyle = B.curb;
      g.fillRect(0, groundY - 3 * s, w, 4 * s);
      g.fillStyle = B.road;
      for (let x = (TRUCK_X - 10) * s; x < w; x += 44 * s) {
        g.fillRect(x, groundY + 24 * s, 24 * s, 3 * s);
      }
      // Dalle béton sous le silo
      g.fillStyle = B.pad;
      g.fillRect(4 * s, groundY - 2 * s, 158 * s, 12 * s);
      g.fillStyle = 'rgba(0,0,0,.08)';
      g.fillRect(4 * s, groundY + 8 * s, 158 * s, 2 * s);
    }

    // ---------- Primitives de dessin (unités de dessin locales) ----------
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function steelGradient(x0, x1, light = '#eceae4', dark = '#8a8d91') {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, shade(dark, 0.15));
      g.addColorStop(0.22, light);
      g.addColorStop(0.55, shade(light, -0.12));
      g.addColorStop(1, dark);
      return g;
    }

    function siloPath() {
      ctx.beginPath();
      ctx.moveTo(SILO.l, SILO.top);
      ctx.lineTo(SILO.r, SILO.top);
      ctx.lineTo(SILO.r, SILO.coneTop);
      ctx.lineTo(SILO.outR, SILO.out);
      ctx.lineTo(SILO.outL, SILO.out);
      ctx.lineTo(SILO.l, SILO.coneTop);
      ctx.closePath();
    }

    function drawShadow(cx, w) {
      ctx.fillStyle = 'rgba(40,30,10,.18)';
      ctx.beginPath();
      ctx.ellipse(cx, 4, w / 2, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---------- Silo en coupe ----------
    function drawSilo(u, fx, selected) {
      const bump = fx.bump > 0 ? Math.sin((fx.bump / 0.18) * Math.PI) * 0.03 : 0;
      ctx.save();
      ctx.translate(80, 0);
      ctx.scale(1 + bump, 1 - bump);
      ctx.translate(-80, 0);

      drawShadow(80, 130);
      // Piètement et entretoises
      ctx.strokeStyle = '#4b4f55';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (const x of [36, 124]) { ctx.moveTo(x, SILO.coneTop); ctx.lineTo(x, 0); }
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(36, -86); ctx.lineTo(124, -20);
      ctx.moveTo(124, -86); ctx.lineTo(36, -20);
      ctx.moveTo(36, -52); ctx.lineTo(124, -52);
      ctx.stroke();

      // Intérieur sombre
      siloPath();
      const inner = ctx.createLinearGradient(SILO.l, 0, SILO.r, 0);
      inner.addColorStop(0, '#2c2f33');
      inner.addColorStop(0.5, '#4a4e54');
      inner.addColorStop(1, '#25282c');
      ctx.fillStyle = inner;
      ctx.fill();

      // Matière, avec un petit dôme en surface et une texture granuleuse
      const ratio = Math.max(0, Math.min(1, u.silo.ratio));
      if (ratio > 0.001) {
        ctx.save();
        siloPath();
        ctx.clip();
        const level = SILO.out - ratio * (SILO.out - SILO.top);
        const mg = ctx.createLinearGradient(SILO.l, 0, SILO.r, 0);
        mg.addColorStop(0, shade(u.silo.color, 0.12));
        mg.addColorStop(0.45, u.silo.color);
        mg.addColorStop(1, shade(u.silo.color, -0.3));
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.moveTo(SILO.l - 2, 10);
        ctx.lineTo(SILO.l - 2, level + 6);
        ctx.quadraticCurveTo(80, level - 10, SILO.r + 2, level + 6);
        ctx.lineTo(SILO.r + 2, 10);
        ctx.closePath();
        ctx.fill();
        for (const p of fx.speckles) {
          if (p.y < level + 4) continue;
          ctx.fillStyle = shade(u.silo.color, p.k);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Coque : bords en acier et ondulations de la tôle
      ctx.save();
      siloPath();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1.2;
      for (let y = SILO.top + 12; y < SILO.coneTop; y += 13) {
        ctx.beginPath(); ctx.moveTo(SILO.l, y); ctx.lineTo(SILO.r, y); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = steelGradient(SILO.l - 4, SILO.l + 10, T.silo.light, T.silo.dark);
      ctx.fillRect(SILO.l - 3, SILO.top, 10, SILO.coneTop - SILO.top);
      ctx.fillStyle = steelGradient(SILO.r - 8, SILO.r + 4, shade(T.silo.light, -0.1), shade(T.silo.dark, -0.2));
      ctx.fillRect(SILO.r - 7, SILO.top, 10, SILO.coneTop - SILO.top);
      // Cerclages
      ctx.fillStyle = T.silo.ring;
      for (const y of [SILO.top + 40, SILO.top + 90, SILO.coneTop - 4]) ctx.fillRect(SILO.l - 3, y, SILO.r - SILO.l + 6, 4);
      // Contour de la trémie
      ctx.strokeStyle = selected ? '#e5b034' : '#4b4f55';
      ctx.lineWidth = selected ? 4 : 2.5;
      siloPath();
      ctx.stroke();

      // Toit conique et évent
      const roof = ctx.createLinearGradient(SILO.l, 0, SILO.r, 0);
      roof.addColorStop(0, shade(T.silo.roofLight, -0.3));
      roof.addColorStop(0.3, T.silo.roofLight);
      roof.addColorStop(1, T.silo.roofDark);
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(SILO.l - 6, SILO.top + 2);
      ctx.lineTo(80, SILO.top - 30);
      ctx.lineTo(SILO.r + 6, SILO.top + 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = selected ? '#e5b034' : '#55595f';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.stroke();
      ctx.fillStyle = '#55595f';
      ctx.fillRect(74, SILO.top - 38, 12, 9);

      // Échelle à crinoline
      ctx.strokeStyle = '#5b5f65';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(SILO.r + 5, SILO.top); ctx.lineTo(SILO.r + 5, 0);
      ctx.moveTo(SILO.r + 13, SILO.top); ctx.lineTo(SILO.r + 13, 0);
      for (let y = SILO.top + 6; y < 0; y += 9) { ctx.moveTo(SILO.r + 5, y); ctx.lineTo(SILO.r + 13, y); }
      ctx.stroke();

      // Trappe de sortie
      ctx.fillStyle = '#3d4146';
      ctx.fillRect(SILO.outL + 2, SILO.out, SILO.outR - SILO.outL - 4, 14);

      // Plaque signalétique
      ctx.fillStyle = selected ? '#e5b034' : '#111';
      roundRect(46, -100, 68, 18, 3);
      ctx.fill();
      ctx.fillStyle = selected ? '#111' : '#e5b034';
      ctx.font = '600 13px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.name.toUpperCase(), 80, -90.5);
      ctx.restore();

      // Contenu du silo en texte
      ctx.font = '700 15px Roboto, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.fillStyle = '#1e2124';
      ctx.strokeText(u.silo.label, 80, SILO.top + 26);
      ctx.fillText(u.silo.label, 80, SILO.top + 26);

      // Invitation à cliquer quand le silo est vide
      if (ratio < 0.02 && !u.auto) {
        const k = reduced ? 1 : 1 + 0.06 * Math.sin(time * 6);
        ctx.save();
        ctx.translate(80, -170);
        ctx.scale(k, k);
        ctx.fillStyle = '#e5b034';
        roundRect(-48, -15, 96, 30, 15);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = '700 15px Roboto, Arial, sans-serif';
        ctx.fillText('Cliquez !', 0, 1);
        ctx.restore();
      }
    }

    // ---------- Alimentation automatique (convoyeur incliné vers le toit) ----------
    function drawFeeder(u) {
      if (!u.auto) return;
      const x0 = -24, y0 = -300, x1 = 76, y1 = SILO.top - 34;
      ctx.strokeStyle = '#6d7075';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = '#9ea2a7';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x1, y1 - 4); ctx.stroke();
      if (u.feeding) {
        ctx.strokeStyle = u.matColor;
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 9]);
        ctx.lineDashOffset = -time * 40;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineCap = 'butt';
      // Pylône
      ctx.strokeStyle = '#5b5f65';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(10, -284); ctx.lineTo(10, -238); ctx.stroke();
    }

    // ---------- Vis d'Archimède ----------
    function drawScrew(u, fx) {
      // Pieds de support
      ctx.strokeStyle = '#4b4f55';
      ctx.lineWidth = 4;
      for (const t of [0.45, 0.85]) {
        const x = SCREW_A.x + (SCREW_B.x - SCREW_A.x) * t;
        const y = SCREW_A.y + (SCREW_B.y - SCREW_A.y) * t;
        ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.lineTo(x, 0); ctx.stroke();
      }

      ctx.save();
      ctx.translate(SCREW_A.x, SCREW_A.y);
      ctx.rotate(SCREW_ANGLE);
      // Moteur
      const mg = ctx.createLinearGradient(0, -14, 0, 14);
      mg.addColorStop(0, '#6a6f75'); mg.addColorStop(1, '#2f3237');
      ctx.fillStyle = mg;
      roundRect(-32, -13, 30, 26, 4); ctx.fill();
      ctx.fillStyle = '#e5b034';
      ctx.fillRect(-28, -3, 22, 6);
      // Auge (arrière)
      ctx.fillStyle = 'rgba(70,72,76,.35)';
      roundRect(8, -18, SCREW_LEN - 8, 36, 5); ctx.fill();
      // Arbre
      const sg = ctx.createLinearGradient(0, -4, 0, 4);
      sg.addColorStop(0, '#dcdcdc'); sg.addColorStop(1, '#6e6e6e');
      ctx.fillStyle = sg;
      ctx.fillRect(-2, -3.5, SCREW_LEN + 16, 7);

      ctx.save();
      ctx.beginPath(); ctx.rect(10, -20, SCREW_LEN - 14, 40); ctx.clip();
      // Tube central
      ctx.fillStyle = T.screw.core;
      ctx.fillRect(10, -6, SCREW_LEN, 12);
      // Grains transportés
      for (const g of fx.grains) {
        ctx.fillStyle = g.c;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
      }
      // Spires : ellipses inclinées, décalées selon la rotation
      const off = fx.phase % PITCH;
      for (let x = -PITCH + off; x < SCREW_LEN + PITCH; x += PITCH) {
        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(-0.38);
        const fg = ctx.createLinearGradient(0, -16, 0, 16);
        fg.addColorStop(0, T.screw.hi); fg.addColorStop(0.5, T.screw.mid); fg.addColorStop(1, T.screw.lo);
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,200,.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 16, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // Bord avant de l'auge
      ctx.strokeStyle = '#8b8e93';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8, 18); ctx.lineTo(SCREW_LEN, 18); ctx.stroke();
      // Goulotte de sortie
      ctx.fillStyle = '#7d8187';
      ctx.fillRect(SCREW_LEN - 4, -10, 18, 20);
      ctx.restore();

      // Filet de matière qui tombe
      if (u.flowing) {
        ctx.fillStyle = u.silo.color;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(SCREW_B.x + 2, SCREW_B.y + 6, 6, fx.pileTop - SCREW_B.y - 6);
        ctx.globalAlpha = 1;
      }
    }

    // ---------- Camion ----------
    function truckLength(model) {
      return model.beds.reduce((a, w) => a + w, 0) + (model.beds.length - 1) * 12 + 60;
    }

    function drawWheel(x, turn) {
      ctx.fillStyle = '#1b1c1e';
      ctx.beginPath(); ctx.arc(x, -WHEEL_R, WHEEL_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9ea2a7';
      ctx.beginPath(); ctx.arc(x, -WHEEL_R, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#44484d';
      for (let k = 0; k < 5; k++) {
        const a = turn + (k * Math.PI * 2) / 5;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * 4.5, -WHEEL_R + Math.sin(a) * 4.5, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawTruck(u, fx) {
      const model = u.truck.model;
      const len = truckLength(model);
      // Départ et retour du camion quand la benne est pleine
      let dx = 0;
      if (u.truck.leaving > 0) {
        const p = 1 - u.truck.leaving / u.truck.rotation;
        if (p < 0.45) dx = easeInOut(p / 0.45) * (UW - TRUCK_X + 60);
        else if (p < 0.55) dx = UW;
        else dx = -(1 - easeInOut((p - 0.55) / 0.45)) * (TRUCK_X + len + 40);
        fx.wheelTurn += 0.25;
      }
      ctx.save();
      ctx.translate(dx, 0);
      drawShadow(TRUCK_X + len / 2, len + 20);

      let x = TRUCK_X;
      const ratio = Math.max(0, Math.min(1, u.truck.ratio));
      model.beds.forEach((w, i) => {
        if (i > 0) { ctx.fillStyle = '#2b2d30'; ctx.fillRect(x - 12, -38, 12, 5); }
        // Châssis
        ctx.fillStyle = '#2b2d30';
        ctx.fillRect(x - 4, BED_BOTTOM, w + 8, 12);
        // Tas de matière qui dépasse de la benne
        if (ratio > 0.001) {
          const hgt = 8 + ratio * 30;
          const peakX = i === 0 ? Math.min(SCREW_B.x + 5, x + w - 20) : x + w / 2;
          const hg = ctx.createLinearGradient(0, BED_TOP - hgt, 0, BED_TOP);
          hg.addColorStop(0, shade(u.truck.color, 0.15));
          hg.addColorStop(1, shade(u.truck.color, -0.2));
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.moveTo(x + 4, BED_TOP + 2);
          ctx.quadraticCurveTo(x + 10, BED_TOP - hgt * ratio, peakX, BED_TOP - hgt);
          ctx.quadraticCurveTo(x + w - 10, BED_TOP - hgt * ratio, x + w - 4, BED_TOP + 2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.2)';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (i === 0) fx.pileTop = BED_TOP - hgt + 4;
        } else if (i === 0) fx.pileTop = BED_TOP + 2;
        // Benne : panneau doré nervuré
        const bg = ctx.createLinearGradient(0, BED_TOP, 0, BED_BOTTOM);
        bg.addColorStop(0, T.truck.bedTop); bg.addColorStop(1, T.truck.bedBot);
        ctx.fillStyle = bg;
        ctx.fillRect(x, BED_TOP, w, BED_BOTTOM - BED_TOP);
        ctx.strokeStyle = 'rgba(0,0,0,.22)';
        ctx.lineWidth = 1.5;
        for (let rx = x + 16; rx < x + w - 6; rx += 18) {
          ctx.beginPath(); ctx.moveTo(rx, BED_TOP + 4); ctx.lineTo(rx, BED_BOTTOM - 3); ctx.stroke();
        }
        ctx.fillStyle = T.truck.rail;
        ctx.fillRect(x - 2, BED_TOP - 3, w + 4, 5);
        // Logo Exventys sur une plaque blanche au flanc de la benne
        if (logoReady) {
          const lw = Math.min(78, w - 24), lh = lw * 235 / 1020;
          const lx = x + (w - lw) / 2, ly = BED_TOP + (BED_BOTTOM - BED_TOP - lh) / 2 - 1;
          ctx.fillStyle = '#fff';
          roundRect(lx - 4, ly - 3, lw + 8, lh + 6, 2);
          ctx.fill();
          ctx.drawImage(logo, 0, 0, 1020, 235, lx, ly, lw, lh);
        }
        // Garde-boue et roues
        const axles = w >= 150 ? [x + 28, x + 62, x + w - 30] : [x + 28, x + 62];
        for (const ax of axles) {
          ctx.fillStyle = '#1f2124';
          ctx.fillRect(ax - 19, BED_BOTTOM + 10, 38, 5);
          drawWheel(ax, fx.wheelTurn);
        }
        x += w + 12;
      });

      // Cabine
      const c = x - 6;
      ctx.fillStyle = '#2b2d30';
      ctx.fillRect(c - 4, BED_BOTTOM, 62, 12);
      const cg = ctx.createLinearGradient(0, -104, 0, -30);
      cg.addColorStop(0, T.truck.cabTop); cg.addColorStop(1, T.truck.cabBot);
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(c, -30); ctx.lineTo(c, -100);
      ctx.lineTo(c + 30, -100); ctx.lineTo(c + 52, -70);
      ctx.lineTo(c + 56, -66); ctx.lineTo(c + 56, -30);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = T.truck.rail; ctx.lineWidth = 1.5; ctx.stroke();
      // Pare-brise avec reflet
      const wg = ctx.createLinearGradient(c + 10, -94, c + 48, -70);
      wg.addColorStop(0, '#dff0f7'); wg.addColorStop(0.5, '#9cc6d8'); wg.addColorStop(1, '#6d9fb6');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(c + 8, -94); ctx.lineTo(c + 28, -94); ctx.lineTo(c + 46, -72); ctx.lineTo(c + 8, -72);
      ctx.closePath(); ctx.fill();
      // Bande et phare
      ctx.fillStyle = T.truck.stripe;
      ctx.fillRect(c, -60, 56, 7);
      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(c + 50, -48, 6, 6);
      // Pot d'échappement
      ctx.fillStyle = '#55595f';
      ctx.fillRect(c - 3, -112, 4, 40);
      drawWheel(c + 34, fx.wheelTurn);
      ctx.restore();

      // Charge en texte au-dessus de la benne
      if (u.truck.leaving <= 0) {
        ctx.font = '700 14px Roboto, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.fillStyle = '#1e2124';
        const lx = TRUCK_X + model.beds[0] / 2 - 20;
        const ly = (fx.pileTop || BED_TOP) - 12;
        ctx.strokeText(u.truck.label, lx, ly);
        ctx.fillText(u.truck.label, lx, ly);
      }
    }

    // ---------- Particules ----------
    function stepParticles(u, fx, dt) {
      const speed = u.screwSpeed; // unités de dessin par seconde le long de la vis
      if (u.flowing) {
        fx.phase += speed * dt * 0.35;
        fx.spawn += dt * Math.min(30, 6 + speed / 12);
        while (fx.spawn >= 1) {
          fx.spawn -= 1;
          if (fx.grains.length < 50) fx.grains.push({ x: 12, y: rand(-2, 12), r: rand(1.4, 2.4), c: u.silo.color });
        }
      }
      for (let i = fx.grains.length - 1; i >= 0; i--) {
        const g = fx.grains[i];
        if (u.flowing) g.x += speed * dt;
        if (g.x > SCREW_LEN) {
          fx.grains.splice(i, 1);
          if (fx.falling.length < 40) {
            fx.falling.push({ x: SCREW_B.x + 5 + rand(-3, 3), y: SCREW_B.y + 8, vx: rand(-12, 12), vy: rand(10, 40), r: g.r, c: g.c });
          }
        }
      }
      const floor = u.truck.leaving > 0 ? 0 : (fx.pileTop || BED_TOP);
      for (let i = fx.falling.length - 1; i >= 0; i--) {
        const p = fx.falling[i];
        p.vy += 700 * dt; p.y += p.vy * dt; p.x += p.vx * dt;
        if (p.y >= floor) {
          if (Math.random() < 0.3 && fx.dust.length < 20) fx.dust.push({ x: p.x, y: floor, age: 0, life: rand(0.5, 0.9), vx: rand(-18, 18), c: p.c });
          fx.falling.splice(i, 1);
        }
      }
      for (let i = fx.dust.length - 1; i >= 0; i--) {
        const d = fx.dust[i];
        d.age += dt; d.x += d.vx * dt;
        if (d.age >= d.life) fx.dust.splice(i, 1);
      }
      if (fx.bump > 0) fx.bump = Math.max(0, fx.bump - dt);
    }

    function drawParticles(fx) {
      for (const p of fx.falling) {
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      for (const d of fx.dust) {
        const k = d.age / d.life;
        ctx.globalAlpha = (1 - k) * 0.4;
        ctx.fillStyle = d.c;
        ctx.beginPath(); ctx.arc(d.x, d.y - k * 16, 3 + k * 10, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---------- Emplacement du prochain silo ----------
    function drawPad(pad) {
      // Dalle et silhouette en pointillés
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = pad.ready ? '#b9870b' : 'rgba(60,60,60,.45)';
      ctx.lineWidth = 2.5;
      siloPath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(SILO.l - 6, SILO.top + 2); ctx.lineTo(80, SILO.top - 30); ctx.lineTo(SILO.r + 6, SILO.top + 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Balise de chantier
      ctx.fillStyle = '#111';
      ctx.fillRect(40, -40, 80, 10);
      ctx.fillStyle = '#e5b034';
      for (let k = 0; k < 4; k++) ctx.fillRect(42 + k * 20, -40, 10, 10);

      // Panneau d'information
      const k = pad.ready && !reduced ? 1 + 0.03 * Math.sin(time * 5) : 1;
      ctx.save();
      ctx.translate(430, -170);
      ctx.scale(k, k);
      ctx.fillStyle = pad.ready ? '#e5b034' : '#fff';
      ctx.strokeStyle = pad.ready ? '#8a6412' : 'rgba(0,0,0,.15)';
      ctx.lineWidth = 2;
      roundRect(-210, -62, 420, 124, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.font = '600 34px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.fillText(pad.title, 0, -20);
      ctx.font = '500 20px Roboto, Arial, sans-serif';
      ctx.fillText(pad.line, 0, 14);
      if (pad.progress != null) {
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        roundRect(-150, 32, 300, 10, 5); ctx.fill();
        ctx.fillStyle = '#b9870b';
        roundRect(-150, 32, 300 * Math.min(1, pad.progress), 10, 5); ctx.fill();
      }
      ctx.restore();
    }

    // ---------- Atelier d'injection (la « presse » à cliquer) ----------
    const press = { anim: 9, flying: [], landed: 0, bump: 0 };

    function drawPart(shape, color, x, y, r, rot = 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (shape === 'ring') {
        ctx.lineWidth = r * 0.45;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.stroke();
      } else if (shape === 'collet') {
        roundRect(-r * 0.5, -r, r, r * 2, 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(-1, -r, 2, r * 1.2);
      } else if (shape === 'scale') {
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      } else if (shape === 'disc') {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
      } else if (shape === 'profile') {
        roundRect(-r * 1.2, -r * 0.4, r * 2.4, r * 0.8, r * 0.4); ctx.fill();
      } else {
        roundRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6, 3); ctx.fill();
      }
      ctx.restore();
    }

    function drawPress(pv, dt) {
      press.anim += dt;
      // Fermeture du moule juste après le clic, puis ouverture
      const t = press.anim;
      let close = 0;
      if (t < 0.08) close = t / 0.08;
      else if (t < 0.16) close = 1;
      else if (t < 0.3) close = 1 - (t - 0.16) / 0.14;

      drawShadow(280, 520);
      // Bâti
      const cab = ctx.createLinearGradient(0, -82, 0, 0);
      cab.addColorStop(0, '#454a51'); cab.addColorStop(1, '#202327');
      ctx.fillStyle = cab;
      roundRect(30, -82, 500, 82, 4); ctx.fill();
      // Bande de signalisation
      ctx.save();
      roundRect(30, -64, 500, 10, 0); ctx.clip();
      for (let x = 20; x < 540; x += 20) {
        ctx.fillStyle = '#e5b034';
        ctx.beginPath(); ctx.moveTo(x, -54); ctx.lineTo(x + 10, -64); ctx.lineTo(x + 20, -64); ctx.lineTo(x + 10, -54); ctx.fill();
      }
      ctx.restore();
      // Pupitre de commande
      ctx.fillStyle = '#2b2e33';
      roundRect(440, -160, 70, 78, 4); ctx.fill();
      ctx.fillStyle = pv.clickFrenzy ? '#ffe28a' : '#9fe0a8';
      ctx.fillRect(448, -150, 54, 26);
      ctx.fillStyle = '#c2283f';
      ctx.beginPath(); ctx.arc(462, -106, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1f8f4a';
      ctx.beginPath(); ctx.arc(486, -106, 6, 0, Math.PI * 2); ctx.fill();

      // Unité de fermeture : vérin, colonnes, plateaux et moule
      const cyl = ctx.createLinearGradient(0, -158, 0, -104);
      cyl.addColorStop(0, '#c9cbcf'); cyl.addColorStop(0.5, '#f1f2f3'); cyl.addColorStop(1, '#7d8187');
      ctx.fillStyle = cyl;
      roundRect(40, -156, 80, 50, 6); ctx.fill();
      ctx.strokeStyle = '#9ea2a7';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(110, -166); ctx.lineTo(330, -166);
      ctx.moveTo(110, -96); ctx.lineTo(330, -96);
      ctx.stroke();
      const mx = 150 + close * 70;
      ctx.fillStyle = '#5b5f65';
      ctx.fillRect(120, -134, mx - 120, 8); // tige du vérin
      ctx.fillStyle = '#3d4146';
      ctx.fillRect(mx, -182, 20, 100);      // plateau mobile
      ctx.fillRect(300, -182, 20, 100);     // plateau fixe
      const mold = ctx.createLinearGradient(0, -170, 0, -94);
      mold.addColorStop(0, '#f3c650'); mold.addColorStop(1, '#b8861a');
      ctx.fillStyle = mold;
      ctx.fillRect(mx + 20, -164, 30, 64);  // demi-moule mobile
      ctx.fillRect(270, -164, 30, 64);      // demi-moule fixe
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(268, -140, 4, 16);

      // Unité d'injection : fourreau chauffé, moteur, trémie de granulés
      const barrel = ctx.createLinearGradient(0, -142, 0, -116);
      barrel.addColorStop(0, '#d9dadc'); barrel.addColorStop(1, '#6d7075');
      ctx.fillStyle = barrel;
      ctx.fillRect(320, -142, 170, 26);
      ctx.fillStyle = '#c2552f';
      for (let x = 340; x < 480; x += 30) ctx.fillRect(x, -144, 14, 30);
      ctx.fillStyle = '#2f3237';
      roundRect(488, -154, 44, 50, 4); ctx.fill();
      ctx.fillStyle = '#9ea2a7';
      ctx.beginPath();
      ctx.moveTo(452, -222); ctx.lineTo(500, -222); ctx.lineTo(484, -168); ctx.lineTo(468, -168);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pv.partColor;
      ctx.beginPath();
      ctx.moveTo(456, -210); ctx.lineTo(496, -210); ctx.lineTo(484, -172); ctx.lineTo(468, -172);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5b5f65';
      ctx.fillRect(472, -168, 8, 26);

      // Bac de pièces
      ctx.fillStyle = '#6d7075';
      ctx.fillRect(590, -58, 130, 58);
      ctx.fillStyle = '#8b8f94';
      ctx.fillRect(586, -62, 138, 8);
      const heap = Math.min(34, 6 + Math.log2(press.landed + 1) * 3.2);
      ctx.fillStyle = pv.partColor;
      ctx.beginPath();
      ctx.moveTo(594, -60);
      ctx.quadraticCurveTo(655, -60 - heap * 2, 716, -60);
      ctx.closePath(); ctx.fill();

      // Pièces éjectées vers le bac
      for (let i = press.flying.length - 1; i >= 0; i--) {
        const f = press.flying[i];
        f.vy += 900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += 8 * dt;
        if (f.y > -62 && f.x > 590) { press.flying.splice(i, 1); press.landed++; continue; }
        drawPart(pv.partShape, pv.partColor, f.x, f.y, 9, f.rot);
      }

      // Panneau d'information
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.lineWidth = 1.5;
      roundRect(560, -300, 260, 150, 8); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#111';
      ctx.font = '600 24px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.fillText("ATELIER D'INJECTION", 576, -270);
      drawPart(pv.partShape, pv.partColor, 588, -243, 8);
      ctx.font = '500 15px Roboto, Arial, sans-serif';
      ctx.fillStyle = '#32373c';
      ctx.fillText(pv.partName, 604, -238);
      ctx.font = '700 26px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.fillStyle = pv.clickFrenzy ? '#c2283f' : '#9a6d05';
      ctx.fillText(`+${pv.valueLabel} / clic`, 576, -206);
      // Jauge de cadence
      ctx.fillStyle = '#ece8df';
      roundRect(576, -188, 150, 14, 7); ctx.fill();
      const cg = ctx.createLinearGradient(576, 0, 726, 0);
      cg.addColorStop(0, '#e5b034'); cg.addColorStop(1, '#c2283f');
      ctx.fillStyle = cg;
      roundRect(576, -188, Math.max(14, 150 * pv.comboRatio), 14, 7); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '600 22px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.fillText(`×${pv.comboLabel}`, 736, -174);
      ctx.font = '500 12px Roboto, Arial, sans-serif';
      ctx.fillStyle = '#6b6860';
      ctx.fillText('CADENCE', 576, -160);

      // Invitation à cliquer
      if (pv.idle > 4) {
        const k = reduced ? 1 : 1 + 0.06 * Math.sin(time * 6);
        ctx.save();
        ctx.translate(230, -225);
        ctx.scale(k, k);
        ctx.fillStyle = '#e5b034';
        roundRect(-110, -18, 220, 36, 18); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.font = '700 17px Roboto, Arial, sans-serif';
        ctx.fillText('Cliquez sur la presse !', 0, 6);
        ctx.restore();
      }
      if (pv.clickFrenzy) {
        ctx.strokeStyle = `rgba(229,176,52,${0.5 + 0.4 * Math.sin(time * 8)})`;
        ctx.lineWidth = 6;
        roundRect(24, -190, 516, 196, 8); ctx.stroke();
      }
    }

    // ---------- Camion doré (bonus à attraper) ----------
    function goldenX(p) { return -170 + p * (UW + 340); }

    function drawGolden(gv) {
      const x = goldenX(gv.p), y = 26;
      ctx.save();
      ctx.translate(x, y);
      // Halo et rayons
      const halo = ctx.createRadialGradient(0, -34, 5, 0, -34, 110);
      halo.addColorStop(0, 'rgba(255,230,140,.75)');
      halo.addColorStop(1, 'rgba(255,230,140,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, -34, 110, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,90,.6)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 10; k++) {
        const a = time * 1.5 + (k * Math.PI) / 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 60, -34 + Math.sin(a) * 60);
        ctx.lineTo(Math.cos(a) * 90, -34 + Math.sin(a) * 90);
        ctx.stroke();
      }
      // Fourgon doré
      const body = ctx.createLinearGradient(0, -70, 0, -12);
      body.addColorStop(0, '#fff1b0'); body.addColorStop(0.5, '#f0c23c'); body.addColorStop(1, '#a8780c');
      ctx.fillStyle = body;
      roundRect(-62, -68, 92, 54, 5); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(30, -60); ctx.lineTo(52, -60); ctx.lineTo(68, -36); ctx.lineTo(68, -14); ctx.lineTo(30, -14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#bfe3f2';
      ctx.beginPath(); ctx.moveTo(36, -55); ctx.lineTo(50, -55); ctx.lineTo(62, -37); ctx.lineTo(36, -37); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '700 18px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PRIME !', -16, -34);
      for (const wx of [-38, 44]) {
        ctx.fillStyle = '#1b1c1e';
        ctx.beginPath(); ctx.arc(wx, -12, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f0c23c';
        ctx.beginPath(); ctx.arc(wx, -12, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    function drawFloaters(key) {
      for (const f of floaters) {
        if (f.unit !== key) continue;
        const k = f.age / 1.1;
        ctx.globalAlpha = 1 - k;
        ctx.font = `700 ${f.big ? 30 : 22}px Roboto, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#9a6d05';
        ctx.strokeText(f.text, f.x, f.y - k * 50);
        ctx.fillText(f.text, f.x, f.y - k * 50);
        ctx.globalAlpha = 1;
      }
    }

    // ---------- Vignettes ----------
    function drawTile(tile, index, view, dt) {
      const s = layout.s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tile.x, tile.y, tile.w, tile.h);
      ctx.clip();
      ctx.drawImage(bgCache, tile.x, tile.y, tile.w, tile.h);

      // Nuages qui dérivent lentement
      ctx.fillStyle = (BACKDROPS[T.bg] || BACKDROPS.matin).cloud;
      for (let k = 0; k < 3; k++) {
        const cx = tile.x + ((time * (6 + k * 3) + k * 290 + index * 170) % (tile.w + 200)) - 100;
        const cy = tile.y + (24 + k * 22) * s + 8;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 46 * s + 10, 11 * s + 3, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 26 * s, cy - 6 * s, 28 * s + 6, 10 * s + 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.translate(tile.x + 14 * s, tile.y + tile.h - GROUND * s);
      ctx.scale(s, s);

      if (tile.kind === 'pad') {
        drawPad(view.pad);
      } else if (tile.kind === 'press') {
        drawPress(view.press, dt);
        drawFloaters('press');
      } else {
        const u = view.units[tile.index];
        const fx = unitFx(tile.index);
        if (!reduced) stepParticles(u, fx, dt);
        else if (fx.bump > 0) fx.bump = Math.max(0, fx.bump - dt);
        drawFeeder(u);
        drawTruck(u, fx);
        drawScrew(u, fx);
        drawSilo(u, fx, u.selected);
        drawParticles(fx);
        drawFloaters(tile.index);
      }
      if (view.golden && view.golden.tile === index) drawGolden(view.golden);
      ctx.restore();

      // Cadre : doré pour le silo sélectionné
      const selected = tile.kind === 'unit' && view.units[tile.index].selected;
      ctx.strokeStyle = selected ? '#e5b034' : 'rgba(0,0,0,.12)';
      ctx.lineWidth = selected ? 4 : 1;
      ctx.strokeRect(tile.x + ctx.lineWidth / 2, tile.y + ctx.lineWidth / 2, tile.w - ctx.lineWidth, tile.h - ctx.lineWidth);
      if (selected && layout.cells > 1) {
        const fs = Math.max(10, Math.min(15, 24 * layout.s));
        const text = `${view.units[tile.index].name.toUpperCase()} · SÉLECTIONNÉ`;
        ctx.font = `600 ${fs}px "Barlow Condensed", "Roboto Condensed", Arial, sans-serif`;
        const bw = ctx.measureText(text).width + fs;
        ctx.fillStyle = '#e5b034';
        ctx.fillRect(tile.x, tile.y, bw, fs * 1.7);
        ctx.fillStyle = '#111';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tile.x + fs / 2, tile.y + fs * 0.9);
        ctx.textBaseline = 'alphabetic';
      }
    }

    function draw(view, dt) {
      lastView = view;
      time += dt;
      T = view.theme || DEFAULT_THEME;
      // Vignettes : l'atelier d'injection, puis les silos, puis l'emplacement libre
      const cells = 1 + view.units.length + (view.pad ? 1 : 0);
      relayout(cells, false);
      buildBackground(layout.tw, layout.th, layout.s);
      tiles.forEach((t, i) => {
        if (i === 0) { t.kind = 'press'; t.index = -1; }
        else if (i - 1 < view.units.length) { t.kind = 'unit'; t.index = i - 1; }
        else { t.kind = 'pad'; t.index = -1; }
      });
      for (let i = floaters.length - 1; i >= 0; i--) {
        floaters[i].age += dt;
        if (floaters[i].age > 1.1) floaters.splice(i, 1);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      tiles.forEach((t, i) => drawTile(t, i, view, dt));
    }

    // ---------- Interaction ----------
    function localPoint(e, tile) {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const s = layout.s;
      return { x: (px - tile.x - 14 * s) / s, y: (py - (tile.y + tile.h - GROUND * s)) / s };
    }

    function hitTile(e) {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      return tiles.find(t => px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h);
    }

    const onSilo = p => p.x >= SILO.l - 10 && p.x <= SILO.r + 16 && p.y >= SILO.top - 40 && p.y <= 0;

    canvas.addEventListener('click', e => {
      const tile = hitTile(e);
      if (!tile) return;
      const p = localPoint(e, tile);
      // Le camion doré passe avant tout le reste
      const gv = lastView && lastView.golden;
      if (gv && tiles[gv.tile] === tile) {
        const gx = goldenX(gv.p);
        if (Math.abs(p.x - (gx + 3)) < 100 && p.y > -120 && p.y < 50) { hooks.onGolden(); return; }
      }
      if (tile.kind === 'pad') { hooks.onPad(); return; }
      if (tile.kind === 'press') { hooks.onPress(p); return; }
      hooks.onUnit(tile.index, onSilo(p), p);
    });
    canvas.addEventListener('mousemove', e => {
      const tile = hitTile(e);
      let pointer = false;
      if (tile && tile.kind === 'pad') pointer = !!(lastView && lastView.pad && lastView.pad.ready);
      else if (tile) pointer = true;
      canvas.style.cursor = pointer ? 'pointer' : 'default';
    });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
    window.addEventListener('resize', resize);
    resize();

    return {
      draw,
      bump(i) { unitFx(i).bump = 0.18; },
      // Clic sur la presse : le moule se ferme et une pièce est éjectée vers le bac.
      pressHit(text, big) {
        press.anim = 0;
        if (press.flying.length < 25) press.flying.push({ x: 262, y: -128, vx: rand(260, 380), vy: rand(-380, -260), rot: 0 });
        floaters.push({ unit: 'press', text, age: 0, x: 260 + rand(-30, 30), y: -200, big });
      },
      floater(i, where, text) {
        const pos = where === 'truck' ? { x: TRUCK_X + 90, y: -130 } : { x: 80, y: -200 };
        floaters.push({ unit: i, text, age: 0, ...pos });
      },
      reset() { units.length = 0; floaters.length = 0; press.landed = 0; press.flying.length = 0; },
    };
  }

  window.IdleSilo.createScene = createScene;
})();
