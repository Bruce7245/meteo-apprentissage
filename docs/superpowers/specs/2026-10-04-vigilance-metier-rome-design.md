# Conception — Vigilance métier ROME pré-calculée quotidiennement

- **Issue :** #36
- **Date :** 2026-10-04
- **Statut :** proposition validée en conversation, à relire avant plan d’implémentation
- **Branche de conception :** `design/occupation-vigilance-36`

## 1. Objectif

Ajouter à ApprentiFR une lecture publique centrée sur un **métier précis (code ROME)** tout en conservant la carte nationale actuelle.

La carte nationale conserve deux modes :

1. **Mode global** : situation générale de l’apprentissage par département.
2. **Mode métier** : après sélection d’un code ROME, la même carte se recolore avec la vigilance calculée pour ce métier dans chaque département.

Le but n’est pas de produire un classement de territoires, mais de répondre à la question :

> « Pour ce métier, ce département est-il actuellement tendu pour trouver une offre d’apprentissage ? »

La vigilance métier est un calcul déterministe. L’IA n’intervient que pour rédiger un bulletin explicatif à partir d’un résultat déjà calculé.

## 2. Principes métier

### 2.1 Unité de calcul

L’unité de décision est :

`date × département × code ROME`

Le code ROME est l’unité métier de référence. Les grandes familles de secteurs restent utiles pour l’agrégation et l’explication, mais ne remplacent pas le ROME pour la couleur métier.

### 2.2 Signal principal

Le **nombre d’offres actives correspondant au code ROME** est le signal principal de la vigilance.

Les autres variables servent à contextualiser ce nombre d’offres :

- population totale ;
- population 15–29 ans ;
- tissu employeur observé ;
- diversité des employeurs / activités observées ;
- formations et sessions rattachées au ROME ;
- saisonnalité lorsque l’historique est suffisant ;
- évolution récente du volume d’offres.

Elles ne doivent pas pouvoir transformer artificiellement un très faible volume d’offres en situation favorable.

### 2.3 États publiables

Un snapshot métier doit produire exactement un état parmi :

- `green`
- `yellow`
- `orange`
- `red`
- `insufficient_data`

`insufficient_data` est un état métier de premier rang et non une erreur technique.

La couleur n’est jamais la seule information affichée : tout état public possède un libellé texte et une explication courte.

## 3. Parcours utilisateur

### 3.1 Navigation publique

Le menu public contient au minimum :

- **Carte nationale**
- **Métiers & formations**

La page `/` reste la carte nationale globale.

La page `/metiers` utilise le même composant de carte nationale mais permet de sélectionner un métier.

### 3.2 Recherche métier

L’utilisateur recherche un métier par son libellé.

Le moteur retourne des entrées ROME provenant du référentiel officiel importé et versionné.

Après sélection :

`/metiers?rome=D1108`

La carte se recolore avec la vigilance du ROME sélectionné.

### 3.3 Recherche formation

L’utilisateur peut rechercher une formation connue du catalogue importé.

Une formation ne reçoit pas directement une couleur globale si plusieurs métiers lui sont rattachés.

Le parcours est :

`formation → codes ROME réellement rattachés → choix du métier → carte métier`

Aucun métier n’est inventé par IA.

Si la formation n’a aucun ROME exploitable, l’interface l’indique explicitement.

### 3.4 Passage à la fiche département

En mode métier, cliquer sur un département conserve le contexte :

`/departement/72?rome=D1108`

Si la recherche provenait d’une formation, un identifiant public de formation ou RNCP peut être conservé en paramètre secondaire uniquement pour l’affichage du contexte, sans intervenir dans le calcul de la couleur.

La fiche département métier affiche :

- métier sélectionné et code ROME ;
- vigilance métier ;
- offres actives ;
- postes à pourvoir ;
- tendance récente ;
- contexte démographique ;
- formations / sessions liées ;
- diversité observée ;
- saisonnalité si exploitable ;
- bulletin de vigilance en premier onglet ;
- offres du métier dans le second onglet.

## 4. Sources de données

### 4.1 Offres

Source principale : snapshots d’offres déjà importés.

Chaque offre utile au calcul doit avoir :

