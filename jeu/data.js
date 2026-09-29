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
  ];

  Object.assign(window.IdleSilo, {
    roundNice, MATERIALS, CLIENTS, EQUIPMENT, LINES, METHODS, ACHIEVEMENTS,
  });
})();
