# ApprentiFR — complément national quotidien à 04h

**Objectif :** après la collecte départementale de **23h59 (J-1)**, récupérer l'export LBA actualisé vers 03h (J), puis **compléter le relevé de la veille** et non créer un nouveau relevé à la date J.

## Ordonnancement

- 23h59 Paris, jour J-1 : `importDailyOffers` poursuit son fonctionnement actuel.
- 03h00 Paris, jour J : disponibilité annoncée de l'export national.
- **04h00 Paris, jour J :** `complementPreviousDayLbaOffers` traite le stock du **jour J-1**.
- Date cible calculée en `Europe/Paris` et couverte par tests de changement d'heure.
- Rejeter l'exécution si l'export du matin n'est pas à jour, si les 101 départements initiaux manquent, si un run est déjà en cours, ou si le stock final est anormal.

## Rapprochement et politique « ne pas écraser / ne pas dédoublonner abusivement »

Un identifiant stable (SHA256 de l'ID LBA, ou source + ID partenaire) = une offre ; on **ne rapproche pas deux annonces seulement parce qu'elles ont le même titre, même métier ou même employeur**.

- `added` : ID absent du relevé précédent, annonce dont la date de création est connue et **antérieure ou égale à J-1**.
- `enriched` : ID connu, on ajoute uniquement les champs vides. Aucun champ déjà connu n'est remplacé silencieusement.
- `unchanged` : ID connu, aucune nouvelle information.
- `review` : conflit (date, ROME, département, nombre de postes...). On garde la valeur initiale et on signale le conflit.
- `baseline_only` : présent dans le relevé 23h59 mais absent de l'export. **Conservé** ; non présenté comme « retiré ».
- `reclassifiedFromSearchDepartment` : ancien ID déjà rencontré dans un autre département de recherche, reclassement géographique documenté.
- `quarantined` : localisation douteuse, ROME absent, ou nouvelle annonce sans date de création. Non ajoutée au stock localisé J-1.

Pour les nouvelles offres trouvées au complément, `firstObservedDate = J` (moment réel de découverte) **même si le relevé enrichi appartient à J-1**. On évite ainsi de les appeler « créations de la veille » sans preuve. Le `publicationCreationDate` de l'API reste un champ séparé.

## Protection de l'existant

Les documents originaux `dailyOfferSnapshots/J-1/departments/{code}/offers/{doc}` **ne sont jamais supprimés ni écrasés**. Les offres du complément sont copiées sous des IDs versionnés `complement_{runId}_{hash}` avec leur propre `runId`.

Après enregistrement, la Function vérifie les **101 comptes départementaux** et le total. Elle stocke l'ancienne metadata de chaque département dans `dailyOfferComplementRuns/J-1/backups`, puis effectue une bascule atomique des **101 parents + racine**. Avant la bascule, les API continuent de voir les données initiales.

Si la Function échoue avant publication, l'ancien relevé reste actif. Si une anomalie apparaît ensuite, un rollback manuel restaure les 101 metadonnées sans supprimer de documents.

Ne pas basculer un jour déjà marqué `export_published` ou `export_complement_published` : il reste inchangé. Ainsi, **le 09/10 déjà intégralement issu de l'export national sera ignoré au premier passage du 10/10 à 04h**.

## Rapport quotidien Firestore

Chemin : `dailyOfferComplementRuns/YYYY-MM-DD` où la date du document est **celle de la veille**.

Champs :
- `status`, `startedAt`, `finishedAt`, `runId`, `exportLastUpdate`
- `initialOffers`, `added`, `enriched`, `unchanged`, `review`, `baselineOnly`, `quarantined`, `afterOffers`
- `metrics.enrichedMeaningful`, `metrics.technicalOnlyEnriched`, `metrics.reclassified`, `fieldsFilled`, `conflictTypes`
- `qualityMethod='search_2359_plus_export_complement_0400_v1'`

Chaque nouvelle génération est marquée `collectionPhase = 'complement_04h'` et chaque offre expose `complement.status`.

## Vigilances et méthodologie

Les vigilances calculées à 03h30 se fondent sur la collecte initiale tant que leur recalcul post-complément n'est pas activé. Il ne faut **pas** les présenter comme déjà recalculées sur les nouveaux chiffres à 04h. Le complément note une rupture méthodologique tant que le jour précédent repose sur une autre source, et ne crée pas de variation positive automatique.

## Critères de validation

- Suite Node unitaire/CI et audit de rapprochement en lecture seule sur les données réelles du 08/10 + export du 09/10.
- Injection d'un retard de l'export ou de métadonnées incohérentes : aucune bascule.
- Retour arrière manuel disponible ; aucune modification de l'import 23h59.
- Avant déploiement, vérifier configuration du secret `API_APPRENTISSAGE_TOKEN` et régions, puis déployer uniquement les fonctions concernées.

Issue : [#103](https://github.com/Bruce7245/meteo-apprentissage/issues/103).
