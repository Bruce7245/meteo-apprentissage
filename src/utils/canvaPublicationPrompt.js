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
    'PROMPT CANVA — APPrentiFR | PUBLICATION INSTAGRAM MÉTIER',
    '',
    'FORMAT ET OBJECTIF',
    'Créer une publication Instagram verticale 1080 × 1350 pixels, très esthétique, dynamique et immédiatement compréhensible par des jeunes cherchant un apprentissage.',
    'Ne PAS produire une fiche scolaire, un rapport statistique, un tableau administratif ou un cours magistral. En quelques secondes, on doit comprendre le métier, les chiffres et les territoires.',
    'Composition premium proche du design éditorial social media : grande typographie, rythme visuel, blocs aérés, contraste, très peu de texte secondaire, rendu naturellement partageable.',
    '',
    'IDENTITÉ VISUELLE ET RESSOURCES CANVA',
    'Utiliser EXCLUSIVEMENT le logo officiel dans Canva > Identité visuelle « Bruce DE LUCAS ». Ne pas recréer le logo.',
    'Les fichiers Numdep_nomdep_bleu.svg sont DÉJÀ présents dans Canva > Identité visuelle « Bruce DE LUCAS » > Illustrations. Les sélectionner directement dans cette bibliothèque.',
    'Palette : bleu marine #1D3557, bleu secondaire #457B9D, blanc #FFFFFF, fond très clair #F8FAFC, gris #64748B. Typographie Inter ou équivalent.',
    'AUCUNE CARTE DE FRANCE. Aucune carte géographique, même stylisée. Ne PAS assembler les silhouettes SVG pour construire une carte.',
    'Les SVG sont de petites silhouettes illustratives placées à côté des départements du classement. Conserver leurs contours exacts, sans redessin ni déformation.',
    '',
    'AMBIANCE PHOTOGRAPHIQUE LIÉE AU MÉTIER',
    SCENERY[safeText(romeCode)] || 'Créer un décor photographique crédible lié au quotidien du métier « ' + job + ' », montrant son environnement et un geste professionnel authentique.',
    'Utiliser une photo ou composition de fond attractive liée à ce métier, avec un léger voile ou dégradé sombre pour garder une excellente lisibilité du texte.',
    'Le décor sert d’ambiance, pas de preuve d’une offre précise. Aucun logo d’employeur, aucune photographie d’annonce copiée, aucune illustration 3D artificielle.',
    '',
    'TEXTES PRINCIPAUX',
    'Accroche : « APPRENTISSAGE ».',
    'Titre fort : « ' + job.toUpperCase() + ' ».',
    hasNational
      ? 'Chiffre principal XXL : « ' + formattedCount(nationalValue) + ' ' + (selectedMetric === 'offers' ? 'OFFRES OBSERVÉES' : 'POSTES PROPOSÉS') + ' » (total du relevé, et non promesse de recrutement).'
      : 'Ne PAS afficher de total national comme exhaustif. Accroche principale : « OÙ SONT LES OFFRES ? » avec le classement territorial comme information centrale.',
    'Sous-titre : « Top ' + safeRanking.length + ' des départements » — classement par nombre de ' + metricName + ' observés.',
    'Date en français : « Offres observées le ' + dateLong + ' » ou « Relevé du ' + dateShort + ' ». Seuls les formats JJ/MM/AAAA ou J mois AAAA sont autorisés. Jamais AAAA-MM-JJ.',
    '',
    'CLASSEMENT DÉPARTEMENTAL — SANS CARTE',
    'Présenter le classement en ' + safeRanking.length + ' cartes/lignes légères, pas dans un tableau. Rang très lisible, nom du département, chiffre exact et sa silhouette SVG bleue issue des Illustrations Canva.',
    'Donner plus d’impact au premier département ; les autres restent équilibrés. Les mini-barres proportionnelles sont facultatives.',
    ...safeRanking.map((r, i) =>
      String(i + 1) + '. ' + safeText(r.departmentName) + ' (' + safeText(r.departmentCode) + ') — ' +
      formattedCount(r.offers) + ' offres observées · ' + formattedCount(r.openings) + ' postes proposés. ' +
      'SVG correspondant à rechercher par le code ' + safeText(r.departmentCode) + ' dans Illustrations.'
    ),
    '',
    ...(includeExamples && validSamples.length ? [
      'BLOC BONUS COURT — EXEMPLES D’OFFRES VÉRIFIÉES',
      'Intégrer si la composition reste lisible deux ou trois exemples, sous l’accroche « Des offres repérées ». Ne montrer que le titre court et la ville, sans recopier les descriptions complètes. Leurs liens sont à conserver dans la légende Instagram, pas en URL longue sur le visuel.',
      ...validSamples.map(offerLine),
      'Liens originaux pour la légende (ne pas afficher dans le décor) :',
      ...validSamples.map(item => item.title + ' — ' + item.url),
      '',
    ] : [
      'EXEMPLES D’OFFRES',
      'Aucun exemple d’annonce lié à ce relevé n’est fourni. Ne pas créer de fausse offre, de faux employeur ou de fausse ville. Omettre entièrement ce bloc de la composition.',
      '',
    ]),
    'PIED ET FIABILITÉ',
    'Ajouter de manière discrète : « Source : ApprentiFR — La Bonne Alternance · Relevé du ' + dateShort + ' ». Une offre peut comporter plusieurs postes et relever de plusieurs codes ROME.',
    'Les volumes sont observés et non exhaustifs ; ce classement ne représente pas les chances individuelles d’obtenir un contrat.',
    'NE PAS écrire « Données en cours de validation » sur le visuel. Les contrôles de qualité et leur état restent dans l’interface d’administration, sans être déguisés en validation acquise.',
    '',
    'RÈGLES DE COMPOSITION',
    'Le fond lié au métier doit être immédiatement identifiable. Garder le classement lisible sur smartphone, sans surcharge : un seul message fort, un Top 5 et éventuellement quelques exemples vérifiés.',
    'Ne pas ajouter de carte de France, de cours méthodologique, de gros pavé de texte, de logo inventé, de faux chiffres, de capture d’annonce ou de décor sans lien avec le métier.',
    'Tous les textes, silhouettes SVG, éléments de classement et effets doivent rester séparément modifiables dans Canva.',
  ].join('\n');
}