- département effectif validé ;
- état actif exploitable ;
- un ou plusieurs `romeCodes` ;
- nombre de postes ;
- date d’observation ;
- identifiant stable interne.

Les offres hors département ou géographiquement indéterminées sont exclues du numérateur départemental métier.

### 4.2 Référentiel ROME

Créer un référentiel interne versionné `occupationReference` issu d’une source officielle ROME déjà utilisée par le projet (France Travail / open data).

Chaque entrée expose au minimum :

- `romeCode`
- `label`
- `normalizedLabel`
- `searchTerms`
- `source`
- `sourceVersion`
- `importedAt`

Les correctifs manuels sont interdits dans le chemin public sauf s’ils sont documentés, versionnés et testés comme une règle de référence explicite.

### 4.3 Formations

Les formations importées servent uniquement lorsque le rattachement à un ROME est présent dans les données sources du projet.

Construire une projection publique nationale dédupliquée, sans coordonnées privées d’organisme :

- identifiant public stable ;
- RNCP si disponible ;
- intitulé ;
- intitulé normalisé ;
- codes ROME rattachés ;
- date de fraîcheur.

Aucun SIRET, UAI, adresse précise ou donnée brute de catalogue n’est nécessaire à la recherche publique.

### 4.4 Population

Ajouter une référence démographique départementale provenant d’une source publique officielle INSEE.

La référence contient :

- `departmentCode`
- `populationTotal`
- `population15To29`
- `referenceYear`
- `source`
- `sourceVersion`
- `importedAt`

La population est une donnée de contexte à mise à jour périodique, pas un import quotidien. Le job journalier utilise la dernière référence valide et conserve son année/source dans la provenance du snapshot.

### 4.5 Employeurs et diversité

Pour la première version, les métriques métier utilisent des données **observées et défendables** :

- nombre d’employeurs distincts observés dans les offres du ROME sur la fenêtre définie ;
- diversité des codes NAF observés ;
- concentration des offres entre employeurs / activités.

Les données INSEE d’établissements peuvent être utilisées comme contexte sectoriel seulement lorsqu’un pont ROME ↔ NAF est validé et versionné.

Aucune notion « d’employeur juridiquement éligible » n’est déduite sans source réglementaire dédiée.

## 5. Historique et saisonnalité

### 5.1 Historique récent

Le moteur conserve un historique quotidien par ROME et département afin de calculer :

- tendance récente ;
- stabilité du signal ;
- disparition / reprise du volume.

La tendance récente est distincte de la saisonnalité.

### 5.2 Activation de la saisonnalité

La saisonnalité ne modifie pas la vigilance tant que l’historique local n’est pas assez représentatif.

Règle de publication :

- historique local < 12 mois complets : saisonnalité non calculée ;
- 12 à 23 mois complets : saisonnalité descriptive seulement, coefficient neutre ;
- ≥ 24 mois complets : coefficient saisonnier local autorisé si la complétude mensuelle du jeu historique atteint le seuil de qualité défini dans la configuration versionnée.

Si la condition n’est pas satisfaite, `seasonalityFactor = 1`.

Le public voit alors « saisonnalité en constitution » plutôt qu’une tendance artificielle.

## 6. Moteur de vigilance déterministe

### 6.1 Séparation calcul / configuration

Le code du moteur est une bibliothèque pure.

Les valeurs de calibration sont contenues dans une configuration versionnée :

`occupationVigilanceConfig.v1`

La configuration contient :

- fenêtres temporelles ;
- bornes de facteurs ;
- seuils de qualité ;
- seuils de vigilance ;
- paramètres de normalisation ;
- version de la méthode.

Aucun coefficient de production ne doit être introduit sans preuve de calibration.

### 6.2 Construction de l’attendu

Le moteur compare les offres observées à un **volume attendu contextualisé**.

Forme conceptuelle :

`expectedOffers = baseRomeDemand × populationFactor × employerFactor × seasonalityFactor × trainingPressureFactor`

Contraintes :

