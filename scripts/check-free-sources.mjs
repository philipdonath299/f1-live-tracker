import {FreeLiveClient} from '../js/free-live.js';
import {communitySnapshot,freeCalendar} from '../server/free-sources.js';
const direct=new Promise(resolve=>{
  let done=false;
  const finish=result=>{if(done)return;done=true;clearTimeout(timeout);client.stop();resolve(result);};
  const client=new FreeLiveClient({onView:view=>{if(view.rows.some(row=>row.position!==null||row.lastLap!==null))finish({source:'F1 public stream',phase:view.phase,session:view.session.session_name,asOf:view.asOf,drivers:view.rows.length});},onState:health=>{if(/restricted|did not allow/.test(health.direct))finish({source:'F1 public stream',available:false,reason:health.direct});}});
  const timeout=setTimeout(()=>finish({source:'F1 public stream',available:false,reason:client.health.direct}),18000);
  client.start('direct');
});
const results=await Promise.allSettled([
 direct,
 communitySnapshot().then(data=>({source:data.source,available:data.available,asOf:data.asOf,session:data.snapshot?.session?.Name,error:data.error})),
 freeCalendar(new Date().getUTCFullYear()).then(data=>({source:'Jolpica',available:true,sessions:data.sessions.length}))
]);
for(let index=0;index<results.length;index++){const result=results[index];console.log(JSON.stringify(result.status==='fulfilled'?result.value:{source:['F1 public stream','Community live feed','Jolpica'][index],available:false,error:result.reason?.message}));}
console.log('Provider diagnostics only. A connection is not a guarantee of live GPS or a complete live session.');
