# Navigation secteur ROME → métier — Design

**Date :** 2026-10-06  
**Statut :** validé fonctionnellement  
**Parent :** #36  
**Périmètre :** parcours public `/metiers`, référentiel officiel ROME, calcul et publication d'une vigilance sectorielle déterministe.

## 1. Décision produit

Le parcours principal de la page `/metiers` devient :

1. choisir un **secteur** ;
2. afficher la carte nationale agrégée de ce secteur ;
3. choisir éventuellement un **métier** appartenant au secteur ;
4. recalculer l'affichage à partir de la vigilance ROME publiée pour ce métier.

La recherche directe d'un métier ou d'une formation reste disponible comme raccourci.

Le terme public **secteur** correspond techniquement au **domaine professionnel ROME** sur 3 caractères, par exemple :

- `G12` — Animation d'activités de loisirs ;
- `D11` — Commerce alimentaire et métiers de bouche.

Le libellé n'est jamais inventé par ApprentiFR : il provient du référentiel officiel ROME importé et versionné.

## 2. Hiérarchie ROME

La navigation utilise trois niveaux logiques :

- grand domaine ROME : 1 lettre, utilisé uniquement comme groupe visuel ;
- domaine professionnel ROME : 3 caractères, unité publique appelée « secteur » ;
- code ROME métier : 5 caractères, unité publique appelée « métier ».

Le rattachement métier → secteur est déterministe :

`domainCode = romeCode.slice(0, 3)`

Cette dérivation n'est utilisée que si le domaine correspondant existe dans le référentiel officiel importé.

## 3. URL et compatibilité

URLs canoniques :

- secteur seul : `/metiers?domain=G12`
- secteur + métier : `/metiers?domain=G12&rome=G1204`
- aucun filtre : `/metiers`

Compatibilité obligatoire :

- une URL existante `/metiers?rome=G1204` reste valide ;
- l'interface infère alors `domain=G12` à partir du référentiel publié ;
- une sélection directe d'un métier positionne automatiquement son secteur ;
- un métier qui n'appartient pas au secteur présent dans l'URL remplace le secteur par son domaine officiel au lieu de conserver un couple incohérent.

Les liens de détail conservent le contexte :

- secteur : `/departement/72?domain=G12`
- métier : `/departement/72?domain=G12&rome=G1204`

## 4. UX publique

### 4.1 Contrôle principal

Le bloc de sélection contient :

**Secteur**  
Sélecteur obligatoire pour le parcours guidé. Les domaines professionnels sont groupés visuellement par grand domaine ROME.

**Métier — facultatif**  
Valeur par défaut : « Tous les métiers du secteur ».  
La liste ne contient que les métiers du secteur sélectionné.

**Recherche directe**  
Champ secondaire permettant de rechercher un métier ou une formation sans passer par les sélecteurs.

### 4.2 Comportement de la carte

- aucun secteur sélectionné : carte nationale générale existante ;
- secteur sélectionné sans métier : carte de vigilance sectorielle ;
- métier sélectionné : carte de vigilance ROME existante ;
- métier effacé : retour immédiat à la carte sectorielle, pas à la carte générale ;
- secteur effacé : retour à la carte générale.

Le texte doit annoncer explicitement le niveau affiché :

- « Vigilance secteur : Animation d'activités de loisirs »
- « Vigilance métier : Éducateur sportif / Éducatrice sportive »

La vue secteur porte la mention :

> Vue agrégée du domaine professionnel. Choisissez un métier pour affiner la lecture.

## 5. Référentiel des secteurs

Créer un référentiel versionné distinct :

- `occupationDomainReferenceRuns`
- `occupationDomainReference`
- `occupationDomainReferenceMeta/current`

Entrée minimale :

```
domainCode
domainLabel
majorDomainCode
majorDomainLabel
normalizedLabel
romeCodes[]
source
sourceVersion
importRunId
importedAt
schemaVersion
```

Contraintes :