- `baseRomeDemand` est dérivé d’un jeu historique de calibration, jamais saisi arbitrairement ;
- les facteurs sont bornés pour conserver les offres comme signal dominant ;
- un facteur indisponible prend une valeur neutre et dégrade éventuellement la confiance ;
- la diversité observée est principalement un signal de robustesse / confiance et ne peut pas compenser un manque d’offres ;
- les données de formation peuvent augmenter la pression attendue mais ne peuvent pas rendre un marché artificiellement favorable.

Le rapport principal est :

`observedVsExpectedRatio = activeOffersCount / expectedOffers`

### 6.3 Calibration

Avant activation publique d’une version de calcul :

1. figer un jeu historique de calibration ;
2. produire les distributions par ROME et département ;
3. dériver les paramètres ;
4. enregistrer les paramètres dans la configuration versionnée ;
5. exécuter les jeux de tests métier ;
6. produire un rapport de calibration ;
7. valider la version avant publication.

Si aucune configuration validée n’existe, le job peut produire des données préparatoires mais ne peut pas publier de nouvelle vigilance métier.

### 6.4 Données insuffisantes

Le moteur retourne `insufficient_data` notamment si :

- aucune observation récente fiable d’offres n’est disponible ;
- le ROME n’est pas reconnu ;
- la géolocalisation des offres disponibles ne permet pas un calcul départemental fiable ;
- la configuration de calcul est absente ou incompatible ;
- les contrôles de cohérence du lot échouent.

L’absence d’un facteur secondaire (ex. saisonnalité) ne suffit pas seule à produire `insufficient_data` : le facteur devient neutre et la confiance est abaissée.

## 7. Pré-calcul quotidien

### 7.1 Déclenchement

Le calcul ne dépend pas d’une heure fixe isolée.

Il démarre uniquement lorsque les dépendances obligatoires du jour sont prêtes :

1. import / snapshot offres terminé ;
2. agrégations formations disponibles ou explicitement marquées indisponibles ;
3. référence ROME compatible ;
4. référence population valide ;
5. configuration de vigilance active.

Les sources secondaires absentes sont gérées selon les règles de neutralité / confiance.

### 7.2 Run quotidien

Chaque exécution possède :

- `runId`
- `date`
- `calculationVersion`
- `configVersion`
- versions de sources ;
- date de début / fin ;
- compteurs attendus / produits / rejetés ;
- erreurs ;
- statut `building | validating | ready | published | failed`.

### 7.3 Publication atomique

Aucune carte publique ne lit directement un lot en construction.

Collections logiques :

- `occupationVigilanceRuns` : métadonnées de run ;
- `occupationVigilanceSnapshots` : résultat complet interne par département × ROME ;
- `publicOccupationVigilanceMaps` : projection compacte par ROME pour la carte ;
- `publicOccupationVigilanceDetails` : projection publique par département × ROME ;
- `publicOccupationVigilanceIndex/current` : pointeur vers le run publié.

Séquence :

1. calcul dans un nouveau `runId` ;
2. validation du lot ;
3. génération des projections publiques ;
4. contrôle des volumes et schémas ;
5. transaction de bascule du pointeur `current`.

La bascule du pointeur est le seul moment où le nouveau lot devient visible.

En cas d’échec, le précédent run publié reste actif.

## 8. Schéma du snapshot interne

Champs minimaux :

```text
runId
date
departmentCode
departmentName
romeCode
romeLabel

activeOffersCount
openingsCount
distinctObservedEmployersCount
distinctObservedNafCount
employerConcentration

formationsCount
upcomingSessionsCount
distinctRncpCount

populationTotal
population15To29
populationReferenceYear

recentTrend
seasonalityStatus
seasonalityFactor

expectedOffers
observedVsExpectedRatio

publishedLevel
confidenceLevel
reasonCodes[]

calculationVersion
configVersion
sourceVersions
computedAt
```

Les raisons sont des codes déterministes, par exemple :

- `OFFERS_VERY_LOW_VS_EXPECTED`
- `OFFERS_LOW_VS_EXPECTED`
- `RECENT_TREND_DEGRADING`
- `SEASONAL_LOW_PERIOD`
- `TRAINING_PRESSURE_HIGH`
- `EMPLOYER_DIVERSITY_LOW`
- `SECONDARY_DATA_INCOMPLETE`

Le texte public correspondant est produit par une table de libellés versionnée, indépendamment de l’IA.

