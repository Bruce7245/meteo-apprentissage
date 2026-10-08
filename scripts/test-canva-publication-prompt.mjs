import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrenchPublicationDate,
  selectOccupationOfferExamples,
  buildOccupationInstagramPrompt,
} from '../src/utils/canvaPublicationPrompt.js';

const day = '2026-10-07';
const departments = [
  {departmentCode:'75',departmentName:'Paris',offers:28,openings:35},
  {departmentCode:'59',departmentName:'Nord',offers:19,openings:21},
];

test('format français court et long : jamais le format ISO brut',()=>{
  assert.equal(formatFrenchPublicationDate(day,'short'),'07/10/2026');
  assert.equal(formatFrenchPublicationDate(day,'long'),'7 octobre 2026');
  assert.equal(formatFrenchPublicationDate('2026-02-30'),'date non renseignée');
  assert.equal(formatFrenchPublicationDate('nonsense'),'date non renseignée');
});

test('exemples originaux conservés seulement si la date du relevé correspond',()=>{
  const responses=[
    {departmentCode:'75',departmentName:'Paris',data:{date:day,offers:[
      {title:'Apprenti boulanger / boulangère',city:'Paris',applyUrl:'https://example.org/offer/1',publicationExpirationDate:'2026-11-01'},
      {title:'Boulanger en alternance',city:'Paris',applyUrl:'javascript:alert(1)'},
      {title:'Annonce expirée',city:'Paris',applyUrl:'https://example.org/expired',publicationExpirationDate:'2026-09-30'},
    ]}},
    {departmentCode:'59',departmentName:'Nord',data:{date:'2026-10-08',offers:[
      {title:'Serveur',city:'Lille',applyUrl:'https://example.org/not-the-same-date'},
    ]}},
  ];
  const selected=selectOccupationOfferExamples(responses,day);
  assert.equal(selected.length,1);
  assert.equal(selected[0].title,'Apprenti boulanger / boulangère');
  assert.equal(selected[0].city,'Paris');
  assert.equal(selected[0].date,day);
  assert.equal(selectOccupationOfferExamples(responses,'2026-10-05').length,0);
});

test('le prompt devient social media, sans carte, avec silhouettes Canva et décor métier',()=>{
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Boulanger / Boulangère',romeCode:'D1102',date:day,
    ranking:departments,fullyComparable:true,nationalOffers:112,nationalOpenings:142,
  });
  assert.match(prompt,/dimensions EXACTES 1080 × 1040 pixels/);
  assert.doesNotMatch(prompt,/1080 × 1350/);
  assert.match(prompt,/PASTILLE JAUNE OBLIGATOIRE/);
  assert.match(prompt,/#F7C948/);
  assert.match(prompt,/APPRENTISSAGE/);
  assert.match(prompt,/bandeau bleu vif/);
  assert.match(prompt,/OÙ SONT LES OFFRES \?/);
  assert.match(prompt,/première carte est BLEUE/);
  assert.match(prompt,/quatre suivantes sont BLANCHES/);
  assert.match(prompt,/DES OFFRES REPÉRÉES/);
  assert.match(prompt,/photo.*métier.*fond/i);
  assert.match(prompt,/fourni[l] authentique/i);
  assert.match(prompt,/AUCUNE CARTE DE FRANCE/);
  assert.doesNotMatch(prompt,/Afficher une carte géographique exacte de France/);
  assert.match(prompt,/Identité visuelle « Bruce DE LUCAS » > Illustrations/);
  assert.match(prompt,/112 OFFRES OBSERVÉES/);
  assert.match(prompt,/7 octobre 2026/);
  assert.match(prompt,/07\/10\/2026/);
  assert.doesNotMatch(prompt,/Relevé du 2026-10-07/);
  assert.match(prompt,/Paris \(75\) — 28 offres observées/);
  assert.match(prompt,/Nord \(59\) — 19 offres observées/);
  assert.match(prompt,/Ne pas créer de fausse offre/);
});

test('les totaux non certifiés ne deviennent pas une promesse de volume national',()=>{
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Boulanger / Boulangère',romeCode:'D1102',
    date:day,ranking:departments,nationalOffers:112,fullyComparable:false,
  });
  assert.match(prompt,/Ne PAS afficher de total national comme exhaustif/);
  assert.doesNotMatch(prompt,/112 OFFRES OBSERVÉES/);
  assert.match(prompt,/volumes sont observés et non exhaustifs/);
  assert.doesNotMatch(prompt,/Mention obligatoire : « Données en cours de validation »/);
});

test('des exemples réels sont facultatifs et tracés, sans descriptions intégrales',()=>{
  const example=[{title:'Apprenti boulanger',city:'Paris',departmentName:'Paris',url:'https://example.org/job/1',date:day}];
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Boulanger / Boulangère',romeCode:'D1102',
    date:day,ranking:departments,examples:example,
  });
  assert.match(prompt,/Apprenti boulanger — Paris/);
  assert.match(prompt,/https:\/\/example.org\/job\/1/);
  assert.match(prompt,/sans recopier les descriptions complètes/);
  const without=buildOccupationInstagramPrompt({
    occupationLabel:'Boulanger / Boulangère',romeCode:'D1102',
    date:day,ranking:departments,examples:example,includeExamples:false,
  });
  assert.doesNotMatch(without,/https:\/\/example.org\/job\/1/);
});

