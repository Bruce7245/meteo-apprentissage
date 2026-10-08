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
  assert.match(prompt,/1080 × 1350/);
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
