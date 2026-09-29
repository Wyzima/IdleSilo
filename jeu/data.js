// Données du jeu : matériaux, équipements, lignes, méthodes, succès.
// Les prix de vente sont des valeurs de jeu ; densités et écoulements sont réalistes.
window.IdleSilo = window.IdleSilo || {};

(() => {
  'use strict';

  function roundNice(n) {
    if (n < 100) return Math.round(n);
    const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  }

  // [id, nom, couleur, catégorie, densité (t/m³), écoulement dans la vis (1 = 100 %)]
  const MATERIALS = [
    ['sable', 'Sable', '#d8c08a', 'btp', 1.6, 1.1],
    ['gravier', 'Gravier', '#9b9b9b', 'btp', 1.7, 0.9],
    ['calcaire', 'Calcaire concassé', '#dcd6c6', 'btp', 1.5, 0.9],
    ['argile', 'Argile', '#b5693c', 'btp', 1.8, 0.6],
    ['sel', 'Sel de déneigement', '#f0f0f0', 'chimie', 1.2, 1.0],
    ['charbon', 'Charbon', '#2b2b2b', 'mine', 0.8, 0.9],
    ['ciment', 'Ciment', '#a7a9ac', 'btp', 1.4, 0.8],
    ['chaux', 'Chaux vive', '#efece2', 'btp', 0.9, 0.7],
    ['platre', 'Plâtre', '#f6f3ea', 'btp', 1.0, 0.7],
    ['fer', 'Minerai de fer', '#7b3b2a', 'mine', 2.4, 0.8],
    ['ble', 'Blé', '#e0b54a', 'agro', 0.78, 1.2],
    ['orge', 'Orge', '#d4b06a', 'agro', 0.65, 1.1],
    ['mais', 'Maïs', '#f2c12e', 'agro', 0.72, 1.2],
    ['soja', 'Soja', '#e4cf8f', 'agro', 0.75, 1.2],
    ['colza', 'Colza', '#3b2a1e', 'agro', 0.68, 1.3],
    ['tournesol', 'Graines de tournesol', '#444444', 'agro', 0.42, 1.0],
    ['riz', 'Riz', '#f4eee0', 'agro', 0.85, 1.2],
    ['farine', 'Farine', '#fbf7ef', 'agro', 0.55, 0.5],
    ['sucre', 'Sucre', '#ffffff', 'agro', 0.85, 1.0],
    ['bois', 'Granulés de bois', '#b8864b', 'energie', 0.65, 1.1],
    ['npk', 'Engrais NPK', '#8fb3d9', 'chimie', 1.1, 1.0],
    ['uree', 'Urée', '#f7f7f7', 'chimie', 0.75, 1.1],
    ['alumine', 'Alumine', '#e3e3ec', 'mine', 1.0, 0.8],
    ['verre', 'Billes de verre', '#cfe8ea', 'chimie', 1.5, 1.3],
    ['pvc', 'Granulés PVC', '#e6e6e6', 'plasturgie', 0.6, 1.2],
    ['pehd', 'Granulés PEHD', '#9fc5e8', 'plasturgie', 0.55, 1.2],
    ['pp', 'Granulés PP', '#f6d365', 'plasturgie', 0.52, 1.2],
    ['epdm', 'Granulés EPDM', '#222222', 'plasturgie', 0.6, 0.9],
    ['cafe', 'Café vert', '#8a9a5b', 'agro', 0.65, 1.1],
    ['cacao', 'Fèves de cacao', '#5a3825', 'agro', 0.6, 1.0],
  ].map(([id, name, color, category, density, flow], i) => ({
    id, name, color, category, density, flow,
    price: roundNice(10 * Math.pow(1.32, i)),
    unlockCost: i === 0 ? 0 : roundNice(250 * Math.pow(2.05, i - 1)),
  }));

  // Clients fictifs par catégorie de matériau.
  const CLIENTS = {
    btp: ['Entreprise de travaux publics', 'Centrale à béton', 'Négociant en matériaux'],
    mine: ['Aciérie', 'Fonderie', 'Centrale thermique'],
    chimie: ['Service des routes', 'Verrerie', 'Distributeur agricole'],
    agro: ['Coopérative céréalière', 'Minoterie', 'Chocolaterie', 'Industriel agroalimentaire'],
    energie: ['Chaufferie collective', 'Réseau de chaleur'],
    plasturgie: ['Plasturgiste', 'Mouliste', 'Fabricant de joints techniques'],
  };

  // Équipement de la ligne principale (achats à niveaux).
  const EQUIPMENT = [
    { id: 'godet', name: 'Godet de chargeuse', maxLevel: 40, costBase: 20, costGrowth: 2.0 },
    { id: 'silo', name: 'Silo agrandi', maxLevel: 40, costBase: 30, costGrowth: 2.2 },
    { id: 'vis', name: "Moteur de vis d'Archimède", maxLevel: 40, costBase: 40, costGrowth: 1.9 },
    { id: 'camion', name: 'Camion plus grand', maxLevel: 40, costBase: 80, costGrowth: 2.3 },
    { id: 'auto', name: 'Alimentation automatique', maxLevel: 50, costBase: 150, costGrowth: 1.8 },
  ];

  // Lignes automatiques : débit passif en m³/s du matériau sélectionné.
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

  // Niveau le plus élevé d'un équipement parmi tous les silos.
  const maxLevel = (s, id) => Math.max(...s.sites.map(site => site.levels[id]));

  // Méthodes : achats uniques, inspirés des méthodes présentées sur exventys.com.
  const METHODS = [
    { id: 'taguchi', name: 'Plans d\'expérience Taguchi', desc: 'Débit de la vis ×1,5', cost: 2000,
      unlock: s => maxLevel(s, 'vis') >= 3 },
    { id: 'qfd', name: 'Voix du client (QFD)', desc: 'Primes des commandes ×1,5', cost: 5000,
      unlock: s => s.orders.completed >= 1 },
    { id: 'toc', name: 'Théorie des contraintes (TOC)', desc: 'Rotation des camions deux fois plus rapide', cost: 20000,
      unlock: s => s.trucks >= 50 },
    { id: 'fea', name: 'Analyse par éléments finis', desc: 'Volume du silo et du godet ×2', cost: 60000,
      unlock: s => maxLevel(s, 'silo') >= 5 },
    { id: 'triz', name: 'Innovation TRIZ', desc: 'Toutes les ventes ×1,5', cost: 250000,
      unlock: s => s.runEarned >= 1e5 },
    { id: 'coeng', name: 'Co-engineering', desc: 'Lignes automatiques ×2', cost: 2e6,
      unlock: s => Object.values(s.lines).reduce((a, b) => a + b, 0) >= 25 },
  ];

  // Succès : chacun donne +2 % sur toutes les ventes.
  const totalLines = s => Object.values(s.lines).reduce((a, b) => a + b, 0);
  const ACHIEVEMENTS = [
    { id: 'truck1', name: 'Premier départ', desc: 'Livrer 1 camion', test: s => s.stats.trucks >= 1 },
    { id: 'truck10', name: 'Petit transporteur', desc: 'Livrer 10 camions', test: s => s.stats.trucks >= 10 },
    { id: 'truck100', name: 'Flotte régionale', desc: 'Livrer 100 camions', test: s => s.stats.trucks >= 100 },
    { id: 'truck1000', name: 'Roi du vrac', desc: 'Livrer 1 000 camions', test: s => s.stats.trucks >= 1000 },
    { id: 'tons100', name: 'Cent tonnes', desc: 'Livrer 100 t au total', test: s => s.stats.tons >= 100 },
    { id: 'tons10k', name: 'Dix mille tonnes', desc: 'Livrer 10 000 t au total', test: s => s.stats.tons >= 1e4 },
    { id: 'tons1m', name: 'Million de tonnes', desc: 'Livrer 1 000 000 t au total', test: s => s.stats.tons >= 1e6 },
    { id: 'click100', name: 'Coup de pelle', desc: 'Verser 100 godets à la main', test: s => s.stats.clicks >= 100 },
    { id: 'click1000', name: 'Bras d\'acier', desc: 'Verser 1 000 godets à la main', test: s => s.stats.clicks >= 1000 },
    { id: 'mat5', name: 'Polyvalent', desc: 'Débloquer 5 matériaux', test: s => s.unlocked.length >= 5 },
    { id: 'mat15', name: 'Catalogue fourni', desc: 'Débloquer 15 matériaux', test: s => s.unlocked.length >= 15 },
    { id: 'mat30', name: 'Tout le catalogue', desc: 'Débloquer les 30 matériaux', test: s => s.unlocked.length >= 30 },
    { id: 'silo2', name: 'Deuxième silo', desc: 'Posséder 2 silos', test: s => s.sites.length >= 2 },
    { id: 'silo6', name: 'Parc de silos', desc: 'Posséder 6 silos', test: s => s.sites.length >= 6 },
    { id: 'autoAll', name: 'Usine autonome', desc: 'Alimentation automatique sur 3 silos', test: s => s.sites.filter(x => x.levels.auto > 0).length >= 3 },
    { id: 'line1', name: 'Automatisation', desc: 'Acheter une ligne automatique', test: s => totalLines(s) >= 1 },
    { id: 'line50', name: 'Usine tentaculaire', desc: 'Posséder 50 lignes automatiques', test: s => totalLines(s) >= 50 },
    { id: 'allLines', name: 'Gamme complète', desc: 'Posséder chaque type de ligne', test: s => Object.values(s.lines).every(n => n > 0) },
    { id: 'order1', name: 'Premier client', desc: 'Honorer une commande', test: s => s.stats.orders >= 1 },
    { id: 'order10', name: 'Fournisseur fiable', desc: 'Honorer 10 commandes', test: s => s.stats.orders >= 10 },
    { id: 'order50', name: 'Partenaire privilégié', desc: 'Honorer 50 commandes', test: s => s.stats.orders >= 50 },
    { id: 'money1k', name: 'Premiers mille', desc: 'Gagner 1 000 € au total', test: s => s.stats.earned >= 1e3 },
    { id: 'money1m', name: 'Millionnaire', desc: 'Gagner 1 M€ au total', test: s => s.stats.earned >= 1e6 },
    { id: 'money1b', name: 'Milliardaire', desc: 'Gagner 1 Md€ au total', test: s => s.stats.earned >= 1e9 },
    { id: 'methods', name: 'Boîte à outils complète', desc: 'Acquérir toutes les méthodes', test: s => s.methods.length >= METHODS.length },
    { id: 'patent1', name: 'Inventeur', desc: 'Déposer un premier brevet', test: s => s.patents >= 1 },
    { id: 'patent25', name: 'Talent INPI', desc: 'Détenir 25 brevets', test: s => s.patents >= 25 },
    { id: 'press100', name: 'Première série', desc: 'Mouler 100 pièces', test: s => s.stats.pressClicks >= 100 },
    { id: 'press1000', name: 'Production de masse', desc: 'Mouler 1 000 pièces', test: s => s.stats.pressClicks >= 1000 },
    { id: 'press10k', name: 'Cadence industrielle', desc: 'Mouler 10 000 pièces', test: s => s.stats.pressClicks >= 1e4 },
    { id: 'combo5', name: 'Pleine cadence', desc: 'Atteindre la cadence ×5', test: s => s.stats.maxCombo >= 5 },
    { id: 'golden1', name: 'Livraison en or', desc: 'Attraper un camion doré', test: s => s.stats.golden >= 1 },
    { id: 'golden25', name: 'Chasseur de primes', desc: 'Attraper 25 camions dorés', test: s => s.stats.golden >= 25 },
    { id: 'style', name: 'Image de marque', desc: 'Acheter une personnalisation', test: s => s.cosmetics.owned.length > 4 },
  ];

  // Presse à injection : les pièces moulées, de la plus simple à la plus chère.
  // Inspirées des réalisations présentées sur exventys.com.
  const PARTS = [
    { name: 'Joint torique', color: '#1f1f1f', shape: 'ring' },
    { name: 'Pince de serrage', color: '#9aa1a8', shape: 'collet' },
    { name: 'Écaille élastomère', color: '#2f6b33', shape: 'scale' },
    { name: 'Support de disque abrasif', color: '#e5b034', shape: 'disc' },
    { name: 'Joint de baie ferroviaire', color: '#3a3d42', shape: 'profile' },
    { name: 'Pièce en polyéthylène', color: '#6fa8dc', shape: 'box' },
    { name: 'Raccord de fond vibrant', color: '#8a1322', shape: 'ring' },
    { name: 'Spire Archimedys™', color: '#b3202f', shape: 'scale' },
  ];

  // Améliorations de l'atelier (achats à niveaux).
  const PRESS_UPGRADES = [
    { id: 'tier', name: 'Gamme de pièces', maxLevel: PARTS.length - 1, costBase: 100, costGrowth: 12 },
    { id: 'molds', name: 'Moule multi-empreintes', maxLevel: 8, costBase: 250, costGrowth: 8 },
    { id: 'eng', name: 'Ingénierie de production', maxLevel: 10, costBase: 2000, costGrowth: 6.5 },
  ];

  // Personnalisations : achetées une fois, conservées après un dépôt de brevets.
  const COSMETICS = {
    truck: {
      label: 'Camions',
      items: [
        { id: 'or', name: 'Or Exventys', cost: 0, c: { bedTop: '#f1c555', bedBot: '#b8861a', rail: '#8a6412', cabTop: '#f3c650', cabBot: '#c99317', stripe: '#111111' } },
        { id: 'rouge', name: 'Rouge', cost: 2000, c: { bedTop: '#e0454f', bedBot: '#9e1b27', rail: '#6d0d15', cabTop: '#e4505a', cabBot: '#a31d29', stripe: '#ffffff' } },
        { id: 'bleu', name: 'Bleu', cost: 2000, c: { bedTop: '#4f8fd6', bedBot: '#1f4f8a', rail: '#153659', cabTop: '#5a9be0', cabBot: '#23558f', stripe: '#ffffff' } },
        { id: 'vert', name: 'Vert', cost: 25000, c: { bedTop: '#5fae63', bedBot: '#2e6b35', rail: '#1d4a22', cabTop: '#66b86a', cabBot: '#316f38', stripe: '#f4d35e' } },
        { id: 'noir', name: 'Noir mat', cost: 250000, c: { bedTop: '#3a3d42', bedBot: '#16181b', rail: '#000000', cabTop: '#44474d', cabBot: '#1b1d20', stripe: '#e5b034' } },
        { id: 'chrome', name: 'Chrome', cost: 5e6, c: { bedTop: '#f7f8f9', bedBot: '#8f969d', rail: '#5f656b', cabTop: '#ffffff', cabBot: '#9aa1a8', stripe: '#e5b034' } },
      ],
    },
    silo: {
      label: 'Silos',
      items: [
        { id: 'galva', name: 'Acier galvanisé', cost: 0, c: { light: '#eceae4', dark: '#8a8d91', roofLight: '#e6e4de', roofDark: '#6c7075', ring: '#7d8187' } },
        { id: 'blanc', name: 'Blanc', cost: 3000, c: { light: '#ffffff', dark: '#b3b7bc', roofLight: '#ffffff', roofDark: '#9da1a6', ring: '#c4c8cc' } },
        { id: 'rouge', name: 'Rouge', cost: 30000, c: { light: '#e8737b', dark: '#8d1822', roofLight: '#ef8b92', roofDark: '#8d1822', ring: '#6d0d15' } },
        { id: 'vert', name: 'Vert agricole', cost: 30000, c: { light: '#8fca8a', dark: '#2f6b33', roofLight: '#9fd49a', roofDark: '#2f6b33', ring: '#24542a' } },
        { id: 'bleu', name: 'Bleu', cost: 300000, c: { light: '#8fbbe9', dark: '#23558f', roofLight: '#9cc4ee', roofDark: '#23558f', ring: '#1b4270' } },
        { id: 'or', name: 'Or', cost: 1e7, c: { light: '#f6dc8e', dark: '#a77a12', roofLight: '#f9e4a6', roofDark: '#a77a12', ring: '#8a6412' } },
      ],
    },
    screw: {
      label: 'Vis',
      items: [
        { id: 'rouge', name: 'Rouge', cost: 0, c: { hi: '#c0303f', mid: '#8a1322', lo: '#4a0811', core: '#6d0d19' } },
        { id: 'jaune', name: 'Jaune', cost: 5000, c: { hi: '#f2cc5a', mid: '#c9971c', lo: '#7a5a0a', core: '#9c7414' } },
        { id: 'bleu', name: 'Bleu', cost: 50000, c: { hi: '#6aa5e6', mid: '#2a5d9c', lo: '#163459', core: '#1f4a7c' } },
        { id: 'inox', name: 'Inox', cost: 500000, c: { hi: '#f7f8f9', mid: '#aab0b6', lo: '#6b7178', core: '#8d9399' } },
      ],
    },
    bg: {
      label: 'Décor',
      items: [
        { id: 'matin', name: 'Matin doré', cost: 0 },
        { id: 'midi', name: 'Plein jour', cost: 10000 },
        { id: 'couchant', name: 'Coucher de soleil', cost: 150000 },
        { id: 'hiver', name: 'Hiver', cost: 1.5e6 },
        { id: 'nuit', name: 'Nuit', cost: 2e7 },
      ],
    },
  };

  Object.assign(window.IdleSilo, {
    roundNice, MATERIALS, CLIENTS, EQUIPMENT, LINES, METHODS, ACHIEVEMENTS,
    PARTS, PRESS_UPGRADES, COSMETICS,
  });
})();
