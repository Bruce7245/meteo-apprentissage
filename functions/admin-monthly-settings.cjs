'use strict';
const {authenticateAdminRequest}=require('./lib/admin-auth.cjs');
const {MONTH_RE,DEPS,monthShift,monthDays,calculateMonth,compare,checkSeasonality}=require('./lib/admin-monthly-settings.cjs');
const DEFAULT=['unknown','unknown','unknown','unknown','unknown','unknown','unknown','unknown','unknown','unknown','unknown','unknown'];
async function readMonth(db,month){
 const days=monthDays(month),rows=new Map();let at=0;
 const workers=Array.from({length:6},async()=>{while(at<days.length){const date=days[at++];const snap=await db.collection('dailyOfferSnapshots').doc(date).collection('departments').get();rows.set(date,new Map(snap.docs.map(d=>[d.id,d.data()])))}});
 await Promise.all(workers);return rows;
}
async function handler({request,response,auth,db,FieldValue}){
 response.set('Cache-Control','private, no-store');
 if(request.method==='OPTIONS'){response.status(204).send('');return}
 if(request.method!=='POST'){response.status(405).json({ok:false,error:'Méthode non autorisée'});return}
 try{
  const admin=await authenticateAdminRequest({request,response,auth,db});if(!admin)return;
  const input=request.body||{};const ref=db.collection('adminMonthlySeasonality').doc('national');
  if(input.action==='save'){
   const data=checkSeasonality(input);const version=Number(input.expectedVersion);
   if(!Number.isSafeInteger(version)||version<0){response.status(400).json({ok:false,error:'Version invalide'});return}
   try{const result=await db.runTransaction(async tx=>{const snap=await tx.get(ref);const previous=snap.exists?snap.data():null;
    const currentVersion=Number(previous?.version||0);
    if(currentVersion!==version)throw new Error('VERSION_CONFLICT');
    const next=currentVersion+1;
    const payload={...data,version:next,updatedBy:admin.uid,updatedAt:FieldValue.serverTimestamp(),schemaVersion:'adminMonthlySeasonality.v1'};
    tx.set(ref,payload);
    tx.set(db.collection('adminMonthlySeasonalityHistory').doc('national_'+String(next).padStart(6,'0')),{...payload,previousMonths:previous?.months||DEFAULT,createdAt:FieldValue.serverTimestamp()});
    return next;
   });response.json({ok:true,version:result})}catch(e){if(e.message==='VERSION_CONFLICT'){response.status(409).json({ok:false,error:'Configuration modifiée dans une autre session'});return}throw e}
   return;
  }
  const month=String(input.month||'');
  if(!MONTH_RE.test(month)||month>'2026-10'&&month>new Date().toISOString().slice(0,7)){response.status(400).json({ok:false,error:'Mois invalide'});return}
  const prev=monthShift(month,-1),year=monthShift(month,-12),months=[month,prev,year];
  const [config,popMeta,popSnap,inseeSnap,importSnap,nafIndexSnap,...snapshots]=await Promise.all([
   ref.get(),db.collection('departmentPopulationReferenceMeta').doc('current').get(),
   db.collection('departmentPopulationReference').get(),db.collection('inseeDepartmentStats').get(),
   db.collection('inseeDepartmentImportIndex').get(),db.collection('inseeDepartmentNafStatsIndex').get(),...months.map(m=>readMonth(db,m))]);
  const popRun=popMeta.data()?.runId;const populations=new Map(popSnap.docs.filter(d=>d.data().runId===popRun).map(d=>[d.id,Number(d.data().population15To29)]));
  const complete=new Set(importSnap.docs.filter(d=>d.data().write===true&&d.data().complete===true&&nafIndexSnap.docs.some(x=>x.id===d.id)).map(d=>d.id));
  const employers=new Map(inseeSnap.docs.filter(d=>complete.has(d.id)).map(d=>[d.id,Number(d.data().activeEmployerEstablishmentsCount)]));
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const results=months.map((m,i)=>calculateMonth(m,snapshots[i],populations,employers,now));
  const rowByCode=(rows)=>new Map(rows.map(r=>[r.departmentCode,r]));
  const p=rowByCode(results[1]),y=rowByCode(results[2]);
  const departments=results[0].map(r=>({...r,changeMonth:compare(r,p.get(r.departmentCode)),changeYear:compare(r,y.get(r.departmentCode))}));
  response.json({ok:true,month,comparisonMonth:prev,comparisonYear:year,departments,
   populationReferenceYear:popMeta.data()?.referenceYear||null,
   seasonality:{months:config.data()?.months||DEFAULT,reason:config.data()?.reason||'',version:config.data()?.version||0},
   methodology:'Moyenne des stocks quotidiens stricts. Comparaisons masquées lorsque la couverture, la méthode ou le dénominateur ne permettent pas un rapprochement fiable. Données INSEE à date de référence.'});
 }catch(error){console.error('adminMonthlySettings',String(error?.code||error?.message).slice(0,120));response.status(503).json({ok:false,error:'Paramétrage momentanément indisponible'})}
}
module.exports={handler};
