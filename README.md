# Idle Silo

Jeu incrémental (type *cookie clicker*) aux couleurs d'Exventys : un silo se vide
par une vis d'Archimède dans un camion. Cliquez sur le silo pour le remplir,
livrez des camions, améliorez la ligne, automatisez et débloquez 30 matériaux.

## Lancer le jeu

Ouvrir `jeu/index.html` dans un navigateur. Aucune installation n'est nécessaire.

## Fichiers

- `jeu/index.html` : structure de la page et scène SVG (silo, vis, camion)
- `jeu/style.css` : charte graphique (or `#E5B034`, noir, Roboto / Roboto Slab)
- `jeu/game.js` : règles du jeu, données (matériaux, équipements, lignes), sauvegarde

La progression est sauvegardée dans le navigateur du joueur (`localStorage`).
