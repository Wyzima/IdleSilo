# Idle Silo

Jeu incrémental (type *cookie clicker*) aux couleurs d'Exventys : un silo se vide
par une vis d'Archimède dans un camion.

- Chaque clic sur le silo y verse un godet ; la vis remplit la benne, le camion
  part livrer quand elle est pleine.
- 30 matériaux avec prix, densité et écoulement propres.
- Commandes clients à durée limitée, avec prime.
- Équipements à niveaux, chargeuse automatique, lignes de production passives.
- Méthodes (QFD, Taguchi, TOC, éléments finis, TRIZ, co-engineering).
- 24 succès (+2 % chacun) et prestige « Brevets INPI » (+5 % par brevet).
- Sons synthétisés (bouton pour couper) et grains animés.

## Lancer le jeu

Ouvrir `jeu/index.html` dans un navigateur. Aucune installation n'est nécessaire.

## Fichiers

- `jeu/index.html` : structure de la page et scène SVG (silo, vis, camion)
- `jeu/style.css` : charte graphique (or `#E5B034`, noir, Roboto / Roboto Slab)
- `jeu/data.js` : données (matériaux, clients, équipements, lignes, méthodes, succès)
- `jeu/audio.js` : sons générés avec la Web Audio API
- `jeu/game.js` : règles du jeu, rendu, particules, sauvegarde

La progression est sauvegardée dans le navigateur du joueur (`localStorage`).
