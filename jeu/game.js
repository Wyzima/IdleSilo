(() => {
  'use strict';

  const SAVE_KEY = 'idle-silo-save-v1';
  const OFFLINE_CAP_SECONDS = 8 * 3600;
  const TRUCK_ROTATION_SECONDS = 3;
  const BUILDING_COST_GROWTH = 1.15;

  // ---------- Données du jeu ----------

  // Trente matériaux en vrac courants dans l'industrie.
  // Le prix de vente (€/t) est une valeur de jeu, pas un cours réel.
  const MATERIALS = [
    ['sable', 'Sable', '#d8c08a'],
    ['gravier', 'Gravier', '#9b9b9b'],
    ['calcaire', 'Calcaire concassé', '#dcd6c6'],
    ['argile', 'Argile', '#b5693c'],
    ['sel', 'Sel de déneigement', '#f0f0f0'],
    ['charbon', 'Charbon', '#2b2b2b'],
    ['ciment', 'Ciment', '#a7a9ac'],
    ['chaux', 'Chaux vive', '#efece2'],
    ['platre', 'Plâtre', '#f6f3ea'],
    ['fer', 'Minerai de fer', '#7b3b2a'],
    ['ble', 'Blé', '#e0b54a'],
    ['orge', 'Orge', '#d4b06a'],
    ['mais', 'Maïs', '#f2c12e'],
    ['soja', 'Soja', '#e4cf8f'],
    ['colza', 'Colza', '#3b2a1e'],
    ['tournesol', 'Graines de tournesol', '#444444'],
    ['riz', 'Riz', '#f4eee0'],
    ['farine', 'Farine', '#fbf7ef'],
    ['sucre', 'Sucre', '#ffffff'],
    ['bois', 'Granulés de bois', '#b8864b'],
    ['npk', 'Engrais NPK', '#8fb3d9'],
    ['uree', 'Urée', '#f7f7f7'],
    ['alumine', 'Alumine', '#e3e3ec'],
    ['verre', 'Billes de verre', '#cfe8ea'],
    ['pvc', 'Granulés PVC', '#e6e6e6'],
    ['pehd', 'Granulés PEHD', '#9fc5e8'],
    ['pp', 'Granulés PP', '#f6d365'],
    ['epdm', 'Granulés EPDM', '#222222'],
    ['cafe', 'Café vert', '#8a9a5b'],
    ['cacao', 'Fèves de cacao', '#5a3825'],
  ].map(([id, name, color], i) => ({
    id, name, color,
    price: roundNice(10 * Math.pow(1.32, i)),
    unlockCost: i === 0 ? 0 : roundNice(250 * Math.pow(2.05, i - 1)),
  }));

  // Améliorations de la ligne principale (niveaux).
  const EQUIPMENT = [
    { id: 'silo', name: 'Silo agrandi', maxLevel: 40,
      cost: l => 30 * Math.pow(2.2, l),
      effect: l => `Capacité ${fmtT(siloCapacity(l))} → ${fmtT(siloCapacity(l + 1))}` },
    { id: 'vis', name: "Moteur de vis d'Archimède", maxLevel: 40,
      cost: l => 40 * Math.pow(1.9, l),
      effect: l => `Débit ${fmtT(screwRate(l))}/s → ${fmtT(screwRate(l + 1))}/s` },
    { id: 'camion', name: 'Camion plus grand', maxLevel: 40,
      cost: l => 80 * Math.pow(2.3, l),
      effect: l => `Benne ${fmtT(truckCapacity(l))} → ${fmtT(truckCapacity(l + 1))}` },
    { id: 'auto', name: 'Remplissage automatique', maxLevel: 6,
      cost: l => 400 * Math.pow(4, l),
      effect: l => l === 0
        ? `Le silo se remplit seul ${fmtS(autoDelay(1))} après s'être vidé`
        : `Délai ${fmtS(autoDelay(l))} → ${fmtS(autoDelay(l + 1))}` },
  ];

  const siloCapacity = l => 5 * Math.pow(1.5, l);
  const screwRate = l => 0.5 * Math.pow(1.35, l);
  const truckCapacity = l => 10 * Math.pow(1.6, l);
  const autoDelay = l => (l <= 0 ? Infinity : 10 * Math.pow(0.6, l - 1));

  // Lignes automatiques : production passive (t/s) vendue au prix du matériau choisi.
  const LINES = [
    { id: 'convoyeur', name: 'Convoyeur à bande', cost: 60, rate: 0.1 },
    { id: 'vis2', name: 'Vis sans fin secondaire', cost: 700, rate: 0.8 },
    { id: 'tremie', name: 'Trémie vibrante', cost: 8000, rate: 5 },
    { id: 'archimedys', name: 'Ligne Archimedys™', cost: 9e4, rate: 30 },
    { id: 'vrac', name: 'Plateforme de vrac', cost: 1e6, rate: 180 },
    { id: 'port', name: 'Terminal portuaire', cost: 1.2e7, rate: 1000 },
    { id: 'reseau', name: 'Réseau logistique européen', cost: 1.5e8, rate: 6000 },
    { id: 'hub', name: "Centre d'ingénierie Exventys", cost: 2e9, rate: 35000 },
  ];

  // ---------- État ----------

  function freshState() {
    return {
      money: 0,
      totalEarned: 0,
      totalTons: 0,
      trucks: 0,
      clicks: 0,
      material: 'sable',
      unlocked: ['sable'],
      levels: Object.fromEntries(EQUIPMENT.map(e => [e.id, 0])),
      lines: Object.fromEntries(LINES.map(l => [l.id, 0])),
      silo: 0,            // tonnes dans le silo
      siloPrice: 10,      // €/t de la matière dans le silo
      siloColor: MATERIALS[0].color,
      truckLoad: 0,       // tonnes dans la benne
      truckValue: 0,      // € que rapportera la benne
      truckColor: MATERIALS[0].color,
      leaving: 0,         // secondes restantes avant retour du camion
      emptyFor: 0,        // secondes depuis que le silo est vide
      lastSaved: Date.now(),
    };
  }

  function load() {
    const base = freshState();
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return base;
      return {
        ...base, ...data,
        levels: { ...base.levels, ...data.levels },
        lines: { ...base.lines, ...data.lines },
      };
    } catch {
      return base;
    }
  }

  function save() {
    state.lastSaved = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
  }

  let state = load();

  const material = () => MATERIALS.find(m => m.id === state.material) || MATERIALS[0];
  const lineCost = l => Math.ceil(l.cost * Math.pow(BUILDING_COST_GROWTH, state.lines[l.id]));
  const passiveTons = () => LINES.reduce((s, l) => s + l.rate * state.lines[l.id], 0);
  const passiveIncome = () => passiveTons() * material().price;

  function earn(euros, tons) {
    state.money += euros;
    state.totalEarned += euros;
    state.totalTons += tons;
  }

  // ---------- Formatage ----------

  function roundNice(n) {
    if (n < 100) return Math.round(n);
    const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  }

  const SUFFIXES = ['', '', ' M', ' Md', ' Bn', ' Bd', ' Tn', ' Td'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 10 && n % 1) return n.toFixed(1).replace('.', ',');
    if (n < 1e6) return Math.floor(n + 1e-6).toLocaleString('fr-FR');
    const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
    return (n / Math.pow(1000, tier)).toFixed(2).replace('.', ',') + SUFFIXES[tier];
  }
  const fmtE = n => `${fmt(n)} €`;
  const fmtT = n => `${fmt(n)} t`;
  const fmtS = n => `${n.toFixed(1).replace('.', ',')} s`;

  // ---------- Éléments ----------

  const $ = id => document.getElementById(id);
  const ui = {
    money: $('money'), income: $('income'), trucks: $('trucks'), tonnage: $('tonnage'),
    scene: $('scene'), silo: $('silo'), siloFill: $('silo-fill'), siloLabel: $('silo-label'),
    prompt: $('silo-prompt'), flights: $('flights'), stream: $('stream'),
    truck: $('truck'), pile: $('pile'), truckLabel: $('truck-label'),
    curMat: $('current-material'), curPrice: $('current-price'), screwRate: $('screw-rate'),
    autoStatus: $('auto-status'),
    equip: $('equip-list'), lines: $('lines-list'), materials: $('materials-list'),
    toast: $('toast'), reset: $('reset'),
  };

  // Spires de la vis, dessinées une fois puis animées en translation.
  (function drawFlights() {
    const ns = 'http://www.w3.org/2000/svg';
    for (let x = -8; x <= 500; x += 32) {
      const e = document.createElementNS(ns, 'ellipse');
      e.setAttribute('cx', x);
      e.setAttribute('cy', 0);
      e.setAttribute('rx', 7);
      e.setAttribute('ry', 24);
      e.setAttribute('transform', `rotate(-22 ${x} 0)`);
      ui.flights.appendChild(e);
    }
  })();

  // ---------- Actions ----------

  function refillSilo(manual) {
    const cap = siloCapacity(state.levels.silo);
    const added = cap - state.silo;
    if (added <= 0.0001) return 0;
    const m = material();
    // Mélange : le prix moyen du silo tient compte de ce qui restait.
    state.siloPrice = (state.silo * state.siloPrice + added * m.price) / cap;
    state.silo = cap;
    state.siloColor = m.color;
    state.emptyFor = 0;
    if (manual) state.clicks++;
    return added;
  }

  function onSiloClick(e) {
    const added = refillSilo(true);
    ui.silo.classList.remove('bump');
    void ui.silo.getBBox();
    ui.silo.classList.add('bump');
    if (added > 0) floater(e, `+${fmtT(added)}`);
    renderScene();
  }

  ui.silo.addEventListener('click', onSiloClick);
  ui.silo.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSiloClick(e); }
  });

  function floater(e, text) {
    const ns = 'http://www.w3.org/2000/svg';
    let x = 150, y = 150;
    if (e && e.clientX) {
      const pt = ui.scene.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(ui.scene.getScreenCTM().inverse());
      x = p.x; y = p.y;
    }
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('class', 'floater');
    t.textContent = text;
    ui.scene.appendChild(t);
    t.addEventListener('animationend', () => t.remove());
  }

  function buyEquipment(eq) {
    const lvl = state.levels[eq.id];
    const cost = eq.cost(lvl);
    if (lvl >= eq.maxLevel || state.money < cost) return;
    state.money -= cost;
    state.levels[eq.id]++;
    if (eq.id === 'auto' && lvl === 0) toast('Remplissage automatique activé !');
    renderShop(true);
  }

  function buyLine(line) {
    const cost = lineCost(line);
    if (state.money < cost) return;
    state.money -= cost;
    state.lines[line.id]++;
    if (state.lines[line.id] === 1) toast(`Nouvelle ligne : ${line.name}`);
    renderShop(true);
  }

  function selectMaterial(m) {
    if (!state.unlocked.includes(m.id)) {
      if (state.money < m.unlockCost) return;
      state.money -= m.unlockCost;
      state.unlocked.push(m.id);
      toast(`Matériau débloqué : ${m.name} (${fmtE(m.price)}/t)`);
    }
    state.material = m.id;
    renderShop(true);
  }

  ui.reset.addEventListener('click', () => {
    if (!confirm('Effacer votre progression et recommencer ?')) return;
    state = freshState();
    save();
    renderShop(true);
  });

  // Onglets de la boutique
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b === btn));
      document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    });
  });

  let toastTimer;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3500);
  }

  // ---------- Simulation ----------

  let flowing = false;

  function step(dt) {
    // Production passive des lignes automatiques.
    const pt = passiveTons() * dt;
    if (pt > 0) earn(pt * material().price, pt);

    // Remplissage automatique quand le silo est vide.
    if (state.silo <= 0.0001) {
      state.emptyFor += dt;
      if (state.emptyFor >= autoDelay(state.levels.auto)) refillSilo(false);
    }

    // Rotation du camion.
    if (state.leaving > 0) {
      state.leaving = Math.max(0, state.leaving - dt);
      flowing = false;
      return;
    }

    // La vis transfère du silo vers la benne.
    const cap = truckCapacity(state.levels.camion);
    const flow = Math.min(screwRate(state.levels.vis) * dt, state.silo, cap - state.truckLoad);
    flowing = flow > 0;
    if (flowing) {
      state.silo -= flow;
      state.truckLoad += flow;
      state.truckValue += flow * state.siloPrice;
      state.truckColor = state.siloColor;
    }

    if (state.truckLoad >= cap - 1e-6) departTruck();
  }

  function departTruck() {
    earn(state.truckValue, state.truckLoad);
    state.trucks++;
    const value = state.truckValue;
    state.truckLoad = 0;
    state.truckValue = 0;
    state.leaving = TRUCK_ROTATION_SECONDS;
    ui.truck.style.setProperty('--leave', `${TRUCK_ROTATION_SECONDS}s`);
    ui.truck.classList.remove('leaving');
    void ui.truck.getBBox();
    ui.truck.classList.add('leaving');
    floaterAt(640, 250, `+${fmtE(value)}`);
  }

  function floaterAt(x, y, text) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('class', 'floater');
    t.textContent = text;
    ui.scene.appendChild(t);
    t.addEventListener('animationend', () => t.remove());
  }

  // ---------- Rendu ----------

  const SILO_TOP = 60, SILO_BOTTOM = 340;
  let lastScrewSpeed = -1;

  function renderScene() {
    const cap = siloCapacity(state.levels.silo);
    const ratio = Math.min(state.silo / cap, 1);
    const h = ratio * (SILO_BOTTOM - SILO_TOP);
    ui.siloFill.setAttribute('y', SILO_BOTTOM - h);
    ui.siloFill.setAttribute('height', h);
    ui.siloFill.setAttribute('fill', state.siloColor);
    ui.siloLabel.textContent = `${fmt(state.silo)} / ${fmtT(cap)}`;
    ui.prompt.classList.toggle('off', state.silo > 0.0001);

    // Pile dans la benne : un tas triangulaire qui grandit.
    const tCap = truckCapacity(state.levels.camion);
    const tr = Math.min(state.truckLoad / tCap, 1);
    const peak = 334 - tr * 70;
    const shoulder = 334 - tr * 40;
    ui.pile.setAttribute('d',
      `M530 334 L530 ${shoulder} L631 ${peak} L702 ${shoulder} L702 334 Z`);
    ui.pile.setAttribute('fill', state.truckColor);
    ui.truckLabel.textContent = `${fmt(state.truckLoad)} / ${fmtT(tCap)}`;
    ui.truckLabel.setAttribute('y', Math.min(312, peak - 8));

    ui.stream.classList.toggle('on', flowing);
    ui.stream.setAttribute('fill', state.siloColor);

    // Vitesse d'animation de la vis proportionnelle au débit (bornée).
    ui.flights.classList.toggle('running', flowing);
    const speed = Math.max(0.15, Math.min(1.2, 0.6 / screwRate(state.levels.vis)));
    if (Math.abs(speed - lastScrewSpeed) > 0.01) {
      ui.flights.style.animationDuration = `${speed}s`;
      lastScrewSpeed = speed;
    }
  }

  function renderStats() {
    ui.money.textContent = fmtE(state.money);
    ui.income.textContent = `${fmtE(passiveIncome())}/s`;
    ui.trucks.textContent = fmt(state.trucks);
    ui.tonnage.textContent = fmtT(state.totalTons);
    const m = material();
    ui.curMat.textContent = m.name;
    ui.curPrice.textContent = `${fmtE(m.price)}/t`;
    ui.screwRate.textContent = `${fmtT(screwRate(state.levels.vis))}/s`;
    const lvl = state.levels.auto;
    ui.autoStatus.textContent = lvl > 0 ? `· Remplissage auto (${fmtS(autoDelay(lvl))})` : '';
  }

  // La boutique est construite une fois, puis seuls textes et états sont mis à jour.
  function itemButton(onClick) {
    const li = document.createElement('li');
    li.innerHTML = `<button class="item" type="button">
      <span class="name"></span><span class="level"></span>
      <span class="effect"></span><span class="cost"></span></button>`;
    const btn = li.firstElementChild;
    btn.addEventListener('click', onClick);
    return { li, btn, name: btn.querySelector('.name'), level: btn.querySelector('.level'),
      effect: btn.querySelector('.effect'), cost: btn.querySelector('.cost') };
  }

  const equipRows = EQUIPMENT.map(eq => {
    const r = itemButton(() => buyEquipment(eq));
    r.name.textContent = eq.name;
    ui.equip.appendChild(r.li);
    return r;
  });

  const lineRows = LINES.map(line => {
    const r = itemButton(() => buyLine(line));
    ui.lines.appendChild(r.li);
    return r;
  });

  const matRows = MATERIALS.map(m => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="mat" type="button">
      <span class="swatch"></span><span class="mname"></span><span class="minfo"></span></button>`;
    const btn = li.firstElementChild;
    btn.querySelector('.swatch').style.background = m.color;
    btn.addEventListener('click', () => selectMaterial(m));
    ui.materials.appendChild(li);
    return { btn, name: btn.querySelector('.mname'), info: btn.querySelector('.minfo') };
  });

  function renderShop() {
    EQUIPMENT.forEach((eq, i) => {
      const r = equipRows[i];
      const lvl = state.levels[eq.id];
      const maxed = lvl >= eq.maxLevel;
      const cost = eq.cost(lvl);
      r.level.textContent = lvl;
      r.effect.textContent = maxed ? 'Niveau maximum atteint' : eq.effect(lvl);
      r.cost.textContent = maxed ? '—' : fmtE(cost);
      r.btn.classList.toggle('maxed', maxed);
      r.btn.disabled = maxed || state.money < cost;
    });

    // Une ligne est révélée quand on a gagné au moins la moitié de son prix.
    let mysteryShown = false;
    LINES.forEach((line, i) => {
      const r = lineRows[i];
      const known = state.lines[line.id] > 0 || state.totalEarned >= line.cost * 0.5;
      r.li.hidden = !known && mysteryShown;
      if (!known) mysteryShown = true;
      const cost = lineCost(line);
      r.btn.classList.toggle('hidden-item', !known);
      r.name.textContent = known ? line.name : '???';
      r.level.textContent = state.lines[line.id] || '';
      r.effect.textContent = known
        ? `+${fmtT(line.rate)}/s (≈ ${fmtE(line.rate * material().price)}/s)`
        : 'Continuez à livrer pour la découvrir…';
      r.cost.textContent = fmtE(cost);
      r.btn.disabled = state.money < cost;
    });

    // On affiche les matériaux débloqués et le prochain à débloquer.
    let nextShown = false;
    MATERIALS.forEach((m, i) => {
      const r = matRows[i];
      const unlocked = state.unlocked.includes(m.id);
      r.btn.parentElement.hidden = !unlocked && nextShown;
      if (!unlocked) nextShown = true;
      r.btn.classList.toggle('selected', m.id === state.material);
      r.btn.classList.toggle('locked', !unlocked);
      r.name.textContent = m.name;
      r.info.textContent = unlocked
        ? `${fmtE(m.price)}/t`
        : `Débloquer : ${fmtE(m.unlockCost)}`;
      r.btn.disabled = !unlocked && state.money < m.unlockCost;
    });

    renderStats();
  }

  // ---------- Boucle ----------

  function applyOffline() {
    const away = Math.min((Date.now() - state.lastSaved) / 1000, OFFLINE_CAP_SECONDS);
    const tons = passiveTons() * away;
    if (away > 10 && tons > 0) {
      earn(tons * material().price, tons);
      toast(`Pendant votre absence, vos lignes ont livré ${fmtT(tons)} (${fmtE(tons * material().price)}).`);
    }
  }

  let last = performance.now();
  let shopTimer = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1);
    last = now;
    step(dt);
    renderScene();
    shopTimer += dt;
    if (shopTimer > 0.1) { shopTimer = 0; renderShop(); }
    requestAnimationFrame(frame);
  }

  applyOffline();
  renderScene();
  renderShop();
  requestAnimationFrame(frame);
  setInterval(save, 5000);
  // Onglet en arrière-plan : la boucle s'arrête, on crédite les lignes au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else { applyOffline(); last = performance.now(); }
  });
  window.addEventListener('pagehide', save);
})();
