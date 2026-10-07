# ApprentiFR

ApprentiFR est un observatoire public de la tension du marché de l’apprentissage en France.

L’application présente une carte départementale inspirée des niveaux de vigilance :

- Vert : situation normale
- Jaune : vigilance
- Orange : tension importante
- Rouge : tension critique

## Fonctionnalités

- carte interactive des départements ;
- bulletins départementaux ;
- analyses par secteur ;
- données issues notamment de l’API La bonne alternance et de l’INSEE ;
- espace d’administration pour calculer, vérifier et publier les vigilances ;
- historique quotidien des offres et indicateurs de confiance.

## Technologies

- React
- Vite
- Firebase
- Firestore
- Firebase Functions
- GitHub Actions

## Développement local

```bash
npm install
npm run dev
```

Pour vérifier la compilation :

```bash
npm run build
```

Pour vérifier la syntaxe des Functions :

```bash
node --check functions/index.js
```

## Attribution cartographique

Les tracés SVG des départements métropolitains proviennent du paquet
`@svg-maps/france.departments`, distribué sous licence CC BY 4.0.

Source : https://github.com/VictorCazanave/svg-maps
