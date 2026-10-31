// Public F1 timing adapters. No account tokens, simulated timing or inferred GPS.
export const FREE_TOPICS=['Heartbeat','SessionInfo','SessionStatus','SessionData','DriverList','TimingData','TimingAppData','TimingStats','WeatherData','TrackStatus','RaceControlMessages','LapCount','ExtrapolatedClock'];
const aliases={SessionInfo:'session',SessionData:'session_data',DriverList:'drivers',TimingData:'timing',TimingAppData:'timing_app',TimingStats:'timing_stats',WeatherData:'weather',TrackStatus:'track_status',RaceControlMessages:'race_control',TeamRadio:'team_radio',LapCount:'lap_count',ExtrapolatedClock:'clock',Heartbeat:'heartbeat',CarData:'car_data',Position:'position'};
export const values=value=>Array.isArray(value)?value:Object.entries(value||{}).filter(([k])=>!k.startsWith('_')).sort(([a],[b])=>Number(a)-Number(b)).map(([,v])=>v);
export function mergePatch(base,patch){
  if(patch===null||typeof patch!=='object')return patch;
  if(patch._kf===true)base=Array.isArray(patch)?[]:{};
  const out=Array.isArray(base)?[...base]:{...(base&&typeof base==='object'?base:{})};
  for(const [key,value]of Object.entries(patch))if(!['_kf','__proto__','constructor','prototype'].includes(key))out[key]=value&&typeof value==='object'?mergePatch(out[key],value):value;
  return out;
}
export function seconds(value){
  if(value&&typeof value==='object')value=value.Value;
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  if(typeof value!=='string'||!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(value.trim()))return null;
  return value.trim().split(':').reduce((n,v)=>n*60+Number(v),0);
}
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const gap=value=>{if(value&&typeof value==='object')value=value.Value;if(value==null||value==='')return null;const parsed=Number(String(value).replace(/^\+/,''));return Number.isFinite(parsed)?parsed:String(value);};
export function f1Date(value,offset){
  if(!value)return null;let text=String(value);
  if(!/(Z|[+-]\d\d:\d\d)$/i.test(text))text+=typeof offset==='string'&&/^[+-]\d\d:\d\d/.test(offset)?offset.slice(0,6):'Z';
  const t=Date.parse(text);return Number.isFinite(t)?new Date(t).toISOString():null;
}
export function canonicalSnapshot(raw={}){
  const topics={};for(const [name,alias]of Object.entries(aliases)){const value=raw[name]??raw[alias];if(value&&typeof value==='object')topics[name]=value;}
  if(raw.SessionStatus)topics.SessionStatus=raw.SessionStatus;
  return topics;
}
export function sessionFromTopics(topics){
  const s=topics.SessionInfo||{},m=s.Meeting||{},offset=s.GmtOffset;
  return {session_key:number(s.Key),meeting_key:number(m.Key),country_name:m.Country?.Name||m.Name||'Formula 1',location:m.Location||m.Circuit?.ShortName||'',circuit_short_name:m.Circuit?.ShortName||m.Location||'Circuit',circuit_key:number(m.Circuit?.Key),session_name:s.Name||s.Type||'Live session',session_type:s.Type||s.Name||'',date_start:f1Date(s.StartDate,offset),date_end:f1Date(s.EndDate,offset),year:Number(String(s.StartDate||'').slice(0,4))||new Date().getUTCFullYear(),path:s.Path||'',status:topics.SessionStatus?.Status||s.SessionStatus||null};
}
export function feedPhase(topics,asOf,now=Date.now()){
  const session=sessionFromTopics(topics),date=Date.parse(asOf),age=now-date;
  if(!session.session_key||!Object.keys(topics.TimingData?.Lines||{}).length)return 'waiting';
  if(['Finalised','Ends','Finished'].includes(session.status))return 'complete';
  if(!Number.isFinite(date)||age>45000||age < -15000)return 'stale';
  if(session.date_start&&now<Date.parse(session.date_start)-300000)return 'upcoming';
  if(session.date_end&&now>Date.parse(session.date_end)+1800000)return 'complete';
  return ['Started','Aborted'].includes(session.status)?'live':'waiting';
}
export function locationSamples(topics){
  const list=[];for(const frame of values(topics.Position?.Position||topics.Position?.Entries)){
    const date=f1Date(frame.Timestamp||frame.Utc);if(!date)continue;
    for(const [id,p]of Object.entries(frame.Entries||{})){const x=number(p.X??p.x),y=number(p.Y??p.y);if(/^\d+$/.test(id)&&x!==null&&y!==null&&(x!==0||y!==0))list.push({driver_number:Number(id),x,y,date});}
  }return list;
}
export function telemetrySamples(topics){
  const list=[];for(const frame of values(topics.CarData?.Entries)){
    const date=f1Date(frame.Utc||frame.Timestamp);if(!date)continue;
    for(const [id,p]of Object.entries(frame.Cars||{})){
      if(!/^\d+$/.test(id))continue;const c=p.Channels||{};
      list.push({driver_number:Number(id),date,rpm:number(c[0]),speed:number(c[2]),n_gear:number(c[3]),throttle:number(c[4]),brake:number(c[5])===1?100:number(c[5]),drs:number(c[45])});
    }
  }return list;
}
export class LiveTimingStore{
  constructor(){this.topics={};this.history=new Map();this.recordable=new Set();this.asOf=null;this.connected=null;}
  reset(){this.topics={};this.history.clear();this.recordable.clear();this.asOf=null;this.connected=null;}
  update(topic,patch,timestamp){
    if(!patch||typeof patch!=='object')return;
    if(topic==='SessionInfo'&&patch.Key&&this.topics.SessionInfo?.Key&&String(patch.Key)!==String(this.topics.SessionInfo.Key)){
      const previous=this.topics.SessionInfo;const sameMeeting=!patch.Meeting?.Key||String(patch.Meeting.Key)===String(previous.Meeting?.Key);
      const drivers=sameMeeting?this.topics.DriverList:undefined;this.reset();if(drivers)this.topics.DriverList=drivers;if(sameMeeting)this.topics.SessionInfo={Meeting:previous.Meeting,GmtOffset:previous.GmtOffset};
    }
    this.topics[topic]=mergePatch(this.topics[topic],patch);
    if(topic==='TimingData')for(const [id,line]of Object.entries(patch.Lines||{}))if(line.NumberOfLaps!=null&&line.LastLapTime?.Value)this.recordable.add(id);
    const time=f1Date(timestamp||this.topics.Heartbeat?.Utc);if(time)this.asOf=time;
  }
  snapshot(raw,asOf){
    const topics=canonicalSnapshot(raw),key=topics.SessionInfo?.Key;
    if(key&&this.topics.SessionInfo?.Key&&String(key)!==String(this.topics.SessionInfo.Key))this.reset();
    // A REST snapshot is a complete replacement, not a patch from a different provider.
    this.topics=topics;this.connected=typeof raw.connected==='boolean'?raw.connected:null;this.asOf=f1Date(asOf||raw.last_update||topics.Heartbeat?.Utc);
    for(const [id,line]of Object.entries(topics.TimingData?.Lines||{}))if(line.NumberOfLaps!=null&&line.LastLapTime?.Value)this.recordable.add(id);
  }
  view(now=Date.now()){
    const t=this.topics,session=sessionFromTopics(t),drivers=t.DriverList||{},lines=t.TimingData?.Lines||{},app=t.TimingAppData?.Lines||{},stats=t.TimingStats?.Lines||{};
    const rows=Object.entries(drivers).filter(([id])=>/^\d+$/.test(id)).map(([id,d])=>{
      const td=lines[id]||{},st=stats[id]||{},stint=values(app[id]?.Stints).at(-1),count=number(td.NumberOfLaps),last=seconds(td.LastLapTime),best=seconds(td.BestLapTime)??seconds(st.PersonalFastestLap);
      const sectors=[0,1,2].map(i=>seconds(td.Sectors?.[i]));
      if(count!==null&&count>0&&last>0&&this.recordable.has(id)){
        this.recordable.delete(id);
        const key=`${session.session_key}:${id}:${count}`;
        const sectorSum=sectors.every(v=>v!==null)?sectors.reduce((a,b)=>a+b,0):null;
        this.history.set(key,{driver_number:Number(id),lap_number:count,lap_duration:last,...Object.fromEntries(sectors.map((v,i)=>[`duration_sector_${i+1}`,sectorSum!==null&&Math.abs(sectorSum-last)<.2?v:null]))});
      }
      const qualifyingStats=values(td.Stats).at(-1)||{};
      return {driver_number:Number(id),full_name:d.FullName||[d.FirstName,d.LastName].filter(Boolean).join(' ')||`Driver ${id}`,name_acronym:d.Tla||d.BroadcastName||id,team_name:d.TeamName||'',team_colour:d.TeamColour||'',position:number(td.Position??td.Line),lastLap:last>0?last:null,bestLap:best>0?best:null,sectors,currentLap:count,compound:stint?.Compound,tyreAge:number(stint?.TotalLaps),pitCount:number(td.NumberOfPitStops),inPit:td.InPit===true,retired:td.Retired===true,knockedOut:td.KnockedOut===true,stopped:td.Stopped===true,gap:gap(td.GapToLeader??qualifyingStats.TimeDiffToFastest),interval:gap(td.IntervalToPositionAhead??qualifyingStats.TimeDifftoPositionAhead),segments:[0,1,2].map(i=>values(td.Sectors?.[i]?.Segments).map(s=>number(s.Status)||0)),speedTraps:Object.fromEntries(['I1','I2','FL','ST'].map(k=>[k,number(td.Speeds?.[k]?.Value)])),completed:[...this.history.values()].filter(l=>l.driver_number===Number(id)).sort((a,b)=>a.lap_number-b.lap_number)};
    }).sort((a,b)=>(a.position??999)-(b.position??999));
    const fastest=Math.min(...rows.map(r=>r.bestLap??Infinity)),w=t.WeatherData||{};
    const date=this.asOf;
    const weather=Object.keys(w).length?{date,air_temperature:number(w.AirTemp),track_temperature:number(w.TrackTemp),humidity:number(w.Humidity),wind_speed:number(w.WindSpeed),rainfall:number(w.Rainfall)}:null;
    const control=values(t.RaceControlMessages?.Messages).map(m=>({date:f1Date(m.Utc),flag:m.Flag,category:m.Category,message:m.Message,sector:m.Sector})).filter(m=>m.date);
    const radio=values(t.TeamRadio?.Captures).map(c=>{
      const path=String(c.Path||'');let url=null;
      if(/^https:\/\//.test(path))url=path;
      else if(session.path&&/^[\w./-]+$/.test(path)&&!path.split('/').includes('..')&&!String(session.path).split('/').includes('..'))url=`https://livetiming.formula1.com/static/${session.path.replace(/^\/+|\/+$/g,'')}/${path.replace(/^\/+/, '')}`;
      return {date:f1Date(c.Utc),driver_number:Number(c.RacingNumber),recording_url:url};
    }).filter(c=>c.date&&c.recording_url);
    return {session,rows,drivers:rows,fastest:Number.isFinite(fastest)?fastest:null,lap:number(t.LapCount?.CurrentLap),totalLaps:number(t.LapCount?.TotalLaps),weather,control,radio,locations:locationSamples(t),telemetry:telemetrySamples(t),trackStatus:t.TrackStatus||{},asOf:date,phase:this.connected===false&&feedPhase(t,date,now)==='live'?'stale':feedPhase(t,date,now)};
  }
}
// A spatial estimate from published mini-sector completion. Never described as GPS.
export function timingEstimate(row,points,date){
  if(row.inPit||row.retired||row.stopped||!points?.length||!date)return null;
  if(!row.segments?.every(sector=>Array.isArray(sector)&&sector.length))return null;
  const all=row.segments.flat();
  if(all.some(code=>![0,2048,2049,2051,2064].includes(code)))return null;
  const complete=all.filter(code=>[2048,2049,2051,2064].includes(code)).length;
  const fraction=complete/all.length;
  const segments=points.map((p,i)=>({a:p,b:points[(i+1)%points.length],length:Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].y-p.y)}));
  const distance=segments.reduce((n,s)=>n+s.length,0)*fraction;
  let travelled=0;
  for(const segment of segments){
    if(travelled+segment.length>=distance){const f=segment.length?(distance-travelled)/segment.length:0;return {driver_number:row.driver_number,x:segment.a.x+(segment.b.x-segment.a.x)*f,y:segment.a.y+(segment.b.y-segment.a.y)*f,date,estimated:true};}
    travelled+=segment.length;
  }return null;
}
