const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function safeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formattedCount(value) {
  const number = count(value);
  return number === null ? 'non établi' : new Intl.NumberFormat('fr-FR').format(number);
}

export function formatFrenchPublicationDate(value, format = 'long') {
  const match = DATE_PATTERN.exec(safeText(value));
  if (!match) return 'date non renseignée';

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    return 'date non renseignée';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    day: format === 'short' ? '2-digit' : 'numeric',
    month: format === 'short' ? '2-digit' : 'long',
    year: 'numeric',
  }).format(date);
}

function safeOriginalLink(value) {
  try {
    const url = new URL(safeText(value));
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function selectOccupationOfferExamples(responses, date, max = 3) {
  const samples = [];
  const seen = new Set();
  const limit = Math.min(Math.max(Number(max) || 3, 1), 3);

  for (const response of Array.isArray(responses) ? responses : []) {
    const snapshot = response?.data;
    // The public offers service exposes only each department's latest snapshot.
    // Historical requests must not silently borrow offers from a newer day.
    if (snapshot?.date !== date) continue;

    for (const offer of Array.isArray(snapshot.offers) ? snapshot.offers : []) {
      const title = safeText(offer?.title);
      const city = safeText(offer?.city);
      const url = safeOriginalLink(offer?.applyUrl);
      if (!title || !city || !url || seen.has(url)) continue;
      if (offer.publicationCreationDate && offer.publicationCreationDate > date) continue;
      if (offer.publicationExpirationDate && offer.publicationExpirationDate < date) continue;

      seen.add(url);
      samples.push({
        title: title.length > 80 ? title.slice(0, 77).trimEnd() + '…' : title,
        city,
        departmentCode: safeText(response.departmentCode),
        departmentName: safeText(response.departmentName),
        url,
        date,
      });
      if (samples.length >= limit) return samples;
    }
  }

  return samples;
}

const SCENERY = {
  D1102: 'Un fournil authentique : pain fraîchement sorti du four, pétrissage, farine sur le plan de travail, lumière chaude et geste du métier.',
  G1803: 'Un restaurant vivant et actuel : service en salle, plateau, tables dressées et équipe en activité, ambiance dynamique.',
  N1103: 'Un entrepôt moderne : colis, rayonnages, préparation de commandes, gestes professionnels et perspectives graphiques.',
  D1214: 'Une boutique contemporaine : présentoirs, rayons, conseils clients et ambiance commerce réelle, sans logos de marques.',
  D1202: 'Un salon de coiffure tendance : miroirs, fauteuils, outils, mouvement et lumière naturelle, esthétique moderne.',
};

function offerLine(offer) {
  const location = [safeText(offer.city), safeText(offer.departmentName)].filter(Boolean).join(' · ');
  return '• ' + offer.title + ' — ' + location;
}

export function buildOccupationInstagramPrompt({
  occupationLabel,
  romeCode,
  date,
  ranking = [],
  metric = 'offers',
  nationalOffers = null,
  nationalOpenings = null,
  fullyComparable = false,
  examples = [],
  includeExamples = true,
} = {}) {
  const job = safeText(occupationLabel) || safeText(romeCode) || 'métier sélectionné';
  const selectedMetric = metric === 'openings' ? 'openings' : 'offers';
  const metricName = selectedMetric === 'offers' ? 'offres' : 'postes';
  const dateLong = formatFrenchPublicationDate(date, 'long');
  const dateShort = formatFrenchPublicationDate(date, 'short');
  const safeRanking = (Array.isArray(ranking) ? ranking : []).filter(row =>
    safeText(row.departmentName) && safeText(row.departmentCode) &&
    count(row.offers) !== null && count(row.openings) !== null
  ).slice(0, 5);
  const nationalValue = selectedMetric === 'offers' ? count(nationalOffers) : count(nationalOpenings);
  const hasNational = fullyComparable && nationalValue !== null;
  const validSamples = (Array.isArray(examples) ? examples : []).filter(item =>
    item?.date === date && safeText(item.title) && safeText(item.city) && safeOriginalLink(item.url)
  ).slice(0, 3);

  return [
    'PROMPT CANVA — ApprentiFR | PUBLICATION MÉTIER INSTAGRAM',
    '',
    'FORMAT OBLIGATOIRE ET RÉFÉRENCE',
    'Créer un visuel Instagram aux dimensions EXACTES 1080 × 1040 pixels (largeur 1080 px, hauteur 1040 px). Ne pas modifier ce format.',
    'Conserver le MÊME TYPE DE COMPOSITION que la publication modèle ApprentiFR « SERVEUR / SERVEUSE — OÙ SONT LES OFFRES ? » : fond bleu nuit, photographie du métier en haut à droite, pastille jaune APPRENTISSAGE, titre très grand blanc, bandeau bleu vif, classement en cartes, encart Des offres repérées et pied discret.',
    'La référence sert de direction artistique : RECOMPOSER le visuel à 1080 × 1040 px, ne pas étirer ni recadrer simplement la composition plus haute.',
    '',
    'GRILLE DE COMPOSITION IMPOSÉE — COORDONNÉES PIXELS (x,y depuis le coin haut gauche)',
    'Format exact : largeur 1080, hauteur 1040 ; marges de sécurité x=56 à 1024, retrait haut 28 px, bas 24 px. Ni texte, ni chiffre, ni silhouette ne doivent être coupés.',
    'HERO — y=0 à 325 : photo métier à droite, logo officiel en haut à gauche x=56,y=30, emprise maxi 140 × 82 px. Aucun grand carré blanc ajouté derrière le logo.',
    'BADGE JAUNE — x=56 à 321, y=124 à 172, hauteur 48 px, coins complètement arrondis : APPRENTISSAGE en bleu nuit 24–28 px, centré.',
    'TITRE — x=56 à 680, y=181 à 320. Métier en GRANDES CAPITALES BLANCHES : 2 lignes préférées (66–76 px), maximum 3 lignes (43–50 px) si intitulé long. Ne jamais empiéter sur le bandeau.',
    'BANDEAU BLEU — x=56 à 714, y=333 à 405, hauteur 72 px, rayon 12 px. Accroche en blanc 48–56 px, centrée verticalement.',
    'INTRO — x=56 à 714, y=419 à 490 : Top des départements en bleu vif 30–34 px ; critère en blanc/gris clair 22–24 px sur la ligne suivante.',
    'TOP 5 — x=56 à 703, y=509 à 899 : cinq cartes de 72 px de haut, départs y=509,588,667,746,825 ; espacement 7 px et coins arrondis 12 px. Ne pas comprimer ni masquer les cinq rangs.',
    'ENCART OFFRES — uniquement si des offres sourcées existent : x=727 à 1024, y=509 à 899, 297 px de large, 390 px de haut, bordure bleue, padding intérieur 18 px. Écart horizontal avec le Top 5 : 24 px.',
    'SANS EXEMPLES : supprimer intégralement l’encart et étendre les cinq cartes de x=56 à x=1024. Ne jamais laisser une grande colonne vide ou créer des offres fictives.',
    'PIED — x=56 à 1024, y=916 à 1016 : date (22–24 px), source (18–20 px) et note courte (18 px minimum). Au plus trois lignes, aucun texte après y=1016.',
    'RÈGLE ANTI-CHEVAUCHEMENT : chaque zone conserve son espace. Aucun élément ne dépasse du canevas ni ne mord sur une autre zone ; le contraste doit rester lisible à taille smartphone.',
    '',
    'Le résultat doit être immédiatement reconnaissable comme un visuel ApprentiFR. Design professionnel, éditorial, premium, énergique et adapté aux jeunes ; jamais scolaire ni magistral.',
    'ATTENTION AU FORMAT COMPACT : privilégier d’abord la lisibilité du métier et du Top 5. Si la place manque, réduire le nombre d’exemples d’offres affichés et condenser les notes, jamais les chiffres ni les cinq lignes du classement. Ne pas réduire la taille des caractères au point de les rendre illisibles.',
    '',
    'IDENTITÉ VISUELLE — ASPECT À REPRENDRE',
    'Fond général bleu marine très profond #071A32 (ou #0B1F3A), titres en blanc #FFFFFF, bandeau bleu soutenu #1459C7, accents bleus lumineux #2D79F3.',
    'PASTILLE JAUNE OBLIGATOIRE : badge horizontal arrondi jaune #F7C948 portant exactement « APPRENTISSAGE » en capitales bleu nuit #071A32. Ne pas remplacer le jaune par du bleu et ne pas modifier ce libellé.',
    'Utiliser le vrai logo ApprentiFR depuis Canva > Identité visuelle « Bruce DE LUCAS » ; l’installer discrètement en haut à gauche sans recréer le logo ni ajouter une grande boîte blanche vide autour.',
    'Les silhouettes départementales SVG bleues sont DÉJÀ dans Canva > Identité visuelle « Bruce DE LUCAS » > Illustrations. Utiliser ces fichiers originaux pour les petites vignettes à droite de chaque ligne du classement, sans déformer les contours.',
    'AUCUNE CARTE DE FRANCE : ne pas représenter une carte nationale, ne pas assembler les silhouettes et ne pas redessiner les départements.',
    'Typographie sans serif forte et condensée pour les titres, Inter ou équivalent lisible pour les chiffres et textes secondaires. Garder un contraste élevé et des espaces de respiration.',
    '',
    'DÉCOR PHOTOGRAPHIQUE MÉTIER',
    SCENERY[safeText(romeCode)] || 'Photographie réaliste montrant l’environnement et un geste caractéristique du métier « ' + job + ' ».',
    'CADRAGE : photo du métier x=420–1080, y=0–430, avec le visage, les mains et l’objet métier idéalement dans x=725–1030, y=30–320 ; personnage ou objet principal sur la droite, jamais caché par le titre à gauche.',
    'RECADRAGE PROPORTIONNEL : mode « Remplir » sans étirer. Ne pas couper le visage au niveau des yeux, les mains ou un outil essentiel du métier. Déplacer la photo dans son cadre avant tout masque si nécessaire.',
    'FONDU HORIZONTAL OBLIGATOIRE : masque bleu nuit #071A32 → transparent. Fond marin à 100 % jusqu’à x≈360 ; opacité ~75 % à x=500, ~25 % à x=720, 0 % à x≈880. Aucun bord vertical net : la photo se dissout vers la GAUCHE dans le bleu nuit.',
    'FONDU VERTICAL OBLIGATOIRE : photo visible jusque vers y=250, fondu bleu nuit progressif 40 % à y≈335, 75 % à y≈385, 100 % vers y=440. Sous y=440, fond bleu nuit UNI, sans photo visible sous les cartes.',
    'HARMONISATION : léger traitement colorimétrique froid sur les ombres uniquement ; garder les tons de peau et le métier réalistes. Pas de halo artificiel, aucune zone rectangulaire dure autour du sujet, aucune bordure de photographie visible.',
    'Aucun décor générique sans rapport avec le métier, aucune fausse annonce mise en scène, aucun logo d’employeur inventé, aucun effet 3D.',
    '',
    'COMPOSITION — REPRENDRE LES CODES DU MODÈLE',
    'EN HAUT : logo en haut à gauche ; dessous, la pastille JAUNE « APPRENTISSAGE » ; puis le métier en TRÈS GRANDES CAPITALES BLANCHES sur deux lignes si besoin. La photo métier occupe essentiellement le haut droit.',
    'BANDEAU : sous le métier, rectangle bleu vif aux angles légèrement arrondis, avec une question en caractères blancs massifs : « ' + (selectedMetric === 'offers' ? 'OÙ SONT LES OFFRES ?' : 'OÙ SONT LES POSTES ?') + ' ». C’est l’accroche principale, même lorsque le total national est disponible.',
    'SOUS-TITRE : « Top ' + safeRanking.length + ' des départements » en bleu lumineux, suivi de « classement par nombre de ' + metricName + ' observés » en blanc légèrement atténué.',
    hasNational
      ? 'Information secondaire possible, sans remplacer le bandeau : « ' + formattedCount(nationalValue) + ' ' + (selectedMetric === 'offers' ? 'OFFRES OBSERVÉES' : 'POSTES PROPOSÉS') + ' » au niveau national. Ne pas donner l’impression d’une chance individuelle de recrutement.'
      : 'Ne PAS afficher de total national comme exhaustif : la source ne permet pas d’affirmer une couverture intégrale. Conserver l’accroche « ' + (selectedMetric === 'offers' ? 'OÙ SONT LES OFFRES ?' : 'OÙ SONT LES POSTES ?') + ' » et le Top ' + safeRanking.length + ' comme informations principales.',
    'CLASSEMENT : placer cinq cartes horizontales empilées dans la partie gauche ou principale. La première carte est BLEUE avec texte et rang blancs ; les quatre suivantes sont BLANCHES avec noms foncés et GRANDS CHIFFRES DE RANG BLEUS.',
    'À l’intérieur de chaque carte : rang bien visible, département et numéro, ligne compacte indiquant le volume d’offres et de postes, et silhouette SVG bleue du département alignée à droite. Éviter les tableaux et les barres trop décoratives.',
    'ENCART LATÉRAL si offres réellement fournies : « Des offres repérées », panneau bleu nuit avec contour bleu vif et titres courts blancs, villes en bleu lumineux. La référence contient une petite icône de recherche ; conserver l’idée d’un repère discret, pas une grosse illustration.',
    'PIED : date en français, source et limite méthodologique sur une à deux lignes courtes, lisibles et non envahissantes. La même date ne doit pas occuper deux fois trop d’espace.',
    '',
    'DONNÉES DE LA PUBLICATION — NE RIEN INVENTER',
    'Métier : « ' + job.toUpperCase() + ' » (ROME ' + safeText(romeCode) + ').',
    'Relevé du ' + dateShort + ' ; variante acceptable : « ' + dateLong + ' ». Afficher les dates exclusivement sous la forme JJ/MM/AAAA ou J mois AAAA, jamais en format ISO.',
    'Classement par nombre de ' + metricName + ' observés :',
    ...safeRanking.map((r, i) =>
      String(i + 1) + '. ' + safeText(r.departmentName) + ' (' + safeText(r.departmentCode) + ') — ' +
      formattedCount(r.offers) + ' offres observées · ' + formattedCount(r.openings) + ' postes proposés. ' +
      'Silhouette SVG bleue à rechercher dans les Illustrations de la marque par le code ' + safeText(r.departmentCode) + '.'
    ),
    '',
    ...(includeExamples && validSamples.length ? [
      'DES OFFRES REPÉRÉES — OPTIONNELLES',
      'Dans l’encart latéral, présenter au maximum 2 exemples en premier. Une troisième offre est possible UNIQUEMENT si le format 1080 × 1040 px la laisse suffisamment lisible, sans réduire le Top 5.',
      'Reprendre seulement le titre abrégé et la ville ; sans recopier les descriptions complètes, sans prétendre que les annonces sont encore en ligne au moment de la publication.',
      ...validSamples.map(offerLine),
      'Liens originaux pour la légende Instagram UNIQUEMENT (pas sur le visuel) :',
      ...validSamples.map(item => item.title + ' — ' + item.url),
      '',
    ] : [
      'DES OFFRES REPÉRÉES — DISPONIBILITÉ',
      'Aucune annonce de ce relevé n’est fournie. Ne pas créer de fausse offre, de faux employeur ou de fausse ville. Omettre le panneau « Des offres repérées » et consacrer l’espace au classement.',
      '',
    ]),
    'SOURCE ET FIABILITÉ',
    'Ajouter discrètement : « Source : ApprentiFR — La Bonne Alternance · Relevé du ' + dateShort + ' ».',
    'Note condensée : « Les volumes sont observés et non exhaustifs ; une offre peut proposer plusieurs postes et relever de plusieurs codes ROME. »',
    'Ce classement ne représente pas les chances individuelles d’obtenir un contrat. Ne pas inventer de pourcentage de réussite, d’employeur, de poste ou de commentaire de tendance.',
    'Ne pas afficher sur le visuel les statuts internes de validation ou des badges de qualité : ceux-ci restent dans l’interface d’administration. Une valeur non certifiée ne doit pas être présentée comme certaine.',
    '',
    'FINITIONS ET INTERDICTIONS',
    'Mise en page fidèle à la composition ApprentiFR de référence : JAUNE pour APPRENTISSAGE, TITRE BLANC XXL, BANDEAU BLEU pour la question, photo du métier en fond, cinq cartes contrastées, vignettes SVG et éventuellement petit encart d’offres sourcées.',
    'Ne pas ajouter de carte de France, d’effets 3D, de long cours méthodologique, de captures d’annonces, de chiffres inventés ou de décoration sans lien avec le métier.',
    'Le texte, les cartes, les photographies, les silhouettes SVG, les chiffres et les couleurs doivent tous rester modifiables dans Canva.',
  ].join('\n');
}
