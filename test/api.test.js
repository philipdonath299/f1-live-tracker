import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{validateWindow} from '../api/f1.js';
const s={date_start:'2024-07-07T14:00:00Z',date_end:'2024-07-07T16:00:00Z'};
function request(url,method='GET'){
  return new Promise(resolve=>{const headers={};const res={setHeader(k,v){headers[k]=v;},end(body){resolve({status:this.statusCode,headers,body:JSON.parse(body)});}};handler({url,method},res);});
}
test('API rejects non-GET methods before any provider request',async()=>{
  const response=await request('/api/f1','POST');assert.equal(response.status,405);assert.equal(response.headers.Allow,'GET');
});
test('API rejects invalid session and season identifiers without network access',async()=>{
  for(const url of ['/api/f1?action=session&session=latest','/api/f1?action=session&session=-1','/api/f1?action=session&session=1%26foo=bar','/api/f1?action=catalog&year=2020'])assert.equal((await request(url)).status,400);
});
test('telemetry windows reject unbounded, reversed, future and out of session queries',()=>{
  const check=(from,to)=>()=>validateWindow(new URLSearchParams({from,to}),s,Date.parse('2024-07-08T00:00:00Z'));
  assert.throws(check(s.date_start,s.date_end));assert.throws(check('bad',s.date_end));assert.throws(check('2024-07-07T15:00:03Z','2024-07-07T15:00:01Z'));assert.throws(check('2024-07-07T12:00:00Z','2024-07-07T12:00:10Z'));
  assert.deepEqual(check('2024-07-07T14:01:00Z','2024-07-07T14:01:40Z')(),{'date>':'2024-07-07T14:01:00.000Z','date<':'2024-07-07T14:01:40.000Z'});
});
test('API never returns authentication secrets to the client',async()=>{
  const before=process.env.OPENF1_TOKEN;process.env.OPENF1_TOKEN='test-secret-never-return';
  try{const response=await request('/api/f1?action=session&session=bad');assert.ok(!JSON.stringify(response).includes(process.env.OPENF1_TOKEN));assert.equal(response.headers['Cache-Control'],'private, no-store');}
  finally{if(before===undefined)delete process.env.OPENF1_TOKEN;else process.env.OPENF1_TOKEN=before;}
});

test('server authenticates privately, shares cached reads, and isolates a failed optional stream',async()=>{
  const originalFetch=globalThis.fetch,oldUser=process.env.OPENF1_USERNAME,oldPassword=process.env.OPENF1_PASSWORD,oldToken=process.env.OPENF1_TOKEN;
  process.env.OPENF1_USERNAME='test-user';process.env.OPENF1_PASSWORD='test-password';delete process.env.OPENF1_TOKEN;
  const calls=[];
  const sample={session_key:42,year:2024,circuit_key:63,date_start:'2024-07-07T14:00:00Z',date_end:'2024-07-07T16:00:00Z'};
  globalThis.fetch=async(url,options={})=>{
    const target=new URL(url);calls.push({url:target.href,headers:options.headers});
    if(target.pathname==='/token')return {ok:true,json:async()=>({access_token:'private-access-token',expires_in:3600})};
    assert.equal(options.headers.Authorization,'Bearer private-access-token');
    let data=[];
    if(target.pathname.endsWith('/sessions'))data=[sample];
    if(target.pathname.endsWith('/drivers'))data=[{driver_number:1,full_name:'Test Driver'}];
    if(target.pathname.endsWith('/laps'))data=[{driver_number:1,lap_number:1,date_start:sample.date_start,lap_duration:90,meeting_key:1}];
    if(target.pathname.endsWith('/location'))data=[{driver_number:1,date:'2024-07-07T14:01:00Z',x:100,y:100}];
    if(target.pathname.endsWith('/car_data'))data=[{driver_number:1,date:'2024-07-07T14:01:00Z',speed:300}];
    if(target.pathname.endsWith('/team_radio'))return {ok:false,status:503};
    return {ok:true,json:async()=>data};
  };
  try{
    const catalog=await request('/api/f1?action=catalog&year=2024');assert.equal(catalog.status,200);assert.equal(catalog.body.liveConfigured,true);assert.ok(!JSON.stringify(catalog).includes('private-access-token'));
    const detail=await request('/api/f1?action=session&session=42');assert.equal(detail.body.drivers[0].driver_number,1);
    const before=calls.length;await request('/api/f1?action=session&session=42');assert.equal(calls.length,before,'duplicate reads use cache');
    const timing=await request('/api/f1?action=timing&session=42');assert.equal(timing.status,200);assert.equal(timing.body.laps[0].lap_duration,90);assert.equal(timing.body.laps[0].meeting_key,undefined);assert.equal(timing.body.issues[0].stream,'team_radio');
    const stream=await request('/api/f1?action=stream&session=42&driver=1&from=2024-07-07T14:01:00Z&to=2024-07-07T14:01:30Z');assert.equal(stream.status,200);assert.equal(stream.body.telemetry[0].speed,300);assert.equal(stream.body.locations[0].x,100);
    assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1,'token is renewed and cached on the server');
  }finally{
    globalThis.fetch=originalFetch;
    for(const [key,value]of [['OPENF1_USERNAME',oldUser],['OPENF1_PASSWORD',oldPassword],['OPENF1_TOKEN',oldToken]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
