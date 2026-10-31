import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePatch,seconds,f1Date,LiveTimingStore,feedPhase,FREE_TOPICS} from '../js/free-model.js';
const now=Date.parse('2026-10-31T21:30:00Z');
const sample=()=>({SessionInfo:{Key:123,Name:'Qualifying',Type:'Qualifying',StartDate:'2026-10-31T15:00:00',EndDate:'2026-10-31T16:00:00',GmtOffset:'-06:00:00',Meeting:{Key:9,Name:'Mexico',Location:'Mexico City',Country:{Name:'Mexico'},Circuit:{Key:65,ShortName:'Mexico City'}}},SessionStatus:{Status:'Started'},Heartbeat:{Utc:new Date(now).toISOString()},DriverList:{1:{FullName:'Example One',Tla:'ONE',TeamName:'Team One',TeamColour:'FF0000'}},TimingData:{Lines:{1:{Position:'1',NumberOfLaps:3,LastLapTime:{Value:'1:20.100'},BestLapTime:{Value:'1:19.200'},Sectors:{0:{Value:'25.100',Segments:{0:{Status:2051}}},1:{Value:'30.000'},2:{Value:'25.000'}},GapToLeader:'0.000',NumberOfPitStops:0}}},TimingAppData:{Lines:{1:{Stints:{0:{Compound:'SOFT',TotalLaps:3}}}}},LapCount:{CurrentLap:3,TotalLaps:71}});
test('public subscription excludes gated car and GPS topics',()=>{assert.ok(FREE_TOPICS.includes('TimingData'));assert.ok(!FREE_TOPICS.includes('CarData.z'));assert.ok(!FREE_TOPICS.includes('Position.z'));});
test('sparse deltas preserve untouched fields and keyframes reset a topic',()=>{
 const a=mergePatch({Lines:{1:{Position:'1',Sectors:[{Value:'25'},{Value:'30'}]}}},{Lines:{1:{Sectors:{1:{Value:'29'}}}}});
 assert.equal(a.Lines[1].Position,'1');assert.equal(a.Lines[1].Sectors[0].Value,'25');assert.equal(a.Lines[1].Sectors[1].Value,'29');
 assert.deepEqual(mergePatch(a,{_kf:true,Lines:{4:{Position:'1'}}}),{Lines:{4:{Position:'1'}}});
 const clean=mergePatch({},JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}'));assert.equal({}.polluted,undefined);assert.deepEqual(clean,{});
});
test('F1 times parse minute formats and local session offsets',()=>{assert.equal(seconds('1:20.123'),80.123);assert.equal(seconds('25.4'),25.4);assert.equal(seconds(''),null);assert.equal(seconds('+1 LAP'),null);assert.equal(f1Date('2026-10-31T15:00:00','-06:00:00'),'2026-10-31T21:00:00.000Z');});
test('live adapter displays actual timing, zero gaps, tyre age and mini sectors',()=>{
 const store=new LiveTimingStore();store.snapshot(sample());const view=store.view(now);
 assert.equal(view.phase,'live');assert.equal(view.rows[0].lastLap,80.1);assert.equal(view.rows[0].bestLap,79.2);assert.equal(view.rows[0].gap,0);assert.equal(view.rows[0].tyreAge,3);assert.deepEqual(view.rows[0].segments[0],[2051]);assert.equal(view.lap,3);assert.equal(view.totalLaps,71);assert.equal(view.rows[0].completed.length,1);
});
test('fresh HTTP fetch times cannot turn old timing into live data',()=>{
 const store=new LiveTimingStore();const raw=sample();store.snapshot(raw,new Date(now-120000).toISOString());assert.equal(store.view(now).phase,'stale');
 raw.SessionStatus.Status='Finalised';store.snapshot(raw,new Date(now).toISOString());assert.equal(store.view(now).phase,'complete');
 assert.equal(feedPhase(sample(),null,now),'stale');
});
test('session rollover clears timing, radio, GPS and laps, retaining weekend identity',()=>{
 const store=new LiveTimingStore();const raw=sample();raw.TeamRadio={Captures:{0:{Utc:new Date(now).toISOString(),Path:'TeamRadio/test.mp3',RacingNumber:'1'}}};store.snapshot(raw);store.view(now);
 store.update('SessionInfo',{Key:124,Name:'Race',StartDate:'2026-11-01T14:00:00'},new Date(now).toISOString());
 const view=store.view(now);assert.equal(view.session.session_key,124);assert.equal(view.session.circuit_key,65);assert.equal(view.rows[0].lastLap,null);assert.equal(view.rows[0].completed.length,0);assert.equal(view.radio.length,0);assert.equal(view.locations.length,0);
});
test('incomplete timing patches never attach an old last-lap time to a new lap',()=>{
 const store=new LiveTimingStore();store.snapshot(sample());store.view(now);store.update('TimingData',{Lines:{1:{NumberOfLaps:4}}},new Date(now+1000).toISOString());
 const view=store.view(now+1000);assert.equal(view.rows[0].currentLap,4);assert.deepEqual(view.rows[0].completed.map(l=>l.lap_number),[3]);
});
test('missing live fields stay missing rather than producing a fabricated best lap',()=>{
 const raw=sample();raw.TimingData.Lines[1]={Position:'2'};const store=new LiveTimingStore();store.snapshot(raw);const row=store.view(now).rows[0];assert.equal(row.lastLap,null);assert.equal(row.bestLap,null);assert.equal(row.pitCount,null);assert.equal(row.gap,null);
});
test('GPS and car samples require real timestamps; speed-trap data is separate',()=>{
 const raw=sample();raw.Position={Position:[{Timestamp:new Date(now).toISOString(),Entries:{1:{X:100,Y:200},2:{X:0,Y:0}}},{Entries:{1:{X:999,Y:999}}}]};
 raw.CarData={Entries:[{Utc:new Date(now).toISOString(),Cars:{1:{Channels:{0:9000,2:200,3:5,4:70,5:1,45:12}}}}]};
 const store=new LiveTimingStore();store.snapshot(raw);const view=store.view(now);assert.equal(view.locations.length,1);assert.equal(view.locations[0].x,100);assert.equal(view.telemetry[0].speed,200);assert.equal(view.telemetry[0].brake,100);
});
import {timingEstimate} from '../js/free-model.js';
test('timing map is explicitly estimated from completed mini-sectors, with no clock-based movement',()=>{
 const row={driver_number:1,segments:[[2051,2051],[0,0],[0,0]],inPit:false,retired:false,stopped:false};
 const points=[{x:100,y:100},{x:400,y:100},{x:400,y:400},{x:100,y:400}];
 const a=timingEstimate(row,points,'2026-10-31T21:30:00Z');const b=timingEstimate(row,points,'2026-10-31T21:31:00Z');
 assert.equal(a.estimated,true);assert.equal(a.x,b.x);assert.equal(a.y,b.y);assert.ok(Math.abs(a.x-400)<.01);assert.ok(Math.abs(a.y-200)<.01);
 assert.equal(timingEstimate({...row,inPit:true},points,a.date),null);assert.equal(timingEstimate({...row,segments:[[],[],[]]},points,a.date),null);
});
test('an explicitly disconnected provider is not labelled live even with a recent timestamp',()=>{
 const raw=sample();raw.connected=false;const store=new LiveTimingStore();store.snapshot(raw,new Date(now).toISOString());assert.equal(store.view(now).phase,'stale');
});
