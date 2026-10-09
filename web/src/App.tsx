import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_MAP, LONG_CATALOG_TRACKS, type Track } from './data/catalog';
import { buildTasteProfile, planJourney, type ListeningRecord, type MoodPoint } from './data/plan';

type View = 'journey' | 'discover' | 'liked';
type Journey = { queue: string[]; index: number; status: 'ready' | 'active' | 'completed' };
type Mood = MoodPoint & { source?: 'manual' | 'text-model' | 'local-estimate' };
const DEFAULT_START: Mood = { valence: 0.3, arousal: 0.32 };
const DEFAULT_TARGET: Mood = { valence: 0.75, arousal: 0.48 };

function storedLikes(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem('mooddrift-likes-v2') || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id in CATALOG_MAP) : []; }
  catch { return []; }
}
function storedListens(): ListeningRecord[] {
  try { const value: unknown = JSON.parse(localStorage.getItem('mooddrift-listens-v2') || '[]'); return Array.isArray(value) ? value.filter((entry): entry is ListeningRecord => entry && typeof entry.trackId === 'string' && entry.trackId in CATALOG_MAP && Number.isFinite(entry.listenedSeconds) && typeof entry.completed === 'boolean').slice(-300) : []; }
  catch { return []; }
}
function makeQueue(start: MoodPoint, target: MoodPoint, count: number, records: ListeningRecord[], likes: string[], excluded: ReadonlySet<string> = new Set()): string[] {
  const taste = buildTasteProfile(LONG_CATALOG_TRACKS, records, new Set(likes));
  return planJourney(LONG_CATALOG_TRACKS, start, target, count, 'All', excluded, taste).map((item) => item.trackId);
}
function time(seconds: number): string { const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0; return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
function moodName(mood: MoodPoint): string {
  if (mood.arousal < 0.38) return mood.valence < 0.45 ? 'Reflective' : 'Calm';
  if (mood.arousal > 0.68) return mood.valence < 0.45 ? 'Intense' : 'Energized';
  return mood.valence < 0.45 ? 'Focused' : 'Bright';
}
function localMood(text: string): MoodPoint {
  const words = text.toLowerCase();
  if (/sad|lonely|down|rain|tired|anxious/.test(words)) return { valence: 0.25, arousal: 0.27 };
  if (/calm|peace|relax|sleep|quiet|soft/.test(words)) return { valence: 0.62, arousal: 0.22 };
  if (/dance|hype|party|excited|energy|workout/.test(words)) return { valence: 0.82, arousal: 0.85 };
  return { valence: 0.58, arousal: 0.48 };
}

export default function App() {
  const [view, setView] = useState<View>('journey');
  const [start, setStart] = useState<Mood>(DEFAULT_START);
  const [target, setTarget] = useState<Mood>(DEFAULT_TARGET);
  const [sessionMood, setSessionMood] = useState<Mood>(DEFAULT_START);
  const [count, setCount] = useState(6);
  const [journey, setJourney] = useState<Journey>(() => ({ queue: makeQueue(DEFAULT_START, DEFAULT_TARGET, 6, [], []), index: 0, status: 'ready' }));
  const [likes, setLikes] = useState<string[]>(storedLikes);
  const [listens, setListens] = useState<ListeningRecord[]>(storedListens);
  const [moodText, setMoodText] = useState('');
  const [moodMessage, setMoodMessage] = useState('Set the mood. We will shape the sound.');
  const [busyMood, setBusyMood] = useState(false);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('All sounds');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const playRequestedRef = useRef(false);
  const verifiedRef = useRef(false);
  const rejectedRef = useRef(new Set<string>());
  const listenedRef = useRef(0);
  const lastPositionRef = useRef<number | null>(null);
  const lastSampleRef = useRef<number | null>(null);
  const journeyRef = useRef(journey);
  journeyRef.current = journey;
  const currentTrack = CATALOG_MAP[journey.queue[journey.index]] || LONG_CATALOG_TRACKS[0];
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;

  useEffect(() => { try { localStorage.setItem('mooddrift-likes-v2', JSON.stringify(likes)); } catch { /* Playback works without local storage. */ } }, [likes]);
  useEffect(() => { try { localStorage.setItem('mooddrift-listens-v2', JSON.stringify(listens.slice(-300))); } catch { /* Playback works without local storage. */ } }, [listens]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause(); audio.src = currentTrack.audioUrl; audio.load();
    verifiedRef.current = false; listenedRef.current = 0; lastPositionRef.current = null; lastSampleRef.current = null;
    setPlaying(false); setLoading(playRequestedRef.current); setPosition(0); setDuration(currentTrack.durationSeconds); setError('');
  }, [currentTrack.id]);
  useEffect(() => { if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; } }, [volume, muted]);

  const genres = useMemo(() => ['All sounds', ...new Set(LONG_CATALOG_TRACKS.map((track) => track.genre))], []);
  const visibleTracks = useMemo(() => LONG_CATALOG_TRACKS.filter((track) => (genre === 'All sounds' || track.genre === genre) && (!search.trim() || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(search.trim().toLowerCase()))), [genre, search]);
  const queueTracks = journey.queue.map((id) => CATALOG_MAP[id]).filter((track): track is Track => Boolean(track));
  const totalMinutes = Math.round(queueTracks.reduce((sum, track) => sum + track.durationSeconds, 0) / 60);
  const liked = likes.includes(currentTrack.id);

  function recordListen(completed: boolean): ListeningRecord[] {
    const next = [...listens, { trackId: currentTrackRef.current.id, listenedSeconds: Math.max(0, listenedRef.current), completed }].slice(-300);
    setListens(next); return next;
  }
  function requestPlayback() {
    const audio = audioRef.current; if (!audio) return;
    playRequestedRef.current = true; setLoading(true); setError('');
    if (verifiedRef.current) void audio.play().catch(() => { playRequestedRef.current = false; setLoading(false); setError('Browser playback was blocked. Press Play to retry.'); });
    else if (audio.readyState === 0) audio.load();
  }
  function pausePlayback() { playRequestedRef.current = false; audioRef.current?.pause(); setLoading(false); }
  function moveTo(index: number, autoplay = true) {
    const active = journeyRef.current; if (index < 0 || index >= active.queue.length) return;
    if (index !== active.index) recordListen(false);
    playRequestedRef.current = autoplay;
    setJourney({ ...active, index, status: 'active' });
    if (index === active.index && autoplay) requestPlayback();
  }
  function audioFailure(message: string) {
    const failed = currentTrackRef.current; if (rejectedRef.current.has(failed.id)) return;
    rejectedRef.current.add(failed.id);
    const active = journeyRef.current;
    const next = active.queue.findIndex((id, index) => index > active.index && !rejectedRef.current.has(id));
    if (next >= 0) { playRequestedRef.current = true; setJourney({ ...active, index: next, status: 'active' }); setMoodMessage(`${failed.title} is unavailable. Trying the next full track.`); }
    else { playRequestedRef.current = false; setPlaying(false); setLoading(false); setError(`${message} Choose another track or build a new journey.`); }
  }
  function loadedMetadata() {
    const audio = audioRef.current; if (!audio) return;
    if (!Number.isFinite(audio.duration) || audio.duration < 240) { audioFailure('The source did not provide a full four-minute track.'); return; }
    verifiedRef.current = true; setDuration(audio.duration);
    if (playRequestedRef.current) requestPlayback(); else setLoading(false);
  }
  function timeUpdate() {
    const audio = audioRef.current; if (!audio) return;
    const now = performance.now(); const current = audio.currentTime;
    if (lastPositionRef.current !== null && lastSampleRef.current !== null && !audio.paused) {
      const delta = current - lastPositionRef.current; const wall = (now - lastSampleRef.current) / 1000;
      if (delta > 0) listenedRef.current += Math.min(delta, wall + 0.5);
    }
    lastPositionRef.current = current; lastSampleRef.current = now; setPosition(current);
  }
  function ended() {
    const finished = currentTrackRef.current;
    const updatedRecords = recordListen(true);
    setSessionMood({ ...finished.mood, source: 'manual' });
    const active = journeyRef.current; const nextIndex = active.index + 1;
    if (nextIndex >= active.queue.length) { playRequestedRef.current = false; setPlaying(false); setJourney({ ...active, status: 'completed' }); setMoodMessage('Journey complete. Build another path when you are ready.'); return; }
    let queue = active.queue;
    try {
      const locked = active.queue.slice(0, nextIndex);
      const excluded = new Set([...locked, ...rejectedRef.current]);
      queue = [...locked, ...makeQueue(finished.mood, target, active.queue.length - nextIndex, updatedRecords, likes, excluded)];
    } catch { /* Keep the remaining queue if the catalog cannot supply a new path. */ }
    playRequestedRef.current = true; setJourney({ queue, index: nextIndex, status: 'active' });
    setMoodMessage('This song ended. The next step now reflects your listening time and taste.');
  }
  function playCatalogTrack(track: Track) {
    const active = journeyRef.current;
    if (track.id !== currentTrack.id) recordListen(false);
    const existing = active.queue.indexOf(track.id);
    const queue = existing >= 0 ? active.queue : [...active.queue.slice(0, active.index + 1), track.id, ...active.queue.slice(active.index + 1).filter((id) => id !== track.id)];
    playRequestedRef.current = true; setJourney({ queue, index: existing >= 0 ? existing : active.index + 1, status: 'active' }); setView('journey');
    if (track.id === currentTrack.id) requestPlayback();
  }
  function toggleLike(id: string) { setLikes((before) => before.includes(id) ? before.filter((item) => item !== id) : [...before, id]); }
  async function detectMood() {
    if (!moodText.trim()) return; setBusyMood(true);
    try {
      const response = await fetch('/api/v1/mood/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: moodText.trim().slice(0, 500) }) });
      if (!response.ok) throw new Error('Mood service unavailable');
      const prediction = await response.json() as { suggestedMood?: MoodPoint };
      const mood = prediction.suggestedMood;
      if (!mood || ![mood.valence, mood.arousal].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Invalid mood');
      setStart({ ...mood, source: 'text-model' }); setMoodMessage(`Detected ${moodName(mood).toLowerCase()} from your check-in. Adjust the dials if needed.`);
    } catch {
      const mood = localMood(moodText); setStart({ ...mood, source: 'local-estimate' }); setMoodMessage(`Suggested ${moodName(mood).toLowerCase()} locally. Adjust the dials if needed.`);
    } finally { setBusyMood(false); }
  }
  function buildJourney() {
    try {
      audioRef.current?.pause(); playRequestedRef.current = false;
      const queue = makeQueue(start, target, count, listens, likes, rejectedRef.current);
      setJourney({ queue, index: 0, status: 'ready' }); setSessionMood(start); setView('journey'); setError(''); setMoodMessage('New journey ready. Press Play to begin.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a journey.'); }
  }

  return <div className="app-shell">
    <audio ref={audioRef} preload="metadata" onLoadedMetadata={loadedMetadata} onTimeUpdate={timeUpdate} onEnded={ended} onPlay={() => { setPlaying(true); setLoading(false); setError(''); }} onPause={() => setPlaying(false)} onError={() => audioFailure('The audio source is unavailable.')} onSeeked={() => { lastPositionRef.current = audioRef.current?.currentTime ?? null; lastSampleRef.current = performance.now(); }} />
    <aside className="sidebar">
      <button className="brand" onClick={() => setView('journey')}><span className="brand-mark">◈</span><span><strong>mooddrift</strong><small>LISTEN IN MOTION</small></span></button>
      <div className="side-label">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation"><button className={view === 'journey' ? 'active' : ''} onClick={() => setView('journey')}><span>◈</span> Journey <b>{journey.queue.length}</b></button><button className={view === 'discover' ? 'active' : ''} onClick={() => setView('discover')}><span>◎</span> Discover</button><button className={view === 'liked' ? 'active' : ''} onClick={() => setView('liked')}><span>♡</span> Liked tracks <b>{likes.length}</b></button></nav>
      <div className="side-rule" /><div className="side-label">NOW IN ROTATION</div>
      <button className="side-current" onClick={() => setView('journey')}><img src={currentTrack.artworkUrl} alt="" /><span><strong>{currentTrack.title}</strong><small>{currentTrack.artist}</small></span><i /></button>
      <div className="side-bottom"><div className="source-mark"><span>↗</span><div><strong>One source. Full songs.</strong><small>Internet Archive · CC BY 4.0</small></div></div><p>Independent music, credited to its creators. No previews or account needed.</p></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">YOUR SPACE <span>/</span> {view === 'journey' ? 'CURRENT JOURNEY' : view === 'discover' ? 'DISCOVER' : 'LIKED TRACKS'}</div><div className="top-actions"><span className="live-pill"><i /> FULL-TRACK AUDIO</span><span className="profile-pill"><span>Local listener</span></span></div></header>
    {view === 'journey' ? <>
      <section className="intro"><div><span className="eyebrow">YOUR LISTENING SPACE <span className="eyebrow-line" /></span><h1>Music that <em>moves</em><br />with you.</h1><p>Start where you are. Drift toward where you want to be.</p><button className="intro-action" onClick={() => document.getElementById('mood-builder')?.scrollIntoView({ behavior: 'smooth' })}>Set your mood <span>↗</span></button></div><div className="session-stat"><span>YOUR JOURNEY</span><strong>{journey.index + 1}<small> / {journey.queue.length}</small></strong><span>SONGS IN YOUR PATH</span></div></section>
      <section className={`hero-card ${playing ? 'is-playing' : ''}`}><div className="hero-glow" /><div className="album-stage"><div className="album-rings" /><img src={currentTrack.artworkUrl} alt={`${currentTrack.album} artwork`} /><div className="album-center" /></div><div className="hero-copy"><div className="hero-kicker"><span className="status-dot" /> {playing ? 'NOW PLAYING' : loading ? 'LOADING SONG' : 'READY TO LISTEN'} <span className="hero-divider">/</span> SONG {String(journey.index + 1).padStart(2, '0')} OF {String(journey.queue.length).padStart(2, '0')}</div><h2>{currentTrack.title}</h2><p className="hero-artist">{currentTrack.artist}</p><div className="hero-tags"><span>{currentTrack.genre}</span><span>{time(duration || currentTrack.durationSeconds)} full track</span><span>{moodName(currentTrack.mood)}</span></div><p className="hero-desc">{journey.status === 'completed' ? 'Your journey is complete.' : 'Chosen for your mood. The next song adapts after this one ends.'}</p><div className="hero-buttons"><button className="primary-play" onClick={playing ? pausePlayback : requestPlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'} <span>{playing ? 'Pause track' : loading ? 'Loading track…' : 'Play track'}</span></button><button className="next-action" onClick={() => moveTo(journey.index + 1)} disabled={journey.index >= journey.queue.length - 1} aria-label="Skip to next song">Next song →</button><button className={`like-action ${liked ? 'liked' : ''}`} onClick={() => toggleLike(currentTrack.id)} aria-label={liked ? 'Unlike track' : 'Like track'}>♡</button></div><div className="credits-row"><a className="source-link" href={currentTrack.sourceUrl} target="_blank" rel="noopener noreferrer">Track & credits ↗</a><a className="source-link" href={currentTrack.licenseUrl} target="_blank" rel="noopener noreferrer">CC BY 4.0 ↗</a></div></div><div className="hero-index">{String(journey.index + 1).padStart(2, '0')}</div></section>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="content-grid"><section className="queue-panel"><div className="section-heading"><div><span className="eyebrow">THE FLOW</span><h3>Your journey</h3></div><span className="section-meta">{journey.queue.length} TRACKS · ~{totalMinutes} MIN</span></div><div className="queue-head"><span>#</span><span>TRACK</span><span>MOOD</span><span>TIME</span></div><div className="queue-list">{queueTracks.map((track, index) => <div className={`queue-row ${index === journey.index ? 'current' : ''}`} key={`${track.id}-${index}`}><button className="queue-index" onClick={() => moveTo(index)} aria-label={`Play ${track.title}`}>{index === journey.index && playing ? '♫' : String(index + 1).padStart(2, '0')}</button><button className="queue-track" onClick={() => moveTo(index)}><img src={track.artworkUrl} alt="" /><span><strong>{track.title}</strong><small>{track.artist}</small></span></button><span className="queue-mood">{moodName(track.mood)}</span><span className="queue-duration">{time(track.durationSeconds)}</span></div>)}</div></section><aside className="mood-panel"><div className="section-heading"><div><span className="eyebrow">THE COMPASS</span><h3>Your mood arc</h3></div><span className="mood-icon">✧</span></div><div className="mood-arc"><div className="arc-line" /><div className="arc-point"><i /><span>START<small>{moodName(start)}</small></span></div><div className="arc-point now"><i /><span>NOW<small>{moodName(sessionMood)}</small></span></div><div className="arc-point end"><i /><span>DESTINATION<small>{moodName(target)}</small></span></div></div><p className="mood-note">{moodMessage}</p><button className="mood-edit" onClick={() => document.getElementById('mood-builder')?.scrollIntoView({ behavior: 'smooth' })}>Shape a new journey <span>↗</span></button></aside></div>
      <section className="builder-panel" id="mood-builder"><div className="section-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h3>Shape your next journey</h3></div><span className="section-meta">MOOD → MUSIC</span></div><div className="builder-grid"><div className="checkin"><label htmlFor="mood-text">HOW ARE YOU FEELING?</label><div className="text-entry"><input id="mood-text" value={moodText} onChange={(event) => setMoodText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void detectMood(); }} maxLength={500} placeholder="A little tired, but ready to feel lighter…" /><button onClick={() => void detectMood()} disabled={busyMood || !moodText.trim()}>{busyMood ? 'Checking…' : 'Detect mood ↗'}</button></div><small>Or set the dials yourself. Your words are used only for the mood check.</small></div><div className="dial-group"><div className="dial-title">STARTING POINT <strong>{moodName(start)}</strong></div><label>Valence <span>{Math.round(start.valence * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={start.valence} onChange={(event) => setStart({ ...start, valence: Number(event.target.value), source: 'manual' })} /></label><label>Energy <span>{Math.round(start.arousal * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={start.arousal} onChange={(event) => setStart({ ...start, arousal: Number(event.target.value), source: 'manual' })} /></label></div><div className="dial-group"><div className="dial-title">DESTINATION <strong>{moodName(target)}</strong></div><label>Valence <span>{Math.round(target.valence * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={target.valence} onChange={(event) => setTarget({ ...target, valence: Number(event.target.value), source: 'manual' })} /></label><label>Energy <span>{Math.round(target.arousal * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={target.arousal} onChange={(event) => setTarget({ ...target, arousal: Number(event.target.value), source: 'manual' })} /></label></div></div><div className="builder-footer"><div className="count-select"><label htmlFor="track-count">JOURNEY LENGTH</label><select id="track-count" value={count} onChange={(event) => setCount(Number(event.target.value))}>{[4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} songs</option>)}</select></div><div className="presets"><button onClick={() => setTarget({ valence: 0.72, arousal: 0.2 })}>Unwind</button><button onClick={() => setTarget({ valence: 0.78, arousal: 0.5 })}>Lift me up</button><button onClick={() => setTarget({ valence: 0.86, arousal: 0.82 })}>Energize</button></div><button className="create-button" onClick={buildJourney}>Create journey <span>↗</span></button></div></section>
    </> : <section className="library-view"><div className="library-intro"><span className="eyebrow">{view === 'liked' ? 'YOUR COLLECTION' : 'EXPLORE THE ARCHIVE'}</span><h1>{view === 'liked' ? 'The ones you love.' : 'Find your frequency.'}</h1><p>{view === 'liked' ? 'Tracks you saved for another listen.' : 'Independent full-length instrumentals. One source, endless room to drift.'}</p></div><div className="library-tools"><div className="search-box">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tracks or artists" aria-label="Search tracks or artists" /></div><select value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filter by genre">{genres.map((item) => <option key={item}>{item}</option>)}</select><span>{view === 'liked' ? likes.length : visibleTracks.length} TRACKS</span></div><div className="track-grid">{visibleTracks.filter((track) => view !== 'liked' || likes.includes(track.id)).map((track) => <article className="track-card" key={track.id}><button className="card-art" onClick={() => playCatalogTrack(track)} aria-label={`Play ${track.title}`}><img src={track.artworkUrl} alt="" /><span>▶</span></button><div className="card-topline"><span>{track.genre.toUpperCase()}</span><span>{time(track.durationSeconds)}</span></div><h3>{track.title}</h3><p>{track.artist}</p><div className="card-footer"><span>{moodName(track.mood)}</span><button className={likes.includes(track.id) ? 'liked' : ''} onClick={() => toggleLike(track.id)} aria-label={likes.includes(track.id) ? `Unlike ${track.title}` : `Like ${track.title}`}>♡</button></div></article>)}</div>{view === 'liked' && likes.length === 0 && <div className="empty-state"><span>♫</span><h3>Your collection starts here.</h3><p>Tap the heart on a track to save it.</p><button onClick={() => setView('discover')}>Discover music ↗</button></div>}</section>}
    </main>
    <footer className="player-bar"><div className="player-track"><img src={currentTrack.artworkUrl} alt="" /><div><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></div><button className={liked ? 'liked' : ''} onClick={() => toggleLike(currentTrack.id)} aria-label={liked ? 'Unlike current track' : 'Like current track'}>♡</button></div><div className="player-center"><div className="player-buttons"><button onClick={() => moveTo(journey.index - 1)} disabled={journey.index === 0} aria-label="Previous track">Ⅰ◀</button><button className="player-main-button" onClick={playing ? pausePlayback : requestPlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button><button onClick={() => moveTo(journey.index + 1)} disabled={journey.index >= journey.queue.length - 1} aria-label="Next track">▶Ⅰ</button></div><div className="timeline"><span>{time(position)}</span><input type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(position, duration || 1)} onChange={(event) => { if (verifiedRef.current && audioRef.current) { audioRef.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }} aria-label="Playback progress" /><span>{time(duration || currentTrack.durationSeconds)}</span></div></div><div className="player-end"><span className="quality-pill">● FULL LENGTH</span><button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '◌' : '◖))'}</button><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" /></div></footer>
  </div>;
}
