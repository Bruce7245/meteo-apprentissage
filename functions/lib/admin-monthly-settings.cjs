'use strict';
const MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const DEPS=['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','2A','2B',...Array.from({length:75},(_,i)=>String(21+i)), '971','972','973','974','976'];
function monthShift(month,months){if(!MONTH_RE.test(month))throw new Error('INVALID_MONTH');const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+months,1)).toISOString().slice(0,7)}
function monthDays(month){const [y,m]=month.split('-').map(Number);const count=new Date(Date.UTC(y,m,0)).getUTCDate();return Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))}
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function calculateMonth(month, daily, populations=new Map(), employers=new Map(), now='2026-10-10'){
 const dates=monthDays(month);const today=now.slice(0,10);const out=[];
 for(const code of DEPS){let count=0,sum=0,openings=0,broken=false,saturated=false,capMissing=false,methods=new Set(),runIds=new Set();
  for(const date of dates){if(date>=today)continue;const row=daily.get(date)?.get(code);if(!row||row.date!==date||!row.activeRunId||row.qualityStatus==='quarantined'||!row.strictSummary)continue;
   const n=num(row.strictSummary.totalOffers),o=num(row.strictSummary.totalOpenings);if(n===null||o===null)continue;
   count++;sum+=n;openings+=o;if(row.methodologyBreak===true)broken=true;
   if(row.strictSummary.isPossiblySaturated===true||row.isPossiblySaturated===true)saturated=true;
   if(typeof (row.strictSummary.isPossiblySaturated??row.isPossiblySaturated)!=='boolean')capMissing=true;
   methods.add(row.qualityMethod||'unknown');runIds.add(row.activeRunId);
  }
  const pop=num(populations.get(code));const emp=num(employers.get(code));const expected=dates.filter(x=>x<today).length;
  const complete=expected===dates.length&&count===dates.length;
  const average=count?sum/count:null;
  const compatible=complete&&!broken&&!saturated&&methods.size===1;
  out.push({departmentCode:code,daysObserved:count,daysExpected:dates.length,
   averageOffers:average,averageOpenings:count?openings/count:null,
   population15To29:pop,activeEmployerEstablishmentsCount:emp,
   offersPer10000Young:average!==null&&pop>0?average/pop*10000:null,
   offersPer100Employers:average!==null&&emp>0?average/emp*100:null,
   comparable:compatible,quality:!complete?'incomplete':broken||methods.size!==1?'method_change':saturated?'saturated':capMissing?'indicative':'comparable',
   methodology:[...methods]});
 }
 return out;
}
function compare(current,previous){if(!current||!previous||!current.comparable||!previous.comparable||current.quality==='method_change'||previous.quality==='method_change')return null;
 const a=current.offersPer10000Young,b=previous.offersPer10000Young;
 if(a===null||b===null||b===0||current.population15To29!==previous.population15To29)return null;
 return (a-b)/b;
}
function checkSeasonality(input){
 const months=input?.months;
 if(!Array.isArray(months)||months.length!==12||months.some(x=>!['high','normal','low','unknown'].includes(x)))throw new Error('INVALID_SEASONALITY');
 if(typeof input?.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000)throw new Error('INVALID_REASON');
 return {months,reason:input.reason.trim()};
}
module.exports={MONTH_RE,DEPS,monthShift,monthDays,calculateMonth,compare,checkSeasonality};
