import {cached,ApiError} from './openf1.js';
const COMMUNITY='https://f1-live-api.onrender.com';
const JOLPICA='https://api.jolpi.ca/ergast/f1';
let jolpicaQueue=Promise.resolve(),lastJolpicaStart=0;
async function jolpicaSlot(){
 const job=jolpicaQueue.catch(()=>{}).then(async()=>{const delay=Math.max(0,lastJolpicaStart+350-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));lastJolpicaStart=Date.now();});jolpicaQueue=job;return job;
}
export const SOURCE_DIRECTORY=[
  {id:'direct',name:'F1 public timing stream',cost:'Free public topics',live:true,provides:'Classification, lap and sector times, gaps, tyres, pit counts, weather and race control when published.',limits:'GPS, full car telemetry and some radio metadata can require connected access. Anonymous access varies by session.',url:'https://nicxe.github.io/f1_sensor/beta/features/f1tv-auth'},
  {id:'community',name:'F1 Insights community feed',cost:'Public endpoint, no key requested',live:true,provides:'A public snapshot of timing, radio, weather, track status, and any telemetry/positions the service actually receives.',limits:'Community hosted; may sleep, be stale or become unavailable. Old snapshots are labelled stale.',url:'https://github.com/harsh779/f1-live-api'},
  {id:'jolpica',name:'Jolpica F1',cost:'Free, no account',live:false,provides:'Season schedules, driver/team standings, points, wins and published race/qualifying results.',limits:'Published results and statistics, not a live timing or GPS feed.',url:'https://github.com/jolpica/jolpica-f1/blob/main/docs/README.md'},
  {id:'openf1',name:'OpenF1',cost:'Free history; optional paid live access',live:false,provides:'Historical timing, lap/sector times, GPS, telemetry, weather, radio and replay.',limits:'Live access requires an OpenF1 subscription. Historical endpoints may also be restricted during an active session.',url:'https://openf1.org/docs/'},
  {id:'multiviewer',name:'MultiViewer',cost:'Public circuit geometry',live:false,provides:'The exact circuit layout and rotation, matched by circuit key and season.',limits:'Geometry only; it does not provide live car positions.',url:'https://multiviewer.app/'},
  {id:'t1',name:'T1API',cost:'Public reference data; account for analysis',live:false,provides:'Circuit/reference data and analysis endpoints.',limits:'Not enabled: analysis needs an API key. Public access is not a complete anonymous live feed.',url:'https://docs.t1f1.com/'},
  {id:'schedule',name:"When's the Race",cost:'Free public schedule JSON',live:false,provides:'A supplementary race schedule.',limits:'Schedule only, not live timing. Jolpica is used for the calendar here.',url:'https://whenstherace.com/f1-schedule-json/'}
];
export async function publicJson(url,ttl=10000){
  return cached(`public:${url}`,ttl,async()=>{
    if(url.startsWith(JOLPICA+'/'))await jolpicaSlot();
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'F1LiveTracker/2.1 (+https://github.com/philipdonath299/f1-live-tracker)'},signal:AbortSignal.timeout(18000)});
    if(!response.ok)throw new ApiError(`Free data source returned ${response.status}.`,response.status===429?429:502,30);
    const text=await response.text();if(text.length>6500000)throw new ApiError('The free data response was too large.',502);
    try{return JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new ApiError('The free source did not return JSON.',502);}
  });
}
export async function communitySnapshot(){
  try{
    const raw=await publicJson(`${COMMUNITY}/snapshot`,8000);
    if(!raw||typeof raw!=='object'||!raw.session||!raw.timing)throw new ApiError('The community feed has not published a timing snapshot yet.',503);
    const snapshot={...raw};
    if(Array.isArray(raw.car_data?.Entries))snapshot.car_data={Entries:raw.car_data.Entries.slice(-8)};
    if(Array.isArray(raw.position?.Position))snapshot.position={Position:raw.position.Position.slice(-8)};
    if(raw.race_control?.Messages)snapshot.race_control={Messages:Object.values(raw.race_control.Messages).slice(-200)};
    if(raw.team_radio?.Captures)snapshot.team_radio={Captures:Object.values(raw.team_radio.Captures).slice(-80)};
    // Preserve the upstream timestamp; a successful HTTP request is not a fresh timing event.
    return {available:true,source:'F1 Insights community feed',snapshot,asOf:raw.last_update||raw.heartbeat?.Utc||null,fetchedAt:new Date().toISOString()};
  }catch(error){return {available:false,source:'F1 Insights community feed',snapshot:null,asOf:null,error:error.message,retryAfter:error.retryAfter||20};}
}
export function calendarSessions(races){
  const names=[['FirstPractice','Practice 1',60],['SecondPractice','Practice 2',60],['ThirdPractice','Practice 3',60],['SprintQualifying','Sprint Qualifying',45],['Qualifying','Qualifying',90],['Sprint','Sprint',60],['Race','Race',150]];
  const sessions=[];
  for(const race of races){
    const year=Number(race.season),round=Number(race.round),c=race.Circuit||{};
    for(let index=0;index<names.length;index++){
      const [field,name,minutes]=names[index],slot=field==='Race'?race:race[field];if(!slot?.date||!slot.time)continue;
      const date=new Date(`${slot.date}T${slot.time}`);if(!Number.isFinite(date.getTime()))continue;
      sessions.push({session_key:9000000+(year-2023)*10000+round*10+index,meeting_key:`jolpica:${year}:${round}`,year,round,provider:'jolpica',race_name:race.raceName,country_name:c.Location?.country||race.raceName,location:c.Location?.locality||'',circuit_short_name:c.circuitName||'',circuit_id:c.circuitId,session_name:name,session_type:['Race','Sprint'].includes(name)?'Race':name.includes('Qualifying')?'Qualifying':'Practice',date_start:date.toISOString(),date_end:new Date(date.getTime()+minutes*60000).toISOString(),end_estimated:true});
    }
  }return sessions;
}
export async function freeCalendar(year){
  const data=await publicJson(`${JOLPICA}/${year}.json?limit=100`,300000);
  return {sessions:calendarSessions(data.MRData?.RaceTable?.Races||[]),liveConfigured:false,source:'Jolpica',serverTime:new Date().toISOString()};
}
export async function freeStats(year){
  const kinds=['driverstandings','constructorstandings','last/results','last/qualifying'];
  const issues=[];
  const result=await Promise.all(kinds.map(async kind=>{try{return await publicJson(`${JOLPICA}/${year}/${kind}.json?limit=100`,300000);}catch(e){issues.push({source:kind,error:e.message});return {};}}));
  return {year,source:'Jolpica published statistics',drivers:result[0].MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings||[],constructors:result[1].MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings||[],race:result[2].MRData?.RaceTable?.Races?.[0]||null,qualifying:result[3].MRData?.RaceTable?.Races?.[0]||null,round:result[0].MRData?.StandingsTable?.StandingsLists?.[0]?.round||null,issues,fetchedAt:new Date().toISOString()};
}
export async function freeGeometry(circuit,year){
  const data=await publicJson(`https://api.multiviewer.app/api/v1/circuits/${circuit}/${year}`,3600000);
  const x=data.x||data.circuit?.x,y=data.y||data.circuit?.y;
  if(!Array.isArray(x)||!Array.isArray(y)||x.length!==y.length||x.length<40)throw new ApiError('No matching circuit geometry is published for this season.',404);
  const points=x.map((v,i)=>({x:v,y:y[i]})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  return {points,rotation:Number(data.rotation)||0,circuitKey:circuit,source:'MultiViewer circuit geometry'};
}
