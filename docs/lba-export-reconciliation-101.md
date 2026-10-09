# ApprentiFR — normalisation et fusion de l'export LBA (issue #101)

**Statut au 09/10/2026 : génération privée Firestore enregistrée et vérifiée ; aucune publication ni écriture dans les instantanés historiques actifs.**

## Complément réalisé (09/10/2026)

- Génération privée `lbaExportComplementRuns/lba_export_20261009010140` avec **10 086** offres normalisées et **104** annonces sans département en quarantaine.
- Parmi les 10 086, **8 380** identifiants présents dans l'ancien relevé et enrichis dans la génération, **1 706** supplémentaires. **438** précédemment retournés dans le mauvais département de recherche ont été rattachés à celui de leur code postal. Les **287** enregistrements présents uniquement le 08/10 restent dans l'historique.
- 101 documents départementaux contrôlés, sommes concordantes ; 115 divergences de champs signalées sans écrasement et une divergence d'effectifs.
- Contrôle indépendant : 08/10 intact à **8 751 stockées / 8 217 strictes**.
- Aucun changement de `dailyOfferSnapshots`, `departmentDailyStats`, moteur de vigilance, calendrier ni données publiques.
- [Ecriture GitHub Actions](https://github.com/Bruce7245/meteo-apprentissage/actions/runs/37975035553), [vérification](https://github.com/Bruce7245/meteo-apprentissage/actions/runs/37975637259).

## Pourquoi

Audit du 09/10/2026 : export national 10 190 offres, dont 10 190 avec ROME valide, 10 086 avec code postal extrait d'une adresse, 10 085 avec ville potentiellement identifiable. Le stock Firestore strict du 08/10 était 8 217 offres. Jointure par identifiant : 8 464 communes, 1 726 seulement dans l'export et 287 seulement dans Firestore (hors strict). Ces deux jeux ne sont pas synchrones.

## Contrat de normalisation

- Identité : conserver la règle `identifier.id || partner_label + ':' + partner_job_id`, puis SHA256. Si aucun identifiant stable : rejeter. Exclure `recruteurs_lba` du stock d'offres.
- ROME : codes `A0000` valides, ensemble trié et dédoublonné, sans attribuer arbitrairement un ROME quand absent.
- Localisation : champ textuel `workplace.location.address` ou champs structurés quand présents. Extraire CP et ville sans prendre pour commune une mention CEDEX, adresse ambiguë, ou simple code postal.
- Corse : CP 20xxx ⇒ 2A/2B selon tranche ; outre-mer : 971, 972, 973, 974, 976 ; zone hors des 101 départements : quarantaine, aucun rattachement inventé.
- `locationNormalization.quality` : `explicit_unverified`, `parsed_unverified`, `postal_only`, `needs_review`, `unresolved`. Les valeurs déduites n'ont **pas** de code INSEE ni `banVerified: true` avant vérification.
- Réconciliation : même identifiant ⇒ ne remplir que les champs vides. Les divergences de dates, ROME, lieu, nombre de postes : conflits, sans substitution silencieuse. Ne jamais écraser `offerDocId`, `runId`, date, département historique ou `firstObservedAt`.
- Métadonnées recommandées lors de l'implémentation Firestore : `normalizationVersion`, `sourceRoute`, `enrichedAt`, `exportLastUpdate`, `firstObservedAt`, `qualityStatus`, `fieldProvenance`, compteur de conflits **agrégé**. Ne pas exposer les adresses complètes dans les logs.

## Date et exhaustivité : principe de non-rétroactivité

Un export mis à jour le 09/10 à 03h ne reconstitue **pas** l'état du 08/10 à 23h59. Des offres disparues entre les deux heures manquent dans l'export et d'autres peuvent être apparues.

**Ne pas** injecter les 1 706 annonces localisables absentes dans la photographie datée du 08/10. Les offres enrichies après coup doivent préserver leur provenance et date d'enrichissement. Toute insertion relève d'un nouveau jeu de données avec `observedAt` réel, pas d'une `creation` supposée.

## Publication sûre / changement de schéma restant à concevoir

Actuellement, les documents `dailyOfferSnapshots/{date}/departments/{code}/offers/{hash}` ont une identité stable (même chemin pour plusieurs imports) et un champ `runId`. Le document parent contient `activeRunId` et `strictSummary`. **Attention :** écrire un futur `runId` dans les mêmes documents pendant que l'ancien est actif en retire temporairement des offres visibles; un simple changement de métadonnées à la fin n'est pas une publication atomique.

Avant de permettre `write=1` :
1. Produire en lecture seule un plan par identifiant : à compléter / ajouter / non localisable / doublon / conflit.
2. Préparer un jeu de données isolé, **versionné par import** (collection de staging ou chemin de run indépendant), sans toucher aux documents actifs.
3. Valider 101/101 départements, ROME, codes postaux, dédoublonnage, cohérence `storedOffersCount`, `strictSummary`, agrégats sectoriels et indicateurs de saturation (#84).
4. Adapter les lecteurs pour basculer uniquement vers un jeu complet ; publier la référence active seulement après validation de toute la photographie. Conserver la référence précédente pour revenir en arrière.
5. Vérifier la date de référence et l'absence d'effets sur vigilances, publication, statistiques, UI et bulletin.
6. Aucun déploiement, aucune modification de scheduler ni écriture de production sans une revue et un test parallèle approuvés.

## Quel horaire conserver ?

**Étape A :** garder le relevé existant de 23h59 et ajouter un test séparé après actualisation de l'export (il est annoncé à 03h00 heure de Paris). Vérifier systématiquement `lastUpdate` (Paris), rejet de l'export périmé, reprise limitée en cas de retard, et contrôle du quota.

**Étape B :** comparer les deux sources pendant au moins **7 jours complets** sur des périodes et règles identiques : couverture ROME/CP/commune/INSEE, doublons, nouvelles offres (`firstObservedAt` vs publication), retraits, source × département, temps et coût.

**Étape C :** si qualité validée, passer à l'export national principal avec job **après 03h00** (par exemple 03h20), puis calculer la vigilance et le bulletin **après confirmation de fin d'import**. Aujourd'hui la vigilance est planifiée à 03h30 : une synchronisation par état de disponibilité est préférable à un horaire fixe trop serré. Prévoir maintien/retour à la collecte actuelle si l'export est périmé.

Attention : le changement de source accroîtra mécaniquement certains stocks. Le tableau de bord devra marquer une **rupture méthodologique**; ne pas interpréter un changement de collecte comme une tendance du marché.

## Références

- Audit couverture des champs : https://github.com/Bruce7245/meteo-apprentissage/actions/runs/37970617261
- Audit IDs export/Firestore : https://github.com/Bruce7245/meteo-apprentissage/actions/runs/37969358542
- Audit saturation : https://github.com/Bruce7245/meteo-apprentissage/actions/runs/37969664285
- API officielle La Bonne Alternance : https://api.apprentissage.beta.gouv.fr/fr/documentation-technique
- BAN : https://adresse.data.gouv.fr/contenu-de-la-ban
- API Géocodage IGN/BAN : https://data.geopf.fr/geocodage/search/
