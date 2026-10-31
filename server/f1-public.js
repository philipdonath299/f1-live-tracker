import {cached} from './openf1.js';
import {FREE_TOPICS} from '../js/free-model.js';
const BASE='https://livetiming.formula1.com/signalrcore';
const RS='\x1e';
// A bounded, anonymous SignalR Long Polling connection for serverless hosts.
// Affinity cookies belong only to this temporary public connection.
export async function readPublicF1Snapshot(){
  const deadline=Date.now()+22000,jar=new Map();let connectionUrl;
  function cookies(response){for(const cookie of response.headers?.getSetCookie?.()||[]){const pair=cookie.split(';')[0],edge=pair.indexOf('='),name=pair.slice(0,edge);if(['AWSALB','AWSALBCORS','ARRAffinity','ARRAffinitySameSite'].includes(name))jar.set(name,pair.slice(edge+1));}}
  async function request(url,method='GET',body){
   const remaining=deadline-Date.now();if(remaining<200)throw new Error('Public F1 timing did not respond in time.');
   const headers={'User-Agent':'F1LiveTracker/2.1 (+https://github.com/philipdonath299/f1-live-tracker)'};
   if(jar.size)headers.Cookie=[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
   if(body!==undefined)headers['Content-Type']='text/plain;charset=UTF-8';
   const response=await fetch(url,{method,body,headers,signal:AbortSignal.timeout(Math.min(remaining,6000))});cookies(response);
   if(response.status===401||response.status===403)throw new Error(`F1 public timing rejected anonymous access (${response.status}).`);
   if(!response.ok)throw new Error(`F1 public timing returned ${response.status}.`);
   return response;
  }
  try{
   await request(`${BASE}/negotiate?negotiateVersion=1`,'OPTIONS');
   const negotiated=await (await request(`${BASE}/negotiate?negotiateVersion=1`,'POST')).json();
   const token=negotiated.connectionToken||negotiated.ConnectionToken;
   if(!token)throw new Error('Public F1 negotiation did not return a connection.');
   if(!negotiated.availableTransports?.some(t=>t.transport==='LongPolling'))throw new Error('F1 does not offer the public HTTP transport on this connection.');
   connectionUrl=`${BASE}?id=${encodeURIComponent(token)}`;
   await (await request(connectionUrl)).text();
   await request(connectionUrl,'POST',JSON.stringify({protocol:'json',version:1})+RS);
   let handshaken=false,snapshot;
   for(let attempt=0;attempt<5;attempt++){
    const text=await (await request(connectionUrl)).text();
    if(text.length>4000000)throw new Error('Public timing snapshot exceeded the response limit.');
    for(const part of text.split(RS)){
     if(!part.trim())continue;const message=JSON.parse(part);
     if(message.error)throw new Error('The provider rejected the public timing subscription.');
     if(!handshaken){handshaken=true;await request(connectionUrl,'POST',JSON.stringify({type:1,invocationId:'1',target:'Subscribe',arguments:[FREE_TOPICS]})+RS);}
     if(message.type===3&&message.result?.SessionInfo&&message.result?.TimingData)snapshot=message.result;
    }
    if(snapshot)return {available:true,source:'F1 public HTTP feed',snapshot,asOf:snapshot.Heartbeat?.Utc||null};
   }
   throw new Error('No public session timing has been published on this connection.');
  }catch(error){return {available:false,source:'F1 public HTTP feed',snapshot:null,asOf:null,error:error.message};}
  finally{if(connectionUrl){const headers={};if(jar.size)headers.Cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');try{await fetch(connectionUrl,{method:'DELETE',headers,signal:AbortSignal.timeout(1000)});}catch{}}}
}
export const publicF1Snapshot=()=>cached('free:f1-public-http',10000,readPublicF1Snapshot);
