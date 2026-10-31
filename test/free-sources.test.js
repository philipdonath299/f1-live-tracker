import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarSessions,communitySnapshot,freeStats,freeCalendar,SOURCE_DIRECTORY} from '../server/free-sources.js';
const race={season:'2026',round:'19',raceName:'Mexico City Grand Prix',date:'2026-11-01',time:'20:00:00Z',Qualifying:{date:'2026-10-31',time:'21:00:00Z'},Circuit:{circuitId:'rodriguez',circuitName:'Hermanos Rodriguez',Location:{country:'Mexico',locality:'Mexico City'}}};
test('free calendar uses actual published times and marks estimated end times',()=>{
 const sessions=calendarSessions([race]);assert.equal(sessions.length,2);assert.equal(sessions[0].date_start,'2026-10-31T21:00:00.000Z');assert.equal(sessions[1].date_start,'2026-11-01T20:00:00.000Z');assert.equal(sessions[0].provider,'jolpica');assert.equal(sessions[0].end_estimated,true);assert.notEqual(sessions[0].session_key,sessions[1].session_key);
});
test('free source directory distinguishes actual live feeds, history and nonlive statistics',()=>{
 assert.equal(SOURCE_DIRECTORY.find(s=>s.id==='jolpica').live,false);assert.equal(SOURCE_DIRECTORY.find(s=>s.id==='direct').live,true);assert.match(SOURCE_DIRECTORY.find(s=>s.id==='openf1').cost,/paid/);
});
test('public APIs use no credentials, cache requests, and keep source timestamps',async()=>{
 const original=globalThis.fetch;let calls=0;const asOf='2026-10-31T21:30:00Z';
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);assert.match(options.headers['User-Agent'],/F1LiveTracker/);
   let body;
   if(String(url).endsWith('/snapshot'))body={session:{Key:123},timing:{Lines:{}},last_update:asOf,car_data:{Entries:Array.from({length:30},(_,i)=>({Utc:i}))}};
   else if(String(url).includes('driverstandings'))body={MRData:{StandingsTable:{StandingsLists:[{round:'19',DriverStandings:[{position:'1',points:'300'}]}]}}};
   else if(String(url).includes('constructorstandings'))return {ok:false,status:503};
   else if(String(url).includes('/last/'))body={MRData:{RaceTable:{Races:[{raceName:'Mexico'}]}}};
   else body={MRData:{RaceTable:{Races:[race]}}};
   return {ok:true,text:async()=>JSON.stringify(body)};
 };
 try{
   const first=await communitySnapshot();assert.equal(first.available,true);assert.equal(first.asOf,asOf);assert.equal(first.snapshot.car_data.Entries.length,8);
   await communitySnapshot();assert.equal(calls,1);
   const calendar=await freeCalendar(2026);assert.equal(calendar.sessions.length,2);
   const stats=await freeStats(2026);assert.equal(stats.drivers[0].points,'300');assert.equal(stats.issues.length,1);assert.equal(stats.issues[0].source,'constructorstandings');
 }finally{globalThis.fetch=original;}
});
