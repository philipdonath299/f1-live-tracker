import {timingEstimate} from './free-model.js';
import {FreeLiveClient} from './free-live.js';
import {groupSamples,sampleAt,lapTime,gapTime} from './pitwall-timing.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=v=>/^[a-f\d]{6}$/i.test(v)?`#${v}`:'#9ba5b7';
const clock=v=>v?new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'-';
const local=v=>new Date(v).toLocaleString([],{dateStyle:'medium',timeStyle:'short'});
const sector=v=>Number.isFinite(v)?v.toFixed(3):'-';
export function installFreeFeatures({state,map,api,notice,connection,setTab,renderDriver,renderFeeds,cancelRequests}){
  let view=null,trackKey=null,expected=null,lastPaint=0,health={},statsYear=null,geometryPoints=[],usingEstimates=false;
  const client=new FreeLiveClient({onView:next=>{
    if(state.mode!=='free')return;
    if(expected&&next.session.date_start&&(Math.abs(Date.parse(next.session.date_start)-Date.parse(expected.date_start))>7200000||next.session.session_name.replace(/\s/g,'').toLowerCase()!==expected.session_name.replace(/\s/g,'').toLowerCase())){
      notice('The free feed currently belongs to another session. Waiting for the selected session.',{retry:true});return;
    }
    const changed=state.session?.session_key!==next.session.session_key;
    view=next;state.session=next.session;state.drivers=next.drivers;state.rows=next.rows;
    if(changed){state.selected=next.rows[0]?.driver_number??null;state.telemetry=[];map.reset();trackKey=null;}
    if(!next.rows.some(r=>r.driver_number===state.selected))state.selected=next.rows[0]?.driver_number??null;
    map.drivers=next.drivers;map.selected=state.selected;
    $('driver-select').innerHTML=next.drivers.map(d=>`<option value="${d.driver_number}">${d.driver_number} - ${esc(d.full_name)}</option>`).join('');$('driver-select').value=state.selected;
    if(next.session.circuit_key&&trackKey!==`${next.session.circuit_key}:${next.session.year}`)loadGeometry(next.session);
    paint();
  },onState:next=>{health=next;paintHealth();}});
  function start(options={}){
    client.stop();cancelRequests();state.generation++;state.mode='free';state.loading=false;state.fatal=false;state.playing=false;state.session=null;state.data={};state.drivers=[];state.rows=[];state.telemetry=[];state.selected=null;state.lastFeed=0;
    view=null;expected=options.expected||null;trackKey=null;geometryPoints=[];map.reset();map.drivers=[];
    $('playback').hidden=true;$('access-note').hidden=true;$('follow').checked=false;map.follow=false;
    $('source-controls').hidden=false;$('source-name').textContent='Auto free';
    $('session-title').textContent='Free live timing';$('session-eyebrow').textContent='FORMULA 1 / NO SUBSCRIPTION';$('session-subtitle').textContent='Connecting to public timing sources. No API key required.';
    $('timing-label').textContent='Free live feed';$('timing-body').innerHTML='<tr><td colspan="5" class="empty">Connecting to free timing. Data appears during an active session.</td></tr>';
    $('driver-title').textContent='Driver focus';$('driver-select').innerHTML='<option value="">Waiting for driver list</option>';$('driver-details').innerHTML='<p class="empty">Select a driver when live timing arrives.</p>';
    $('control-feed').innerHTML='<p class="empty">Waiting for public race control.</p>';$('radio-feed').innerHTML='<p class="empty">Radio clips appear when the free source publishes them.</p>';$('radio-feed').dataset.signature='initial';$('control-count').textContent='0';$('radio-count').textContent='0';
    for(const id of ['session-clock','lap-count','fastest-lap','weather-temp'])$(id).textContent='-';$('weather-extra').textContent='Waiting for weather';$('data-age').textContent='waiting';$('track-source').textContent='Waiting for circuit identity';$('circuit-name').textContent='Current session circuit';
    $('map-empty').hidden=false;$('map-empty').innerHTML='<strong>Waiting for the live circuit</strong><span>GPS appears only if the free source publishes fresh positions.</span>';
    notice('');connection('CONNECTING FREE');
    const url=new URL(location.href);url.searchParams.delete('session');url.searchParams.set('live','free');history.replaceState(null,'',url);
    client.start($('live-source').value||'auto');
  }
  function stop(){client.stop();view=null;expected=null;$('source-controls').hidden=true;$('follow').disabled=false;$('source-name').textContent='OpenF1';}
  async function loadGeometry(session){
    const key=trackKey=`${session.circuit_key}:${session.year}`,generation=state.generation;
    try{const data=await api('geometry',{circuit:session.circuit_key,year:session.year});if(state.mode!=='free'||generation!==state.generation||trackKey!==key)return;geometryPoints=data.points;map.load(data);$('map-empty').hidden=true;$('track-source').textContent=data.source;}
    catch(error){if(generation!==state.generation||error.name==='AbortError')return;$('map-empty').innerHTML=`<strong>Circuit geometry unavailable</strong><span>${esc(error.message)}</span>`;}
  }
  function paint(){
    if(state.mode!=='free')return;
    const current=client.getView();if(current&&view?.session.session_key===current.session.session_key)view=current;
    if(!view){connection('WAITING FOR FREE FEED');$('free-feed-summary').textContent='No live timing received yet. Direct F1 timing and the free community fallback are being checked.';return;}
    state.cursor=Date.now();state.session=view.session;state.drivers=view.drivers;state.rows=view.rows;
    state.data={weather:view.weather?[view.weather]:[],race_control:view.control,team_radio:view.radio};
    const phase=view.phase,live=phase==='live';const freshPositions=view.locations.filter(p=>Math.abs(Date.now()-Date.parse(p.date))<12000);connection(live?'LIVE / FREE':phase==='complete'?'SESSION COMPLETE':phase==='stale'?'STALE / RECONNECTING':'WAITING FOR SESSION',live?'live':phase==='stale'?'error':'replay');
    $('session-title').textContent=`${view.session.country_name} - ${view.session.session_name}`;$('session-eyebrow').textContent=`FORMULA 1 / ${view.session.year} / ${live?'FREE LIVE TIMING':phase.toUpperCase()}`;
    $('session-subtitle').textContent=`${view.session.circuit_short_name} / ${view.session.location} / ${view.source}`;$('circuit-name').textContent=view.session.circuit_short_name;
    $('session-clock').textContent=clock(view.asOf);$('lap-count').textContent=view.lap!==null?`${view.lap}${view.totalLaps?' / '+view.totalLaps:''}`:'-';$('fastest-lap').textContent=lapTime(view.fastest);
    const age=view.asOf?Math.max(0,Math.floor((Date.now()-Date.parse(view.asOf))/1000)):null;
    $('source-name').textContent=view.source;$('data-age').textContent=age!==null?` / ${age}s old`:' / unknown age';$('timing-label').textContent=live?'Free live timing':phase==='complete'?'Last published session':'Waiting for fresh timing';
    $('free-feed-summary').textContent=phase==='complete'?'The last session has finished. Its last published timing is shown; the next session connects automatically.':phase==='stale'?'The source timestamp is old. These are the last received values, not current live timing.':`Free timing: ${view.rows.length} drivers. ${freshPositions.length?'Fresh GPS is available.':'Live GPS is not published. The optional map estimate uses mini-sector timing.'}`;
    const weather=view.weather;$('weather-temp').textContent=weather?`${weather.air_temperature??'-'} C / ${weather.track_temperature??'-'} C`:'- / -';$('weather-extra').textContent=weather?`${weather.rainfall===1?'Rain':weather.rainfall===0?'Dry':'Unknown'} / ${weather.wind_speed??'-'} m/s / ${weather.humidity??'-'}% RH`:'Weather not published';
    $('live-track-flag').textContent=view.trackStatus.Message|| (view.trackStatus.Status?`Track status ${view.trackStatus.Status}`:'No track status');
    $('timing-body').innerHTML=view.rows.map(r=>`<tr tabindex="0" data-driver="${r.driver_number}" class="${r.driver_number===state.selected?'selected':''}" aria-label="Select ${esc(r.full_name)}"><td>${r.position??'-'}</td><td><div class="driver-name"><i class="team-line" style="--team:${color(r.team_colour)}"></i><span class="driver-copy">${esc(r.name_acronym)} <span class="muted">${r.driver_number}</span><small>${esc(r.team_name)}</small></span></div></td><td>${r.retired?'RETIRED':r.knockedOut?'OUT':r.inPit?'IN PIT':r.position===1?'LEADER':esc(gapTime(r.gap))}<span class="sub">${esc(gapTime(r.interval))}</span></td><td class="${r.lastLap===view.fastest&&view.fastest?'purple':''}">${lapTime(r.lastLap)}<span class="sub ${r.bestLap===view.fastest&&view.fastest?'purple':''}">${lapTime(r.bestLap)}</span></td><td><span class="tyre ${esc(r.compound)}">${esc(r.compound?.[0]||'-')}</span><span class="sub">${r.tyreAge??'-'}L / ${r.pitCount??'-'}</span></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No driver timing has been published yet.</td></tr>';
    state.telemetry=view.telemetry.filter(r=>r.driver_number===state.selected&&Math.abs(Date.now()-Date.parse(r.date))<12000);
    const row=view.rows.find(r=>r.driver_number===state.selected);renderDriver(row,view.fastest);
    if(row){
      const extras=document.createElement('div');extras.className='free-driver-extras';
      extras.innerHTML=`<div class="mini-sector-grid">${row.segments.map((segments,i)=>`<div><span class="stat-label">SECTOR ${i+1} / ${sector(row.sectors[i])}</span><div class="mini-sectors">${segments.map(code=>`<i class="mini-s${[2049,2051,2064].includes(code)?code:0}"></i>`).join('')||'<span class="muted">No mini-sector data</span>'}</div></div>`).join('')}</div><div class="driver-meta">${Object.entries(row.speedTraps).map(([key,value])=>`<span>${key}: ${value??'-'} km/h</span>`).join('')}</div>${!state.telemetry.length?'<p class="telemetry-note">Live speed, RPM, pedals and GPS are not available from this free feed. Published speed-trap readings and sector timing are shown above.</p>':''}`;
      $('driver-details').append(extras);
    }
    renderFeeds(Date.now()+1000);
    const estimates=!freshPositions.length&&live&&$('timing-map').checked?view.rows.map(r=>timingEstimate(r,geometryPoints,view.asOf)).filter(Boolean):[];
    usingEstimates=estimates.length>0;map.samples=groupSamples(usingEstimates?estimates:freshPositions);map.drivers=view.drivers;map.selected=state.selected;
    $('follow').disabled=!freshPositions.length&&!usingEstimates;
    $('map-estimate-note').hidden=!usingEstimates;
    $('track-canvas').setAttribute('aria-label',usingEstimates?'Approximate progress from timing mini-sectors, not GPS':'Circuit map with recorded GPS positions');
  }
  function select(number){state.selected=Number(number);map.selected=state.selected;$('driver-select').value=state.selected;paint();}
  function frame(now){
    if(state.mode==='schedule'){if(Date.now()>=Date.parse(state.session.date_start)&&Date.now()<=Date.parse(state.session.date_end))start({expected:state.session});return;}
    const count=map.draw(Date.now()-(usingEstimates?0:1500));$('map-status').textContent=usingEstimates?'TIMING ESTIMATE / NOT GPS':count?`${count} CARS / FREE GPS`:'GPS NOT PUBLISHED';
    if(now-lastPaint>1000){lastPaint=now;paint();}
  }
  function schedule(session){
    if(Date.now()>=Date.parse(session.date_start)&&Date.now()<=Date.parse(session.date_end)){start({expected:session});return;}
    stop();cancelRequests();state.generation++;state.session=session;state.mode='schedule';state.loading=false;state.fatal=false;state.data={};state.drivers=[];state.rows=[];map.reset();
    $('playback').hidden=true;$('session-title').textContent=`${session.country_name} - ${session.session_name}`;$('session-eyebrow').textContent='JOLPICA / PUBLISHED SCHEDULE';$('session-subtitle').textContent=`${session.circuit_short_name} / ${local(session.date_start)}`;connection(Date.now()<Date.parse(session.date_start)?'UPCOMING':'PUBLISHED SESSION');
    $('timing-body').innerHTML='<tr><td colspan="5" class="empty">This calendar entry provides the scheduled session time. Use Free live for current timing, or Championship for published results.</td></tr>';$('driver-details').innerHTML='<p class="empty">Select Free live for driver timing.</p>';$('circuit-name').textContent=session.circuit_short_name;$('map-empty').hidden=false;$('map-empty').innerHTML='<strong>Scheduled session</strong><span>Live positions appear only when a live source publishes them.</span>';
    for(const id of ['session-clock','lap-count','fastest-lap','weather-temp'])$(id).textContent='-';$('control-feed').innerHTML='<p class="empty">Select Free live for race control.</p>';$('radio-feed').innerHTML='<p class="empty">No radio for this scheduled session.</p>';$('control-count').textContent='0';$('radio-count').textContent='0';$('source-name').textContent='Jolpica';$('data-age').textContent=' / schedule';
    notice('Free schedule data is available. Full replay is available for sessions published by OpenF1.');
  }
  async function stats(){
    const year=Number($('year').value);if(statsYear===year)return;statsYear=year;$('championship-content').innerHTML='<p class="empty">Loading free championship statistics...</p>';
    try{
      const data=await api('free-stats',{year});if(statsYear!==year)return;
      const table=(title,headers,rows)=>`<section class="panel"><div class="panel-heading"><h2>${esc(title)}</h2></div><div class="table-scroll"><table class="stats-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}" class="empty">No published data yet.</td></tr>`}</tbody></table></div></section>`;
      $('championship-content').innerHTML=`<p class="stats-caption">${year} / Jolpica / published results${data.round?' / after round '+esc(data.round):''}. These standings are not live championship predictions.</p><div class="stats-grid">${table('Driver standings',['POS','DRIVER','TEAM','PTS','WINS'],data.drivers.map(d=>[d.position,`${d.Driver?.givenName||''} ${d.Driver?.familyName||''}`,d.Constructors?.map(c=>c.name).join(', '),d.points,d.wins]))}${table('Constructor standings',['POS','TEAM','PTS','WINS'],data.constructors.map(c=>[c.position,c.Constructor?.name,c.points,c.wins]))}</div>${table(data.race?`Latest race: ${data.race.raceName}`:'Latest race results',['POS','DRIVER','LAPS','TIME / STATUS','FASTEST LAP','PTS'],(data.race?.Results||[]).map(r=>[r.position,`${r.Driver?.givenName||''} ${r.Driver?.familyName||''}`,r.laps,r.Time?.time||r.status,r.FastestLap?.Time?.time||'-',r.points]))}${table(data.qualifying?`Latest qualifying: ${data.qualifying.raceName}`:'Latest qualifying',['POS','DRIVER','Q1','Q2','Q3'],(data.qualifying?.QualifyingResults||[]).map(r=>[r.position,`${r.Driver?.givenName||''} ${r.Driver?.familyName||''}`,r.Q1||'-',r.Q2||'-',r.Q3||'-']))}${data.issues.length?'<p class="stats-caption">Some statistics are temporarily unavailable. Reopen this tab to retry.</p>':''}`;
      if(data.issues.length)statsYear=null;
    }catch(error){statsYear=null;$('championship-content').innerHTML=`<p class="empty">${esc(error.message)} Reopen this tab to retry.</p>`;}
  }
  async function sources(){
    try{const result=await api('sources');$('sources-list').innerHTML=result.sources.map(source=>`<article class="source-entry"><div><h3><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.name)} &#8599;</a></h3><span class="mode-tag">${esc(source.cost)}</span></div><p>${esc(source.provides)}</p><small>${esc(source.limits)}</small><strong class="source-health" data-source-health="${source.id}"></strong></article>`).join('');paintHealth();}catch(error){$('sources-list').innerHTML=`<p class="empty">${esc(error.message)}</p>`;}
  }
  function paintHealth(){for(const element of document.querySelectorAll('[data-source-health]'))element.textContent=health[element.dataset.sourceHealth]||'';}
  $('live-source').addEventListener('change',()=>start());$('timing-map').addEventListener('change',paint);
  for(const button of document.querySelectorAll('.tab')){if(button.dataset.tab==='championship')button.addEventListener('click',stats);if(button.dataset.tab==='sources')button.addEventListener('click',sources);}
  $('year').addEventListener('change',()=>{statsYear=null;});
  window.addEventListener('pagehide',()=>client.stop());
  return {start,stop,select,frame,schedule,paint,client};
}
