import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicF1Snapshot} from '../server/f1-public.js';
const response=(body='',extra={})=>({ok:true,status:200,headers:{getSetCookie:()=>[]},text:async()=>typeof body==='string'?body:JSON.stringify(body),json:async()=>body,...extra});
test('HTTP fallback uses the standard anonymous SignalR negotiation, affinity and subscription lifecycle',async()=>{
 const original=globalThis.fetch,calls=[];const snapshot={SessionInfo:{Key:123},TimingData:{Lines:{1:{Position:'1'}}},Heartbeat:{Utc:'2026-10-31T21:30:00Z'}};
 globalThis.fetch=async(url,options={})=>{
  const n=calls.length;calls.push({url:String(url),...options});assert.equal(options.headers?.Authorization,undefined);
  if(n===0)return response('',{headers:{getSetCookie:()=>['AWSALBCORS=public-affinity; Secure; SameSite=None']}});
  assert.equal(options.headers.Cookie,'AWSALBCORS=public-affinity');
  if(n===1)return response({connectionToken:'public-test-id',availableTransports:[{transport:'LongPolling'}]});
  if(n===4)return response('{}\x1e');
  if(n===6)return response(JSON.stringify({type:3,invocationId:'1',result:snapshot})+'\x1e');
  return response();
 };
 try{
  const result=await readPublicF1Snapshot();assert.equal(result.available,true);assert.equal(result.asOf,snapshot.Heartbeat.Utc);assert.equal(result.snapshot.TimingData.Lines[1].Position,'1');
  assert.equal(calls[0].method,'OPTIONS');assert.equal(calls[1].method,'POST');assert.ok(calls[3].body.includes('"protocol":"json"'));
  const subscribe=JSON.parse(calls[5].body.slice(0,-1));assert.equal(subscribe.target,'Subscribe');assert.ok(!subscribe.arguments[0].includes('CarData.z'));assert.equal(calls.at(-1).method,'DELETE');
 }finally{globalThis.fetch=original;}
});
test('an anonymous HTTP rejection stops without retrying credentials or another endpoint',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:401,headers:{getSetCookie:()=>[]}};};
 try{const result=await readPublicF1Snapshot();assert.equal(result.available,false);assert.match(result.error,/401/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
