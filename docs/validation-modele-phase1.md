# ApprentiFR — Protocole de validation du modèle territorial (phase 1)

**Statut : audit technique exploratoire ; seuils et modèle non validés scientifiquement.**  
**Version logicielle :** `adminTerritorialModelAudit.phase1.v1`.  
**Accès :** Admin > Analyse > Validation du modèle (`/admin/validation-modele`).

## Objet

Mesurer la cohérence des données qui sous-tendent les indices départementaux,
leur traçabilité, les situations provisoires, et la différence de classification
entre le modèle actuel et le nouveau modèle pondéré. Une couleur rouge ne signifie
pas qu'un individu échouera à trouver un contrat : elle représente des opportunités
**observées**, contextualisées relativement à la population jeune et au tissu
économique. Le périmètre est national et **tous métiers**.

Il ne s'agit pas d'une estimation directe des places disponibles, du nombre
de candidats à un apprentissage, des entreprises qui recrutent réellement,
ou de la probabilité de signer un contrat.

## Procédure de lancement

1. Se connecter à l'administration.
2. Ouvrir `/admin/validation-modele`, choisir le mois.
3. Cliquer sur **Lancer l'audit**. L'analyse utilise la réponse Admin authentifiée
   `getAdminMonthlySettings(month)` (lecture uniquement), et la dernière
   publication Firestore `vigilancePublicIndex/latest`, sans recalcul serveur
   des coefficients ni écriture en base.
4. Inspecter les indicateurs de couverture, les alertes critiques,
   la matrice de couleurs et les 101 dossiers.
5. Exporter le CSV local si une revue externe ou une archive de contrôle est utile.
   **Le CSV n'est pas une certification** ; il contient la source/version et
   la provenance de la période observée.

## Contrôles automatisés

- Un département doit disposer d'une ligne mensuelle, de relevés cohérents
  (`0 ≤ jours relevés ≤ jours attendus`) et de valeurs non négatives.
- La population INSEE de référence actuellement utilisée est **15–29 ans**,
  pas 14–29 ans. Elle contextualise l'offre et ne représente pas le nombre
  réel de candidats.
- Le nombre d'établissements employeurs est **tous secteurs**, non une
  liste d'entreprises recrutant des apprentis.
- Les ratios **mensuels bruts** sont recalculés pour vérifier la cohérence
  arithmétique :
  `offres moyennes / population 15–29 × 10 000` et
  `offres moyennes / établissements × 100` (si dénominateurs valides).
  **Ce recalcul de contrôle n'est pas un recalcul des scores.**
- Les doublons de code départemental, les absences de score,
  les scores basés uniquement sur la densité et les composantes absentes
  sont détectés. Un zéro observé est valide et distinct d'un manque de données.
- Une couleur peut être calculable avec un **score pondéré provisoire** même
  lorsque la composante tendance M−1/M−12 est indisponible. La présence des
  quatre dimensions est donc examinée indépendamment du libellé « provisoire ».
- Le score provisoire repose sur une **fenêtre de journées communes** entre
  départements, qui peut différer des jours utilisés pour les moyennes brutes
  du mois. La provenance (nombre de jours, cohortes et méthode) est affichée.
  Un score fondé sur seulement 3 jours ne vaut **pas validation statistique**.
- Seuils de simulation actuels : rouge `0–<30`, orange `30–<45`,
  jaune `45–<60`, vert `60–100`. Le nombre de valeurs situées à
  ±3 points d'une frontière est indiqué, **sans prétendre tester les poids**.
- Le facteur de correction saisonnier reste à `1,00`. Un autre facteur
  est un point à vérifier.
- Une référence nationale avec moins de 75 départements éligibles et des
  calculs pondérés est un point à signaler.

## Comparaison des méthodes

La carte de gauche représente le **dernier niveau publié**, avec sa date.
La carte de droite représente le **nouveau calcul expérimental du mois demandé**.
On ne doit jamais présenter une différence de couleur entre ces cartes comme
une dégradation ou une amélioration **dans le temps** : l'échelle, la période
et les critères ne sont pas comparables directement.

Les départements qui apparaissent **verts par défaut** sur la carte publique
en l'absence de vigilance explicitement publiée sont exclus de la matrice
des transitions « comparables ». Ils restent visibles dans le tableau, avec
un indicateur `vert (défaut)`.

Une couleur basée sur la **densité seule** est visible et étiquetée comme telle,
mais ne doit jamais être décrite comme un score pondéré complet.

## Limites et suite

**À réaliser avant une décision de bascule :**

- Auditer et expliquer les départements dont la classification diverge fortement.
- Quantifier réellement la sensibilité des scores aux coefficients
  (`±0,5`, y compris les changements de couleur), les dénominateurs et les
  seuils. Une simple proximité à un seuil ne remplace pas ces simulations.
- Contrôler la dépendance mathématique des trois rapports
  `offres/jeunes`, `établissements/jeunes` et `offres/établissements` :
  ils ne sont pas trois observations indépendantes.
- Étudier un historique de plusieurs mois complets et, pour la saisonnalité,
  idéalement plusieurs années ; ne pas estimer de facteur saisonnier
  sur une fenêtre provisoire.
- Évaluer explicitement 15–29 ans contre une éventuelle population 14–29 ans
  avant de changer le dénominateur, en tenant compte de la disponibilité INSEE,
  de la réglementation des âges et du champ réellement pertinent.
- Confronter les signaux aux séries externes officielles (DARES/DEPP)
  en documentant les différences de périmètre entre **offres**, **contrats**
  et **effectifs en formation**.
- Conserver les versions de sources et de méthodes pour pouvoir reproduire
  les évolutions de classement.

**Aucune publication de vigilance, modification d'accueil, écriture Firestore
ni déploiement de Functions n'est déclenché par cet audit.**

Suivi : issue GitHub **#144**.