- `domainCode` respecte `^[A-Z][0-9]{2}$` ;
- chaque `romeCode` respecte `^[A-Z][0-9]{4}$` ;
- chaque métier rattaché commence par `domainCode` ;
- aucun libellé manuel dans le chemin public ;
- source et version sont identiques ou traçables par rapport au référentiel ROME courant.

Une publication de domaines incohérente avec `occupationReferenceMeta/current` est refusée.

## 6. Calcul de vigilance secteur

### 6.1 Unité de calcul

L'unité sectorielle est :

`date × département × domaine professionnel ROME`

Le secteur ne reprend **pas** la moyenne des couleurs des métiers.

### 6.2 Agrégation des offres

À partir des snapshots d'offres strictement géolocalisés :

- une offre est rattachée à chaque domaine professionnel présent dans ses `romeCodes` ;
- si plusieurs ROME d'une même offre appartiennent au même domaine, l'offre est comptée une seule fois dans ce domaine ;
- le nombre de postes de l'offre est compté une seule fois par domaine ;
- les offres hors département ou à localisation inconnue sont exclues ;
- les métiers non reconnus dans le référentiel courant ne créent aucun domaine artificiel.

Champs minimaux du contexte sectoriel :

```
date
departmentCode
domainCode
domainLabel
activeOffersCount
openingsCount
distinctObservedEmployersCount
distinctObservedNafCount
employerConcentration
populationTotal
population15To29
populationReferenceYear
sourceVersions
schemaVersion
```

### 6.3 Baseline sectorielle indépendante

La vigilance secteur possède sa **propre calibration**.

Elle ne réutilise ni la moyenne des niveaux ROME, ni les baselines métier.

Pour chaque domaine, la calibration dérive un volume attendu à population de référence à partir des contextes historiques sectoriels :

`expectedSectorOffers = baseDomainDemand × populationFactor × secondaryFactors`

Le rapport principal reste :

`sectorObservedVsExpectedRatio = activeOffersCount / expectedSectorOffers`

Les seuils de niveau `green / yellow / orange / red` sont dérivés d'une configuration sectorielle versionnée et validée avant publication.

Collections :

- `occupationDomainVigilanceConfigs`
- `occupationDomainContextStats`
- `occupationDomainContextStatsRuns`

Aucun coefficient public n'est introduit directement dans le code.

### 6.4 Données insuffisantes

Le secteur retourne `insufficient_data` si notamment :

- le domaine n'est pas reconnu ;
- les offres du jour ne sont pas géographiquement fiables ;
- aucune baseline sectorielle validée n'existe ;
- l'échantillon historique du domaine n'atteint pas les critères de calibration ;
- les contrôles du run échouent.

Un métier peut avoir `insufficient_data` alors que son secteur possède une couleur, et inversement. Les deux niveaux sont indépendants.

## 7. Calibration sectorielle

La première calibration secteur utilise uniquement des journées historiques dont les snapshots ont passé leurs contrôles qualité.

Le 04/10/2026 actuellement en quarantaine ne doit pas entrer dans cette calibration.

Le 05/10/2026 peut contribuer uniquement via les contextes historiques explicitement retenus par le garde-fou qualité déjà appliqué.

Le 06/10/2026 est une journée complète de référence.

La calibration produit :

- distribution des échantillons par domaine ;
- domaines exclus et motif ;
- fenêtre historique ;
- seuils dérivés ;
- baseline de chaque domaine éligible ;
- nombre d'échantillons utilisés ;
- statut `draft | validated`.

Aucune configuration sectorielle `draft` ne peut publier une carte.

## 8. Publication atomique

Collections logiques :

- `occupationDomainVigilanceRuns`
- `occupationDomainVigilanceSnapshots`
- `publicOccupationDomainVigilanceMaps`
- `publicOccupationDomainVigilanceDetails`
- `publicOccupationDomainVigilanceIndex/current`

Séquence :

1. construire les contextes ;
2. charger la configuration sectorielle validée ;
3. calculer tous les couples département × domaine ;
4. générer les projections publiques ;
5. valider volumes, schémas et dates ;
6. basculer `publicOccupationDomainVigilanceIndex/current` en transaction.

Un échec conserve le précédent run publié.

