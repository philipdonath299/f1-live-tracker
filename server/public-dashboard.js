import {cached} from './openf1.js';
// This public dashboard documents a /ws endpoint carrying complete timing states.
export function publicDashboardSnapshot(){
 return cached('free:public-dashboard-ws',8000,()=>new Promise(resolve=>{
  let socket,settled=false;
  const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);if(socket){socket.onclose=null;socket.onerror=()=>{};try{socket.close();}catch{}}resolve(result);};
  const unavailable=message=>finish({available:false,source:'F1Dash public WebSocket',snapshot:null,asOf:null,error:message});
  const timer=setTimeout(()=>unavailable('The public dashboard did not publish an active session snapshot.'),10000);
  try{
   socket=new WebSocket('wss://dash.f1.pesaventofilippo.com/ws');
   socket.onerror=()=>unavailable('The public dashboard WebSocket is unavailable.');
   socket.onclose=()=>unavailable('The public dashboard disconnected.');
   socket.onmessage=async event=>{
    try{
     const text=typeof event.data==='string'?event.data:await event.data.text();if(text.length>6000000){unavailable('The public snapshot was too large.');return;}
     const raw=JSON.parse(text);if(!raw.SessionInfo||!raw.TimingData?.Lines)return;
     if(Array.isArray(raw.CarData?.Entries))raw.CarData={Entries:raw.CarData.Entries.slice(-8)};
     if(Array.isArray(raw.Position?.Position))raw.Position={Position:raw.Position.Position.slice(-8)};
     finish({available:true,source:'F1Dash public WebSocket',snapshot:raw,asOf:raw.Heartbeat?.Utc||null});
    }catch{/* Ignore incomplete frames; the bounded connection will close. */}
   };
  }catch(error){unavailable(error.message);}
 }));
}
