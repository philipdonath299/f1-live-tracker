import {FREE_TOPICS,LiveTimingStore} from './free-model.js';
const SEPARATOR='\x1e';
export class FreeLiveClient{
  constructor({onView=()=>{},onState=()=>{},fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,now=()=>Date.now(),negotiate=true}={}){
    Object.assign(this,{onView,onState,fetchImpl,WebSocketImpl,now,negotiate});
    this.direct=new LiveTimingStore();this.community=new LiveTimingStore();this.token=0;this.stopped=true;this.health={direct:'Not connected',community:'Not connected'};
  }
  start(mode='auto'){
    this.stop();this.mode=mode;this.stopped=false;const token=++this.token;
    this.direct.reset();this.community.reset();this.attempt=0;this.health={direct:'Waiting',community:'Waiting'};
    if(mode!=='community')this.connect(token);
    if(mode!=='direct')this.poll(token);
  }
  stop(){
    this.stopped=true;this.token++;clearTimeout(this.retry);clearTimeout(this.pollTimer);clearTimeout(this.handshakeTimer);clearInterval(this.ping);
    clearTimeout(this.negotiateTimer);this.abort?.abort();this.negotiateAbort?.abort();if(this.socket){this.socket.onclose=null;this.socket.onerror=null;try{this.socket.close();}catch{}}
  }
  active(token){return !this.stopped&&token===this.token;}
  status(source,message){this.health[source]=message;this.onState({...this.health});}
  getView(){
    const now=this.now(),direct=this.direct.view(now),community=this.community.view(now);
    const options=[];
    if(this.mode!=='community'&&direct.session.session_key)options.push({...direct,source:'F1 public stream',sourceId:'direct'});
    if(this.mode!=='direct'&&community.session.session_key)options.push({...community,source:this.communityName||'Community live feed',sourceId:'community'});
    options.sort((a,b)=>Number(b.phase==='live')-Number(a.phase==='live')||(Date.parse(b.session.date_start)||0)-(Date.parse(a.session.date_start)||0)||(Date.parse(b.asOf)||0)-(Date.parse(a.asOf)||0));
    const view=options[0];if(!view)return null;
    if(view.sourceId==='direct'&&community.session.session_key===view.session.session_key){
      const fresh=rows=>rows.filter(r=>Math.abs(now-Date.parse(r.date))<12000);
      const gps=fresh(community.locations),tel=fresh(community.telemetry);
      if(!view.locations.length&&gps.length){view.locations=gps;view.gpsSource='Community live feed';}
      if(!view.telemetry.length&&tel.length)view.telemetry=tel;
    }
    return view;
  }
  emit(){const view=this.getView();if(view)this.onView(view);}
  async connect(token){
    if(!this.active(token))return;
    if(!this.WebSocketImpl){this.status('direct','WebSocket unavailable in this browser');return;}
    this.status('direct','Connecting to public timing');this.buffer='';this.handshaken=false;
    let ws,url='wss://livetiming.formula1.com/signalrcore';
    if(this.negotiate){
      this.negotiateAbort=new AbortController();this.negotiateTimer=setTimeout(()=>this.negotiateAbort.abort(),12000);
      try{
        const options={credentials:'include',signal:this.negotiateAbort.signal};
        const preflight=await this.fetchImpl('https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1',{...options,method:'OPTIONS'});
        if([401,403].includes(preflight.status)){this.status('direct','Provider restricted anonymous negotiation');return;}
        const response=await this.fetchImpl('https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1',{...options,method:'POST'});
        if(!this.active(token))return;
        if([401,403].includes(response.status)){this.status('direct','Provider restricted anonymous negotiation');return;}
        if(!response.ok)throw new Error('Direct negotiation unavailable');
        const data=await response.json(),id=data.connectionToken||data.ConnectionToken;if(!id)throw new Error('No public connection token');url+='?id='+encodeURIComponent(id);
      }catch(error){if(!this.active(token))return;this.status('direct','Direct browser negotiation unavailable; using free fallback');this.reconnect(token);return;}finally{clearTimeout(this.negotiateTimer);}
    }
    if(!this.active(token))return;
    try{ws=this.socket=new this.WebSocketImpl(url);}catch{this.reconnect(token);return;}
    this.handshakeTimer=setTimeout(()=>{if(this.active(token))ws.close();},15000);
    ws.onopen=()=>{if(this.active(token))ws.send(JSON.stringify({protocol:'json',version:1})+SEPARATOR);};
    ws.onmessage=event=>{
      this.messageQueue=(this.messageQueue||Promise.resolve()).then(async()=>{
        if(!this.active(token)||ws!==this.socket)return;
        let chunk=event.data;if(typeof chunk!=='string')chunk=typeof chunk?.text==='function'?await chunk.text():new TextDecoder().decode(chunk);
        this.receive(chunk,ws,token);
      }).catch(()=>{this.status('direct','Invalid timing message; reconnecting');ws.close();});
    };
    ws.onerror=()=>this.status('direct','Direct timing unavailable; checking free fallback');
    ws.onclose=()=>{this.direct.connected=false;this.emit();clearTimeout(this.handshakeTimer);clearInterval(this.ping);if(this.active(token))this.reconnect(token);};
  }
  reconnect(token){
    if(!this.active(token))return;this.status('direct','Direct stream disconnected');
    this.retry=setTimeout(()=>this.connect(token),Math.min(60000,5000*2**Math.min(this.attempt++,4)));
  }
  receive(chunk,ws,token){
    this.buffer+=chunk;if(this.buffer.length>4000000){ws.close();return;}
    let edge;
    while((edge=this.buffer.indexOf(SEPARATOR))>=0){
      const text=this.buffer.slice(0,edge);this.buffer=this.buffer.slice(edge+1);if(!text.trim())continue;
      const message=JSON.parse(text);
      if(!this.handshaken){
        if(message.error){this.status('direct','Public timing is restricted by the provider');this.stopDirect();return;}
        this.handshaken=true;clearTimeout(this.handshakeTimer);this.attempt=0;
        ws.send(JSON.stringify({type:1,invocationId:'1',target:'Subscribe',arguments:[FREE_TOPICS]})+SEPARATOR);
        this.ping=setInterval(()=>{if(this.active(token)&&ws.readyState===1)ws.send(JSON.stringify({type:6})+SEPARATOR);},15000);
        this.status('direct','Connected; awaiting timing data');continue;
      }
      if(message.type===3){
        if(message.error){this.status('direct','The provider did not allow public timing');this.stopDirect();return;}
        if(message.result&&typeof message.result==='object')this.direct.snapshot(message.result,message.result.Heartbeat?.Utc);
      }else if(message.type===1&&String(message.target).toLowerCase()==='feed'){
        const [topic,patch,timestamp]=message.arguments||[];if(FREE_TOPICS.includes(topic))this.direct.update(topic,patch,timestamp);
      }else if(message.type===6){if(ws.readyState===1)ws.send(JSON.stringify({type:6})+SEPARATOR);continue;}
      else if(message.type===7){this.status('direct',message.error?'Provider closed public timing':'Stream reconnecting');ws.close();return;}
      else continue;
      this.direct.connected=true;
      if(this.direct.topics.TimingData?.Lines)this.status('direct','Receiving public timing');this.emit();
    }
  }
  stopDirect(){clearInterval(this.ping);clearTimeout(this.handshakeTimer);if(this.socket){this.socket.onclose=null;this.socket.close();}}
  async poll(token){
    if(!this.active(token))return;this.abort=new AbortController();let delay=12000;
    try{
      const response=await this.fetchImpl('/api/f1?action=free-live',{signal:this.abort.signal});
      if(!this.active(token))return;
      const result=await response.json();if(!response.ok||!result.available||!result.snapshot)throw new Error(result.error||'Community feed not available');
      this.communityName=result.source||'Community live feed';this.community.snapshot(result.snapshot,result.asOf);const phase=this.community.view(this.now()).phase;
      this.status('community',phase==='live'?'Receiving free timing':phase==='complete'?'Last session completed':phase==='stale'?'Snapshot is stale':'Waiting for an active session');this.emit();
    }catch(error){if(!this.active(token)||error.name==='AbortError')return;this.status('community',error.message||'Community feed unavailable');delay=20000;}
    finally{if(this.active(token))this.pollTimer=setTimeout(()=>this.poll(token),delay);}
  }
}
