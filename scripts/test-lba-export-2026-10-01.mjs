/**
 * Test ponctuel de l'export national La Bonne Alternance.
 * 1 appel a l'API GET /job/v1/export + 1 telechargement de l'URL signee.
 * Aucun ecriture Firestore ou GitHub. Aucun fichier export conserve.
 * Exige Node.js >= 18 et API_APPRENTISSAGE_TOKEN en variable d'environnement.
 */
import { gunzipSync } from 'node:zlib';

const TARGET_DATE = '2026-10-01';
const EXPORT_ENDPOINT = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/export';
const token = (process.env.API_APPRENTISSAGE_TOKEN || '').trim();

if (!token) {
  console.error('Cle manquante : definir API_APPRENTISSAGE_TOKEN (cle API de production).');
  process.exit(2);
}

const parisDateFormatter = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});
function parisDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : parisDateFormatter.format(date);
}
function findJobRows(payload) {
  if (Array.isArray(payload)) return payload;
  const scopes = [payload, payload?.data, payload?.results, payload?.export];
  for (const obj of scopes) {
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object') continue;
    for (const name of ['jobs', 'offers', 'offres', 'items', 'results']) {
      if (Array.isArray(obj[name])) return obj[name];
    }
  }
  throw new Error('Structure export inconnue : ' + Object.keys(payload || {}).join(', '));
}
async function getJson(response, label) {
  const status = response.status;
  if (!response.ok) {
    const msg = (await response.text()).slice(0, 250);
    throw new Error(`${label}: HTTP ${status} ${msg.replaceAll(token, '[REDACTED]')}`);
  }
  return response.json();
}

try {
  // Seul appel a l'API metier : aucun parametre de date n'existe pour cette route.
  const linkRes = await fetch(EXPORT_ENDPOINT, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const meta = await getJson(linkRes, 'GET /job/v1/export');
  if (typeof meta?.url !== 'string' || !/^https:\/\//i.test(meta.url)) {
    throw new Error('Reponse export invalide : aucun lien HTTPS de telechargement');
  }
  // Ce telechargement n'est pas un second appel a /job/v1/export.
  const downloadRes = await fetch(meta.url, { signal: AbortSignal.timeout(240_000) });
  if (!downloadRes.ok) {
    throw new Error(`Telechargement du fichier export : HTTP ${downloadRes.status}`);
  }
  let buf = Buffer.from(await downloadRes.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf);
  }
  const content = JSON.parse(buf.toString('utf8'));
  const rows = findJobRows(content);
  const offers = rows.filter(job => job && typeof job.offer === 'object' && job.offer !== null
    && String(job?.identifier?.partner_label || '').trim() !== 'recruteurs_lba');
  const matches = offers.filter(job => parisDate(job?.offer?.publication?.creation || job?.publication?.creation) === TARGET_DATE);
  const ids = new Set();
  let noStableId = 0;
  let openings = 0;
  const departments = new Map();
  const partners = new Map();
  for (const job of matches) {
    const id = job.identifier || {};
    const partner = String(id.partner_label || 'source_inconnue');
    const partnerId = String(id.partner_job_id || id.id || '');
    if (partnerId) ids.add(`${partner}:${partnerId}`);
    else noStableId++;
    openings += Number(job?.offer?.opening_count || 0);
    const location = job?.workplace?.location || {};
    const dep = String(location.department || location.departmentCode || 'non_renseigne');
    departments.set(dep, (departments.get(dep) || 0) + 1);
    partners.set(partner, (partners.get(partner) || 0) + 1);
  }
  const top = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count }));
  console.log(JSON.stringify({
    objectif: `Offres creees le ${TARGET_DATE} toujours presentes dans l'export actuel`,
    exportLastUpdate: meta.lastUpdate || null,
    checkedAt: new Date().toISOString(),
    routeExportCalls: 1,
    signedFileDownloads: 1,
    totalRowsInExport: rows.length,
    totalJobOfferRows: offers.length,
    offersWithKnownCreationDate: offers.filter(j => parisDate(j?.offer?.publication?.creation || j?.publication?.creation)).length,
    offersCreatedOnTargetDate: matches.length,
    knownDistinctOfferIdsOnTargetDate: ids.size,
    rowsWithoutStableIdOnTargetDate: noStableId,
    advertisedOpeningCountOnTargetDate: openings,
    topDepartments: top(departments),
    topSources: top(partners),
    note: 'Ce resultat NE reconstitue PAS toutes les offres actives le 01/10 : uniquement les annonces creees ce jour et encore presentes dans le dernier export.',
  }, null, 2));
} catch (error) {
  console.error('Test export impossible : ' + String(error?.message || error).replaceAll(token, '[REDACTED]'));
  process.exitCode = 1;
}
