const { authenticateAdminRequest } = require('./lib/admin-auth.cjs');
const { DEPARTMENT_CODES } = require('./admin-national-stats.cjs');

const VALID_CODES = new Set(DEPARTMENT_CODES);
const ROMECODE = /^[A-Z][0-9]{4}$/;
const asNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const normalizeCode = (value) => String(value || '').trim().toUpperCase().padStart(2, '0');
function parisDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function previousDate(date, days) {
  const instant = new Date(date + 'T12:00:00.000Z');
  instant.setUTCDate(instant.getUTCDate() - days);
  return instant.toISOString().slice(0, 10);
}
function byRomeLookup(summary, rome) {
  const rows = Array.isArray(summary?.byRome) ? summary.byRome : [];
  const match = rows.find((item) => item.code === rome);
  const rawLimit = summary?.byRomeStoredCount;
  const knownCount = asNumber(rawLimit);
  const complete = summary?.byRomeComplete === true || (summary?.byRomeComplete !== false && rows.length < 120 && (knownCount === null || knownCount <= rows.length));
  return { match: match || null, complete };
}
function aggregateRomeDay(date, docs, references, rome) {
  const rows = [];
  let unknown = 0;
  let capped = 0;
  let unassessed = 0;
  for (const doc of docs) {
    const data = doc.data() || {};
    const code = normalizeCode(doc.id);
    if (!VALID_CODES.has(code) || normalizeCode(data.departmentCode) !== code || data.date !== date ||
        !data.activeRunId || data.qualityStatus === 'quarantined' || !data.strictSummary ||
        asNumber(data.strictSummary.totalOffers) === null ||
        (asNumber(data.storedOffersCount) !== null && Number(data.strictSummary.totalOffers) > Number(data.storedOffersCount))) continue;
    const assessment = data.strictSummary.isPossiblySaturated;
    if (assessment === true) capped += 1;
    if (typeof assessment !== 'boolean') unassessed += 1;
    const { match, complete } = byRomeLookup(data.strictSummary, rome);
    if (!match && !complete) unknown += 1;
    const offers = match ? asNumber(match.offers) : complete ? 0 : null;
    const openings = match ? asNumber(match.openings) : complete ? 0 : null;
    const ref = references.get(code) || {};
    rows.push({
      departmentCode: code,
      departmentName: String(ref.name || ref.nom || code),
      regionName: String(ref.regionName || 'Région non renseignée'),
      offers, openings,
      complete: offers !== null && openings !== null,
      capped: assessment === true,
      capAssessed: typeof assessment === 'boolean',
    });
  }
  rows.sort((a,b) => (b.offers ?? -1) - (a.offers ?? -1) || a.departmentCode.localeCompare(b.departmentCode, 'fr'));
  return {
    date,
    coveredDepartments: rows.length,
    measuredDepartments: rows.filter(row => row.complete).length,
    unknownDepartments: unknown,
    cappedDepartments: capped,
    unassessedCapDepartments: unassessed,
    offers: rows.every(row => row.complete) && rows.length === DEPARTMENT_CODES.length ? rows.reduce((sum,row) => sum + row.offers,0) : null,
    observedOffers: rows.reduce((sum,row) => sum + (row.offers || 0),0),
    openings: rows.every(row => row.complete) && rows.length === DEPARTMENT_CODES.length ? rows.reduce((sum,row) => sum + row.openings,0) : null,
    observedOpenings: rows.reduce((sum,row) => sum + (row.openings || 0),0),
    comparable: rows.length === DEPARTMENT_CODES.length && unknown === 0 && capped === 0 && unassessed === 0 && rows.every(row => row.complete),
    departments: rows,
  };
}
async function loadRomeDay(db, date, references, rome) {
  const snapshot = await db.collection('dailyOfferSnapshots').doc(date).collection('departments').get();
  if (snapshot.empty) return null;
  const day = aggregateRomeDay(date, snapshot.docs, references, rome);
  return day.coveredDepartments ? day : null;
}
async function loadOccupationOffers(db, { rome, days = 7, today = parisDate() }) {
  const referencesSnap = await db.collection('departments').get();
  const references = new Map(referencesSnap.docs.map(doc => [normalizeCode(doc.id), doc.data() || {}]));
  const window = [7, 30, 60].includes(days) ? days : 7;
  const dates = Array.from({ length: window },(_,i) => previousDate(today,i));
  const history = [];
  // Load two days at a time to avoid unbounded Firestore requests.
  for(let i=0;i<dates.length;i+=2){
    const daysBatch=await Promise.all(dates.slice(i,i+2).map(date => loadRomeDay(db,date,references,rome)));
    history.push(...daysBatch.filter(Boolean));
  }
  const latest=history[0] || null;
  return {
    ok:true,romeCode:rome,latestDate:latest?.date || null,
    latest:latest ? { ...latest, departments:undefined } : null,
    departments:latest?.departments || [],
    history:history.reverse().map(({departments,...other})=>other),
    methodology:'Offres et postes par code ROME issus des instantanés strictement géolocalisés La Bonne Alternance. Plusieurs codes ROME peuvent être associés à une offre. Une absence dans un classement tronqué ne vaut pas zéro. Les sommes ne sont certifiées que pour une couverture complète et un contrôle de plafonnement suffisant.',
  };
}
async function handleOccupationOffers({request,response,auth,db}={}) {
  if (request?.method !== 'POST') {
    response.set?.('Allow','POST');
    response.status(405).json({ok:false,error:'Méthode non autorisée'});
    return;
  }
  const account=await authenticateAdminRequest({request,response,auth,db});
  if(!account)return;
  const rome=String(request?.body?.romeCode || '').trim().toUpperCase();
  if(!ROMECODE.test(rome)){
    response.status(400).json({ok:false,error:'Code ROME invalide'});
    return;
  }
  try{
    const rawDays=Number(request?.body?.days);
    const days=[7,30,60].includes(rawDays)?rawDays:7;
    const result=await loadOccupationOffers(db,{rome,days});
    response.set?.('Cache-Control','private, no-store');
    response.status(200).json(result);
  }catch(error){
    console.error('Occupation offers report failed',String(error?.message || error).slice(0,200));
    response.status(500).json({ok:false,error:'Statistiques métiers indisponibles'});
  }
}
module.exports={byRomeLookup,aggregateRomeDay,loadOccupationOffers,handleOccupationOffers};