test('aucune fausse ligne du classement avec données incomplètes',()=>{
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Boulanger',romeCode:'D1102',date:day,ranking:[
      {departmentCode:'75',departmentName:'Paris',offers:null,openings:3},
      departments[1],
    ],
  });
  assert.match(prompt,/Nord \(59\)/);
  assert.doesNotMatch(prompt,/Paris \(75\) —/);
});

test('le prompt conserve l’identité graphique aussi lors du classement par postes',()=>{
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Serveur / Serveuse',
    romeCode:'G1803',
    date:day,
    ranking:departments,
    metric:'openings',
    nationalOpenings:90,
    fullyComparable:true,
  });
  assert.match(prompt,/1080 × 1040 pixels/);
  assert.match(prompt,/OÙ SONT LES POSTES \?/);
  assert.match(prompt,/90 POSTES PROPOSÉS/);
  assert.match(prompt,/PASTILLE JAUNE OBLIGATOIRE/);
  assert.match(prompt,/restaurant vivant et actuel/i);
  assert.doesNotMatch(prompt,/1080 × 1350/);
  assert.doesNotMatch(prompt,/Afficher une carte géographique exacte de France/);
});

test('le bloc offres n’invente rien et disparaît si aucun exemple ne correspond au relevé',()=>{
  const prompt=buildOccupationInstagramPrompt({
    occupationLabel:'Serveur / Serveuse',
    romeCode:'G1803',
    date:day,
    ranking:departments,
    examples:[{title:'Ancienne annonce',city:'Lille',url:'https://example.org/expired',date:'2026-09-01'}],
  });
  assert.match(prompt,/Omettre le panneau « Des offres repérées »/);
  assert.doesNotMatch(prompt,/Ancienne annonce/);
  assert.match(prompt,/cinq cartes contrastées/);
  assert.match(prompt,/1080 × 1040/);
});


test('cadrage imposé : marges, positions et ratio des cinq cartes', () => {
  const prompt = buildOccupationInstagramPrompt({
    occupationLabel: 'Serveur / Serveuse', romeCode: 'G1803',
    date: day, ranking: departments,
  });
  assert.match(prompt, /dimensions EXACTES 1080 × 1040 pixels/);
  assert.match(prompt, /GRILLE DE COMPOSITION IMPOSÉE/);
  assert.match(prompt, /x=56 à 1024/);
  assert.match(prompt, /x=56 à 321, y=124 à 172/);
  assert.match(prompt, /x=56 à 680, y=181 à 320/);
  assert.match(prompt, /x=56 à 714, y=333 à 405/);
  assert.match(prompt, /y=509,588,667,746,825/);
  assert.match(prompt, /hauteur 72 px chacune/);
  assert.match(prompt, /x=598–693/);
  assert.match(prompt, /mode « Contenir » sans déformation/);
  assert.match(prompt, /RÈGLE ANTI-CHEVAUCHEMENT/);
  assert.match(prompt, /maximum 3 lignes/);
  assert.match(prompt, /Ne pas réduire la taille des caractères au point de les rendre illisibles/);
});

test('la photographie métier est recadrée à droite et se fond dans le bleu nuit sur deux axes', () => {
  const prompt = buildOccupationInstagramPrompt({
    occupationLabel: 'Boulanger / Boulangère', romeCode: 'D1102',
    date: day, ranking: departments,
  });
  assert.match(prompt, /CADRAGE : photo du métier x=420–1080, y=0–430/);
  assert.match(prompt, /FONDU HORIZONTAL OBLIGATOIRE/);
  assert.match(prompt, /FONDU VERTICAL OBLIGATOIRE/);
  assert.match(prompt, /#071A32 → transparent/);
  assert.match(prompt, /100 % vers y=440/);
  assert.match(prompt, /ne pas couper le visage/i);
  assert.match(prompt, /aucun bord vertical net/i);
  assert.match(prompt, /photo.*visible.*cartes/i);
});

test('deux exemples maximum sur le visuel, troisième lien réservé à la légende', () => {
  const examples = ['Première annonce', 'Deuxième annonce', 'Troisième annonce'].map((title, i) => ({
    title, city: 'Lille', departmentName: 'Nord', date: day,
    url: 'https://example.org/job/' + String(i + 1),
  }));
  const prompt = buildOccupationInstagramPrompt({
    occupationLabel: 'Serveur / Serveuse', romeCode: 'G1803',
    date: day, ranking: departments, examples,
  });
  const [visual, caption] = prompt.split('INFORMATIONS RÉSERVÉES À LA LÉGENDE INSTAGRAM (HORS VISUEL)');
  assert.match(visual, /Première annonce/);
  assert.match(visual, /Deuxième annonce/);
  assert.doesNotMatch(visual, /Troisième annonce/);
  assert.match(caption, /Troisième annonce/);
  assert.match(prompt, /Ne JAMAIS dessiner la troisième/);
});

test('en absence d’offres sourcées le Top 5 utilise toute la largeur', () => {
  const prompt = buildOccupationInstagramPrompt({
    occupationLabel: 'Boulanger', romeCode: 'D1102',
    date: day, ranking: departments, examples: [],
  });
  assert.match(prompt, /SANS EXEMPLES : supprimer intégralement l’encart/);
  assert.match(prompt, /étendre les cinq cartes de x=56 à x=1024/);
  assert.match(prompt, /Omettre le panneau « Des offres repérées »/);
});
