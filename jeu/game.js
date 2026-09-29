(() => {
  'use strict';

  const { roundNice, MATERIALS, CLIENTS, EQUIPMENT, LINES, METHODS, ACHIEVEMENTS, audio } = window.IdleSilo;

  const SAVE_KEY = 'idle-silo-save-v2';
  const OFFLINE_CAP_SECONDS = 8 * 3600;
  const LINE_COST_GROWTH = 1.15;
  const ORDERS_UNLOCK_TRUCKS = 3;
  const ORDER_OFFERS = 3;
  const ORDER_REFRESH_SECONDS = 60;
  const PATENT_BASE = 1e5; // brevets = racine cubique (gains totaux / 100 000 €)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- État ----------

  function freshRun() {
    const sand = MATERIALS[0];
    return {
      money: 0,
      runEarned: 0,
      trucks: 0,
      material: sand.id,
      unlocked: [sand.id],
      levels: Object.fromEntries(EQUIPMENT.map(e => [e.id, 0])),
      lines: Object.fromEntries(LINES.map(l => [l.id, 0])),
      methods: [],
      // Contenu du silo : volume (m³) et caractéristiques moyennes du mélange.
      silo: { vol: 0, density: sand.density, flow: sand.flow, price: sand.price, color: sand.color, mat: sand.id },
      truck: { load: 0, value: 0, mix: {}, color: sand.color },
      leaving: 0,
      autoAcc: 0,
      orders: { offers: [], active: null, completed: 0, refresh: 0 },
    };
  }

  function freshState() {
    return {
      ...freshRun(),
      patents: 0,
      achievements: [],
      stats: { earned: 0, tons: 0, trucks: 0, clicks: 0, orders: 0 },
      lastSaved: Date.now(),
    };
  }

  function load() {
    const base = freshState();
    try {
      localStorage.removeItem('idle-silo-save-v1'); // ancienne version, incompatible
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return base;
      return {
        ...base, ...data,
        levels: { ...base.levels, ...data.levels },
        lines: { ...base.lines, ...data.lines },
        stats: { ...base.stats, ...data.stats },
        silo: { ...base.silo, ...data.silo },
        truck: { ...base.truck, ...data.truck },
        orders: { ...base.orders, ...data.orders },
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

  // ---------- Règles ----------

  const has = id => state.methods.includes(id);
  const material = (id = state.material) => MATERIALS.find(m => m.id === id) || MATERIALS[0];
  const lvl = id => state.levels[id];

  const bucketVolume = (l = lvl('godet')) => 0.5 * Math.pow(1.5, l) * (has('fea') ? 2 : 1);
  const siloVolume = (l = lvl('silo')) => 5 * Math.pow(1.5, l) * (has('fea') ? 2 : 1);
  const screwVolume = (l = lvl('vis')) => 0.5 * Math.pow(1.35, l) * (has('taguchi') ? 1.5 : 1);
  const truckCapacity = (l = lvl('camion')) => 10 * Math.pow(1.6, l);
  const autoRate = (l = lvl('auto')) => 0.2 * l; // godets par seconde
  const truckRotation = () => (has('toc') ? 1.5 : 3);

  const equipCost = eq => eq.costBase * Math.pow(eq.costGrowth, lvl(eq.id));
  const lineCost = l => Math.ceil(l.cost * Math.pow(LINE_COST_GROWTH, state.lines[l.id]));

  const salesMult = () =>
    (1 + 0.05 * state.patents) * (1 + 0.02 * state.achievements.length) * (has('triz') ? 1.5 : 1);
  const orderMult = () => salesMult() * (has('qfd') ? 1.5 : 1);

  const passiveVolume = () =>
    LINES.reduce((s, l) => s + l.rate * state.lines[l.id], 0) * (has('coeng') ? 2 : 1);
  const passiveTons = (m = material()) => passiveVolume() * m.density * m.flow;
  const passiveIncome = () => passiveTons() * material().price * salesMult();

  const patentsPotential = () => Math.floor(Math.cbrt(state.stats.earned / PATENT_BASE));
  const patentsGain = () => Math.max(0, patentsPotential() - state.patents);

  function earn(euros, tons) {
    state.money += euros;
    state.runEarned += euros;
    state.stats.earned += euros;
    state.stats.tons += tons;
  }

  // ---------- Formatage ----------

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
  const fmtV = n => `${fmt(n)} m³`;
  const fmtPct = n => `${Math.round(n * 100)} %`;
  const fmtDuration = s => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m ? `${m} min ${String(r).padStart(2, '0')}` : `${r} s`;
  };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Éléments ----------

  const $ = id => document.getElementById(id);
  const ui = {
    money: $('money'), income: $('income'), trucks: $('trucks'), tonnage: $('tonnage'), sound: $('sound'),
    scene: $('scene'), silo: $('silo'), siloFill: $('silo-fill'), siloLabel: $('silo-label'),
    prompt: $('silo-prompt'), flights: $('flights'), grains: $('grains'), particles: $('particles'),
    stream: $('stream'), truck: $('truck'), pile: $('pile'), truckLabel: $('truck-label'),
    curMat: $('current-material'), curPrice: $('current-price'), screwRate: $('screw-rate'),
    bucket: $('bucket-size'), autoStatus: $('auto-status'),
    ordersLocked: $('orders-locked'), orderActive: $('order-active'), orderClient: $('order-client'),
    orderTimer: $('order-timer'), orderWhat: $('order-what'), orderBar: $('order-bar'),
    orderProgress: $('order-progress'), orderReward: $('order-reward'), offers: $('order-offers'),
    methodsBlock: $('methods-block'), methods: $('methods-list'),
    equip: $('equip-list'), lines: $('lines-list'), materials: $('materials-list'),
    patents: $('patents'), patentBonus: $('patent-bonus'), prestige: $('prestige'),
    achCount: $('ach-count'), achList: $('ach-list'),
    toast: $('toast'), reset: $('reset'),
    confirm: $('confirm'), confirmText: $('confirm-text'), confirmOk: $('confirm-ok'), confirmCancel: $('confirm-cancel'),
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };

  // Spires de la vis, dessinées une fois puis animées en translation.
  for (let x = -8; x <= 500; x += 32) {
    ui.flights.appendChild(svg('ellipse', { cx: x, cy: 0, rx: 7, ry: 24, transform: `rotate(-22 ${x} 0)` }));
  }

  // ---------- Actions du joueur ----------

  // Verse un godet du matériau sélectionné dans le silo. Renvoie les tonnes ajoutées.
  function addBucket(manual) {
    const s = state.silo;
    const vol = Math.min(bucketVolume(), siloVolume() - s.vol);
    if (vol <= 1e-6) return 0;
    const m = material();
    const total = s.vol + vol;
    const oldTons = s.vol * s.density;
    const newTons = vol * m.density;
    s.price = (oldTons * s.price + newTons * m.price) / (oldTons + newTons);
    s.density = (s.vol * s.density + vol * m.density) / total;
    s.flow = (s.vol * s.flow + vol * m.flow) / total;
    s.vol = total;
    s.color = m.color;
    s.mat = m.id;
    if (manual) state.stats.clicks++;
    return newTons;
  }

  function onSiloClick(e) {
    const tons = addBucket(true);
    ui.silo.classList.remove('bump');
    void ui.silo.getBBox();
    ui.silo.classList.add('bump');
    if (tons > 0) {
      audio.play('bucket');
      floater(e, `+${fmtT(tons)}`);
    }
  }

  ui.silo.addEventListener('click', onSiloClick);
  ui.silo.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSiloClick(e); }
  });

  function buyEquipment(eq) {
    const cost = equipCost(eq);
    if (lvl(eq.id) >= eq.maxLevel || state.money < cost) return;
    state.money -= cost;
    state.levels[eq.id]++;
    audio.play('buy');
    if (eq.id === 'auto' && lvl('auto') === 1) toast('Chargeuse automatique en service !');
  }

  function buyLine(line) {
    const cost = lineCost(line);
    if (state.money < cost) return;
    state.money -= cost;
    state.lines[line.id]++;
    audio.play('buy');
    if (state.lines[line.id] === 1) toast(`Nouvelle ligne : ${line.name}`);
  }

  function buyMethod(method) {
    if (has(method.id) || state.money < method.cost) return;
    state.money -= method.cost;
    state.methods.push(method.id);
    audio.play('buy');
    toast(`Méthode acquise : ${method.name}`);
  }

  function selectMaterial(m) {
    if (!state.unlocked.includes(m.id)) {
      if (state.money < m.unlockCost) return;
      state.money -= m.unlockCost;
      state.unlocked.push(m.id);
      audio.play('buy');
      toast(`Matériau débloqué : ${m.name}`);
    }
    state.material = m.id;
  }

  function prestige() {
    const gain = patentsGain();
    if (gain < 1) return;
    const msg = `Déposer ${gain} brevet(s) ? L'usine repart de zéro, mais chaque brevet donne +5 % sur toutes les ventes, pour toujours.`;
    askConfirm(msg, 'Déposer les brevets', () => {
      const g = patentsGain();
      if (g < 1) return;
      state = { ...state, ...freshRun(), patents: state.patents + g };
      audio.play('achievement');
      toast(`${g} brevet(s) déposé(s) ! Bonus permanent : +${fmt(state.patents * 5)} %`);
      save();
    });
  }

  ui.prestige.addEventListener('click', prestige);

  ui.reset.addEventListener('click', () => {
    askConfirm('Effacer toute votre progression, y compris les brevets et les succès ?', 'Tout effacer', () => {
      state = freshState();
      save();
    });
  });

  // Confirmation intégrée à la page (les fenêtres confirm() du navigateur
  // sont bloquées quand le jeu est affiché dans un cadre).
  let confirmAction = null;
  function askConfirm(message, okLabel, action) {
    ui.confirmText.textContent = message;
    ui.confirmOk.textContent = okLabel;
    confirmAction = action;
    ui.confirm.hidden = false;
    ui.confirmOk.focus();
  }
  function closeConfirm() {
    ui.confirm.hidden = true;
    confirmAction = null;
  }
  ui.confirmOk.addEventListener('click', () => {
    const action = confirmAction;
    closeConfirm();
    if (action) action();
  });
  ui.confirmCancel.addEventListener('click', closeConfirm);
  ui.confirm.addEventListener('keydown', e => { if (e.key === 'Escape') closeConfirm(); });

  ui.sound.addEventListener('click', () => {
    const on = audio.toggle();
    renderSoundButton(on);
  });
  function renderSoundButton(on) {
    ui.sound.textContent = on ? '🔊' : '🔇';
    ui.sound.setAttribute('aria-pressed', on);
    ui.sound.title = on ? 'Couper le son' : 'Activer le son';
  }
  renderSoundButton(audio.isEnabled());

  // Onglets de la boutique
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b === btn));
      document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    });
  });

  // Les notifications s'affichent l'une après l'autre.
  const toastQueue = [];
  let toastBusy = false;
  function toast(msg) {
    toastQueue.push(msg);
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const msg = toastQueue.shift();
    if (!msg) { toastBusy = false; return; }
    toastBusy = true;
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    setTimeout(() => {
      ui.toast.classList.remove('show');
      setTimeout(nextToast, 350);
    }, toastQueue.length ? 2200 : 3500);
  }

  function floaterAt(x, y, text) {
    const t = svg('text', { x, y, class: 'floater' });
    t.textContent = text;
    ui.scene.appendChild(t);
    t.addEventListener('animationend', () => t.remove());
  }

  function floater(e, text) {
    let x = 150, y = 150;
    if (e && e.clientX) {
      const pt = ui.scene.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(ui.scene.getScreenCTM().inverse());
      x = p.x; y = p.y;
    }
    floaterAt(x, y, text);
  }

  // ---------- Commandes clients ----------

  function makeOffer() {
    const m = material(pick(state.unlocked));
    const duration = pick([90, 120, 180]);
    // Quantité calibrée sur la capacité actuelle de l'usine pour ce matériau.
    const tps = screwVolume() * m.flow * m.density * 0.6 + passiveTons(m);
    const qty = roundNice(Math.max(5, tps * duration * rand(0.35, 0.6)));
    return {
      id: Math.random().toString(36).slice(2),
      client: pick(CLIENTS[m.category]),
      material: m.id,
      qty,
      duration,
      reward: roundNice(qty * m.price * rand(2, 3)),
    };
  }

  function refreshOffers() {
    const o = state.orders;
    o.offers = Array.from({ length: ORDER_OFFERS }, makeOffer);
    o.refresh = ORDER_REFRESH_SECONDS;
  }

  function acceptOffer(id) {
    const o = state.orders;
    if (o.active) return;
    const offer = o.offers.find(x => x.id === id);
    if (!offer) return;
    o.offers = o.offers.filter(x => x !== offer);
    o.active = { ...offer, delivered: 0, remaining: offer.duration };
    // Pratique : on bascule directement sur le matériau demandé.
    state.material = offer.material;
    audio.play('buy');
  }

  function creditOrder(matId, tons) {
    const a = state.orders.active;
    if (a && a.material === matId) a.delivered += tons;
  }

  function stepOrders(dt) {
    const o = state.orders;
    if (state.stats.trucks < ORDERS_UNLOCK_TRUCKS) return;
    o.refresh -= dt;
    if (o.refresh <= 0 || (!o.offers.length && !o.active)) refreshOffers();

    const a = o.active;
    if (!a) return;
    a.remaining -= dt;
    if (a.delivered >= a.qty) {
      const reward = a.reward * orderMult();
      earn(reward, 0);
      o.completed++;
      state.stats.orders++;
      o.active = null;
      audio.play('order');
      toast(`Commande honorée : +${fmtE(reward)}`);
      floaterAt(400, 120, `+${fmtE(reward)}`);
    } else if (a.remaining <= 0) {
      o.active = null;
      audio.play('fail');
      toast(`Commande expirée : ${a.client} n'a pas été livré à temps.`);
    }
  }

  // ---------- Simulation ----------

  let flowing = false;

  function step(dt) {
    // Lignes automatiques.
    const pt = passiveTons() * dt;
    if (pt > 0) {
      earn(pt * material().price * salesMult(), pt);
      creditOrder(state.material, pt);
    }

    // Chargeuse automatique.
    state.autoAcc += autoRate() * dt;
    while (state.autoAcc >= 1) {
      state.autoAcc -= 1;
      addBucket(false);
    }

    stepOrders(dt);

    // Le camion est parti livrer : la vis attend.
    if (state.leaving > 0) {
      state.leaving = Math.max(0, state.leaving - dt);
      flowing = false;
      return;
    }

    // La vis transfère la matière du silo vers la benne.
    const s = state.silo;
    const t = state.truck;
    const cap = truckCapacity();
    let vol = Math.min(screwVolume() * s.flow * dt, s.vol);
    let tons = vol * s.density;
    if (tons > cap - t.load) {
      tons = cap - t.load;
      vol = tons / s.density;
    }
    flowing = tons > 1e-9;
    if (flowing) {
      s.vol = Math.max(0, s.vol - vol);
      t.load += tons;
      t.value += tons * s.price;
      t.mix[s.mat] = (t.mix[s.mat] || 0) + tons;
      t.color = s.color;
    }
    if (t.load >= cap - 1e-6) departTruck();
  }

  function departTruck() {
    const t = state.truck;
    const value = t.value * salesMult();
    earn(value, t.load);
    for (const id in t.mix) creditOrder(id, t.mix[id]);
    state.trucks++;
    state.stats.trucks++;
    state.truck = { load: 0, value: 0, mix: {}, color: t.color };
    state.leaving = truckRotation();
    ui.truck.style.setProperty('--leave', `${truckRotation()}s`);
    ui.truck.classList.remove('leaving');
    void ui.truck.getBBox();
    ui.truck.classList.add('leaving');
    audio.play('horn');
    floaterAt(640, 250, `+${fmtE(value)}`);
  }

  function checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id) || !a.test(state)) continue;
      state.achievements.push(a.id);
      audio.play('achievement');
      toast(`Succès débloqué : ${a.name} (+2 % sur les ventes)`);
    }
  }

  // ---------- Particules (grains et poussière) ----------

  const OUTLET = { x: 631, y: 218 };
  const grainPool = [];   // grains dans la vis (repère local de la vis)
  const falling = [];     // grains qui tombent dans la benne
  const dust = [];        // nuages de poussière
  let grainSpawn = 0;
  let pileTop = 334;
  let screwSpeedPx = 32;  // vitesse d'avance des spires en px/s

  function spawnGrain(color) {
    if (grainPool.length > 70) return;
    const el = svg('circle', { r: rand(2, 3.4).toFixed(1), class: 'grain', fill: color });
    ui.grains.appendChild(el);
    grainPool.push({ el, x: 26, y: rand(-3, 12) });
  }

  function spawnFalling(color) {
    if (falling.length > 60) return;
    const el = svg('circle', { r: rand(1.8, 3).toFixed(1), class: 'grain', fill: color });
    ui.particles.appendChild(el);
    falling.push({ el, x: OUTLET.x + rand(-4, 4), y: OUTLET.y, vy: rand(20, 60), vx: rand(-15, 15) });
  }

  function spawnDust(x, y, color) {
    if (dust.length > 30) return;
    const el = svg('circle', { r: 3, class: 'dust', fill: color });
    ui.particles.appendChild(el);
    dust.push({ el, x: x + rand(-10, 10), y, age: 0, life: rand(0.5, 0.9), vx: rand(-20, 20) });
  }

  function stepParticles(dt) {
    if (reducedMotion) return;
    const color = state.silo.color;

    if (flowing) {
      grainSpawn += dt * Math.min(40, 8 + screwVolume() * 10);
      while (grainSpawn >= 1) { grainSpawn -= 1; spawnGrain(color); }
    }

    // Les grains avancent avec les spires, seulement quand la vis tourne.
    for (let i = grainPool.length - 1; i >= 0; i--) {
      const g = grainPool[i];
      if (flowing) g.x += screwSpeedPx * dt;
      if (g.x > 478) {
        g.el.remove();
        grainPool.splice(i, 1);
        spawnFalling(g.el.getAttribute('fill'));
        continue;
      }
      g.el.setAttribute('cx', g.x.toFixed(1));
      g.el.setAttribute('cy', g.y.toFixed(1));
    }

    for (let i = falling.length - 1; i >= 0; i--) {
      const p = falling[i];
      p.vy += 900 * dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      const floor = state.leaving > 0 ? 398 : pileTop;
      if (p.y >= floor) {
        if (Math.random() < 0.35) spawnDust(p.x, floor, p.el.getAttribute('fill'));
        p.el.remove();
        falling.splice(i, 1);
        continue;
      }
      p.el.setAttribute('cx', p.x.toFixed(1));
      p.el.setAttribute('cy', p.y.toFixed(1));
    }

    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.age += dt;
      const k = d.age / d.life;
      if (k >= 1) { d.el.remove(); dust.splice(i, 1); continue; }
      d.x += d.vx * dt;
      d.el.setAttribute('cx', d.x.toFixed(1));
      d.el.setAttribute('cy', (d.y - k * 18).toFixed(1));
      d.el.setAttribute('r', (3 + k * 10).toFixed(1));
      d.el.setAttribute('opacity', ((1 - k) * 0.45).toFixed(2));
    }
  }

  // ---------- Rendu de la scène ----------

  const SILO_TOP = 60, SILO_BOTTOM = 340;
  let lastScrewDuration = -1;

  function renderScene() {
    const s = state.silo;
    const cap = siloVolume();
    const ratio = Math.min(s.vol / cap, 1);
    const h = ratio * (SILO_BOTTOM - SILO_TOP);
    ui.siloFill.setAttribute('y', SILO_BOTTOM - h);
    ui.siloFill.setAttribute('height', h);
    ui.siloFill.setAttribute('fill', s.color);
    ui.siloLabel.textContent = `${fmt(s.vol)} / ${fmtV(cap)}`;
    ui.prompt.classList.toggle('off', s.vol > 1e-6);

    // Tas dans la benne.
    const t = state.truck;
    const tCap = truckCapacity();
    const tr = Math.min(t.load / tCap, 1);
    pileTop = 334 - tr * 70;
    const shoulder = 334 - tr * 40;
    ui.pile.setAttribute('d', `M530 334 L530 ${shoulder} L631 ${pileTop} L702 ${shoulder} L702 334 Z`);
    ui.pile.setAttribute('fill', t.color);
    ui.truckLabel.textContent = `${fmt(t.load)} / ${fmtT(tCap)}`;
    ui.truckLabel.setAttribute('y', Math.min(312, pileTop - 8));

    ui.stream.classList.toggle('on', flowing);
    ui.stream.setAttribute('y', OUTLET.y);
    ui.stream.setAttribute('height', Math.max(0, pileTop - OUTLET.y));
    ui.stream.setAttribute('fill', s.color);

    // Vitesse de rotation de la vis proportionnelle au débit (bornée).
    ui.flights.classList.toggle('running', flowing);
    const duration = Math.max(0.12, Math.min(0.8, 0.35 / (screwVolume() * s.flow)));
    if (Math.abs(duration - lastScrewDuration) > 0.01) {
      ui.flights.style.animationDuration = `${duration}s`;
      lastScrewDuration = duration;
      // Les grains avancent plus vite que les spires pour rester lisibles.
      screwSpeedPx = 3 * 32 / duration;
    }
    audio.setPouring(flowing);
  }

  // ---------- Rendu de l'interface ----------

  function renderStats() {
    ui.money.textContent = fmtE(state.money);
    ui.income.textContent = `${fmtE(passiveIncome())}/s`;
    ui.trucks.textContent = fmt(state.stats.trucks);
    ui.tonnage.textContent = fmtT(state.stats.tons);
    const m = material();
    ui.curMat.textContent = m.name;
    ui.curPrice.textContent = `${fmtE(m.price)}/t`;
    ui.screwRate.textContent = `${fmtT(screwVolume() * m.flow * m.density)}/s`;
    ui.bucket.textContent = fmtT(bucketVolume() * m.density);
    ui.autoStatus.textContent = autoRate() > 0 ? `· Chargeuse : ${fmt(autoRate())} godet/s` : '';
  }

  function itemButton(parent, onClick) {
    const li = document.createElement('li');
    li.innerHTML = `<button class="item" type="button">
      <span class="name"></span><span class="level"></span>
      <span class="effect"></span><span class="cost"></span></button>`;
    const btn = li.firstElementChild;
    btn.addEventListener('click', onClick);
    parent.appendChild(li);
    return { li, btn, name: btn.querySelector('.name'), level: btn.querySelector('.level'),
      effect: btn.querySelector('.effect'), cost: btn.querySelector('.cost') };
  }

  const equipEffects = {
    godet: l => `${fmtV(bucketVolume(l))} → ${fmtV(bucketVolume(l + 1))} par clic`,
    silo: l => `Volume ${fmtV(siloVolume(l))} → ${fmtV(siloVolume(l + 1))}`,
    vis: l => `Débit ${fmtV(screwVolume(l))}/s → ${fmtV(screwVolume(l + 1))}/s`,
    camion: l => `Benne ${fmtT(truckCapacity(l))} → ${fmtT(truckCapacity(l + 1))}`,
    auto: l => (l === 0
      ? 'Verse 0,2 godet/s sans cliquer'
      : `${fmt(autoRate(l))} → ${fmt(autoRate(l + 1))} godet/s`),
  };

  const equipRows = EQUIPMENT.map(eq => {
    const r = itemButton(ui.equip, () => buyEquipment(eq));
    r.name.textContent = eq.name;
    return r;
  });

  const lineRows = LINES.map(line => itemButton(ui.lines, () => buyLine(line)));

  const methodRows = METHODS.map(mt => {
    const btn = document.createElement('button');
    btn.className = 'method';
    btn.type = 'button';
    btn.innerHTML = `<b></b><span class="desc"></span><br><small></small>`;
    btn.querySelector('b').textContent = mt.name;
    btn.querySelector('.desc').textContent = mt.desc;
    btn.addEventListener('click', () => buyMethod(mt));
    ui.methods.appendChild(btn);
    return { btn, cost: btn.querySelector('small') };
  });

  const matRows = MATERIALS.map(m => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="mat" type="button">
      <span class="swatch"></span><span class="mname"></span><span class="minfo"></span><span class="mstats"></span></button>`;
    const btn = li.firstElementChild;
    btn.querySelector('.swatch').style.background = m.color;
    btn.querySelector('.mname').textContent = m.name;
    btn.querySelector('.mstats').textContent =
      `${String(m.density).replace('.', ',')} t/m³ · écoulement ${fmtPct(m.flow)}`;
    btn.addEventListener('click', () => selectMaterial(m));
    ui.materials.appendChild(li);
    return { li, btn, info: btn.querySelector('.minfo') };
  });

  const achRows = ACHIEVEMENTS.map(a => {
    const li = document.createElement('li');
    li.className = 'ach';
    li.innerHTML = '<b></b><span></span>';
    li.querySelector('b').textContent = a.name;
    li.querySelector('span').textContent = a.desc;
    ui.achList.appendChild(li);
    return li;
  });

  ui.offers.addEventListener('click', e => {
    const btn = e.target.closest('button[data-offer]');
    if (btn) acceptOffer(btn.dataset.offer);
  });

  function renderShop() {
    EQUIPMENT.forEach((eq, i) => {
      const r = equipRows[i];
      const l = lvl(eq.id);
      const maxed = l >= eq.maxLevel;
      const cost = equipCost(eq);
      r.level.textContent = l;
      r.effect.textContent = maxed ? 'Niveau maximum atteint' : equipEffects[eq.id](l);
      r.cost.textContent = maxed ? '—' : fmtE(cost);
      r.btn.classList.toggle('maxed', maxed);
      r.btn.disabled = maxed || state.money < cost;
    });

    let anyMethod = false;
    METHODS.forEach((mt, i) => {
      const r = methodRows[i];
      const owned = has(mt.id);
      const visible = owned || mt.unlock(state);
      r.btn.hidden = !visible;
      anyMethod = anyMethod || visible;
      r.btn.classList.toggle('owned', owned);
      r.cost.textContent = owned ? 'Acquise' : fmtE(mt.cost);
      r.btn.disabled = owned || state.money < mt.cost;
    });
    ui.methodsBlock.hidden = !anyMethod;

    // Une ligne est révélée quand on a gagné au moins la moitié de son prix.
    let mysteryShown = false;
    const m = material();
    LINES.forEach((line, i) => {
      const r = lineRows[i];
      const known = state.lines[line.id] > 0 || state.runEarned >= line.cost * 0.5;
      r.li.hidden = !known && mysteryShown;
      if (!known) mysteryShown = true;
      const cost = lineCost(line);
      const rate = line.rate * (has('coeng') ? 2 : 1);
      r.btn.classList.toggle('hidden-item', !known);
      r.name.textContent = known ? line.name : '???';
      r.level.textContent = state.lines[line.id] || '';
      r.effect.textContent = known
        ? `+${fmtV(rate)}/s (≈ ${fmtE(rate * m.density * m.flow * m.price * salesMult())}/s en ${m.name.toLowerCase()})`
        : 'Continuez à livrer pour la découvrir…';
      r.cost.textContent = fmtE(cost);
      r.btn.disabled = state.money < cost;
    });

    // Matériaux débloqués + le suivant à débloquer.
    let nextShown = false;
    MATERIALS.forEach((mat, i) => {
      const r = matRows[i];
      const unlocked = state.unlocked.includes(mat.id);
      r.li.hidden = !unlocked && nextShown;
      if (!unlocked) nextShown = true;
      r.btn.classList.toggle('selected', mat.id === state.material);
      r.btn.classList.toggle('locked', !unlocked);
      r.info.textContent = unlocked ? `${fmtE(mat.price)}/t` : `Débloquer : ${fmtE(mat.unlockCost)}`;
      r.btn.disabled = !unlocked && state.money < mat.unlockCost;
    });

    // Progrès : brevets et succès.
    ui.patents.textContent = fmt(state.patents);
    ui.patentBonus.textContent = `+${fmt(state.patents * 5)} %`;
    const gain = patentsGain();
    ui.prestige.disabled = gain < 1;
    ui.prestige.textContent = gain >= 1
      ? `Déposer ${fmt(gain)} brevet(s)`
      : `Prochain brevet à ${fmtE(Math.pow(state.patents + 1, 3) * PATENT_BASE)} gagnés au total`;
    ACHIEVEMENTS.forEach((a, i) => achRows[i].classList.toggle('done', state.achievements.includes(a.id)));
    ui.achCount.textContent = `${state.achievements.length} / ${ACHIEVEMENTS.length}`;

    renderOrders();
    renderStats();
  }

  let offersKey = '';
  function renderOrders() {
    const o = state.orders;
    const unlocked = state.stats.trucks >= ORDERS_UNLOCK_TRUCKS;
    ui.ordersLocked.hidden = unlocked;

    const a = o.active;
    ui.orderActive.hidden = !a;
    if (a) {
      const m = material(a.material);
      ui.orderClient.textContent = a.client;
      ui.orderTimer.textContent = fmtDuration(Math.max(0, a.remaining));
      ui.orderTimer.classList.toggle('urgent', a.remaining < 20);
      ui.orderWhat.textContent = `${fmtT(a.qty)} de ${m.name.toLowerCase()}`
        + (state.material !== a.material ? ' — sélectionnez ce matériau pour livrer !' : '');
      ui.orderBar.style.width = `${Math.min(100, (a.delivered / a.qty) * 100)}%`;
      ui.orderProgress.textContent = `${fmt(Math.min(a.delivered, a.qty))} / ${fmtT(a.qty)}`;
      ui.orderReward.textContent = fmtE(a.reward * orderMult());
    }

    // Les offres ne sont reconstruites que lorsqu'elles changent.
    const key = unlocked ? o.offers.map(x => x.id).join() + (a ? '+' : '') + Math.floor(orderMult() * 100) : '';
    if (key !== offersKey) {
      offersKey = key;
      ui.offers.innerHTML = '';
      if (unlocked) {
        for (const offer of o.offers) {
          const m = material(offer.material);
          const li = document.createElement('li');
          li.className = 'offer';
          li.innerHTML = `<span class="client"></span>
            <span><span class="swatch-inline"></span><span class="what"></span></span>
            <span class="meta"></span>
            <button type="button" data-offer="${offer.id}">Accepter</button>`;
          li.querySelector('.client').textContent = offer.client;
          li.querySelector('.swatch-inline').style.background = m.color;
          li.querySelector('.what').textContent = `${fmtT(offer.qty)} de ${m.name.toLowerCase()}`;
          li.querySelector('.meta').textContent =
            `Délai ${fmtDuration(offer.duration)} · Prime ${fmtE(offer.reward * orderMult())}`;
          li.querySelector('button').disabled = !!a;
          ui.offers.appendChild(li);
        }
      }
    }
  }

  // ---------- Boucle ----------

  function applyOffline() {
    const away = Math.min((Date.now() - state.lastSaved) / 1000, OFFLINE_CAP_SECONDS);
    const tons = passiveTons() * away;
    if (away > 10 && tons > 0) {
      const euros = tons * material().price * salesMult();
      earn(euros, tons);
      toast(`Pendant votre absence, vos lignes ont livré ${fmtT(tons)} (${fmtE(euros)}).`);
    }
    state.lastSaved = Date.now();
  }

  let last = performance.now();
  let slowTimer = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1);
    last = now;
    step(dt);
    stepParticles(dt);
    renderScene();
    slowTimer += dt;
    if (slowTimer > 0.1) {
      slowTimer = 0;
      checkAchievements();
      renderShop();
    }
    requestAnimationFrame(frame);
  }

  applyOffline();
  renderScene();
  renderShop();
  requestAnimationFrame(frame);
  setInterval(save, 5000);
  // Onglet en arrière-plan : la boucle s'arrête, on crédite les lignes au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); audio.setPouring(false); }
    else { applyOffline(); last = performance.now(); }
  });
  window.addEventListener('pagehide', save);
})();
