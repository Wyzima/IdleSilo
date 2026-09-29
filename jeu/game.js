(() => {
  'use strict';

  const { roundNice, MATERIALS, CLIENTS, EQUIPMENT, LINES, METHODS, ACHIEVEMENTS,
    PARTS, PRESS_UPGRADES, COSMETICS, audio, createScene } = window.IdleSilo;

  const SAVE_KEY = 'idle-silo-save-v3';
  const OFFLINE_CAP_SECONDS = 8 * 3600;
  const LINE_COST_GROWTH = 1.15;
  const ORDERS_UNLOCK_TRUCKS = 3;
  const ORDER_OFFERS = 3;
  const ORDER_REFRESH_SECONDS = 60;
  const PATENT_BASE = 1e5; // brevets = racine cubique (gains totaux / 100 000 €)
  const MAX_SITES = 6;
  const SITES_UNLOCK_TRUCKS = 10;
  const siteCost = n => 1500 * Math.pow(15, n - 1); // prix du (n+1)e silo
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COMBO_MAX = 40;          // clics rapides pour atteindre la cadence ×5
  const GOLDEN_DURATION = 8;     // secondes pour attraper le camion doré
  const FRENZY = { sales: 5, salesTime: 30, click: 10, clickTime: 20 };

  // ---------- État ----------

  // Un site = un silo avec sa vis, son camion et son équipement.
  function newSite(matId = MATERIALS[0].id) {
    const m = MATERIALS.find(x => x.id === matId) || MATERIALS[0];
    return {
      material: m.id,
      levels: Object.fromEntries(EQUIPMENT.map(e => [e.id, 0])),
      // Contenu du silo : volume (m³) et caractéristiques moyennes du mélange.
      silo: { vol: 0, density: m.density, flow: m.flow, price: m.price, color: m.color, mat: m.id },
      truck: { load: 0, value: 0, mix: {}, color: m.color },
      leaving: 0,
      autoAcc: 0,
    };
  }

  function freshRun() {
    return {
      money: 0,
      runEarned: 0,
      trucks: 0,
      unlocked: [MATERIALS[0].id],
      sites: [newSite()],
      selected: 0,
      linesMaterial: MATERIALS[0].id,
      lines: Object.fromEntries(LINES.map(l => [l.id, 0])),
      methods: [],
      orders: { offers: [], active: null, completed: 0, refresh: 0 },
      press: { tier: 0, molds: 0, eng: 0 },
      buffs: { frenzy: 0, clickFrenzy: 0 },
      golden: { next: 45, active: null },
    };
  }

  // Personnalisations possédées et actives (conservées après un dépôt de brevets).
  function freshCosmetics() {
    const first = Object.fromEntries(Object.entries(COSMETICS).map(([cat, c]) => [cat, c.items[0].id]));
    return { owned: Object.entries(first).map(([cat, id]) => `${cat}:${id}`), active: first };
  }

  function freshState() {
    return {
      ...freshRun(),
      patents: 0,
      achievements: [],
      stats: { earned: 0, tons: 0, trucks: 0, clicks: 0, orders: 0, pressClicks: 0, golden: 0, maxCombo: 1 },
      cosmetics: freshCosmetics(),
      lastSaved: Date.now(),
    };
  }

  function load() {
    const base = freshState();
    try {
      // Anciennes versions, incompatibles.
      localStorage.removeItem('idle-silo-save-v1');
      localStorage.removeItem('idle-silo-save-v2');
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data) return base;
      const sites = data.sites.map(site => {
        const b = newSite(site.material);
        return { ...b, ...site, levels: { ...b.levels, ...site.levels },
          silo: { ...b.silo, ...site.silo }, truck: { ...b.truck, ...site.truck } };
      });
      return {
        ...base, ...data, sites,
        selected: Math.min(data.selected || 0, sites.length - 1),
        lines: { ...base.lines, ...data.lines },
        stats: { ...base.stats, ...data.stats },
        orders: { ...base.orders, ...data.orders },
        press: { ...base.press, ...data.press },
        buffs: { ...base.buffs, ...data.buffs },
        golden: { ...base.golden, ...data.golden, active: null },
        cosmetics: data.cosmetics
          ? { owned: data.cosmetics.owned, active: { ...base.cosmetics.active, ...data.cosmetics.active } }
          : base.cosmetics,
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
  const material = id => MATERIALS.find(m => m.id === id) || MATERIALS[0];
  const cur = () => state.sites[state.selected];
  const curMaterial = () => material(cur().material);
  const lvl = (id, site = cur()) => site.levels[id];

  // Caractéristiques d'un site selon ses niveaux (par défaut : le silo sélectionné).
  const bucketVolume = (l = lvl('godet')) => 1 * Math.pow(1.5, l) * (has('fea') ? 2 : 1);
  const siloVolume = (l = lvl('silo')) => 8 * Math.pow(1.5, l) * (has('fea') ? 2 : 1);
  const screwVolume = (l = lvl('vis')) => 1 * Math.pow(1.35, l) * (has('taguchi') ? 1.5 : 1);
  const truckCapacity = (l = lvl('camion')) => 10 * Math.pow(1.6, l);
  // Godets versés par seconde : 0,5 au niveau 1, puis +25 % par niveau.
  const autoRate = (l = lvl('auto')) => (l > 0 ? 0.6 * Math.pow(1.25, l - 1) : 0);
  const truckRotation = () => (has('toc') ? 1 : 2);

  const screwDiameter = l => 200 + 50 * l; // mm, pour l'affichage
  // Modèles de camion : plus la benne est grande, plus le véhicule s'allonge.
  // beds = longueur de chaque benne ou remorque, de l'arrière vers la cabine.
  const TRUCK_MODELS = [
    { from: 0, name: 'Camion benne', beds: [120] },
    { from: 3, name: 'Porteur 8×4', beds: [160] },
    { from: 6, name: 'Semi-remorque', beds: [215] },
    { from: 10, name: 'Train routier', beds: [145, 145] },
    { from: 15, name: 'Convoi exceptionnel', beds: [145, 145, 155] },
  ];
  const truckModelOf = l => TRUCK_MODELS.filter(m => l >= m.from).pop();
  const truckModel = l => truckModelOf(l).name;

  const equipCost = eq => eq.costBase * Math.pow(eq.costGrowth, lvl(eq.id));
  const lineCost = l => Math.ceil(l.cost * Math.pow(LINE_COST_GROWTH, state.lines[l.id]));

  // Bonus permanents (brevets, succès) communs aux ventes et à la presse.
  const bonusMult = () => (1 + 0.05 * state.patents) * (1 + 0.02 * state.achievements.length);
  const salesMult = () =>
    bonusMult() * (has('triz') ? 1.5 : 1) * (state.buffs.frenzy > 0 ? FRENZY.sales : 1);
  const orderMult = () => salesMult() * (has('qfd') ? 1.5 : 1);

  const passiveVolume = () =>
    LINES.reduce((s, l) => s + l.rate * state.lines[l.id], 0) * (has('coeng') ? 2 : 1);
  const linesMaterial = () => material(state.linesMaterial);
  const passiveTons = (m = linesMaterial()) => passiveVolume() * m.density * m.flow;
  const passiveIncome = () => passiveTons() * linesMaterial().price * salesMult();

  // Revenu automatique total : lignes + silos alimentés automatiquement.
  function autoIncome() {
    const sites = state.sites.reduce((sum, site) =>
      sum + autoSiteTons(site) * material(site.material).price, 0) * salesMult();
    return passiveIncome() + sites;
  }

  // ---------- Presse à injection ----------
  const combo = { heat: 0, last: -1e9 };
  // Gains progressifs : peu au début, beaucoup en fin de partie.
  // Les pièces et le moule progressent modérément ; c'est la part du revenu
  // automatique qui accélère avec l'ingénierie de production (×1,48 par niveau).
  const partValue = (t = state.press.tier) => Math.pow(3, t);                  // 1 €, 3 €, 9 €… 2 187 €
  const moldCount = (l = state.press.molds) => 1 + l;                          // 1 à 9 pièces par clic
  const incomeShare = (l = state.press.eng) => 0.002 * Math.pow(1.48, l);      // 0,2 % → 10 % du revenu auto
  const comboMult = () => 1 + (combo.heat / COMBO_MAX) * 4;
  const pressUpCost = u => u.costBase * Math.pow(u.costGrowth, state.press[u.id]);
  // Gain d'un clic : la pièce moulée, plus une part du revenu automatique.
  function pressValue() {
    const base = partValue() * moldCount() * bonusMult() + incomeShare() * autoIncome();
    return base * comboMult() * (state.buffs.clickFrenzy > 0 ? FRENZY.click : 1);
  }

  // Débit moyen (t/s) d'un silo alimenté automatiquement, rotations de camion comprises.
  function autoSiteTons(site) {
    const l = site.levels;
    if (!l.auto) return 0;
    const m = material(site.material);
    const volPerSec = Math.min(autoRate(l.auto) * bucketVolume(l.godet), screwVolume(l.vis) * m.flow);
    const tps = volPerSec * m.density;
    const cap = truckCapacity(l.camion);
    return tps * cap / (cap + tps * truckRotation());
  }

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
  const fmtPctFine = n => `${(n * 100).toFixed(1).replace('.', ',').replace(',0', '')} %`;
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
    scene: $('scene'), buildBtn: $('build-silo'), sceneHint: $('scene-hint'), buffs: $('buffs'),
    pressList: $('press-list'), skins: $('skins'),
    curMat: $('current-material'), curPrice: $('current-price'), screwRate: $('screw-rate'),
    bucket: $('bucket-size'), truckInfo: $('truck-info'), autoStatus: $('auto-status'),
    equipTitle: $('equip-title'),
    linesMaterial: $('lines-material'),
    ordersLocked: $('orders-locked'), orderActive: $('order-active'), orderClient: $('order-client'),
    orderTimer: $('order-timer'), orderWhat: $('order-what'), orderBar: $('order-bar'),
    orderProgress: $('order-progress'), orderReward: $('order-reward'), offers: $('order-offers'),
    methodsBlock: $('methods-block'), methods: $('methods-list'),
    equip: $('equip-list'), lines: $('lines-list'), materials: $('materials-list'),
    materialTitle: $('material-title'), materialDetails: $('material-details'), unlockNext: $('unlock-next'),
    patents: $('patents'), patentBonus: $('patent-bonus'), prestige: $('prestige'),
    achCount: $('ach-count'), achList: $('ach-list'), achDetail: $('ach-detail'),
    toast: $('toast'), reset: $('reset'),
    confirm: $('confirm'), confirmText: $('confirm-text'), confirmOk: $('confirm-ok'), confirmCancel: $('confirm-cancel'),
  };
  // ---------- Actions du joueur ----------

  // Verse un godet dans le silo d'un site, avec le matériau choisi pour ce site.
  // Renvoie les tonnes ajoutées.
  function addBucket(site, manual) {
    const s = site.silo;
    const vol = Math.min(bucketVolume(site.levels.godet), siloVolume(site.levels.silo) - s.vol);
    if (vol <= 1e-6) return 0;
    const m = material(site.material);
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

  // Clic sur un silo de la scène : il devient le silo sélectionné,
  // et un clic sur le silo lui-même y verse un godet.
  function onUnitClick(i, onSilo) {
    selectSite(i);
    if (onSilo) pourBucket(i);
  }

  function pourBucket(i) {
    const tons = addBucket(state.sites[i], true);
    scene.bump(i);
    if (tons > 0) {
      audio.play('bucket');
      scene.floater(i, 'silo', `+${fmtT(tons)}`);
    }
  }

  function buyEquipment(eq) {
    const cost = equipCost(eq);
    if (lvl(eq.id) >= eq.maxLevel || state.money < cost) return;
    state.money -= cost;
    cur().levels[eq.id]++;
    audio.play('buy');
    if (eq.id === 'auto' && lvl('auto') === 1) toast(`Silo ${state.selected + 1} : alimentation automatique en service !`);
  }

  function buySite() {
    const n = state.sites.length;
    const cost = siteCost(n);
    if (n >= MAX_SITES || state.stats.trucks < SITES_UNLOCK_TRUCKS || state.money < cost) return;
    state.money -= cost;
    const site = newSite(cur().material);
    site.levels.auto = 1; // un nouveau silo tourne tout seul dès sa construction
    state.sites.push(site);
    audio.play('buy');
    selectSite(n);
    toast(`Silo ${n + 1} construit ! Il se remplit tout seul. Choisissez son matériau à droite.`);
    toast('Cliquez sur un silo dans l\'image pour le sélectionner.');
  }

  function selectSite(i) {
    if (i === state.selected || !state.sites[i]) return;
    state.selected = i;
  }

  function onPressClick() {
    const value = pressValue();
    earn(value, 0);
    state.stats.pressClicks++;
    combo.heat = Math.min(COMBO_MAX, combo.heat + 1);
    combo.last = performance.now();
    state.stats.maxCombo = Math.max(state.stats.maxCombo, comboMult());
    audio.play('press');
    scene.pressHit(`+${fmtE(value)}`, state.buffs.clickFrenzy > 0);
  }

  function catchGolden() {
    const g = state.golden;
    if (!g.active) return;
    g.active = null;
    g.next = rand(60, 150);
    state.stats.golden++;
    audio.play('golden');
    const r = Math.random();
    if (r < 0.4) {
      const lump = Math.max(250, autoIncome() * 60 + partValue() * moldCount() * bonusMult() * 30);
      earn(lump, 0);
      toast(`Camion doré : prime de ${fmtE(lump)} !`);
    } else if (r < 0.75) {
      state.buffs.frenzy = FRENZY.salesTime;
      toast(`Camion doré : frénésie de production, ventes ×${FRENZY.sales} pendant ${FRENZY.salesTime} s !`);
    } else {
      state.buffs.clickFrenzy = FRENZY.clickTime;
      toast(`Camion doré : clics d'or, presse ×${FRENZY.click} pendant ${FRENZY.clickTime} s !`);
    }
  }

  function buyPressUpgrade(u) {
    const cost = pressUpCost(u);
    if (state.press[u.id] >= u.maxLevel || state.money < cost) return;
    state.money -= cost;
    state.press[u.id]++;
    audio.play('buy');
    if (u.id === 'tier') toast(`Nouvelle pièce : ${PARTS[state.press.tier].name}`);
  }

  function chooseCosmetic(cat, item) {
    const key = `${cat}:${item.id}`;
    const c = state.cosmetics;
    if (!c.owned.includes(key)) {
      if (state.money < item.cost) return;
      state.money -= item.cost;
      c.owned.push(key);
      audio.play('buy');
      toast(`Personnalisation achetée : ${COSMETICS[cat].label} « ${item.name} »`);
    }
    c.active[cat] = item.id;
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
    cur().material = m.id;
  }

  function prestige() {
    const gain = patentsGain();
    if (gain < 1) return;
    const msg = `Déposer ${gain} brevet(s) ? L'usine repart de zéro, mais chaque brevet donne +5 % sur toutes les ventes, pour toujours.`;
    askConfirm(msg, 'Déposer les brevets', () => {
      const g = patentsGain();
      if (g < 1) return;
      state = { ...state, ...freshRun(), patents: state.patents + g };
      combo.heat = 0;
      scene.reset();
      audio.play('achievement');
      toast(`${g} brevet(s) déposé(s) ! Bonus permanent : +${fmt(state.patents * 5)} %`);
      save();
    });
  }

  ui.prestige.addEventListener('click', prestige);

  ui.reset.addEventListener('click', () => {
    askConfirm('Effacer toute votre progression, y compris les brevets et les succès ?', 'Tout effacer', () => {
      state = freshState();
      scene.reset();
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

  // ---------- Commandes clients ----------

  function makeOffer() {
    const m = material(pick(state.unlocked));
    const duration = pick([90, 120, 180]);
    // Quantité calibrée sur la capacité actuelle de l'usine pour ce matériau.
    const screws = state.sites.reduce((sum, site) => sum + screwVolume(site.levels.vis), 0);
    const tps = screws * m.flow * m.density * 0.6 + passiveTons(m);
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
    // Si aucun silo ne produit ce matériau, le silo sélectionné bascule dessus.
    if (!state.sites.some(site => site.material === offer.material)) cur().material = offer.material;
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
    } else if (a.remaining <= 0) {
      o.active = null;
      audio.play('fail');
      toast(`Commande expirée : ${a.client} n'a pas été livré à temps.`);
    }
  }

  // ---------- Simulation ----------

  const flowing = []; // la vis de chaque silo tourne-t-elle ?
  const feeding = []; // l'alimentation automatique de chaque silo verse-t-elle ?

  function stepBonuses(dt) {
    // La cadence retombe dès qu'on arrête de cliquer.
    if (performance.now() - combo.last > 700) combo.heat = Math.max(0, combo.heat - 15 * dt);
    const b = state.buffs;
    const hadFrenzy = b.frenzy > 0, hadClick = b.clickFrenzy > 0;
    b.frenzy = Math.max(0, b.frenzy - dt);
    b.clickFrenzy = Math.max(0, b.clickFrenzy - dt);
    if (hadFrenzy && b.frenzy === 0) toast('Fin de la frénésie de production.');
    if (hadClick && b.clickFrenzy === 0) toast('Fin des clics d\'or.');
    // Camion doré : il apparaît de temps en temps et traverse une vignette.
    const g = state.golden;
    if (!g.active) {
      g.next -= dt;
      if (g.next <= 0) g.active = { tile: Math.floor(Math.random() * (1 + state.sites.length)), t: 0 };
    } else {
      g.active.t += dt;
      if (g.active.t >= GOLDEN_DURATION) { g.active = null; g.next = rand(60, 150); }
    }
  }

  function step(dt) {
    stepBonuses(dt);
    // Lignes automatiques.
    const pt = passiveTons() * dt;
    if (pt > 0) {
      earn(pt * linesMaterial().price * salesMult(), pt);
      creditOrder(state.linesMaterial, pt);
    }
    state.sites.forEach((site, i) => stepSite(site, i, dt));
    stepOrders(dt);
  }

  function stepSite(site, i, dt) {
    // Alimentation automatique : des godets versés sans cliquer.
    const s = site.silo;
    feeding[i] = autoRate(site.levels.auto) > 0 && s.vol < siloVolume(site.levels.silo) - 1e-6;
    site.autoAcc += autoRate(site.levels.auto) * dt;
    while (site.autoAcc >= 1) {
      site.autoAcc -= 1;
      addBucket(site, false);
    }

    // Le camion est parti livrer : la vis attend.
    if (site.leaving > 0) {
      site.leaving = Math.max(0, site.leaving - dt);
      flowing[i] = false;
      return;
    }

    // La vis transfère la matière du silo vers la benne.
    const t = site.truck;
    const cap = truckCapacity(site.levels.camion);
    let vol = Math.min(screwVolume(site.levels.vis) * s.flow * dt, s.vol);
    let tons = vol * s.density;
    if (tons > cap - t.load) {
      tons = cap - t.load;
      vol = tons / s.density;
    }
    flowing[i] = tons > 1e-9;
    if (flowing[i]) {
      s.vol = Math.max(0, s.vol - vol);
      t.load += tons;
      t.value += tons * s.price;
      t.mix[s.mat] = (t.mix[s.mat] || 0) + tons;
      t.color = s.color;
    }
    if (t.load >= cap - 1e-6) departTruck(site, i);
  }

  function departTruck(site, i) {
    const t = site.truck;
    const value = t.value * salesMult();
    earn(value, t.load);
    for (const id in t.mix) creditOrder(id, t.mix[id]);
    state.trucks++;
    state.stats.trucks++;
    site.truck = { load: 0, value: 0, mix: {}, color: t.color };
    site.leaving = truckRotation();
    scene.floater(i, 'truck', `+${fmtE(value)}`);
    // Le klaxon seulement pour le silo sélectionné, pour ne pas saturer.
    if (i === state.selected) audio.play('horn');
  }

  function checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id) || !a.test(state)) continue;
      state.achievements.push(a.id);
      audio.play('achievement');
      toast(`Succès débloqué : ${a.name} (+2 % sur les ventes)`);
    }
  }

  // ---------- Scène ----------

  const scene = createScene(ui.scene, {
    onUnit: onUnitClick,
    onPad: buySite,
    onPress: onPressClick,
    onGolden: catchGolden,
  });

  // Ce que la scène doit dessiner, recalculé à chaque image.
  function sceneView() {
    const units = state.sites.map((site, i) => {
      const cap = siloVolume(site.levels.silo);
      const tCap = truckCapacity(site.levels.camion);
      const run = !!flowing[i];
      const speed = run ? Math.min(260, 60 + 70 * screwVolume(site.levels.vis) * site.silo.flow) : 0;
      return {
        name: `Silo ${i + 1}`,
        selected: i === state.selected,
        auto: site.levels.auto > 0,
        feeding: !!feeding[i],
        matColor: material(site.material).color,
        flowing: run,
        screwSpeed: speed,
        silo: { ratio: site.silo.vol / cap, color: site.silo.color, label: `${fmt(site.silo.vol)} / ${fmtV(cap)}` },
        truck: {
          ratio: site.truck.load / tCap, color: site.truck.color, label: `${fmt(site.truck.load)} / ${fmtT(tCap)}`,
          model: truckModelOf(site.levels.camion), leaving: site.leaving, rotation: truckRotation(),
        },
      };
    });
    const part = PARTS[state.press.tier];
    const g = state.golden.active;
    return {
      units,
      pad: padView(),
      theme: currentTheme(),
      golden: g ? { tile: g.tile, p: g.t / GOLDEN_DURATION } : null,
      press: {
        partName: part.name, partColor: part.color, partShape: part.shape,
        valueLabel: fmtE(pressValue()),
        comboRatio: combo.heat / COMBO_MAX,
        comboLabel: comboMult().toFixed(1).replace('.', ','),
        idle: (performance.now() - combo.last) / 1000,
        clickFrenzy: state.buffs.clickFrenzy > 0,
      },
    };
  }

  function currentTheme() {
    const pick = cat => {
      const items = COSMETICS[cat].items;
      return (items.find(i => i.id === state.cosmetics.active[cat]) || items[0]);
    };
    return { bg: pick('bg').id, truck: pick('truck').c, silo: pick('silo').c, screw: pick('screw').c };
  }

  // Emplacement du prochain silo, affiché dans l'image dès 3 camions livrés.
  function padView() {
    const n = state.sites.length;
    if (n >= MAX_SITES || state.stats.trucks < 3) return null;
    const unlocked = state.stats.trucks >= SITES_UNLOCK_TRUCKS;
    const cost = siteCost(n);
    if (!unlocked) {
      return { title: `Silo ${n + 1}`, line: `${state.stats.trucks} / ${SITES_UNLOCK_TRUCKS} camions livrés`,
        progress: state.stats.trucks / SITES_UNLOCK_TRUCKS, ready: false };
    }
    const ready = state.money >= cost;
    return { title: `+ Construire le silo ${n + 1}`,
      line: ready ? `${fmtE(cost)} · cliquez ici` : `${fmtE(cost)} · encore ${fmtE(cost - state.money)}`,
      progress: ready ? null : state.money / cost, ready };
  }

  let wasPouring = false;
  function renderScene(dt) {
    scene.draw(sceneView(), dt);
    const pouring = flowing.some(Boolean);
    if (pouring !== wasPouring) { audio.setPouring(pouring); wasPouring = pouring; }
  }

  // Clavier : Espace pour la presse, flèches pour changer de silo, Entrée pour verser un godet.
  ui.scene.addEventListener('keydown', e => {
    const n = state.sites.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selectSite((state.selected + 1) % n); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selectSite((state.selected + n - 1) % n); }
    else if (e.key === 'Enter') { e.preventDefault(); pourBucket(state.selected); }
    else if (e.key === ' ') { e.preventDefault(); if (!e.repeat) onPressClick(); }
  });
  ui.buildBtn.addEventListener('click', buySite);

  // ---------- Rendu de l'interface ----------

  function renderStats() {
    ui.money.textContent = fmtE(state.money);
    ui.income.textContent = `${fmtE(autoIncome())}/s`;
    renderBuffs();
    ui.trucks.textContent = fmt(state.stats.trucks);
    ui.tonnage.textContent = fmtT(state.stats.tons);
    const m = curMaterial();
    ui.curMat.textContent = `Silo ${state.selected + 1} · ${m.name}`;
    ui.curPrice.textContent = `${fmtE(m.price)}/t`;
    ui.screwRate.textContent = `Ø${screwDiameter(lvl('vis'))} mm, ${fmtT(screwVolume() * m.flow * m.density)}/s`;
    ui.bucket.textContent = fmtT(bucketVolume() * m.density);
    ui.truckInfo.textContent = `${truckModel(lvl('camion'))} ${fmtT(truckCapacity())}`;
    ui.autoStatus.textContent = autoRate() > 0 ? `· Alimentation auto : ${fmt(autoRate())} godet/s` : '';
  }

  // Pictogrammes des équipements (traits en currentColor).
  const ICONS = {
    godet: '<path d="M4 9h13l-2 8H6z"/><path d="M17 9l3-4"/><path d="M8 12h6"/>',
    silo: '<path d="M7 7l5-3 5 3v9l-3 4h-4l-3-4z"/><path d="M7 11h10"/>',
    vis: '<path d="M3 17L21 7"/><path d="M6 12c1 2 2 3 3 3M10 10c1 2 2 3 3 3M14 8c1 2 2 3 3 3"/>',
    camion: '<path d="M2 7h12v9H2zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    auto: '<path d="M3 18L15 6"/><path d="M15 6h5v4"/><circle cx="7" cy="16" r="1.4"/><circle cx="11" cy="12" r="1.4"/>',
    presse: '<path d="M3 20h18"/><path d="M5 20V9h6v11"/><path d="M11 13h8"/><path d="M15 5h4l-1 4h-2z"/>',
    moule: '<rect x="4" y="6" width="7" height="12" rx="1"/><rect x="13" y="6" width="7" height="12" rx="1"/><circle cx="7.5" cy="12" r="1.5"/><circle cx="16.5" cy="12" r="1.5"/>',
    ingenierie: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    ligne: '<path d="M3 15h18"/><circle cx="6" cy="15" r="2.2"/><circle cx="18" cy="15" r="2.2"/><path d="M6 11h3v-3h6v3h3"/>',
  };
  const icon = id => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;

  function itemButton(parent, onClick, iconId) {
    const li = document.createElement('li');
    li.innerHTML = `<button class="item" type="button">
      <span class="ico">${icon(iconId)}</span>
      <span class="txt"><span class="name"></span><span class="effect"></span></span>
      <span class="side"><span class="level"></span><span class="cost"></span></span></button>`;
    const btn = li.firstElementChild;
    btn.addEventListener('click', onClick);
    parent.appendChild(li);
    return { li, btn, name: btn.querySelector('.name'), level: btn.querySelector('.level'),
      effect: btn.querySelector('.effect'), cost: btn.querySelector('.cost') };
  }

  const equipEffects = {
    godet: l => `${fmtV(bucketVolume(l))} → ${fmtV(bucketVolume(l + 1))} par clic`,
    silo: l => `Volume ${fmtV(siloVolume(l))} → ${fmtV(siloVolume(l + 1))}`,
    vis: l => `Ø${screwDiameter(l)} → Ø${screwDiameter(l + 1)} mm : ${fmtV(screwVolume(l))}/s → ${fmtV(screwVolume(l + 1))}/s`,
    camion: l => {
      const next = truckModel(l + 1) !== truckModel(l) ? ` (${truckModel(l + 1)})` : '';
      return `Benne ${fmtT(truckCapacity(l))} → ${fmtT(truckCapacity(l + 1))}${next}`;
    },
    auto: l => (l === 0
      ? `Remplit le silo sans cliquer : ${fmt(autoRate(1))} godet/s`
      : `${fmt(autoRate(l))} → ${fmt(autoRate(l + 1))} godet/s`),
  };

  // Atelier d'injection
  const PRESS_ICONS = { tier: 'presse', molds: 'moule', eng: 'ingenierie' };
  const pressEffects = {
    tier: l => `${PARTS[l + 1].name} : ${fmtE(partValue(l))} → ${fmtE(partValue(l + 1))} la pièce`,
    molds: l => `${fmt(moldCount(l))} → ${fmt(moldCount(l + 1))} pièces par clic`,
    eng: l => `${fmtPctFine(incomeShare(l))} → ${fmtPctFine(incomeShare(l + 1))} du revenu auto par clic`,
  };
  const pressRows = PRESS_UPGRADES.map(u => {
    const r = itemButton(ui.pressList, () => buyPressUpgrade(u), PRESS_ICONS[u.id]);
    r.name.textContent = u.name;
    return r;
  });

  // Personnalisation : une rangée de pastilles par catégorie
  const BG_SWATCH = { matin: '#f0dfb0', midi: '#8fc0ea', couchant: '#d9725a', hiver: '#e3ebf2', nuit: '#1b2a56' };
  const skinRows = Object.entries(COSMETICS).map(([cat, def]) => {
    const block = document.createElement('div');
    block.className = 'skin-group';
    block.innerHTML = '<span class="skin-label"></span><div class="skins"></div>';
    block.querySelector('.skin-label').textContent = def.label;
    const wrap = block.querySelector('.skins');
    const buttons = def.items.map(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skin';
      btn.innerHTML = '<span class="swatch"></span><span class="skin-name"></span><span class="skin-cost"></span>';
      const color = cat === 'bg' ? BG_SWATCH[item.id]
        : cat === 'truck' ? item.c.cabTop : cat === 'silo' ? item.c.light : item.c.mid;
      btn.querySelector('.swatch').style.background = color;
      btn.querySelector('.skin-name').textContent = item.name;
      btn.addEventListener('click', () => chooseCosmetic(cat, item));
      wrap.appendChild(btn);
      return { btn, item, cost: btn.querySelector('.skin-cost') };
    });
    ui.skins.appendChild(block);
    return { cat, buttons };
  });

  function renderCosmetics() {
    const c = state.cosmetics;
    for (const row of skinRows) {
      for (const b of row.buttons) {
        const owned = c.owned.includes(`${row.cat}:${b.item.id}`);
        const active = c.active[row.cat] === b.item.id;
        b.btn.classList.toggle('active', active);
        b.btn.setAttribute('aria-pressed', active);
        b.cost.textContent = active ? 'Actif' : owned ? 'Choisir' : fmtE(b.item.cost);
        b.btn.disabled = !owned && state.money < b.item.cost;
      }
    }
  }

  // Bonus actifs affichés sous la scène
  function renderBuffs() {
    const b = state.buffs;
    const parts = [];
    if (b.frenzy > 0) parts.push(`<span class="buff">Frénésie · ventes ×${FRENZY.sales} · ${Math.ceil(b.frenzy)} s</span>`);
    if (b.clickFrenzy > 0) parts.push(`<span class="buff">Clics d'or · presse ×${FRENZY.click} · ${Math.ceil(b.clickFrenzy)} s</span>`);
    const html = parts.join('');
    if (ui.buffs.dataset.html !== html) { ui.buffs.dataset.html = html; ui.buffs.innerHTML = html; }
  }

  const equipRows = EQUIPMENT.map(eq => {
    const r = itemButton(ui.equip, () => buyEquipment(eq), eq.id);
    r.name.textContent = eq.name;
    return r;
  });

  const lineRows = LINES.map(line => itemButton(ui.lines, () => buyLine(line), 'ligne'));

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

  // Matériaux : une pastille par matériau débloqué, et un bouton pour le suivant.
  const matChips = MATERIALS.map(m => {
    const li = document.createElement('li');
    li.innerHTML = '<button class="chip" type="button"><span class="dot"></span><span></span></button>';
    const btn = li.firstElementChild;
    btn.querySelector('.dot').style.background = m.color;
    btn.lastElementChild.textContent = m.name;
    btn.title = `${m.name} · ${fmtE(m.price)}/t`;
    btn.addEventListener('click', () => selectMaterial(m));
    ui.materials.appendChild(li);
    return { li, btn };
  });
  const nextMaterial = () => MATERIALS.find(m => !state.unlocked.includes(m.id));
  ui.unlockNext.addEventListener('click', () => {
    const m = nextMaterial();
    if (m) selectMaterial(m);
  });

  // Succès : une étoile par succès, le détail au survol ou au focus.
  const achRows = ACHIEVEMENTS.map(a => {
    const li = document.createElement('li');
    li.className = 'ach';
    li.tabIndex = 0;
    li.textContent = '★';
    const show = () => {
      const done = state.achievements.includes(a.id);
      ui.achDetail.textContent = `${done ? '★' : '☆'} ${a.name} : ${a.desc}${done ? ' (obtenu)' : ''}`;
    };
    li.addEventListener('mouseenter', show);
    li.addEventListener('focus', show);
    li.addEventListener('click', show);
    ui.achList.appendChild(li);
    return li;
  });

  ui.offers.addEventListener('click', e => {
    const btn = e.target.closest('button[data-offer]');
    if (btn) acceptOffer(btn.dataset.offer);
  });

  function renderShop() {
    PRESS_UPGRADES.forEach((u, i) => {
      const r = pressRows[i];
      const l = state.press[u.id];
      const maxed = l >= u.maxLevel;
      const cost = pressUpCost(u);
      r.level.textContent = `Niv. ${l}`;
      r.effect.textContent = maxed ? 'Niveau maximum atteint' : pressEffects[u.id](l);
      r.cost.textContent = maxed ? 'Max.' : fmtE(cost);
      r.btn.classList.toggle('maxed', maxed);
      r.btn.disabled = maxed || state.money < cost;
    });
    renderCosmetics();
    ui.equipTitle.textContent = `Équipement du silo ${state.selected + 1}`;
    EQUIPMENT.forEach((eq, i) => {
      const r = equipRows[i];
      const l = lvl(eq.id);
      const maxed = l >= eq.maxLevel;
      const cost = equipCost(eq);
      r.level.textContent = `Niv. ${l}`;
      r.effect.textContent = maxed ? 'Niveau maximum atteint' : equipEffects[eq.id](l);
      r.cost.textContent = maxed ? 'Max.' : fmtE(cost);
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
    const m = linesMaterial();
    LINES.forEach((line, i) => {
      const r = lineRows[i];
      const known = state.lines[line.id] > 0 || state.runEarned >= line.cost * 0.5;
      r.li.hidden = !known && mysteryShown;
      if (!known) mysteryShown = true;
      const cost = lineCost(line);
      const rate = line.rate * (has('coeng') ? 2 : 1);
      r.btn.classList.toggle('hidden-item', !known);
      r.name.textContent = known ? line.name : '???';
      r.level.textContent = state.lines[line.id] ? `× ${state.lines[line.id]}` : '';
      r.effect.textContent = known
        ? `+${fmtV(rate)}/s (≈ ${fmtE(rate * m.density * m.flow * m.price * salesMult())}/s en ${m.name.toLowerCase()})`
        : 'Continuez à livrer pour la découvrir…';
      r.cost.textContent = fmtE(cost);
      r.btn.disabled = state.money < cost;
    });

    // Matériau du silo affiché.
    const cm = curMaterial();
    ui.materialTitle.textContent = `Matériau du silo ${state.selected + 1}`;
    ui.materialDetails.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = cm.name;
    ui.materialDetails.append(strong,
      ` · ${fmtE(cm.price)}/t · ${String(cm.density).replace('.', ',')} t/m³ · écoulement ${fmtPct(cm.flow)}`);
    MATERIALS.forEach((mat, i) => {
      const c = matChips[i];
      c.li.hidden = !state.unlocked.includes(mat.id);
      c.btn.classList.toggle('selected', mat.id === cm.id);
      c.btn.setAttribute('aria-pressed', mat.id === cm.id);
    });
    const next = nextMaterial();
    ui.unlockNext.hidden = !next;
    if (next) {
      ui.unlockNext.textContent = `Débloquer ${next.name} (${fmtE(next.price)}/t) : ${fmtE(next.unlockCost)}`;
      ui.unlockNext.disabled = state.money < next.unlockCost;
    }

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

    renderLinesMaterial();
    renderSceneBar();
    renderOrders();
    renderStats();
  }

  // Sélecteur du matériau livré par les lignes automatiques.
  let linesKey = '';
  function renderLinesMaterial() {
    const key = state.unlocked.join() + '|' + state.linesMaterial;
    if (key === linesKey) return;
    linesKey = key;
    ui.linesMaterial.innerHTML = '';
    for (const id of state.unlocked) {
      const m = material(id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${m.name} (${fmtE(m.price)}/t)`;
      opt.selected = id === state.linesMaterial;
      ui.linesMaterial.appendChild(opt);
    }
  }
  ui.linesMaterial.addEventListener('change', () => {
    if (state.unlocked.includes(ui.linesMaterial.value)) state.linesMaterial = ui.linesMaterial.value;
  });

  // Bouton de construction sous l'image (même action que l'emplacement dans la scène).
  function renderSceneBar() {
    const n = state.sites.length;
    const unlocked = state.stats.trucks >= SITES_UNLOCK_TRUCKS;
    ui.buildBtn.hidden = n >= MAX_SITES || !unlocked;
    if (!ui.buildBtn.hidden) {
      const cost = siteCost(n);
      ui.buildBtn.textContent = `Construire le silo ${n + 1} · ${fmtE(cost)}`;
      ui.buildBtn.disabled = state.money < cost;
    }
    ui.sceneHint.textContent = n > 1
      ? 'Cliquez sur la presse pour gagner de l\'argent, sur un silo pour le sélectionner et y verser un godet. Clavier : Espace (presse), flèches (silo), Entrée (godet).'
      : 'Cliquez sur la presse pour gagner de l\'argent, et sur le silo pour y verser un godet. Clavier : Espace (presse), Entrée (godet).';
    if (unlocked && !state.siteHintShown) {
      state.siteHintShown = true;
      toast(`Vous pouvez construire un deuxième silo (${fmtE(siteCost(1))}) : cliquez sur l'emplacement dans l'image.`);
    }
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
        + (state.sites.some(site => site.material === a.material) || state.linesMaterial === a.material
          ? '' : ' — aucun silo ne produit ce matériau !');
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
            <span><span class="dot"></span><span class="what"></span></span>
            <span class="meta"></span>
            <button type="button" data-offer="${offer.id}">Accepter</button>`;
          li.querySelector('.client').textContent = offer.client;
          li.querySelector('.dot').style.background = m.color;
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
    // Les lignes automatiques et les silos alimentés automatiquement continuent de livrer.
    let tons = passiveTons() * away;
    let euros = tons * linesMaterial().price;
    for (const site of state.sites) {
      const t = autoSiteTons(site) * away;
      tons += t;
      euros += t * material(site.material).price;
    }
    euros *= salesMult();
    if (away > 10 && tons > 0) {
      earn(euros, tons);
      toast(`Pendant votre absence, votre usine a livré ${fmtT(tons)} (${fmtE(euros)}).`);
    }
    state.lastSaved = Date.now();
  }

  let last = performance.now();
  let slowTimer = 0;
  function frame(now) {
    // Le premier horodatage de requestAnimationFrame peut précéder « last » : on borne à 0.
    const dt = Math.max(0, Math.min((now - last) / 1000, 1));
    last = now;
    step(dt);
    renderScene(dt);
    slowTimer += dt;
    if (slowTimer > 0.1) {
      slowTimer = 0;
      checkAchievements();
      renderShop();
    }
    requestAnimationFrame(frame);
  }

  applyOffline();
  renderScene(0);
  renderShop();
  requestAnimationFrame(frame);
  setInterval(save, 5000);
  // Onglet en arrière-plan : la boucle s'arrête, on crédite les lignes au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); audio.setPouring(false); wasPouring = false; }
    else { applyOffline(); last = performance.now(); }
  });
  window.addEventListener('pagehide', save);
})();
