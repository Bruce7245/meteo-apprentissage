import {getReadyAdminUser} from './adminSessionService.js';
const ENDPOINT='https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminMonthlySettingsHttp';
async function call(body){const user=await getReadyAdminUser();if(!user)throw new Error('Session administrateur absente.');
 const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw new Error(data?.error||'Service indisponible');return data;
}
export const getAdminMonthlySettings=(month,romeCode,departmentCode)=>call({month,...(romeCode?{romeCode}:{}),...(departmentCode?{departmentCode}:{})});
export const saveAdminSeasonality=(months,reason,expectedVersion)=>call({action:'save',months,reason,expectedVersion});

export const previewAdminWeightedScores = (month, weights) =>
  call({action:'previewScores',month,weights,seasonalityFactor:1});
export const saveAdminWeightedScoreDraft = (weights, reason, expectedVersion) =>
  call({action:'saveScoreWeights',weights,reason,expectedVersion,seasonalityFactor:1});
