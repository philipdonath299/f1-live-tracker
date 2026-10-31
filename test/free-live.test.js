import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeLiveClient} from '../js/free-live.js';
const now=Date.parse('2026-10-31T21:30:00Z'),stamp=new Date(now).toISOString();
const raw=(key=123)=>({SessionInfo:{Key:key,Name:'Qualifying',StartDate:'2026-10-31T21:00:00Z',EndDate:'2026-10-31T22:00:00Z',Meeting:{Key:9,Circuit:{Key:65,ShortName:'Mexico City'}}},SessionStatus:{Status:'Started'},Heartbeat:{Utc:stamp},DriverList:{1:{FullName:'Test One',Tla:'ONE'}},TimingData:{Lines:{1:{Position:'1',NumberOfLaps:3,LastLapTime:{Value:'1:20.100'}}}}});
class Socket{
  static all=[];
  constructor(url){this.url=url;this.sent=[];this.readyState=1;Socket.all.push(this);}
  send(message){this.sent.push(message);}
  close(){this.readyState=3;this.onclose?.();}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function receive(ws,text){ws.onmessage({data:text});await flush();}
test('native SignalR negotiates JSON, handles split frames and merges sparse live updates without a token',async()=>{
  Socket.all=[];const updates=[];const client=new FreeLiveClient({WebSocketImpl:Socket,onView:v=>updates.push(v),now:()=>now,fetchImpl:async()=>{throw new Error('must not poll in direct mode');}});
  try{
    client.start('direct');const ws=Socket.all[0];ws.onopen();assert.equal(ws.url,'wss://livetiming.formula1.com/signalrcore');assert.equal(ws.sent[0],'{"protocol":"json","version":1}\x1e');
    await receive(ws,'{}\x1e');const subscribe=JSON.parse(ws.sent[1].slice(0,-1));assert.equal(subscribe.target,'Subscribe');assert.ok(!subscribe.arguments[0].includes('CarData.z'));
    const message=JSON.stringify({type:3,invocationId:'1',result:raw()});await receive(ws,message.slice(0,60));assert.equal(updates.length,0);await receive(ws,message.slice(60)+'\x1e');assert.equal(updates.at(-1).rows[0].lastLap,80.1);
    await receive(ws,JSON.stringify({type:1,target:'feed',arguments:['TimingData',{Lines:{1:{Position:'2'}}},stamp]})+'\x1e'+JSON.stringify({type:6})+'\x1e');
    assert.equal(client.getView().rows[0].position,2);assert.equal(client.getView().rows[0].lastLap,80.1);assert.ok(ws.sent.some(s=>s==='{"type":6}\x1e'));
    assert.ok(ws.sent.every(s=>!s.includes('access_token')&&!s.includes('Authorization')));
  }finally{client.stop();}
});
test('community fallback preserves upstream age and never labels an old snapshot live',async()=>{
  let requested;
  const client=new FreeLiveClient({now:()=>now,WebSocketImpl:class{constructor(){throw new Error('must not connect');}},fetchImpl:async url=>{requested=url;return {ok:true,json:async()=>({available:true,snapshot:raw(),asOf:new Date(now-120000).toISOString(),fetchedAt:stamp})};}});
  try{client.start('community');await flush();assert.equal(requested,'/api/f1?action=free-live');assert.equal(client.getView().phase,'stale');assert.equal(client.getView().rows[0].lastLap,80.1);}finally{client.stop();}
});
test('GPS enrichment only combines the same session and fresh samples',()=>{
  const client=new FreeLiveClient({now:()=>now});client.mode='auto';client.direct.snapshot(raw(),stamp);
  let other=raw(999);other.Position={Position:[{Timestamp:stamp,Entries:{1:{X:100,Y:200}}}]};client.community.snapshot(other,stamp);assert.equal(client.getView().locations.length,0);
  other=raw();other.Position={Position:[{Timestamp:stamp,Entries:{1:{X:100,Y:200}}}]};client.community.snapshot(other,stamp);assert.equal(client.getView().locations[0].x,100);
  other.Position.Position[0].Timestamp=new Date(now-60000).toISOString();client.community.snapshot(other,stamp);assert.equal(client.getView().locations.length,0);
});
test('provider authorization errors stop direct requests instead of attempting a bypass',async()=>{
  const client=new FreeLiveClient({WebSocketImpl:Socket,now:()=>now});
  try{client.start('direct');const ws=Socket.all.at(-1);ws.onopen();await receive(ws,'{"error":"Unauthorized"}\x1e');assert.equal(ws.readyState,3);assert.equal(client.retry,undefined);assert.equal(ws.sent.length,1);}finally{client.stop();}
});
