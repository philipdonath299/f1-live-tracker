import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
class Element{
 constructor(id=''){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=id==='timing-map';this.dataset={};this.events={};this.children=[];this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.parentElement=this;this.lastElementChild=this;}
 addEventListener(name,cb){(this.events[name]||=[]).push(cb);} fire(name,event={}){for(const cb of this.events[name]||[])cb(event);}
 setAttribute(name,value){this[name]=value;} removeAttribute(){} append(child){this.children.push(child);} replaceChildren(...children){this.children=children;}
 querySelectorAll(){return [];}querySelector(){return null;}closest(){return this;}
 add(option){this.children.push(option);if(!this.value)this.value=option.value;}
 getBoundingClientRect(){return {width:800,height:400,left:0,top:0};}getContext(){return new Proxy({},{get:()=>()=>{}});}
}
class Socket{static all=[];constructor(url){this.url=url;this.readyState=1;this.sent=[];Socket.all.push(this);}send(data){this.sent.push(data);}close(){this.readyState=3;this.onclose?.();}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('default page opens free live timing, renders public sectors and approximate map, with free statistics and no paid timing requests',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
 const buttons=['pitwall','control','radio','sessions','championship','sources'].map(name=>{const e=new Element();e.dataset.tab=name;return e;});
 const windowEvents={},calls=[];let frame;
 globalThis.document={getElementById:id=>{assert.ok(elements[id],id);return elements[id];},querySelectorAll:selector=>selector==='.tab'?buttons:[],addEventListener(){},hidden:false,createElement:()=>new Element()};
 globalThis.window={devicePixelRatio:1,addEventListener(name,cb){(windowEvents[name]||=[]).push(cb);}};globalThis.ResizeObserver=class{observe(){}};globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
 globalThis.WebSocket=Socket;globalThis.location={href:'http://localhost/',search:''};globalThis.history={replaceState(){}};globalThis.requestAnimationFrame=cb=>{frame=cb;};
 globalThis.fetch=async url=>{
   const p=new URL(url,'http://localhost').searchParams,action=p.get('action');calls.push(action);
   if(action==='catalog')return {ok:false,status:401,json:async()=>({error:'OpenF1 live access restricted'})};
   let body;
   if(action==='free-calendar')body={sessions:[],liveConfigured:false};
   if(action==='free-live')body={available:false,error:'Test community feed offline'};
   if(action==='geometry')body={points:Array.from({length:80},(_,i)=>({x:500+400*Math.cos(i/80*Math.PI*2),y:500+400*Math.sin(i/80*Math.PI*2)})),rotation:0,source:'Test-only circuit'};
   if(action==='free-stats')body={year:2026,source:'Jolpica',round:'19',drivers:[{position:'1',points:'331',wins:'8',Driver:{givenName:'Test',familyName:'Leader'},Constructors:[{name:'Test Team'}]}],constructors:[],race:null,qualifying:null,issues:[]};
   if(action==='sources')body={sources:[{id:'direct',name:'F1 public stream',cost:'Free',provides:'Timing',limits:'GPS not included',url:'https://example.com/'}]};
   return {ok:true,status:200,json:async()=>body};
 };
 try{
   await import(`../js/pitwall.js?free-integration=${Date.now()}`);for(let i=0;i<8;i++)await tick();
   assert.ok(!elements['notice-text'].textContent.includes('subscription'));
   const ws=Socket.all[0];assert.ok(ws);ws.onopen();ws.onmessage({data:'{}\x1e'});await tick();
   const now=Date.now(),utc=new Date(now).toISOString();
   const result={
     SessionInfo:{Key:555,Name:'Qualifying',Type:'Qualifying',StartDate:new Date(now-1800000).toISOString(),EndDate:new Date(now+1800000).toISOString(),Meeting:{Key:9,Country:{Name:'Mexico'},Location:'Mexico City',Circuit:{Key:65,ShortName:'Mexico City'}}},
     SessionStatus:{Status:'Started'},Heartbeat:{Utc:utc},
     DriverList:{1:{FullName:'Test Driver',Tla:'TST',TeamName:'Test Team'}},
     TimingData:{Lines:{}}
   };
   result.TimingData.Lines[1]={Position:'1',NumberOfLaps:3,LastLapTime:{Value:'1:20.100'},BestLapTime:{Value:'1:19.200'},Sectors:{}};
   for(let i=0;i<3;i++)result.TimingData.Lines[1].Sectors[i]={Value:i===0?'25':'',Segments:{0:{Status:i===0?2051:0},1:{Status:i===0?2051:0}}};
   ws.onmessage({data:JSON.stringify({type:3,invocationId:'1',result})+'\x1e'});for(let i=0;i<12;i++)await tick();frame(performance.now()+2000);frame(performance.now()+4000);
   assert.equal(elements['session-title'].textContent,'Mexico - Qualifying');assert.ok(elements['connection'].innerHTML.includes('LIVE / FREE'));assert.ok(elements['timing-body'].innerHTML.includes('1:20.100'));assert.equal(elements['access-note'].hidden,true);assert.ok(elements['map-status'].textContent.includes('NOT GPS'));
   assert.ok(!calls.includes('session')&&!calls.includes('timing')&&!calls.includes('stream'),'paid OpenF1 timing endpoints not used for free mode');
   buttons.find(b=>b.dataset.tab==='championship').fire('click');for(let i=0;i<5;i++)await tick();assert.ok(elements['championship-content'].innerHTML.includes('331'));
   buttons.find(b=>b.dataset.tab==='sources').fire('click');for(let i=0;i<5;i++)await tick();assert.ok(elements['sources-list'].innerHTML.includes('GPS not included'));
 }finally{for(const cb of windowEvents.pagehide||[])cb();}
});