La publication métier ROME existante reste indépendante et ne doit pas être régressée.

## 9. API publiques

### 9.1 Liste des secteurs

`getPublicOccupationDomainsHttp`

Réponse minimale :

```
asOfDate
domains[]:
  domainCode
  domainLabel
  majorDomainCode
  majorDomainLabel
  occupationsCount
```

### 9.2 Métiers d'un secteur

`getPublicOccupationDomainOccupationsHttp?domain=G12`

Réponse :

```
domainCode
domainLabel
occupations[]:
  romeCode
  label
```

### 9.3 Carte secteur

`getPublicOccupationDomainMapHttp?domain=G12`

Réponse analogue à la carte métier :

```
exists
data:
  date
  domainCode
  domainLabel
  departments[]
```

Chaque département expose uniquement la projection publique minimale :

```
departmentCode
departmentName
level
levelLabel
confidenceLevel
activeOffersCount
openingsCount
dataAvailable
```

### 9.4 Détail département secteur

`getPublicOccupationDomainDepartmentHttp?department=72&domain=G12`

Aucun SIRET, aucune offre brute et aucune donnée personnelle n'est exposé par ces endpoints.

## 10. Frontend

### 10.1 État d'URL

Créer un état unifié :

```
{
  domainPresent,
  domainValid,
  domainCode,
  romePresent,
  romeValid,
  romeCode
}
```

Le frontend ne décide pas seul qu'un ROME appartient à un secteur : il utilise le référentiel public chargé.

### 10.2 Sélecteurs

Nouveaux composants recommandés :

- `OccupationDomainSelect.jsx`
- `OccupationWithinDomainSelect.jsx`

Le composant `OccupationSearch.jsx` reste le raccourci de recherche libre.

### 10.3 Accessibilité

- labels explicites ;
- navigation clavier complète ;
- changement dynamique annoncé ;
- couleur toujours accompagnée d'un texte ;
- `insufficient_data` distinct du vert ;
- groupes de secteurs annoncés avec leur grand domaine.

## 11. Méthodologie publique

La page méthodologie doit expliquer :

- le secteur correspond au domaine professionnel ROME officiel ;
- la couleur secteur est calculée directement sur les offres agrégées du domaine ;
- elle n'est pas une moyenne des couleurs métier ;
- sélectionner un métier affine la lecture ;
- secteur et métier peuvent avoir des niveaux différents ;
- `insufficient_data` signifie que le signal ne permet pas de publier une couleur fiable.

## 12. Sécurité, RGPD et traçabilité

- données publiques agrégées uniquement ;
- validation stricte de `domain`, `rome`, `department` ;
- pas de recherche utilisateur persistée par défaut ;
- pas d'accès Firestore brut depuis le navigateur ;
- cache uniquement sur payload public ;
- provenance et versions conservées ;
- aucune IA dans la taxonomie, le calcul, la couleur ou le filtrage ;
- chaque étape liée à une Issue et à des tests.

## 13. Compatibilité et non-régression

Doivent rester fonctionnels :

- `/metiers`
- `/metiers?rome=G1204`
- `/departement/72?rome=G1204`
- recherche métier ;
- recherche formation ;
- carte métier publiée du 06/10 ;
- état `insufficient_data` ;
- carte nationale générale.

Le nouveau parcours ajoute le secteur sans casser les URLs existantes.

## 14. Critères de réussite

Le sous-système est prêt quand :

- les domaines professionnels sont importés depuis le référentiel officiel ;
- un domaine liste uniquement ses ROME officiels ;
- la carte secteur provient d'un run pré-calculé et publié atomiquement ;
- la couleur secteur est calculée directement sur ses données agrégées ;
- aucune moyenne de couleurs métier n'est utilisée ;
- un métier sélectionné affine la carte et conserve son secteur ;
- une URL métier historique continue de fonctionner ;
- le 04/10 en quarantaine n'entre pas dans la calibration ;
- une configuration sectorielle doit être explicitement validée avant publication ;
- les tests couvrent parser, calcul, pipeline, API, URL, accessibilité et non-régression.