## 9. Projections publiques et API

### 9.1 Recherche

Endpoint public :

`getPublicOccupationSearchHttp?q=...`

Il retourne au maximum un petit nombre de résultats :

- type `occupation` ou `training` ;
- libellé ;
- code ROME ou liste de ROME ;
- RNCP / identifiant public si pertinent.

La requête est normalisée côté serveur, limitée en taille et rate-limitée.

Les termes de recherche utilisateur ne sont pas persistés par défaut dans des logs applicatifs.

### 9.2 Carte métier

Endpoint :

`getPublicOccupationMapHttp?rome=D1108`

Réponse :

- date publiée ;
- ROME ;
- libellé ;
- départements ;
- niveau ;
- libellé de niveau ;
- confiance ;
- nombre d’offres actives ;
- drapeau `dataAvailable`.

La réponse ne contient aucun SIRET ni donnée brute.

### 9.3 Détail département métier

Endpoint :

`getPublicOccupationDepartmentHttp?department=72&rome=D1108`

Il expose seulement la projection publique nécessaire à la fiche.

Les offres détaillées restent servies par une projection d’offres sécurisée, filtrée sur ROME, et non en lisant les documents bruts depuis le navigateur.

## 10. Bulletin rédigé par IA

### 10.1 Frontière

L’IA intervient **après** le calcul déterministe.

Entrée autorisée :

- niveau déjà calculé ;
- métriques agrégées publiques ;
- reason codes et libellés ;
- contexte de saisonnalité ;
- contexte de formation ;
- date et provenance non personnelle.

Entrées interdites :

- SIRET ;
- coordonnées personnelles ;
- adresses précises inutiles ;
- données brutes d’offres ;
- secrets ou identifiants internes.

### 10.2 Sortie

Le bulletin IA contient du texte explicatif uniquement.

Il ne peut pas :

- modifier `publishedLevel` ;
- modifier les métriques ;
- écrire une nouvelle raison métier ;
- bloquer la publication du snapshot.

### 10.3 Traçabilité

Stocker séparément :

- `runId`
- `departmentCode`
- `romeCode`
- `model`
- `promptVersion`
- `generatedAt`
- empreinte du snapshot source ;
- statut de génération.

Si le bulletin est absent, invalide ou ne correspond pas à l’empreinte du snapshot courant, l’interface affiche le résumé déterministe.

## 11. UX et accessibilité

- la carte garde le même dessin et la même navigation que le mode global ;
- un bandeau indique clairement « Vigilance métier : <métier> » ;
- une action permet de revenir au mode global ;
- la légende distingue `insufficient_data` des niveaux colorés ;
- chaque département possède un libellé accessible incluant nom, code, métier et niveau ;
- la couleur est toujours accompagnée d’un texte ou badge ;
- recherche, liste de résultats et changement de mode sont utilisables au clavier ;
- les changements dynamiques importants sont annoncés aux technologies d’assistance ;
- le filtre ROME est conservé dans l’URL pour navigation, partage et retour arrière.

## 12. Sécurité et vie privée

Principes :

- privacy by design ;
- minimisation des projections publiques ;
- validation et normalisation serveur de `q`, `rome`, `department` ;
- taille maximale des paramètres ;
- rate limiting des endpoints de recherche et lecture ;
- cache public uniquement sur des payloads non personnels ;
- aucun accès Firestore brut depuis le navigateur aux collections internes ;
- aucun log de secret ;
- pas de conservation par défaut des recherches utilisateur ;
- métadonnées de provenance et versionnement conservées côté snapshot ;
- flux IA limités aux agrégats nécessaires.

Le sous-système ne nécessite pas de compte utilisateur ni de profilage individuel.

## 13. Traçabilité qualité / ISO

La mise en œuvre doit produire des preuves couvrant au minimum les contrôles internes suivants :

- exactitude des résultats et cas limites ;
- cohérence des règles entre carte et fiche ;
- chargement progressif et absence de recalcul global à la consultation ;
- versionnement des API, formats et configurations ;
- navigation clavier, focus, libellés et information non portée par la couleur seule ;
- validation serveur des entrées ;
- journalisation des événements de sécurité sans données personnelles inutiles ;
- provenance et fraîcheur des données ;
- traçabilité Issue → décision → commit → PR → tests ;
- frontière et traçabilité du bulletin IA ;
- fallback déterministe en cas d’indisponibilité IA.

