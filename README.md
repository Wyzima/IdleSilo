# Idle Silo

Jeu incrémental (type *cookie clicker*) aux couleurs d'Exventys : un silo se vide
par une vis d'Archimède dans un camion.

- Chaque clic sur le silo y verse un godet ; la vis remplit la benne, le camion
  part livrer quand elle est pleine.
- 30 matériaux avec prix, densité et écoulement propres.
- Commandes clients à durée limitée, avec prime.
- Jusqu'à 6 silos, chacun avec son matériau, sa vis, son camion et son
  alimentation automatique ; le camion s'allonge avec sa capacité
  (porteur, semi-remorque, train routier, convoi exceptionnel).
- Tous les silos sur une même image (canvas) : cliquez sur un silo pour le
  sélectionner et y verser un godet ; l'emplacement vide sert à construire le suivant.
- Tout est accessible sur une seule page, sans onglets.
- Équipements à niveaux et lignes de production passives.
- Méthodes (QFD, Taguchi, TOC, éléments finis, TRIZ, co-engineering).
- 24 succès (+2 % chacun) et prestige « Brevets INPI » (+5 % par brevet).
- Sons synthétisés (bouton pour couper) et grains animés.

## Lancer le jeu

Ouvrir `jeu/index.html` dans un navigateur. Aucune installation n'est nécessaire.

## Fichiers

- `jeu/index.html` : structure de la page
- `jeu/style.css` : charte graphique (or `#E5B034`, noir, Barlow Condensed / Roboto)
- `jeu/scene.js` : dessin de la scène en canvas (silos en coupe, vis, camions, particules)
- `jeu/data.js` : données (matériaux, clients, équipements, lignes, méthodes, succès)
- `jeu/audio.js` : sons générés avec la Web Audio API
- `jeu/game.js` : règles du jeu, rendu, particules, sauvegarde
- `jeu/img/logo-exventys.jpg` : logo repris du site exventys.com

La progression est sauvegardée dans le navigateur du joueur (`localStorage`).
