import {lapTime,gapTime,modeFor,mergeData,deriveTiming,groupSamples,sampleAt,ms} from './pitwall-timing.js';
import {TrackMap} from './pitwall-track.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=v=>/^[a-f\d]{6}$/i.test(v)?`#${v}`:'#9ba5b7';
const localDate=v=>new Date(v).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const clock=v=>new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const elapsed=v=>{const s=Math.max(0,Math.floor(v/1000));return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
const state={generation:0,sessions:[],session:null,drivers:[],data:{},selected:null,mode:null,cursor:0,playing:false,speed:1,loading:false,fatal:false,buffer:null,telemetry:[],locations:{},streamBusy:false,timingBusy:false,nextTiming:0,nextStream:0,lastTiming:0,lastStream:0,lastFeed:0,lastRender:0};
const map=new TrackMap($('track-canvas'),selectDriver);
let controller=new AbortController(),catalogController,catalogGeneration=0,lastFrame=performance.now();
function connection(text,kind=''){$('connection').className=`connection ${kind}`;$('connection').innerHTML=`<i></i>${esc(text)}`;}
function notice(message,{retry=false,archive=false}={}){$('notice-text').textContent=message;$('notice').hidden=!message;$('retry').hidden=!retry;$('archive').hidden=!archive;}
async function api(action,params={},signal=controller.signal){
  const response=await fetch(`/api/f1?${new URLSearchParams({action,...params})}`,{signal});
  let body;try{body=await response.json();}catch{throw new Error('The data server is unavailable. Run npm run dev locally or deploy the complete project to Vercel.');}
  if(!response.ok){const e=new Error(body.error||'Data request failed.');e.status=response.status;e.retryAfter=body.retryAfter;throw e;}return body;
}
function setTab(name){document.querySelectorAll('.tab').forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}-view`));map.resize();}
async function loadCatalog(year,autoSelect=true,preferLatest=false){
  catalogController?.abort();catalogController=new AbortController();const ticket=++catalogGeneration;
  $('session-select').disabled=true;
  try{
    const data=await api('catalog',{year},catalogController.signal);if(ticket!==catalogGeneration)return;
    state.sessions=data.sessions.filter(s=>!s.is_cancelled).sort((a,b)=>ms(b.date_start)-ms(a.date_start));state.configured=data.liveConfigured;
    $('access-note').hidden=data.liveConfigured;renderSessionPicker();renderCalendar();
    if(autoSelect){
      const key=preferLatest?0:Number(new URLSearchParams(location.search).get('session'));
      const chosen=state.sessions.find(s=>s.session_key===key)||state.sessions.find(s=>modeFor(s)==='live')||state.sessions.find(s=>modeFor(s)==='replay')||state.sessions.at(-1);
      if(chosen){if(chosen.session_key!==state.session?.session_key||state.fatal)await loadSession(chosen.session_key);}else notice('No sessions have been published for this season. Choose another season.',{archive:true});
    }
  }catch(e){if(ticket!==catalogGeneration||e.name==='AbortError')return;notice(e.message,{retry:true,archive:true});connection('OFFLINE','error');$('session-select').innerHTML='<option value="">Sessions unavailable · retry</option>';$('session-calendar').innerHTML='<p class="empty">Calendar unavailable. Refresh to reconnect, or choose another season.</p>';}
  finally{if(ticket===catalogGeneration)$('session-select').disabled=false;}
}
function renderSessionPicker(){
  $('session-select').innerHTML=state.sessions.map(s=>`<option value="${s.session_key}">${esc(s.country_name)} · ${esc(s.session_name)} · ${localDate(s.date_start)}</option>`).join('')||'<option value="">No sessions available</option>';
  if(state.session&&state.sessions.some(s=>s.session_key===state.session.session_key))$('session-select').value=state.session.session_key;
}
async function loadSession(key){
  controller.abort();controller=new AbortController();const generation=++state.generation;
  Object.assign(state,{session:null,drivers:[],data:{},selected:null,mode:null,playing:false,loading:true,fatal:false,buffer:null,telemetry:[],locations:{},streamBusy:false,timingBusy:false,nextTiming:0,nextStream:0,lastTiming:0,lastStream:0,lastFeed:0});
  map.reset();map.drivers=[];map.follow=false;$('follow').checked=false;
  document.querySelectorAll('audio').forEach(a=>a.pause());
  $('playback').hidden=true;$('driver-select').innerHTML='<option value="">Loading drivers…</option>';
  $('timing-body').innerHTML='<tr><td colspan="5" class="empty">Loading recorded timing…</td></tr>';
  $('driver-title').textContent='Loading driver focus';$('driver-details').innerHTML='<p class="empty">Fetching session data…</p>';
  $('control-feed').innerHTML='<p class="empty">Waiting for race control…</p>';$('radio-feed').innerHTML='<p class="empty">Waiting for radio clips…</p>';$('radio-feed').dataset.signature='initial';
  $('control-count').textContent='0';$('radio-count').textContent='0';$('map-empty').hidden=false;
  $('map-empty').innerHTML='<span class="map-empty-icon">⌁</span><strong>Loading the session circuit</strong><span>Matching geometry to this exact race weekend.</span>';
  $('track-source').textContent='Loading circuit geometry';$('map-status').textContent='AWAITING GPS';$('session-title').textContent='Connecting to the pit wall';$('session-subtitle').textContent='Fetching session and driver information…';
  for(const id of ['session-clock','lap-count','fastest-lap','weather-temp'])$(id).textContent='—';
  notice('');connection('CONNECTING');
  try{
    const data=await api('session',{session:key});if(generation!==state.generation)return;
    state.session=data.session;state.drivers=data.drivers.filter(d=>d.driver_number!=null);state.mode=modeFor(state.session);state.configured=data.liveConfigured;
    state.start=ms(state.session.date_start);state.end=ms(state.session.date_end);state.cursor=state.mode==='live'?Date.now()-6000:state.start;
    $('access-note').hidden=data.liveConfigured||state.mode!=='live';$('session-title').textContent=`${state.session.country_name} · ${state.session.session_name}`;
    $('session-eyebrow').textContent=`FORMULA 1 · ${state.session.year} · ${state.mode.toUpperCase()}`;
    $('session-subtitle').textContent=`${state.session.circuit_short_name} / ${state.session.location} · ${localDate(state.session.date_start)} · your local time`;
    $('circuit-name').textContent=state.session.circuit_short_name;$('timing-label').textContent=state.mode==='live'?'Live timing · 10s refresh':'Session replay';
    $('driver-select').innerHTML=state.drivers.map(d=>`<option value="${d.driver_number}">${d.driver_number} · ${esc(d.full_name)}</option>`).join('');
    state.selected=state.drivers[0]?.driver_number??null;$('driver-select').value=state.selected;map.drivers=state.drivers;map.selected=state.selected;
    const url=new URL(location.href);url.searchParams.set('session',key);url.searchParams.set('year',state.session.year);history.replaceState(null,'',url);
    if(state.sessions.some(s=>s.session_key===Number(key)))$('session-select').value=key;renderCalendar();
    if(['upcoming','cancelled'].includes(state.mode)){connection(state.mode.toUpperCase());notice(state.mode==='cancelled'?'This session was cancelled.':`This session starts ${localDate(state.session.date_start)}. Timing connects automatically when it begins.`);render();return;}
    if(state.mode==='live'&&!state.configured){state.fatal=true;connection('LIVE ACCESS REQUIRED','error');notice('This session is live. Add your OpenF1 subscription credentials in Vercel, or choose a completed session for free replay.',{retry:true});render();return;}
    $('playback').hidden=state.mode!=='replay';$('replay-duration').textContent=elapsed(state.end-state.start);
    loadTrack(generation);await loadTiming(generation,true);if(generation!==state.generation)return;
    if(state.mode==='replay'){
      const starts=(state.data.laps||[]).map(l=>ms(l.date_start)).filter(t=>t>=state.start&&t<state.end);
      state.cursor=Math.min(state.end,(starts.length?Math.min(...starts):state.start)+12000);
    }
    await loadStream(generation,true);if(generation!==state.generation)return;
    state.playing=state.mode==='replay'&&Boolean(state.buffer);updatePlay();render();
  }catch(e){if(generation!==state.generation||e.name==='AbortError')return;state.fatal=true;connection('CONNECTION FAILED','error');notice(e.message,{retry:true,archive:true});$('timing-body').innerHTML='<tr><td colspan="5" class="empty">Timing unavailable. Retry the connection.</td></tr>';$('driver-title').textContent='Driver focus';$('driver-details').innerHTML='<p class="empty">Reconnect to load driver data.</p>';}
  finally{if(generation===state.generation)state.loading=false;}
}
async function loadTrack(generation){try{const data=await api('track',{session:state.session.session_key});if(generation!==state.generation)return;map.load(data);$('map-empty').hidden=false;$('map-empty').hidden=map.points.length>0;$('track-source').textContent=data.source;}catch(e){if(generation!==state.generation||e.name==='AbortError')return;$('map-empty').innerHTML=`<span class="map-empty-icon">⌁</span><strong>Circuit map unavailable</strong><span>${esc(e.message)}</span>`;$('track-source').textContent='Waiting for circuit geometry';}}
function showIssues(issues){if(issues?.length)notice(`Some feeds are delayed: ${issues.map(i=>i.stream.replaceAll('_',' ')).join(', ')}. ${issues[0].message}`,{retry:true});}
async function loadTiming(generation,initial=false){
  if(state.timingBusy)return;state.timingBusy=true;
  try{
    const params={session:state.session.session_key};if(!initial&&state.mode==='live'&&state.lastTiming)params.since=new Date(state.lastTiming).toISOString();
    const data=await api('timing',params);if(generation!==state.generation)return;
    state.data=mergeData(state.data,data);state.lastTiming=Date.now();state.nextTiming=Date.now()+10000;
    if(data.issues?.length)showIssues(data.issues);else notice('');
  }catch(e){if(generation!==state.generation||e.name==='AbortError')return;state.nextTiming=Date.now()+Math.max(10000,(e.retryAfter||10)*1000);notice(e.message,{retry:true});if(initial)throw e;}
  finally{if(generation===state.generation)state.timingBusy=false;}
}
async function loadStream(generation,force=false){
  if(state.streamBusy||(!force&&Date.now()<state.nextStream))return;
  const replay=state.mode==='replay',cursor=state.cursor,selected=state.selected;
  if(!force&&replay&&state.buffer?.driver===selected&&state.buffer.from<=cursor&&state.buffer.to>=Math.min(state.end+1000,cursor+7000))return;
  const bucket=Math.floor((cursor+6000)/30000)*30000;
  const from=replay?Math.max(state.start-5000,bucket-8000):Math.floor((Date.now()-18000)/4000)*4000;
  const to=replay?Math.min(state.end+5000,bucket+33000):Math.floor(Date.now()/4000)*4000;
  state.streamBusy=true;
  try{
    const params={session:state.session.session_key,from:new Date(from).toISOString(),to:new Date(to).toISOString()};if(selected)params.driver=selected;
    const data=await api('stream',params);if(generation!==state.generation||selected!==state.selected)return;
    if(replay&&(state.cursor<from||state.cursor>to))return;
    const oldRows=Object.values(state.locations).flat().filter(r=>r.t>=state.cursor-12000&&r.t<from);
    state.locations=groupSamples([...oldRows,...data.locations]);map.samples=state.locations;
    state.telemetry=[...state.telemetry.filter(r=>ms(r.date)>=state.cursor-12000&&ms(r.date)<from),...data.telemetry].sort((a,b)=>ms(a.date)-ms(b.date));
    state.buffer={from:Math.min(from,state.buffer?.from??from),to,driver:selected};state.lastStream=Date.now();
    state.lastFeed=Math.max(0,...data.locations.map(r=>ms(r.date)),...data.telemetry.map(r=>ms(r.date)));
    state.nextStream=Date.now()+(replay?1000:4000);showIssues(data.issues);
  }catch(e){if(generation!==state.generation||e.name==='AbortError')return;state.nextStream=Date.now()+Math.max(10000,(e.retryAfter||10)*1000);notice(e.message,{retry:true});}
  finally{if(generation===state.generation)state.streamBusy=false;}
}
function selectDriver(number){state.selected=Number(number);$('driver-select').value=number;map.selected=Number(number);state.telemetry=[];state.nextStream=0;if(state.session&&!state.fatal&&!state.loading&&!['upcoming','cancelled'].includes(state.mode))loadStream(state.generation,true);render();}
function updatePlay(){$('play').textContent=state.playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',state.playing?'Pause replay':'Play replay');}
function render(){
  if(!state.session)return;const s=state.session,t=state.cursor,isRace=s.session_type==='Race'||['Race','Sprint'].includes(s.session_name),final=state.mode==='replay'&&t>=state.end;
  const {rows,fastest,lap}=deriveTiming(state.data,state.drivers,t,isRace,final);state.rows=rows;
  const weather=(state.data.weather||[]).filter(w=>ms(w.date)<=t).at(-1);
  $('session-clock').textContent=state.mode==='upcoming'?'NOT STARTED':clock(t);$('lap-count').textContent=lap||'—';$('fastest-lap').textContent=lapTime(fastest);
  $('weather-temp').textContent=weather?`${weather.air_temperature??'—'}° / ${weather.track_temperature??'—'}°`:'— / —';
  $('weather-extra').textContent=weather?`${weather.rainfall===1?'Rain':weather.rainfall===0?'Dry':'—'} · ${weather.wind_speed??'—'} m/s · ${weather.humidity??'—'}% RH`:'Awaiting weather';
  $('data-age').textContent=state.mode==='replay'?'· recorded':state.lastFeed?`· ${Math.max(0,Math.floor((Date.now()-state.lastFeed)/1000))}s old`:'· waiting';
  $('replay-elapsed').textContent=elapsed(t-state.start);if(!state.scrubbing)$('seek').value=Math.round((t-state.start)/(state.end-state.start||1)*1000);
  if(!state.fatal&&!state.loading&&!['upcoming','cancelled'].includes(state.mode)){
    const stale=state.mode==='live'&&(!state.lastFeed||Date.now()-state.lastFeed>30000||Date.now()-state.lastTiming>35000);
    connection(stale?'WAITING FOR LIVE DATA':state.mode==='replay'?(state.playing?'REPLAY':final?'SESSION COMPLETE':'REPLAY PAUSED'):'LIVE · REST FEED',stale?'error':state.mode);
  }
  $('timing-body').innerHTML=rows.map((r,i)=>{
    const status=r.result?.dsq?'DSQ':r.result?.dns?'DNS':r.result?.dnf?'DNF':r.inPit?'IN PIT':null;
    const gap=r.position===1&&isRace?'LEADER':gapTime(r.gap);
    return `<tr tabindex="0" data-driver="${r.driver_number}" class="${r.driver_number===state.selected?'selected':''}" aria-label="Select ${esc(r.full_name)}"><td>${!isRace&&r.bestLap?i+1:r.position??'—'}</td><td><div class="driver-name"><i class="team-line" style="--team:${color(r.team_colour)}"></i><span class="driver-copy">${esc(r.name_acronym||r.full_name)} <span class="muted">${r.driver_number}</span><small>${esc(r.team_name)}</small></span></div></td><td>${esc(status||gap)}<span class="sub">${gapTime(r.interval)}</span></td><td class="${r.lastLap===fastest&&fastest?'purple':r.lastLap&&r.lastLap===r.bestLap?'green':''}">${lapTime(r.lastLap)}<span class="sub ${r.bestLap===fastest&&fastest?'purple':''}">${lapTime(r.bestLap)}</span></td><td><span class="tyre ${esc(r.compound)}" title="${esc(r.compound||'Unknown compound')}">${esc(r.compound?.[0]||'—')}</span><span class="sub">${r.tyreAge??'—'}L / ${r.pitCount}</span></td></tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">No drivers have been published yet.</td></tr>';
  renderDriver(rows.find(r=>r.driver_number===state.selected),fastest);renderFeeds(t);
}
function renderDriver(row,fastest){
  if(!row)return;$('driver-title').textContent=row.full_name;$('driver-details').closest('.driver-panel').style.setProperty('--team',color(row.team_colour));
  const tel=sampleAt(state.telemetry,state.cursor,10000),value=k=>Number.isFinite(tel?.[k])?tel[k]:'—',drs=tel?([10,12,14].includes(tel.drs)?'OPEN':'CLOSED'):'—';
  const throttle=Math.min(100,Math.max(0,tel?.throttle||0)),brake=Math.min(100,Math.max(0,tel?.brake||0));
  $('driver-details').innerHTML=`<div class="telemetry-grid"><div><span class="stat-label">SPEED</span><strong>${value('speed')}</strong><small>km/h</small></div><div><span class="stat-label">GEAR</span><strong>${value('n_gear')}</strong></div><div><span class="stat-label">RPM</span><strong>${value('rpm')}</strong></div><div><span class="stat-label">DRS</span><strong style="font-size:15px" class="${drs==='OPEN'?'green':''}">${drs}</strong></div></div><div class="pedals"><div class="pedal"><span>THROTTLE</span><div class="meter"><i style="--value:${throttle}%"></i></div><span>${tel?throttle+'%':'—'}</span></div><div class="pedal brake"><span>BRAKE</span><div class="meter"><i style="--value:${brake}%"></i></div><span>${tel?brake+'%':'—'}</span></div></div><div class="driver-meta"><span>LAP ${row.currentLap??'—'}</span><span>BEST ${lapTime(row.bestLap)}</span><span>${row.pitCount} PIT STOP${row.pitCount===1?'':'S'}</span><span>${tel?`SAMPLE ${clock(tel.date)}`:'Awaiting telemetry'}</span></div><div class="sector-grid">${row.sectors.map((v,i)=>`<div><span class="stat-label">SECTOR ${i+1}</span><strong>${v?v.toFixed(3):'—'}</strong></div>`).join('')}</div><div class="lap-history"><table class="lap-table"><thead><tr><th>LAP</th><th>TIME</th><th>S1</th><th>S2</th><th>S3</th></tr></thead><tbody>${row.completed.slice(-40).reverse().map(l=>`<tr><td>${l.lap_number}${l.is_pit_out_lap?' OUT':''}</td><td class="${l.lap_duration===fastest?'purple':l.lap_duration===row.bestLap?'green':''}">${lapTime(l.lap_duration)}</td>${[1,2,3].map(i=>`<td>${l[`duration_sector_${i}`]?.toFixed(3)||'—'}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="5" class="empty">No completed laps at this time.</td></tr>'}</tbody></table></div>`;
}
function renderFeeds(t){
  const control=(state.data.race_control||[]).filter(r=>ms(r.date)<=t).slice(-200).reverse();$('control-count').textContent=control.length;
  $('control-feed').innerHTML=control.map(r=>`<article class="feed-item"><time>${clock(r.date)}</time><div><span class="flag-tag ${esc((r.flag||'').replaceAll(' ','-'))}">${esc(r.flag||r.category||'RACE CONTROL')}</span><p>${esc(r.message)}</p></div></article>`).join('')||'<p class="empty">No race control messages at this point in the session.</p>';
  const radio=(state.data.team_radio||[]).filter(r=>ms(r.date)<=t).slice(-80).reverse();$('radio-count').textContent=radio.length;
  const signature=radio.map(r=>r.recording_url).join('|');if($('radio-feed').dataset.signature===signature)return;$('radio-feed').dataset.signature=signature;
  const existing=new Map([...$('radio-feed').querySelectorAll('article')].map(el=>[el.dataset.clip,el]));
  const articles=radio.map(r=>{
    if(existing.has(r.recording_url))return existing.get(r.recording_url);const d=state.drivers.find(d=>d.driver_number===r.driver_number);
    const item=document.createElement('article');item.className='feed-item';item.dataset.clip=r.recording_url;
    item.innerHTML=`<time>${clock(r.date)}</time><div><div class="radio-driver">${esc(d?.full_name||`Driver ${r.driver_number}`)}<span>${esc(d?.team_name)}</span></div></div>`;
    try{const url=new URL(r.recording_url);if(url.protocol==='https:'){const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url.href;audio.setAttribute('aria-label',`${d?.full_name||r.driver_number} radio at ${clock(r.date)}`);item.lastElementChild.append(audio);}}catch{}return item;
  });
  // Retain current audio nodes when new clips arrive; pause only clips removed by seeking.
  for(const [url,item]of existing)if(!radio.some(r=>r.recording_url===url))item.querySelector('audio')?.pause();
  if(articles.length)$('radio-feed').replaceChildren(...articles);else $('radio-feed').innerHTML='<p class="empty">No published radio clips at this point in the session.</p>';
}
function renderCalendar(){
  const query=$('session-search').value.toLowerCase(),groups=new Map();
  for(const s of state.sessions){if(!`${s.country_name} ${s.location} ${s.circuit_short_name} ${s.session_name}`.toLowerCase().includes(query))continue;if(!groups.has(s.meeting_key))groups.set(s.meeting_key,[]);groups.get(s.meeting_key).push(s);}
  $('session-calendar').innerHTML=[...groups.values()].map(list=>`<div class="calendar-meeting"><h3>${esc(list[0].country_name)} <span class="muted">/ ${esc(list[0].circuit_short_name)}</span></h3>${list.sort((a,b)=>ms(a.date_start)-ms(b.date_start)).map(s=>`<button class="session-card ${s.session_key===state.session?.session_key?'active':''}" data-session="${s.session_key}"><span><strong>${esc(s.session_name)}</strong><small>${localDate(s.date_start)}</small></span><span class="mode-tag">${modeFor(s).toUpperCase()}</span></button>`).join('')}</div>`).join('')||'<p class="empty">No sessions match your search.</p>';
}
function frame(now){
  const delta=Math.min(now-lastFrame,200);lastFrame=now;
  if(state.session&&!state.fatal&&!state.loading){
    if(state.mode==='live')state.cursor=Math.min(state.end,Date.now()-6000);
    if(state.mode==='replay'&&state.playing&&!state.scrubbing){const next=Math.min(state.end,state.cursor+delta*state.speed);if(state.buffer&&state.cursor>=state.buffer.from&&next<state.buffer.to-1000)state.cursor=next;if(state.cursor>=state.end){state.playing=false;updatePlay();}}
    if(['live','replay'].includes(state.mode)){
      const count=map.draw(state.cursor);$('map-status').textContent=count?`${count} CARS · ${state.mode==='live'?'LIVE GPS':'RECORDED GPS'}`:'AWAITING GPS';
      const buffering=state.mode==='replay'&&state.playing&&(!state.buffer||state.cursor>=state.buffer.to-1200);$('buffer-state').textContent=buffering?'Buffering recorded positions…':'Real session data';$('buffer-state').classList.toggle('buffering',buffering);
      if(!document.hidden&&!state.scrubbing){loadStream(state.generation);if((state.mode==='live'||!state.lastTiming)&&Date.now()>=state.nextTiming)loadTiming(state.generation).catch(()=>{});}
      if(state.mode==='live'&&Date.now()>state.end+60000)loadSession(state.session.session_key);
    }else if(state.mode==='upcoming'&&Date.now()>=state.start)loadSession(state.session.session_key);
    if(now-state.lastRender>1000){state.lastRender=now;render();}
  }requestAnimationFrame(frame);
}
for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>setTab(tab.dataset.tab));
$('session-select').addEventListener('change',e=>{if(e.target.value)loadSession(Number(e.target.value));});$('year').addEventListener('change',e=>loadCatalog(Number(e.target.value)));
$('driver-select').addEventListener('change',e=>selectDriver(e.target.value));$('session-search').addEventListener('input',renderCalendar);
$('session-calendar').addEventListener('click',e=>{const b=e.target.closest('[data-session]');if(b){setTab('pitwall');loadSession(Number(b.dataset.session));}});
$('timing-body').addEventListener('click',e=>{const row=e.target.closest('[data-driver]');if(row)selectDriver(Number(row.dataset.driver));});
$('timing-body').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();const row=e.target.closest('[data-driver]');if(row)selectDriver(Number(row.dataset.driver));}});
$('play').addEventListener('click',()=>{if(state.cursor>=state.end){state.cursor=state.start;state.buffer=null;state.nextStream=0;}state.playing=!state.playing;updatePlay();});$('speed').addEventListener('change',e=>{state.speed=Number(e.target.value);});
$('seek').addEventListener('input',e=>{state.scrubbing=true;state.cursor=state.start+Number(e.target.value)/1000*(state.end-state.start);render();});
$('seek').addEventListener('change',()=>{state.scrubbing=false;state.buffer=null;state.locations={};map.samples={};state.telemetry=[];state.nextStream=0;});
$('follow').addEventListener('change',e=>{map.follow=e.target.checked;if(map.follow&&map.zoom<1.8)map.zoom=2;});$('fit').addEventListener('click',()=>{map.zoom=1;map.follow=false;$('follow').checked=false;});
$('zoom-in').addEventListener('click',()=>{map.zoom=Math.min(6,map.zoom*1.3);});$('zoom-out').addEventListener('click',()=>{map.zoom=Math.max(.6,map.zoom/1.3);});$('labels').addEventListener('click',()=>{map.labels=!map.labels;$('labels').setAttribute('aria-pressed',String(map.labels));});
const reconnect=()=>state.session?loadSession(state.session.session_key):loadCatalog(Number($('year').value));$('latest').addEventListener('click',()=>{ $('year').value=String(new Date().getFullYear());loadCatalog(Number($('year').value),true,true);});$('refresh').addEventListener('click',reconnect);$('retry').addEventListener('click',reconnect);
$('archive').addEventListener('click',()=>{$('year').value='2023';loadCatalog(2023,false);loadSession(9165);});
window.addEventListener('online',()=>{state.nextTiming=state.nextStream=0;if(state.fatal)reconnect();});document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();if(!document.hidden)state.nextTiming=state.nextStream=0;});
window.addEventListener('pagehide',()=>{controller.abort();catalogController?.abort();document.querySelectorAll('audio').forEach(a=>a.pause());});
$('local-time').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ');
const currentYear=new Date().getFullYear();for(let year=currentYear;year>=2023;year--)$('year').add(new Option(String(year),String(year)));
const requestedYear=Number(new URLSearchParams(location.search).get('year'));if(requestedYear>=2023&&requestedYear<=currentYear)$('year').value=requestedYear;
loadCatalog(Number($('year').value));requestAnimationFrame(frame);
