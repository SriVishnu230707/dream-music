import {useEffect,useRef,useState} from 'react'

type Mood={valence:number;arousal:number;source?:'manual'|'text-model'|'user-corrected';confidence?:number}
type QueueItem={position:number;trackId:string;pathPoint:{valence:number;arousal:number};reason:string}
type Session={sessionId:string;queue:QueueItem[];currentIndex:number;status:'ready'|'active'|'completed';revision:number}
type Track={id:string;title:string;artist:string;genre:string;durationSeconds:number;attribution:string;audioUrl:string}
type Prediction={suggestedMood:{valence:number;arousal:number}|null;confidence:number|null;needsManualSelection:boolean;reason:string|null}

async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'})
 const data=await response.json()
 if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`)
 return data as T
}

export default function App(){
 const [tracks,setTracks]=useState<Record<string,Track>>({})
 const [session,setSession]=useState<Session|null>(null)
 const [userId,setUserId]=useState('local-listener')
 const [checkIn,setCheckIn]=useState('')
 const [start,setStart]=useState<Mood>({valence:0.3,arousal:0.3,source:'manual'})
 const [target,setTarget]=useState<Mood>({valence:0.7,arousal:0.5})
 const [count,setCount]=useState(5)
 const [prediction,setPrediction]=useState<Prediction|null>(null)
 const [moodConfirmed,setMoodConfirmed]=useState(true)
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 const [playing,setPlaying]=useState(false)
 const [progress,setProgress]=useState(0)
 const audio=useRef<HTMLAudioElement>(null)
 const advancing=useRef(false)

 useEffect(()=>{
  api<{tracks:Track[]}>('/api/v1/catalog').then(data=>setTracks(Object.fromEntries(data.tracks.map(t=>[t.id,t])))).catch(e=>setMessage(e.message))
  const id=new URLSearchParams(window.location.search).get('session')||localStorage.getItem('mood-drift-session')
  if(id)api<Session>(`/api/v1/sessions/${encodeURIComponent(id)}`).then(setSession).catch(()=>{localStorage.removeItem('mood-drift-session');setMessage('Saved session could not be restored. Start a new one.')})
 },[])

 const current=session?.queue[session.currentIndex]
 const currentTrack=current&&tracks[current.trackId]
 async function suggest(){
  if(!checkIn.trim()){setMessage('Write a check-in or set your mood manually.');return}
  setBusy(true);setMessage('')
  try{const result=await api<Prediction>('/api/v1/mood/predict','POST',{text:checkIn});setPrediction(result);setMoodConfirmed(false)
   if(result.suggestedMood){setStart({...result.suggestedMood,source:'text-model',confidence:result.confidence??undefined})}
   else setMessage('No clear suggestion. Please choose your mood manually.')
  }catch(e){setMessage(`${(e as Error).message} Manual mood selection is available.`)}finally{setBusy(false)}
 }
 async function create(){
  setBusy(true);setMessage('')
  try{const data=await api<Session>('/api/v1/sessions','POST',{userId:userId.trim(),startMood:start,targetMood:{valence:target.valence,arousal:target.arousal},trackCount:count,taste:{preferredGenres:[],likedTrackIds:[]}})
   setSession(data);localStorage.setItem('mood-drift-session',data.sessionId);history.replaceState(null,'',`?session=${encodeURIComponent(data.sessionId)}`);setPlaying(false);setProgress(0)
  }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
 }
 async function advance(action:'skip'|'complete'){
  if(!session||advancing.current)return
  advancing.current=true;setBusy(true)
  audio.current?.pause();setPlaying(false)
  try{const data=await api<Session>(`/api/v1/sessions/${encodeURIComponent(session.sessionId)}/advance`,'POST',{expectedRevision:session.revision,action});setSession(data);setProgress(0)}
  catch(e){setMessage((e as Error).message);try{setSession(await api<Session>(`/api/v1/sessions/${encodeURIComponent(session.sessionId)}`))}catch{}}
  finally{advancing.current=false;setBusy(false)}
 }
 async function toggle(){
  if(!audio.current)return
  if(playing){audio.current.pause();setPlaying(false);return}
  try{await audio.current.play();setPlaying(true);setMessage('')}catch{setMessage('Playback was blocked or audio is unavailable. Press Play again or skip this track.')}
 }
 function moodControl(label:string,value:Mood,onChange:(m:Mood)=>void,source=false){return <fieldset><legend>{label}</legend>
  {(['valence','arousal'] as const).map(key=><label key={key}>{key==='valence'?'Valence (low → positive)':'Arousal (calm → energetic)'} <strong>{value[key].toFixed(2)}</strong><input aria-label={`${label} ${key}`} type="range" min="0" max="1" step="0.01" value={value[key]} onChange={e=>onChange({...value,[key]:Number(e.target.value),...(source?{source:'user-corrected' as const,confidence:undefined}:{})})}/></label>)}
 </fieldset>}
 return <main><header><span className="eyebrow">MOOD DRIFT MUSIC · LOCAL DEMO</span><h1>A listening path for this moment</h1><p>Choose where you are and where you want the music to lead. Mood values are suggestions, not a measure of your feelings.</p></header>
  {message&&<div role="alert" className="notice">{message}</div>}
  {!session&&<section className="panel setup"><h2>Start a session</h2><label>Listener name<input value={userId} maxLength={128} onChange={e=>setUserId(e.target.value)}/></label>
   <label>Optional check-in<textarea value={checkIn} maxLength={1000} placeholder="How does this moment feel?" onChange={e=>setCheckIn(e.target.value)}/></label>
   <button type="button" className="secondary" disabled={busy} onClick={suggest}>Suggest a starting mood</button>
   {prediction&&<p className="hint">{prediction.suggestedMood?`Suggestion ready${prediction.needsManualSelection?' — review it carefully':''}. Confirm the starting mood before creating a session.`:'Use the sliders to select a starting mood.'}</p>}
   {moodControl('Starting mood',start,m=>{setStart(m);setMoodConfirmed(false)},true)}
   {!moodConfirmed&&<button type="button" className="secondary" onClick={()=>setMoodConfirmed(true)}>Confirm starting mood</button>}
   {moodControl('Target mood',target,setTarget)}
   <label>Number of tracks <strong>{count}</strong><input type="range" min="1" max="12" value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
   <button type="button" disabled={busy||!userId.trim()||!moodConfirmed} onClick={create}>Create listening path</button><p className="hint">Check-in text is sent to the local mood service only when you request a suggestion. It is not stored with the session.</p>
  </section>}
  {session&&<section className="panel player"><div className="row"><div><span className="eyebrow">YOUR SESSION</span><h2>{session.status==='completed'?'Session complete':currentTrack?.title||'Loading track'}</h2><p>{session.status==='completed'?'You reached the end of this listening path.':`${currentTrack?.artist||''} · ${currentTrack?.genre||''}`}</p></div><span className="badge">{Math.min(session.currentIndex+1,session.queue.length)} / {session.queue.length}</span></div>
   {session.status!=='completed'&&current&&<><audio ref={audio} key={current.trackId} src={currentTrack?.audioUrl||`/audio/${current.trackId}`} preload="metadata" onEnded={()=>void advance('complete')} onTimeUpdate={e=>setProgress(e.currentTarget.currentTime)} onError={()=>{setPlaying(false);setMessage('Audio could not be loaded. Retry Play or skip this track.')}}/><div className="controls"><button onClick={toggle} disabled={busy}>{playing?'Pause':'Play'}</button><button className="secondary" onClick={()=>void advance('skip')} disabled={busy}>Skip</button><span aria-live="polite">{Math.floor(progress)}s / {currentTrack?.durationSeconds||'…'}s</span></div><p className="hint">{currentTrack?.attribution}</p></>}
   <ol className="queue">{session.queue.map((item,i)=><li key={item.trackId} className={i===session.currentIndex?'current':i<session.currentIndex?'past':''}><strong>{tracks[item.trackId]?.title||item.trackId}</strong><span>{i<session.currentIndex?'Played':i===session.currentIndex&&session.status!=='completed'?'Now playing':'Up next'} · {item.reason}</span></li>)}</ol>
   <button className="text" onClick={()=>{audio.current?.pause();localStorage.removeItem('mood-drift-session');history.replaceState(null,'',window.location.pathname);setSession(null);setPlaying(false)}}>Start another session</button>
  </section>}
  <footer>Original synthesized demo audio. Track mood coordinates are design proxies and make no therapeutic claim.</footer></main>
}
