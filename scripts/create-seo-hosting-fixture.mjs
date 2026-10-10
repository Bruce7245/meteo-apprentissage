// Offline Hosting emulator fixture only. Never run on a production deployment.
import { generateDepartmentSeo } from './generate-department-seo.mjs';

const date = new Date().toISOString().slice(0, 10);
const index = {
  latestDate: date,
  sourceCollection: 'departmentVigilanceDaily',
  publishedCount: 1,
  departments: [{
    departmentCode: '72',
    departmentName: 'Sarthe',
    publishedLevel: 'yellow',
  }],
};
const documents = [{
  id: date + '_72',
  date,
  departmentCode: '72',
  departmentName: 'Sarthe',
  publishedLevel: 'yellow',
  isPublished: true,
  publicTitle: 'Vigilance jaune apprentissage - Sarthe',
  publicSummary: 'Exemple fictif CI : une situation de vigilance jaune est simulée uniquement dans le serveur de test local.',
  publicAdvice: 'Ce contenu ne doit jamais être publié sur le site réel.',
  reasons: ['Ceci est un échantillon artificiel réservé au test des routes Hosting.'],
  confidenceScore: 60,
  metrics: { activeOffers: 12 },
}];

const report = await generateDepartmentSeo({ index, documents });
if (report.eligibleCount !== 1) {
  throw new Error('Offline Hosting SEO fixture was not generated');
}
console.log('Local Hosting SEO fixture ready: /departement/72');
