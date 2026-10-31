import test from 'node:test';
import assert from 'node:assert/strict';
import { lapTime, gapTime, modeFor, mergeData, deriveTiming, groupSamples, sampleAt } from '../js/pitwall-timing.js';
const start=Date.parse('2024-07-07T14:00:00Z');
const at=seconds=>new Date(start+seconds*1000).toISOString();
const drivers=[{driver_number:1,full_name:'Driver One'},{driver_number:4,full_name:'Driver Four'}];
const lap=(driver,number,seconds,duration=90)=>({driver_number:driver,lap_number:number,date_start:at(seconds),lap_duration:duration,duration_sector_1:25,duration_sector_2:35,duration_sector_3:duration-60});
test('lap formatting handles rounding across a minute and missing values',()=>{
  assert.equal(lapTime(89.123),'1:29.123');assert.equal(lapTime(59.9999),'1:00.000');assert.equal(lapTime(null),'—');assert.equal(lapTime(NaN),'—');
});
test('gaps preserve zero, lap deficits and missing values',()=>{
  assert.equal(gapTime(0),'+0.000');assert.equal(gapTime('+1 LAP'),'+1 LAP');assert.equal(gapTime(null),'—');
});
test('session phase checks both start and end and cancellation',()=>{
  const session={date_start:at(0),date_end:at(3600)};
  assert.equal(modeFor(session,start-1),'upcoming');assert.equal(modeFor(session,start+1),'live');assert.equal(modeFor(session,start+3600001),'replay');assert.equal(modeFor({...session,is_cancelled:true},start),'cancelled');
});
test('replay never reveals a future lap or final classification',()=>{
  const data={laps:[lap(1,1,0),lap(1,2,90,89),lap(4,1,0,92)],position:[{driver_number:1,date:at(1),position:1},{driver_number:4,date:at(1),position:2}],session_result:[{driver_number:4,position:1,dnf:true},{driver_number:1,position:2}]};
  const result=deriveTiming(data,drivers,start+100000,true);
  assert.equal(result.rows[0].driver_number,1);assert.equal(result.rows[0].bestLap,90);assert.equal(result.rows[0].lastLap,90);assert.equal(result.rows[0].currentLap,2);assert.equal(result.rows[1].result,undefined);
  assert.equal(deriveTiming(data,drivers,start+200000,true,true).rows[0].driver_number,4);
});
test('current sector times only appear after the sector finishes',()=>{
  const data={laps:[lap(1,1,0)]};
  assert.deepEqual(deriveTiming(data,drivers,start+40000,true).rows[0].sectors,[25,null,null]);
  assert.deepEqual(deriveTiming(data,drivers,start+65000,true).rows[0].sectors,[25,35,null]);
});
test('lap counter uses laps while position records may have no lap_number',()=>{
  const result=deriveTiming({laps:[lap(1,12,0)],position:[{driver_number:1,position:2,date:at(0)}]},drivers,start+95000,true);
  assert.equal(result.lap,12);assert.equal(result.rows.find(r=>r.driver_number===1).currentLap,12);
});
test('qualifying ranks valid best laps and preserves session gaps',()=>{
  const data={laps:[lap(1,1,0,92),lap(4,1,0,90)]};
  const result=deriveTiming(data,drivers,start+100000,false);
  assert.equal(result.rows[0].driver_number,4);assert.equal(result.fastest,90);assert.equal(result.rows[1].gap,2);
});
test('missing positions, gaps and lap times stay missing',()=>{
  const result=deriveTiming({},drivers,start,true);
  assert.equal(result.rows[0].position,null);assert.equal(result.rows[0].gap,null);assert.equal(result.rows[0].lastLap,null);assert.equal(result.fastest,null);
});
test('stints do not leak future tyres and include the previous tyre age',()=>{
  const data={laps:[lap(1,6,0)],stints:[{driver_number:1,stint_number:1,lap_start:1,compound:'SOFT',tyre_age_at_start:3},{driver_number:1,stint_number:2,lap_start:7,compound:'HARD'}]};
  const row=deriveTiming(data,drivers,start+95000,true).rows[0];assert.equal(row.compound,'SOFT');assert.equal(row.tyreAge,9);
});
test('pit counts are synchronized to the cursor and use actual pit duration',()=>{
  const data={pit:[{driver_number:1,date:at(10),lane_duration:24},{driver_number:1,date:at(200),lane_duration:22}]};
  const row=deriveTiming(data,drivers,start+15000,true).rows[0];assert.equal(row.pitCount,1);assert.equal(row.inPit,true);
  assert.equal(deriveTiming(data,drivers,start+45000,true).rows[0].inPit,false);
});
test('updates replace an existing lap without duplicating history',()=>{
  const a=mergeData({}, {laps:[{...lap(1,2,90),lap_duration:null}],stints:[{driver_number:1,stint_number:1,lap_start:1,compound:'SOFT'}]});
  const b=mergeData(a,{laps:[lap(1,2,90)],stints:[{driver_number:1,stint_number:1,lap_start:1,lap_end:12,compound:'SOFT'}]});
  assert.equal(b.laps.length,1);assert.equal(b.laps[0].lap_duration,90);assert.equal(b.stints.length,1);assert.equal(b.stints[0].lap_end,12);
});
test('latest position selection is chronological even for out of order rows',()=>{
  const data={position:[{driver_number:1,date:at(50),position:2},{driver_number:1,date:at(10),position:1},{driver_number:1,date:at(100),position:4}]};
  assert.equal(deriveTiming(data,drivers,start+60000,true).rows[0].position,2);
});
test('GPS is sorted, filters zero fixes, interpolates between observed samples',()=>{
  const groups=groupSamples([{driver_number:1,date:at(2),x:200,y:100},{driver_number:1,date:at(0),x:100,y:50},{driver_number:1,date:at(1),x:0,y:0}]);
  assert.equal(groups[1].length,2);assert.equal(sampleAt(groups[1],start+1000).x,150);assert.equal(sampleAt(groups[1],start-1),null);assert.equal(sampleAt(groups[1],start+20000),null);
});
test('GPS never interpolates long outages or garage teleports',()=>{
  const a=[{t:0,x:1,y:1},{t:1000,x:5000,y:5000}];assert.equal(sampleAt(a,500).x,1);
  const b=[{t:0,x:1,y:1},{t:4000,x:5,y:5}];assert.equal(sampleAt(b,2000).x,1);
});

