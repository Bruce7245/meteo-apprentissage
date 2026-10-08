const test=require('node:test');
const assert=require('node:assert/strict');
const {byRomeLookup,aggregateRomeDay,handleOccupationOffers}=require('../admin-occupation-offers.cjs');
const date='2026-10-08';
function doc(code,romeRows=[{code:'D1102',offers:3,openings:6}],extra={}){
return {id:code,data:()=>({departmentCode:code,date,activeRunId:'run',storedOffersCount:50,strictSummary:{totalOffers:20,isPossiblySaturated:false,byRome:romeRows,...extra}})};
}
test('filtre les metiers par vrai code ROME et distingue postes des offres',()=>{
 const result=aggregateRomeDay(date,[doc('72'),doc('59',[{code:'G1803',offers:4,openings:4}])],new Map([['72',{name:'Sarthe'}],['59',{name:'Nord'}]]),'D1102');
 assert.equal(result.coveredDepartments,2);assert.equal(result.measuredDepartments,2);
 assert.equal(result.departments[0].departmentName,'Sarthe');assert.equal(result.departments[0].offers,3);
 assert.equal(result.departments[0].openings,6);assert.equal(result.departments[1].offers,0);
 assert.equal(result.offers,null);assert.equal(result.observedOffers,3);
});
test('ne transforme pas en zero une entree absente dans un byRome tronque',()=>{
 const rows=Array.from({length:120},(_,i)=>({code:'A'+String(i).padStart(4,'0'),offers:1,openings:2}));
 const data=aggregateRomeDay(date,[doc('72',rows)],new Map(),'D1102');
 assert.equal(data.unknownDepartments,1);assert.equal(data.departments[0].offers,null);assert.equal(data.observedOffers,0);
 assert.equal(byRomeLookup({byRome:[]},'D1102').complete,true);
});
test('absence de controle du plafonnement bloque publication certifiee',()=>{
 const data=aggregateRomeDay(date,[doc('72',[],{isPossiblySaturated:null})],new Map(),'D1102');
 assert.equal(data.unassessedCapDepartments,1);assert.equal(data.comparable,false);
});
test('quarantaine, date ou code incoherent ignores',()=>{
 const q=doc('72');q.data=()=>({...doc('72').data(),qualityStatus:'quarantined'});
 assert.equal(aggregateRomeDay(date,[q,doc('59',[],{totalOffers:70})],new Map(),'D1102').coveredDepartments,0);
});
test('endpoint refuse un appel sans authentification',async()=>{
 const response={status(n){this.code=n;return this},json(obj){this.result=obj},set(){}};
 await handleOccupationOffers({request:{method:'POST',get:()=>''},response,auth:{},db:{}});
 assert.equal(response.code,401);
});
test('endpoint refuse un code ROME malforme pour un administrateur authentifie',async()=>{
 const response={status(n){this.code=n;return this},json(obj){this.result=obj},set(){}};
 const auth={verifyIdToken:async()=>({uid:'uid',email_verified:true,firebase:{sign_in_provider:'password'}})};
 const db={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({role:'admin'})})})})};
 await handleOccupationOffers({request:{method:'POST',body:{romeCode:'<script>'},get:()=> 'Bearer valid'},response,auth,db});
 assert.equal(response.code,400);
});

test('une synthese byRome absente ne signifie jamais zero offre',()=>{
 assert.equal(byRomeLookup({},'D1102').complete,false);
 assert.equal(byRomeLookup({byRome:null},'D1102').complete,false);
 const result=aggregateRomeDay(date,[doc('72',[],{byRome:undefined})],new Map(),'D1102');
 assert.equal(result.departments[0].offers,null);
});
test('la recherche historique conserve les classements de chaque date',async()=>{
 const dayBefore='2026-10-07';
 const old=doc('72',[{code:'D1102',offers:1,openings:2}]);
 const oldData=old.data();
 old.data=()=>({...oldData,date:dayBefore});
 const docsByDate={[date]:[doc('72')],[dayBefore]:[old]};
 const db={collection:(collectionName)=>{
   if(collectionName==='departments')return {get:async()=>({docs:[{id:'72',data:()=>({name:'Sarthe',regionName:'Pays de la Loire'})}]})};
   if(collectionName==='dailyOfferSnapshots')return{doc:(day)=>({collection:()=>({get:async()=>({docs:docsByDate[day]||[],empty:!(docsByDate[day]?.length)})})})};
   throw new Error('Unexpected collection '+collectionName);
 }};
 const {loadOccupationOffers}=require('../admin-occupation-offers.cjs');
 const result=await loadOccupationOffers(db,{rome:'D1102',days:7,today:date});
 assert.equal(result.latestDate,date);
 assert.deepEqual(result.history.map(x=>x.date),[dayBefore,date]);
 assert.equal(result.history[0].departments[0].offers,1);
 assert.equal(result.history[1].departments[0].openings,6);
 assert.equal(result.departments[0].offers,3);
});