Les référentiels internes de contrôle sont :

- `Grille_Audit_ISO_Logiciels_2026.xlsx`
- `Referentiel_RGPD_Logiciel_2026 (1).xlsx`

## 14. Tests et validation

### 14.1 Bibliothèque de calcul

Tests unitaires obligatoires :

- calcul nominal ;
- zéro offre ;
- très faible volume ;
- forte population avec faible volume ;
- petit territoire avec faible volume ;
- facteurs secondaires absents ;
- historique saisonnier insuffisant ;
- saisonnalité active ;
- bornes de facteurs ;
- seuils exacts de changement de niveau ;
- configuration incompatible ;
- données géographiques invalides ;
- ROME inconnu.

Les tests utilisent des fixtures déterministes et vérifient les `reasonCodes`.

### 14.2 Calibration

Tests de non-régression sur un jeu figé de couples département × ROME.

Un changement de configuration ou de méthode doit produire un diff explicite des changements de niveau avant publication.

### 14.3 Pipeline

Vérifier :

- dépendance aux imports ;
- reprise après échec ;
- absence de publication partielle ;
- conservation du dernier run valide ;
- idempotence d’un rerun sur la même date et configuration ;
- correspondance entre snapshot interne et projection publique.

### 14.4 API

Tests :

- paramètres invalides ;
- code ROME invalide ;
- département invalide ;
- payload minimal ;
- absence de champs privés ;
- cache ;
- rate limiting ;
- absence de données ;
- run ancien / pointeur courant.

### 14.5 Frontend

Tests :

- recherche métier ;
- recherche formation ;
- choix d’un ROME ;
- conservation dans l’URL ;
- recoloration de la carte ;
- clic département en conservant le filtre ;
- retour au mode global ;
- état données insuffisantes ;
- navigation clavier ;
- libellés accessibles.

### 14.6 Bulletin IA

Tests :

- l’IA ne peut pas modifier le niveau ;
- bulletin absent => fallback déterministe ;
- empreinte snapshot différente => bulletin ignoré ;
- aucun champ privé dans le payload envoyé au modèle ;
- modèle/prompt/version/date traçables.

## 15. Découpage d’implémentation recommandé

Après validation de cette spec, l’implémentation sera découpée en Issues/PR séparées :

1. référentiel ROME public et recherche métier/formation ;
2. référence démographique départementale ;
3. agrégations historiques ROME et données de calibration ;
4. bibliothèque de calcul + configuration versionnée ;
5. job quotidien + publication atomique ;
6. API publiques métier ;
7. menu et page `/metiers` avec carte réutilisée ;
8. fiche département filtrée par ROME ;
9. bulletin IA métier et fallback ;
10. audit ISO/RGPD, performance et accessibilité avant activation publique.

Chaque Issue doit préciser les contrôles ISO/RGPD applicables et les preuves attendues.

## 16. Hors périmètre initial

- recommandation personnalisée basée sur un profil utilisateur ;
- classement « meilleur département » ;
- décision automatisée d’orientation ;
- géolocalisation personnelle ;
- prédiction IA du niveau de vigilance ;
- déduction juridique des employeurs éligibles ;
- saisonnalité artificielle lorsque l’historique est insuffisant.

## 17. Critères de réussite

Le sous-système est prêt à être activé publiquement lorsque :

- un métier ROME peut être recherché sans IA ;
- une formation ne propose que des ROME réellement rattachés aux données ;
- la même carte nationale affiche la vigilance métier sans recalcul lourd à la consultation ;
- chaque couleur provient d’un snapshot quotidien déterministe et versionné ;
- une absence de signal fiable produit `insufficient_data` ;
- le clic département conserve le ROME ;
- les calculs sont explicables par métriques et reason codes ;
- l’IA ne produit que le bulletin rédigé ;
- une panne IA ne change ni la couleur ni la disponibilité des données ;
- aucune donnée privée inutile n’est exposée ;
- les preuves de tests et de traçabilité sont reliées aux Issues et PR.
