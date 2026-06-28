const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

const ROME_FAMILIES = {
  A: 'Agriculture, pêche, espaces naturels',
  B: 'Arts et façonnage d’ouvrages',
  C: 'Banque, assurance, immobilier',
  D: 'Commerce, vente, grande distribution',
  E: 'Communication, média, multimédia',
  F: 'Construction, bâtiment, travaux publics',
  G: 'Hôtellerie, restauration, tourisme, loisirs',
  H: 'Industrie',
  I: 'Installation et maintenance',
  J: 'Santé',
  K: 'Services à la personne et à la collectivité',
  L: 'Spectacle',
  M: 'Support à l’entreprise',
  N: 'Transport et logistique',
};

function getSectorCodeFromLabel(label) {
  const entry = Object.entries(ROME_FAMILIES).find(([, value]) => value === label);
  return entry ? entry[0] : 'unknown';
}

function getLevelFromCount(count) {
  if (count < 3) return 'Jaune';
  return 'Vert';
}

function getReasonFromCount(count) {
  if (count < 3) {
    return 'Volume quotidien faible dans ce secteur. Une surveillance est recommandée.';
  }

  return 'Le secteur présente un volume observé sans signal de tension particulier.';
}

async function main() {
  const latestSnapshot = await db
    .collection('departmentDailyStats')
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  if (latestSnapshot.empty) {
    console.log('Aucune donnée departmentDailyStats trouvée.');
    return;
  }

  const latestDate = latestSnapshot.docs[0].data().date;
  console.log(`Backfill sectoriel pour la date ${latestDate}`);

  const dailySnapshot = await db
    .collection('departmentDailyStats')
    .where('date', '==', latestDate)
    .get();

  let batch = db.batch();
  let writeCount = 0;

  dailySnapshot.docs.forEach((document) => {
    const data = document.data();
    const departmentCode = data.code || document.id.split('_')[1];
    const departmentName = data.name || `Département ${departmentCode}`;
    const families = Array.isArray(data.topRomeFamilies) ? data.topRomeFamilies : [];

    families.forEach((family) => {
      const sectorLabel = family.sector || family.label || 'Secteur non renseigné';
      const sectorCode = getSectorCodeFromLabel(sectorLabel);
      const jobsCount = Number(family.count || 0);
      const level = getLevelFromCount(jobsCount);

      const reference = db
        .collection('departmentSectorStats')
        .doc(`${departmentCode}_${sectorCode}`);

      batch.set(
        reference,
        {
          date: latestDate,
          departmentCode,
          departmentName,
          sectorCode,
          sectorLabel,
          jobsCount,
          openingCount: 0,
          level,
          suggestedLevel: level,
          publicLevel: level,
          publicReason: getReasonFromCount(jobsCount),
          confidence: jobsCount >= 10 ? 'high' : jobsCount >= 3 ? 'medium' : 'low',
          source: 'departmentDailyStats.topRomeFamilies',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      writeCount += 1;

      if (writeCount % 400 === 0) {
        console.log(`Commit intermédiaire : ${writeCount}`);
      }
    });
  });

  await batch.commit();

  console.log(`Backfill terminé : ${writeCount} documents écrits dans departmentSectorStats.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
