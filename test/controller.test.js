import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Lightweight DOM harness: exercises the shipped controller without a browser or network.
class Element {
  constructor(id=''){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.events={};this.children=[];this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.parentElement=this;this.lastElementChild=this;}
  addEventListener(name,callback){this.events[name]=callback;}
  setAttribute(){} removeAttribute(){} append(child){this.children.push(child);} replaceChildren(...children){this.children=children;}
  querySelectorAll(){return [];} querySelector(){return null;} closest(){return this;}
  add(option){this.children.push(option);if(!this.value)this.value=option.value;}
  getBoundingClientRect(){return {width:800,height:400,left:0,top:0};}
  getContext(){return new Proxy({},{get:()=>()=>{}});}
}
const session={session_key:100,meeting_key:1,year:2024,country_name:'Test Circuit',location:'Test City',circuit_short_name:'TEST TRACK',date_start:'2024-07-07T14:00:00Z',date_end:'2024-07-07T14:10:00Z',session_name:'Race',session_type:'Race'};
const session2={...session,session_key:101,country_name:'Second Circuit',circuit_short_name:'SECOND TRACK'};
const start=Date.parse(session.date_start),date=s=>new Date(start+s*1000).toISOString();
const drivers=[{driver_number:1,full_name:'Test Driver One',name_acronym:'ONE',team_name:'Test Team',team_colour:'FF0000'},{driver_number:4,full_name:'Test Driver Four',name_acronym:'FOU',team_name:'Other Team',team_colour:'00FF00'}];
const history={position:[{driver_number:1,position:1,date:date(0)},{driver_number:4,position:2,date:date(0)}],laps:[{driver_number:1,lap_number:1,date_start:date(0),lap_duration:90,duration_sector_1:25,duration_sector_2:35,duration_sector_3:30}],stints:[],race_control:[{date:date(120),message:'TEST LATE MESSAGE',category:'Flag'}],team_radio:[],weather:[],intervals:[],pit:[],issues:[]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('controller loads real API shapes, follows selection, seeks without leaking future results, and switches sessions',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  let frame,blockNextSession,release;
  const calls=[];
  globalThis.document={getElementById:id=>{assert.ok(elements[id],`HTML contains ${id}`);return elements[id];},querySelectorAll:()=>[],addEventListener(){},hidden:false,createElement:()=>new Element()};
  globalThis.window={devicePixelRatio:1,addEventListener(){}};
  globalThis.ResizeObserver=class{observe(){}};
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  globalThis.location={href:'http://localhost/?year=2024',search:'?year=2024'};
  globalThis.history={replaceState(){}};
  globalThis.requestAnimationFrame=callback=>{frame=callback;};
  globalThis.fetch=async url=>{
    const p=new URL(url,'http://localhost').searchParams,action=p.get('action');calls.push({action,session:p.get('session'),driver:p.get('driver')});
    if(action==='session'&&blockNextSession){blockNextSession=false;await new Promise(resolve=>{release=resolve;});}
    let body;
    if(action==='catalog')body={sessions:[session2,session],liveConfigured:false};
    if(action==='session')body={session:p.get('session')==='101'?session2:session,drivers,liveConfigured:false};
    if(action==='timing')body=history;
    if(action==='track')body={points:[{x:100,y:100},{x:200,y:200},{x:100,y:200}],rotation:0,source:'Test-only geometry'};
    if(action==='stream'){
      const from=Date.parse(p.get('from')),to=Date.parse(p.get('to')),number=Number(p.get('driver'));
      const locations=[];const telemetry=[];
      for(let t=from;t<=to;t+=1000){locations.push({driver_number:1,date:new Date(t).toISOString(),x:150,y:150});telemetry.push({driver_number:number,date:new Date(t).toISOString(),speed:123,n_gear:4,rpm:9000,drs:8,throttle:50,brake:0});}
      body={locations,telemetry,issues:[]};
    }
    return {ok:true,status:200,json:async()=>body};
  };
  await import(`../js/pitwall.js?integration=${Date.now()}`);
  for(let i=0;i<12;i++)await tick();
  frame(performance.now()+2000);
  assert.equal(elements['session-title'].textContent,'Second Circuit · Race');
  assert.ok(elements['timing-body'].innerHTML.includes('ONE'));
  assert.ok(!elements['timing-body'].innerHTML.includes('1:30.000'),'future lap hidden at 12 seconds');
  assert.ok(elements['driver-details'].innerHTML.includes('123'));
  assert.equal(elements['control-count'].textContent,0);
  elements['seek'].value='170';elements['seek'].events.input({target:elements['seek']});elements['seek'].events.change();frame(performance.now()+4000);
  for(let i=0;i<8;i++)await tick();frame(performance.now()+6000);
  assert.ok(elements['timing-body'].innerHTML.includes('1:30.000'),'completed lap visible after seeking');
  assert.equal(elements['control-count'].textContent,0,'future race-control message still hidden');
  elements['driver-select'].value='4';elements['driver-select'].events.change({target:elements['driver-select']});
  for(let i=0;i<8;i++)await tick();frame(performance.now()+8000);
  assert.equal(elements['driver-title'].textContent,'Test Driver Four');
  assert.ok(calls.some(c=>c.action==='stream'&&c.driver==='4'));
  // Make an older session response finish after the newly selected session.
  blockNextSession=true;elements['session-select'].value='100';elements['session-select'].events.change({target:elements['session-select']});await tick();
  elements['session-select'].value='101';elements['session-select'].events.change({target:elements['session-select']});
  for(let i=0;i<12;i++)await tick();release();for(let i=0;i<5;i++)await tick();
  assert.equal(elements['session-title'].textContent,'Second Circuit · Race','late response cannot overwrite new selection');
  assert.equal(elements['circuit-name'].textContent,'SECOND TRACK');
  globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Subscription required for live access'})});
  elements['refresh'].events.click();for(let i=0;i<8;i++)await tick();
  assert.equal(elements['connection'].innerHTML,'<i></i>CONNECTION FAILED');
  assert.equal(elements['notice-text'].textContent,'Subscription required for live access');
  assert.ok(!elements['timing-body'].innerHTML.includes('ONE'),'failed reconnect clears previous session data');
});
