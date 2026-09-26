import {
  useEffect,
  useRef,
  useState,
  useMemo,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  CATALOG_MAP,
  CATALOG_TRACKS,
  type Track,
  getTrackSpotifyId,
  getSpotifySearchUrl,
} from "./data/catalog";

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

// Types
export type Mood = {
  valence: number;
  arousal: number;
  source?: "manual" | "text-model" | "user-corrected";
  confidence?: number;
};

export type QueueItem = {
  position: number;
  trackId: string;
  pathPoint: { valence: number; arousal: number };
  trackMood: { valence: number; arousal: number };
  reason: string;
};

export type Session = {
  sessionId: string;
  queue: QueueItem[];
  currentIndex: number;
  status: "ready" | "active" | "completed";
  revision: number;
  retentionDays: number;
  expiresAt: string;
  lastCheckIn?: Mood;
};

export type PlaybackEvent = "start" | "skip" | "complete" | "replay" | "like";

export type AuditEvent = {
  eventId: string;
  trackId: string;
  type: PlaybackEvent;
  occurredAt: string;
  acceptedAt: string;
};

export type AuditCheckIn = { id: string; mood: Mood; createdAt: string };

export type EventResult = {
  accepted: boolean;
  revision: number;
  queueChanged: boolean;
  futureReplanned: boolean;
  session: Session;
};

export type Prediction = {
  suggestedMood: { valence: number; arousal: number } | null;
  confidence: number | null;
  needsManualSelection: boolean;
  reason: string | null;
};

// Initial default session with authentic Tamil & English songs
function createDefaultSession(): Session {
  // Always resolves and ends in pure Melody (Munbe Vaa)
  const initialTrackIds = [
    "tamil-4-arabic-kuthu-halamithi-habibo", // High energy opening
    "eng-1-blinding-lights",                 // Pop momentum
    "eng-12-levitating",                     // Dance transition
    "tamil-8-kadhale-kadhale",               // Emotional depth
    "eng-17-viva-la-vida",                   // Symphonic glide
    "tamil-1-munbe-vaa",                     // Pure timeless Melody destination!
  ];

  const queue: QueueItem[] = initialTrackIds.map((id, idx) => {
    const t = CATALOG_MAP[id] || CATALOG_TRACKS[idx];
    const isDestination = idx === initialTrackIds.length - 1;
    return {
      position: idx + 1,
      trackId: t.id,
      pathPoint: t.mood || { valence: 0.5, arousal: 0.5 },
      trackMood: t.mood || { valence: 0.5, arousal: 0.5 },
      reason:
        idx === 0
          ? `Opening energy: ${t.genre}`
          : isDestination
          ? `🎯 Drift Resolution: Pure Melody (${t.title} · ${t.genre})`
          : `Drift transition ${idx + 1} (${t.language}): ${t.title}`,
    };
  });

  return {
    sessionId: "default-journey",
    queue,
    currentIndex: 0,
    status: "ready",
    revision: 1,
    retentionDays: 7,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    lastCheckIn: queue[0].trackMood,
  };
}

// API Fetch Helper
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Service response was not valid JSON.");
  }
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Request failed (${response.status})`
    );
  }
  return data as T;
}

// Helper to identify Melody songs across Tamil and English
function isMelodyGenre(genre?: string, title?: string): boolean {
  const g = (genre || "").toLowerCase();
  const t = (title || "").toLowerCase();
  return (
    g.includes("melody") ||
    g.includes("romance") ||
    g.includes("ballad") ||
    g.includes("acoustic") ||
    g.includes("soul") ||
    g.includes("chill") ||
    g.includes("peace") ||
    g.includes("calm") ||
    g.includes("seren") ||
    g.includes("classical") ||
    g.includes("breezy") ||
    t.includes("munbe vaa") ||
    t.includes("vaseegara") ||
    t.includes("malare") ||
    t.includes("kadhale") ||
    t.includes("poove") ||
    t.includes("ennodu") ||
    t.includes("thalli") ||
    t.includes("kannazhaga") ||
    t.includes("unakkul") ||
    t.includes("new york") ||
    t.includes("hosanna") ||
    t.includes("vennilave") ||
    t.includes("anbil")
  );
}

// Sequence Planner across 1,000 songs — ALWAYS guarantees the drift ends up in a pure Melody
function generateSequenceFromCatalog(
  start: Mood,
  target: Mood,
  count: number,
  retentionDays: number,
  langFilter: "All" | "Tamil" | "English" = "All"
): Session {
  const candidates =
    langFilter === "All"
      ? CATALOG_TRACKS
      : CATALOG_TRACKS.filter((t) => t.language === langFilter);

  // All melody tracks in candidate pool
  const melodyPool = candidates.filter((t) => isMelodyGenre(t.genre, t.title));
  const finalMelodyPool = melodyPool.length > 0 ? melodyPool : candidates;

  // The drift target always anchors to the peaceful melody centroid
  const melodyDestV = 0.78;
  const melodyDestA = 0.35;

  const effectiveTargetV = (target.valence + melodyDestV) / 2;
  const effectiveTargetA = (target.arousal + melodyDestA) / 2;

  const queue: QueueItem[] = [];

  for (let i = 0; i < count; i++) {
    const fraction = count <= 1 ? 1 : i / (count - 1);
    const isDestination = i === count - 1;

    // As fraction approaches 1, smoothly steer toward the pure melody destination
    const pointV = isDestination ? melodyDestV : start.valence + (effectiveTargetV - start.valence) * fraction;
    const pointA = isDestination ? melodyDestA : start.arousal + (effectiveTargetA - start.arousal) * fraction;

    // The final destination track is STRICTLY chosen from the melody pool!
    const pool = isDestination ? finalMelodyPool : candidates;

    let best = pool[0];
    let minDistance = Infinity;

    for (const t of pool) {
      const tm = t.mood ?? { valence: 0.5, arousal: 0.5 };
      const d = Math.hypot(tm.valence - pointV, tm.arousal - pointA);
      const penalty = queue.length > 0 && queue[queue.length - 1].trackId === t.id ? 0.45 : 0;
      // Penultimate steps give an extra affinity bonus to melodious songs
      const melodyBonus = (i >= count - 2 && isMelodyGenre(t.genre, t.title)) ? -0.15 : 0;

      if (d + penalty + melodyBonus < minDistance) {
        minDistance = d + penalty + melodyBonus;
        best = t;
      }
    }

    queue.push({
      position: i + 1,
      trackId: best.id,
      pathPoint: { valence: Number(pointV.toFixed(2)), arousal: Number(pointA.toFixed(2)) },
      trackMood: best.mood ?? { valence: 0.5, arousal: 0.5 },
      reason:
        i === 0
          ? `Starting vibe (${best.language}): ${best.genre}`
          : isDestination
          ? `🎯 Drift Resolution: Pure Melody (${best.title} · ${best.genre})`
          : `Drift transition ${i + 1} (${best.language}): ${best.title}`,
    });
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + retentionDays);

  return {
    sessionId: `drift-${Date.now()}`,
    queue,
    currentIndex: 0,
    status: "active",
    revision: 1,
    retentionDays,
    expiresAt: expires.toISOString(),
    lastCheckIn: start,
  };
}

// 3D Dimensional Record Art Component with real album artwork support
function RecordScene({
  valence,
  arousal,
  playing,
  title,
  artworkUrl,
}: {
  valence: number;
  arousal: number;
  playing: boolean;
  title: string;
  artworkUrl?: string;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const hue = Math.round(168 + 20 * valence - 15 * arousal);
  const style = { "--mood-hue": hue } as CSSProperties;

  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (!scene.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = scene.current.getBoundingClientRect();
    scene.current.style.setProperty(
      "--tilt-x",
      `${((event.clientY - box.top) / box.height - 0.5) * -12}deg`
    );
    scene.current.style.setProperty(
      "--tilt-y",
      `${((event.clientX - box.left) / box.width - 0.5) * 12}deg`
    );
  }

  function reset() {
    scene.current?.style.setProperty("--tilt-x", "0deg");
    scene.current?.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <div
      ref={scene}
      className={`record-scene ${playing ? "is-playing" : ""}`}
      style={style}
      role="img"
      aria-label={`Record art for ${title}`}
      onPointerMove={tilt}
      onPointerLeave={reset}
    >
      <div className="scene-glow" />
      <div className="record-disc">
        <div className="record-grooves" />
        {artworkUrl ? (
          <div
            className="record-label"
            style={{
              backgroundImage: `url(${artworkUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "2px solid #1ed7b5",
              boxShadow: "0 0 16px rgba(30, 215, 181, 0.7)",
            }}
          >
            <span style={{ opacity: 0.8 }} />
          </div>
        ) : (
          <div className="record-label">
            MOOD
            <br />
            DRIFT
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

// Main App Component
export default function App() {
  const [tracks, setTracks] = useState<Record<string, Track>>(CATALOG_MAP);
  const [session, setSession] = useState<Session>(createDefaultSession);
  const [userId, setUserId] = useState("Local Listener");
  const [checkIn, setCheckIn] = useState("");
  const [start, setStart] = useState<Mood>({ valence: 0.25, arousal: 0.35, source: "manual" });
  const [target, setTarget] = useState<Mood>({ valence: 0.78, arousal: 0.35 });
  const [count, setCount] = useState(6);
  const [retentionDays, setRetentionDays] = useState(7);
  const [sessionMood, setSessionMood] = useState<Mood>({ valence: 0.5, arousal: 0.5, source: "manual" });
  const [journeyLanguage, setJourneyLanguage] = useState<"All" | "Tamil" | "English">("All");

  // Catalog filters & search state
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogLanguage, setCatalogLanguage] = useState<"All" | "Tamil" | "English">("All");
  const [catalogGenre, setCatalogGenre] = useState<string>("All");
  const [visibleCount, setVisibleCount] = useState(36);

  const [likedTrackIDs, setLikedTrackIDs] = useState<string[]>([
    "tamil-1-munbe-vaa",
    "eng-1-blinding-lights",
    "tamil-4-arabic-kuthu-halamithi-habibo",
    "eng-17-viva-la-vida",
  ]);

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditCheckIns, setAuditCheckIns] = useState<AuditCheckIn[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(0.95);
  const [isMuted, setIsMuted] = useState(false);
  const [continuousLoop, setContinuousLoop] = useState(true);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"spotify" | "full" | "preview">("spotify");
  const [spotifyClientId, setSpotifyClientId] = useState(() => localStorage.getItem("mood_drift_spotify_client_id") || "");
  const [miniPlayerCollapsed, setMiniPlayerCollapsed] = useState(false);
  const [ytBlocked, setYtBlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "studio" | "explore" | "audit" | "liked">("queue");
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [hoverTrackIdx, setHoverTrackIdx] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const pendingPlayRef = useRef<string | null>(null);
  const advancing = useRef(false);
  const playbackWatchdog = useRef<any>(null);

  // Show Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3800);
  };

  const current = session.queue[session.currentIndex] || session.queue[0];
  const currentTrack: Track =
    (current && (CATALOG_MAP[current.trackId] || tracks[current.trackId])) ||
    CATALOG_TRACKS[0];

  const currentTrackRef = useRef<Track>(currentTrack);
  currentTrackRef.current = currentTrack;

  // Initialize YouTube Iframe Player
  useEffect(() => {
    let isMounted = true;
    function setupPlayer() {
      if (!isMounted) return;
      if (window.YT && window.YT.Player && !ytPlayerRef.current) {
        try {
          ytPlayerRef.current = new window.YT.Player("yt-player-target", {
            height: "100%",
            width: "100%",
            videoId: currentTrack?.youtubeId || "4NRXx6U8ABQ",
            playerVars: {
              autoplay: 0,
              controls: 0,
              disablekb: 1,
              fs: 0,
              iv_load_policy: 3,
              modestbranding: 1,
              rel: 0,
              playsinline: 1,
              enablejsapi: 1,
            },
            events: {
              onReady: (event: any) => {
                if (!isMounted) return;
                try {
                  event.target.setVolume(isMuted ? 0 : Math.round(volume * 100));
                } catch {}
                if (pendingPlayRef.current) {
                  event.target.loadVideoById({
                    videoId: pendingPlayRef.current,
                    startSeconds: 0,
                  });
                  event.target.playVideo();
                  setPlaying(true);
                  pendingPlayRef.current = null;
                }
              },
              onStateChange: (event: any) => {
                if (!isMounted) return;
                if (event.data === window.YT.PlayerState.PLAYING) {
                  if (playbackWatchdog.current) {
                    clearTimeout(playbackWatchdog.current);
                    playbackWatchdog.current = null;
                  }
                  setYtBlocked(false);
                  setPlaying(true);
                  try {
                    const d = event.target.getDuration();
                    if (d && d > 0) setDuration(d);
                  } catch {}
                } else if (event.data === window.YT.PlayerState.PAUSED) {
                  setPlaying(false);
                } else if (event.data === window.YT.PlayerState.ENDED) {
                  if (continuousLoop) {
                    event.target.seekTo(0);
                    event.target.playVideo();
                  } else {
                    if (shuffleMode) {
                      const randIdx = Math.floor(Math.random() * session.queue.length);
                      playQueueIndex(randIdx);
                    } else {
                      skipTrack();
                    }
                  }
                }
              },
              onError: (err: any) => {
                const code = err?.data;
                console.warn("YouTube player error/restriction:", code);
                // 101 or 150 = Embedding restricted ("Watch on YouTube")
                // 100 = Video not found/removed
                // 2 = Invalid parameter
                // 5 = HTML5 error
                setYtBlocked(true);
                const trk = currentTrackRef.current || currentTrack;
                if (trk) {
                  playDirectAudioFallback(trk);
                  showToast(`Direct studio audio active for "${trk.title}"`);
                }
              },
            },
          });
        } catch (e) {
          console.warn("Error instantiating YT player:", e);
        }
      }
    }

    if (window.YT && window.YT.Player) {
      setupPlayer();
    } else {
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevReady) prevReady();
        setupPlayer();
      };
    }

    return () => {
      isMounted = false;
      if (playbackWatchdog.current) {
        clearTimeout(playbackWatchdog.current);
      }
    };
  }, []);

  // Poll current time for Full Song Mode
  useEffect(() => {
    if (!playing || playbackMode !== "full" || ytBlocked) return;
    const interval = setInterval(() => {
      try {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === "function") {
          const cur = ytPlayerRef.current.getCurrentTime();
          if (typeof cur === "number" && !isNaN(cur)) {
            setProgress(cur);
          }
          const dur = ytPlayerRef.current.getDuration();
          if (dur && dur > 0 && (!duration || Math.abs(dur - duration) > 2)) {
            setDuration(dur);
          }
        }
      } catch {}
    }, 250);
    return () => clearInterval(interval);
  }, [playing, playbackMode, ytBlocked, duration]);

  // Keep volume in sync across both engines
  useEffect(() => {
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === "function") {
      try {
        if (isMuted) {
          ytPlayerRef.current.mute();
        } else {
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(Math.round(volume * 100));
        }
      } catch {}
    }
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Direct Audio Fallback Player (Guaranteed to play without "Watch on YouTube" blocks)
  function playDirectAudioFallback(track: Track) {
    setYtBlocked(true);
    if (playbackWatchdog.current) {
      clearTimeout(playbackWatchdog.current);
      playbackWatchdog.current = null;
    }
    if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === "function") {
      try { ytPlayerRef.current.pauseVideo(); } catch {}
    }
    const el = audioRef.current;
    if (!el || !track) return;
    const url = track.audioUrl || CATALOG_MAP[track.id]?.audioUrl;
    if (!url) return;
    if (el.src !== url) {
      el.src = url;
    }
    el.currentTime = 0;
    setProgress(0);
    setDuration(track.durationSeconds || 30);
    el.play().then(() => {
      setPlaying(true);
    }).catch((err) => {
      console.warn("Direct audio play error:", err);
    });
  }

  // Unified Direct Playback Starter
  function startPlayback(track: Track) {
    if (!track) return;
    currentTrackRef.current = track;
    setYtBlocked(false);

    if (playbackWatchdog.current) {
      clearTimeout(playbackWatchdog.current);
      playbackWatchdog.current = null;
    }

    // 1. Spotify Engine: Stream official full lengthy song via Spotify
    if (playbackMode === "spotify") {
      if (audioRef.current) audioRef.current.pause();
      if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === "function") {
        try { ytPlayerRef.current.pauseVideo(); } catch {}
      }
      setPlaying(true);
      setProgress(0);
      setDuration(track.durationSeconds || 210);
      showToast(`🟢 Streaming "${track.title}" via Spotify Master`);
      return;
    }

    // 2. YouTube Full HD Engine
    if (playbackMode === "full") {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const yId = track.youtubeId || CATALOG_MAP[track.id]?.youtubeId;
      if (yId && ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        try {
          ytPlayerRef.current.loadVideoById({
            videoId: yId,
            startSeconds: 0,
          });
          ytPlayerRef.current.playVideo();
          setPlaying(true);
          setProgress(0);
          setDuration(track.durationSeconds || 180);

          // Watchdog: If YouTube doesn't start playing within 2.5s (due to "Watch on YouTube" error), auto-switch to direct audio
          playbackWatchdog.current = setTimeout(() => {
            if (ytPlayerRef.current) {
              const state = ytPlayerRef.current.getPlayerState?.();
              if (state !== 1 && state !== 3) {
                console.warn("YouTube video blocked, auto-switching to direct audio for:", track.title);
                playDirectAudioFallback(track);
              }
            }
          }, 2500);
          return;
        } catch (err) {
          console.warn("YouTube play failed, auto-falling back:", err);
        }
      } else if (yId) {
        pendingPlayRef.current = yId;
        setDuration(track.durationSeconds || 180);
        setPlaying(true);
        return;
      }
    }

    // 3. Direct audio stream
    playDirectAudioFallback(track);
  }

  // Play/Pause Toggle
  async function togglePlay() {
    if (playbackMode === "spotify") {
      setPlaying(!playing);
      showToast(playing ? "Spotify Player paused" : "Spotify Player playing");
      return;
    }

    if (!ytBlocked && playbackMode === "full" && ytPlayerRef.current && typeof ytPlayerRef.current.playVideo === "function") {
      try {
        if (playing) {
          ytPlayerRef.current.pauseVideo();
          setPlaying(false);
        } else {
          ytPlayerRef.current.playVideo();
          setPlaying(true);
          void sendEvent("start");
        }
        return;
      } catch (err) {
        console.warn("YT togglePlay error:", err);
      }
    }

    const el = audioRef.current;
    if (!el || !currentTrack) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }

    const url = currentTrack.audioUrl || CATALOG_MAP[currentTrack.id]?.audioUrl;
    if (url && el.src !== url) el.src = url;
    try {
      await el.play();
      setPlaying(true);
      void sendEvent("start");
    } catch {
      el.muted = false;
      try {
        await el.play();
        setPlaying(true);
      } catch {
        showToast("Click Play to start audio.");
      }
    }
  }

  // Switch between Spotify, Full Song, and 30s Snippet
  function switchPlaybackMode(mode: "spotify" | "full" | "preview") {
    setPlaybackMode(mode);
    if (mode === "spotify") {
      if (audioRef.current) audioRef.current.pause();
      if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === "function") {
        try { ytPlayerRef.current.pauseVideo(); } catch {}
      }
      setPlaying(true);
      showToast("🟢 Spotify Full Song Engine Active (High Fidelity)");
    } else if (mode === "full") {
      if (audioRef.current) audioRef.current.pause();
      const yId = currentTrack?.youtubeId || CATALOG_MAP[currentTrack?.id]?.youtubeId;
      if (yId && ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        ytPlayerRef.current.loadVideoById({
          videoId: yId,
          startSeconds: Math.floor(progress),
        });
        ytPlayerRef.current.playVideo();
        setPlaying(true);
      }
      showToast("🎵 YouTube Full Video Engine Active");
    } else {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === "function") {
        ytPlayerRef.current.pauseVideo();
      }
      const el = audioRef.current;
      if (el && currentTrack) {
        const url = currentTrack.audioUrl || CATALOG_MAP[currentTrack.id]?.audioUrl;
        if (url && el.src !== url) el.src = url;
        el.currentTime = Math.min(progress, 28);
        el.play().then(() => setPlaying(true)).catch(() => {});
      }
      showToast("⚡ 30-second preview mode active");
    }
  }

  // Play a specific track index in current queue
  function playQueueIndex(idx: number) {
    const targetItem = session.queue[idx];
    if (!targetItem) return;
    const targetTrack = CATALOG_MAP[targetItem.trackId] || tracks[targetItem.trackId];

    setSession((s) => ({ ...s, currentIndex: idx, status: "active" }));
    setPlaying(true);

    if (targetTrack) {
      startPlayback(targetTrack);
      showToast(`Playing ${targetTrack.title} (${targetTrack.language})`);
    }
  }

  // Replay
  function replayTrack() {
    if (playbackMode === "full" && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
        setPlaying(true);
        setProgress(0);
        void sendEvent("replay");
        showToast(`Replaying ${currentTrack.title}`);
        return;
      } catch {}
    }

    const el = audioRef.current;
    if (!el || !currentTrack) return;
    el.currentTime = 0;
    setProgress(0);
    el.play().then(() => {
      setPlaying(true);
      void sendEvent("replay");
      showToast(`Replaying ${currentTrack.title}`);
    }).catch(() => {});
  }

  // Skip
  function skipTrack() {
    const nextIdx = (session.currentIndex + 1) % session.queue.length;
    playQueueIndex(nextIdx);
    void sendEvent("skip");
  }

  // Send Event / Handle Playback State
  async function sendEvent(type: PlaybackEvent) {
    if (!current || advancing.current) return;
    advancing.current = true;

    const payload = {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      trackId: current.trackId,
      type,
      occurredAt: new Date().toISOString(),
      expectedRevision: session.revision,
    };

    setAuditEvents((events) => [
      ...events,
      {
        eventId: payload.eventId,
        trackId: payload.trackId,
        type,
        occurredAt: payload.occurredAt,
        acceptedAt: new Date().toISOString(),
      },
    ]);

    try {
      await api<EventResult>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/events`,
        "POST",
        payload
      );
    } catch {}

    advancing.current = false;
  }

  // Direct track play from catalog
  function playCatalogTrack(t: Track) {
    const fresh = CATALOG_MAP[t.id] || t;
    const idx = session.queue.findIndex((q) => q.trackId === fresh.id);

    if (idx >= 0) {
      setSession((s) => ({ ...s, currentIndex: idx, status: "active" }));
    } else {
      const newQueue = [...session.queue];
      newQueue.splice(session.currentIndex + 1, 0, {
        position: session.currentIndex + 2,
        trackId: fresh.id,
        pathPoint: fresh.mood ?? { valence: 0.5, arousal: 0.5 },
        trackMood: fresh.mood ?? { valence: 0.5, arousal: 0.5 },
        reason: `Direct pick (${fresh.language}): ${fresh.title}`,
      });
      setSession((s) => ({ ...s, queue: newQueue, currentIndex: s.currentIndex + 1, status: "active" }));
    }

    setPlaying(true);
    startPlayback(fresh);
    showToast(`Playing ${fresh.title} (${fresh.language})`);
  }

  // Like / Unlike Toggle
  function toggleLike(trackId: string) {
    if (likedTrackIDs.includes(trackId)) {
      setLikedTrackIDs((ids) => ids.filter((id) => id !== trackId));
      showToast("Removed from Liked Songs");
    } else {
      setLikedTrackIDs((ids) => [...ids, trackId]);
      showToast("Added to Liked Songs ♥");
      void sendEvent("like");
    }
  }

  // AI Mood Suggestion
  async function suggestMood() {
    if (!checkIn.trim()) {
      showToast("Write a check-in phrase first (e.g. 'Energetic Tamil dance kuthu vibe').");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Prediction>("/api/v1/mood/predict", "POST", { text: checkIn });
      setPrediction(result);
      if (result.suggestedMood) {
        setStart({
          ...result.suggestedMood,
          source: "text-model",
          confidence: result.confidence ?? undefined,
        });
        showToast("Mood predicted from your check-in!");
      }
    } catch {
      const text = checkIn.toLowerCase();
      let v = 0.5;
      let a = 0.5;
      if (text.includes("rain") || text.includes("tired") || text.includes("sad") || text.includes("kadhale")) {
        v = 0.22;
        a = 0.25;
      } else if (text.includes("calm") || text.includes("peace") || text.includes("chill") || text.includes("melody")) {
        v = 0.72;
        a = 0.32;
      } else if (text.includes("kuthu") || text.includes("dance") || text.includes("hype") || text.includes("energy") || text.includes("party")) {
        v = 0.92;
        a = 0.94;
      } else {
        v = 0.75;
        a = 0.60;
      }
      setStart({ valence: v, arousal: a, source: "text-model", confidence: 0.88 });
      setPrediction({
        suggestedMood: { valence: v, arousal: a },
        confidence: 0.88,
        needsManualSelection: false,
        reason: "Tamil & English sentiment inference",
      });
      showToast("Mood suggestion ready based on your check-in!");
    } finally {
      setBusy(false);
    }
  }

  // Preset Mood Chooser
  function applyPreset(presetV: number, presetA: number, presetName: string) {
    setTarget({ valence: presetV, arousal: presetA });
    showToast(`Target set to ${presetName} (V: ${(presetV * 100).toFixed(0)}%, A: ${(presetA * 100).toFixed(0)}%)`);
  }

  // Create New Journey Session across 1000 songs
  function createJourney() {
    setBusy(true);
    const data = generateSequenceFromCatalog(start, target, count, retentionDays, journeyLanguage);
    setSession(data);
    setSessionMood({
      valence: data.queue[0]?.trackMood.valence ?? start.valence,
      arousal: data.queue[0]?.trackMood.arousal ?? start.arousal,
      source: "manual",
    });
    setProgress(0);
    setPlaying(true);
    setActiveTab("queue");
    showToast(`Generated journey across 1,000 ${journeyLanguage !== "All" ? journeyLanguage : "Tamil & English"} songs!`);
    setBusy(false);
  }

  // Mid-Session Mood Update
  function submitCheckIn() {
    const remaining = session.queue.length - (session.currentIndex + 1);
    if (remaining > 0) {
      const fresh = generateSequenceFromCatalog(sessionMood, target, remaining + 1, session.retentionDays, journeyLanguage);
      const newQueue = [
        ...session.queue.slice(0, session.currentIndex + 1),
        ...fresh.queue.slice(1).map((item, idx) => ({
          ...item,
          position: session.currentIndex + 2 + idx,
          reason: `Recalibrated step: ${CATALOG_MAP[item.trackId]?.title || item.trackId}`,
        })),
      ];
      setSession((s) => ({ ...s, queue: newQueue, revision: s.revision + 1, lastCheckIn: sessionMood }));
    }
    setAuditCheckIns((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        mood: { ...sessionMood, source: "manual" },
        createdAt: new Date().toISOString(),
      },
    ]);
    setShowCheckInModal(false);
    showToast("Upcoming trajectory recalibrated!");
  }

  // Filtered Catalog tracks based on search, language, and genre
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return CATALOG_TRACKS.filter((t) => {
      // Language filter
      if (catalogLanguage !== "All" && t.language !== catalogLanguage) return false;
      // Genre filter
      if (catalogGenre !== "All" && !t.genre.toLowerCase().includes(catalogGenre.toLowerCase())) return false;
      // Search query
      if (q) {
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesArtist = t.artist.toLowerCase().includes(q);
        const matchesAlbum = t.album ? t.album.toLowerCase().includes(q) : false;
        if (!matchesTitle && !matchesArtist && !matchesAlbum) return false;
      }
      return true;
    });
  }, [searchQuery, catalogLanguage, catalogGenre]);

  // Handle Seeking / Scrubber
  function handleScrubberClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * (duration || 180);
    setProgress(targetTime);

    if (playbackMode === "full" && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(targetTime, true);
        return;
      } catch {}
    }

    const el = audioRef.current;
    if (el) {
      el.currentTime = targetTime;
    }
  }

  // Format seconds to mm:ss
  function formatSeconds(sec: number) {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, "0")}`;
  }

  return (
    <div className="app-container">
      {/* Persistent HTML5 Audio Tag */}
      <audio
        ref={audioRef}
        preload="auto"
        loop={continuousLoop}
        onEnded={() => {
          if (!continuousLoop) {
            if (shuffleMode) {
              const randIdx = Math.floor(Math.random() * session.queue.length);
              playQueueIndex(randIdx);
            } else {
              skipTrack();
            }
          }
        }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (e.currentTarget.duration && !isNaN(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onDurationChange={(e) => {
          if (e.currentTarget.duration && !isNaN(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onError={(e) => {
          console.warn("Audio element error:", e);
        }}
      />

      {/* Docked Full Song Video & Audio Canvas */}
      <div
        className={`docked-player-widget ${miniPlayerCollapsed ? "is-collapsed" : ""} ${playbackMode === "spotify" ? "is-spotify" : ""} ${playbackMode === "preview" ? "is-hidden" : ""}`}
      >
        <div className="mini-player-bar">
          <div className="mini-player-badge">
            <span
              className="live-pulse-dot"
              style={{ backgroundColor: playbackMode === "spotify" ? "#1ed760" : undefined }}
            />
            <span>
              {playbackMode === "spotify"
                ? "Spotify Player (Full)"
                : ytBlocked
                ? "Direct Audio"
                : "YouTube HD"}
            </span>
          </div>
          <div className="mini-player-actions">
            <button
              className="mini-btn"
              onClick={() => setMiniPlayerCollapsed((v) => !v)}
              title={miniPlayerCollapsed ? "Expand Mini Player" : "Collapse Mini Player"}
            >
              {miniPlayerCollapsed ? "▢" : "—"}
            </button>
            {playbackMode === "spotify" ? (
              <a
                href={getSpotifySearchUrl(currentTrack)}
                target="_blank"
                rel="noreferrer"
                className="mini-btn"
                title="Open in Spotify App"
                style={{ textDecoration: "none", color: "#1ed760", display: "grid", placeItems: "center" }}
              >
                ↗
              </a>
            ) : (
              <button
                className="mini-btn"
                onClick={() => setShowVideoModal(true)}
                title="Fullscreen Video / Details"
              >
                ⤢
              </button>
            )}
          </div>
        </div>
        <div className="mini-player-viewport">
          {playbackMode === "spotify" ? (
            <iframe
              key={currentTrack.id}
              src={`https://open.spotify.com/embed/track/${getTrackSpotifyId(currentTrack)}?utm_source=generator&theme=0`}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              style={{ border: "none", background: "#0b1518" }}
              title={`Spotify Player - ${currentTrack.title}`}
            />
          ) : (
            <>
              <div
                id="yt-player-target"
                style={{
                  width: "100%",
                  height: "100%",
                  display: ytBlocked ? "none" : "block",
                }}
              />
              {ytBlocked && (
                <div className="direct-audio-visualizer">
                  <img
                    src={currentTrack.artworkUrl}
                    alt={currentTrack.title}
                    className="visualizer-artwork"
                  />
                  <div className="visualizer-overlay">
                    <div className="equalizer-bars">
                      <span className="eq-bar bar-1" />
                      <span className="eq-bar bar-2" />
                      <span className="eq-bar bar-3" />
                      <span className="eq-bar bar-4" />
                      <span className="eq-bar bar-5" />
                    </div>
                    <span className="visualizer-label">{currentTrack.title}</span>
                    <small className="visualizer-sub">Direct Studio Audio · No Video Block</small>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Official HD Music Video Modal */}
      {showVideoModal && (
        <div className="video-canvas-overlay" onClick={() => setShowVideoModal(false)}>
          <div className="video-canvas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="canvas-header">
              <div className="canvas-title">
                <span>Official HD Music Video</span>
                <small>{currentTrack.title} · {currentTrack.artist}</small>
              </div>
              <button
                className="btn-canvas-close"
                onClick={() => setShowVideoModal(false)}
                title="Close Video"
              >
                ✕
              </button>
            </div>
            <div className="canvas-video-wrapper">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${currentTrack.youtubeId || "4NRXx6U8ABQ"}?autoplay=1&controls=1&rel=0`}
                title={currentTrack.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      {/* Spotify Connect & Settings Modal */}
      {showSpotifyModal && (
        <div className="video-canvas-overlay" onClick={() => setShowSpotifyModal(false)}>
          <div className="video-canvas-modal" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()}>
            <div className="canvas-header" style={{ borderBottomColor: "rgba(30, 215, 96, 0.3)" }}>
              <div className="canvas-title">
                <span style={{ color: "#1ed760", display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="#1ed760">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
                  </svg>
                  Spotify API & Full Song Engine
                </span>
                <small>High-fidelity, full-length commercial songs & audio features</small>
              </div>
              <button
                className="btn-canvas-close"
                onClick={() => setShowSpotifyModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "rgba(30, 215, 96, 0.08)", border: "1px solid rgba(30, 215, 96, 0.25)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
                <h4 style={{ color: "#1ed760", margin: "0 0 6px 0", fontSize: "0.95rem" }}>🟢 Spotify Engine Active</h4>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  The app automatically embeds official Spotify Player frames. If you are logged into Spotify in this browser, you get <strong>full-length, high-definition tracks (3-5+ mins)</strong> with seamless library sync!
                </p>
              </div>

              <div className="control-group">
                <label className="control-label">
                  Spotify Developer Client ID (Optional)
                </label>
                <input
                  type="text"
                  className="spotify-input"
                  placeholder="e.g. 5a1b2c3d4e5f6g7h8i9j0k..."
                  value={spotifyClientId}
                  onChange={(e) => {
                    setSpotifyClientId(e.target.value);
                    localStorage.setItem("mood_drift_spotify_client_id", e.target.value);
                  }}
                />
                <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                  Create a free app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: "#1ed760" }}>developer.spotify.com/dashboard</a> to enable custom Web Playback SDK streaming.
                </span>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button
                  className="spotify-btn-primary"
                  style={{ flex: 1, padding: "10px", background: "#1ed760", color: "#000", fontWeight: 800, border: "none", borderRadius: "20px", cursor: "pointer" }}
                  onClick={() => {
                    switchPlaybackMode("spotify");
                    setShowSpotifyModal(false);
                    showToast("🟢 Spotify Engine set as Primary Player!");
                  }}
                >
                  Set Spotify as Default Player
                </button>
                <a
                  href={`https://open.spotify.com/track/${getTrackSpotifyId(currentTrack)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "grid", placeItems: "center", padding: "10px 18px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "20px", color: "#fff", textDecoration: "none", fontSize: "0.84rem", fontWeight: 700 }}
                >
                  Open Current Track ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          LEFT SIDEBAR (Spotify-style Navigation & Library)
          ========================================================================== */}
      <aside className="sidebar">
        {/* Brand Logo */}
        <div className="brand-header" onClick={() => setActiveTab("queue")}>
          <div className="brand-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z" />
            </svg>
          </div>
          <div className="brand-title">
            <h1>mood<span>drift</span></h1>
            <span className="brand-badge">1,000 Real Songs · Tamil & English</span>
          </div>
        </div>

        {/* Primary Navigation Menu */}
        <nav className="nav-section" aria-label="Main Navigation">
          <button
            className={`nav-item ${activeTab === "queue" ? "active" : ""}`}
            onClick={() => setActiveTab("queue")}
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Current Journey</span>
          </button>

          <button
            className={`nav-item ${activeTab === "explore" ? "active" : ""}`}
            onClick={() => setActiveTab("explore")}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
            <span>Explore Catalog (1,000)</span>
          </button>

          <button
            className={`nav-item ${activeTab === "studio" ? "active" : ""}`}
            onClick={() => setActiveTab("studio")}
          >
            <svg viewBox="0 0 24 24">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span>Mood Studio</span>
          </button>

          <button
            className={`nav-item ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Privacy & History</span>
          </button>

          <button
            className="nav-item"
            style={{ color: "#1ed760" }}
            onClick={() => setShowSpotifyModal(true)}
            title="Configure Spotify API Integration"
          >
            <svg viewBox="0 0 24 24" fill="#1ed760">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
            </svg>
            <span>Spotify Connect</span>
          </button>
        </nav>

        {/* Spotify Library Section */}
        <div className="sidebar-library">
          <div className="library-heading">
            <div className="library-heading-left">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span>Your Library</span>
            </div>
            <button
              className="library-add-btn"
              onClick={() => setActiveTab("studio")}
              title="Create New Flow"
            >
              +
            </button>
          </div>

          {/* Library Filter Pills */}
          <div className="library-filter-tags">
            <span
              className={`lib-filter-pill ${activeTab === "queue" ? "active" : ""}`}
              onClick={() => setActiveTab("queue")}
            >
              Journeys
            </span>
            <span
              className={`lib-filter-pill ${activeTab === "liked" ? "active" : ""}`}
              onClick={() => setActiveTab("liked")}
            >
              Liked ({likedTrackIDs.length})
            </span>
            <span
              className="lib-filter-pill"
              onClick={() => {
                setCatalogLanguage("Tamil");
                setActiveTab("explore");
              }}
            >
              Tamil (500)
            </span>
            <span
              className="lib-filter-pill"
              onClick={() => {
                setCatalogLanguage("English");
                setActiveTab("explore");
              }}
            >
              English (500)
            </span>
          </div>

          {/* Library Items */}
          <div className="library-items-list">
            {/* Liked Songs Item */}
            <div
              className={`library-item ${activeTab === "liked" ? "is-selected" : ""}`}
              onClick={() => setActiveTab("liked")}
            >
              <div className="library-item-thumb liked">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
              <div className="library-item-meta">
                <span className="library-item-title">Liked Songs</span>
                <span className="library-item-subtitle">Playlist · {likedTrackIDs.length} songs</span>
              </div>
            </div>

            {/* Active Journey Item */}
            <div
              className={`library-item ${activeTab === "queue" ? "is-selected" : ""}`}
              onClick={() => setActiveTab("queue")}
            >
              <div className="library-item-thumb journey">
                {currentTrack.artworkUrl ? (
                  <img
                    src={currentTrack.artworkUrl}
                    alt={currentTrack.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--radius-xs)" }}
                  />
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </div>
              <div className="library-item-meta">
                <span className="library-item-title">Active Listening Path</span>
                <span className="library-item-subtitle">
                  Step {session.currentIndex + 1} of {session.queue.length} · {currentTrack?.title}
                </span>
              </div>
            </div>

            {/* Tamil Hits 500 Shortcut */}
            <div
              className="library-item"
              onClick={() => {
                setCatalogLanguage("Tamil");
                setActiveTab("explore");
              }}
            >
              <div className="library-item-thumb" style={{ background: "linear-gradient(135deg, #0d7f72, #052f2a)", color: "var(--teal-bright)" }}>
                🪕
              </div>
              <div className="library-item-meta">
                <span className="library-item-title">Tamil Melodies & Kuthu</span>
                <span className="library-item-subtitle">500 Tracks · Rahman, Anirudh & more</span>
              </div>
            </div>

            {/* English Anthems 500 Shortcut */}
            <div
              className="library-item"
              onClick={() => {
                setCatalogLanguage("English");
                setActiveTab("explore");
              }}
            >
              <div className="library-item-thumb" style={{ background: "linear-gradient(135deg, #0e5b72, #05242d)", color: "#38bdf8" }}>
                🎧
              </div>
              <div className="library-item-meta">
                <span className="library-item-title">Global English Hits</span>
                <span className="library-item-subtitle">500 Tracks · The Weeknd, Taylor & more</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Footer User Card */}
        <div className="sidebar-footer">
          <div className="user-avatar">{userId.charAt(0).toUpperCase()}</div>
          <div className="user-meta">
            <span className="user-name">{userId}</span>
            <span className="user-tag">Official Audio Enabled</span>
          </div>
        </div>
      </aside>

      {/* ==========================================================================
          MAIN VIEWPORT
          ========================================================================== */}
      <main className="main-view">
        <div className="ambient-glow" />

        {/* Sticky Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="nav-history-btn"
              title="Previous"
              onClick={() => setActiveTab("queue")}
            >
              &lt;
            </button>
            <button
              className="nav-history-btn"
              title="Next"
              onClick={() => setActiveTab("explore")}
            >
              &gt;
            </button>

            <span className="topbar-badge">
              ● STEP {Math.min(session.currentIndex + 1, session.queue.length)} OF {session.queue.length}
            </span>
          </div>

          <div className="topbar-right">
            <button
              className="btn-outline"
              onClick={() => setShowCheckInModal(true)}
            >
              🎛️ Adjust Vibe
            </button>

            <button
              className="btn-pill"
              onClick={() => setActiveTab("studio")}
            >
              + New Flow
            </button>
          </div>
        </header>

        {/* Scrollable Content Body */}
        <div className="content-body">
          {/* TAB 1: CURRENT JOURNEY / PLAYLIST VIEW */}
          {activeTab === "queue" && (
            <div>
              {/* Spotify Hero Banner */}
              <section className="hero-banner">
                <div className="hero-artwork">
                  <RecordScene
                    valence={current?.trackMood.valence ?? start.valence}
                    arousal={current?.trackMood.arousal ?? start.arousal}
                    playing={playing}
                    title={currentTrack?.title || "Mood Drift"}
                    artworkUrl={currentTrack?.artworkUrl}
                  />
                </div>

                <div className="hero-info">
                  <span className="hero-type">
                    OFFICIAL TRACK PREVIEW · {currentTrack?.language?.toUpperCase()}
                  </span>
                  <h1 className="hero-title">{currentTrack?.title || "Listening Journey"}</h1>
                  <p className="hero-desc">
                    {currentTrack?.artist} · {currentTrack?.album || currentTrack?.genre}
                    <br />
                    Guiding from ({(start.valence * 100).toFixed(0)}% valence, {(start.arousal * 100).toFixed(0)}% energy) to ({(target.valence * 100).toFixed(0)}% valence, {(target.arousal * 100).toFixed(0)}% energy).
                  </p>

                  <div className="hero-meta">
                    <strong>{userId}</strong>
                    <span className="hero-meta-dot" />
                    <span>{session.queue.length} songs · ~{session.queue.length * 3} min</span>
                    <span className="hero-meta-dot" />
                    <span>Authentic Master Recording</span>
                  </div>
                </div>
              </section>

              {/* Action Bar */}
              <div className="action-bar">
                <button
                  className="btn-play-hero"
                  onClick={togglePlay}
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <svg viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>

                <button
                  className={`btn-icon-hero ${likedTrackIDs.includes(current.trackId) ? "liked" : ""}`}
                  onClick={() => toggleLike(current.trackId)}
                  title={likedTrackIDs.includes(current.trackId) ? "Unlike" : "Like"}
                >
                  <svg viewBox="0 0 24 24" fill={likedTrackIDs.includes(current.trackId) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>

                <button
                  className="btn-secondary-action"
                  onClick={skipTrack}
                >
                  Skip Track ⏭
                </button>

                <button
                  className="btn-secondary-action"
                  onClick={() => setShowCheckInModal(true)}
                >
                  🎛️ Check In Now
                </button>
              </div>

              {/* Spotify Track Table */}
              <table className="track-table">
                <thead>
                  <tr>
                    <th className="col-num">#</th>
                    <th>TITLE</th>
                    <th>LANGUAGE & GENRE</th>
                    <th>MOOD DRIFT / REASON</th>
                    <th className="col-time">TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {session.queue.map((item, idx) => {
                    const track = tracks[item.trackId] || CATALOG_MAP[item.trackId];
                    const isActive = idx === session.currentIndex;
                    const isHovered = hoverTrackIdx === idx;
                    return (
                      <tr
                        key={item.trackId + idx}
                        className={isActive ? "is-active" : ""}
                        onMouseEnter={() => setHoverTrackIdx(idx)}
                        onMouseLeave={() => setHoverTrackIdx(null)}
                        onClick={() => void playQueueIndex(idx)}
                      >
                        <td className="track-num-cell">
                          {isActive && playing ? (
                            <div className="equalizer">
                              <span className="eq-bar" />
                              <span className="eq-bar" />
                              <span className="eq-bar" />
                              <span className="eq-bar" />
                            </div>
                          ) : isHovered ? (
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          ) : (
                            idx + 1
                          )}
                        </td>
                        <td className="track-title-cell">
                          <div className="track-thumb">
                            {track?.artworkUrl ? (
                              <img
                                src={track.artworkUrl}
                                alt={track.title}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            )}
                          </div>
                          <div className="track-meta">
                            <span className="track-name">{track?.title || item.trackId}</span>
                            <span className="track-artist">{track?.artist || "Mood Drift"}</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <span className={`badge-language ${track?.language?.toLowerCase() || "tamil"}`}>
                              {track?.language || "Tamil"}
                            </span>
                            <span className="badge-genre">{track?.genre || "Melody"}</span>
                          </div>
                        </td>
                        <td>
                          <span className="track-reason">{item.reason}</span>
                        </td>
                        <td className="track-time">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                            <span>{formatSeconds(track?.durationSeconds || 210)}</span>
                            <a
                              href={getSpotifySearchUrl(track)}
                              target="_blank"
                              rel="noreferrer"
                              className="track-spotify-btn"
                              title="Listen on Spotify"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
                              </svg>
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: EXPLORE CATALOG (1,000 SONGS: 500 TAMIL & 500 ENGLISH) */}
          {activeTab === "explore" && (
            <div className="catalog-section">
              <div className="catalog-header">
                <h2>Browse 1,000 Songs (Tamil & English)</h2>
                <span style={{ fontSize: "0.85rem", color: "var(--teal-bright)" }}>
                  Showing {filteredCatalog.length} of 1,000 songs
                </span>
              </div>

              {/* Toolbar: Search & Language Filter */}
              <div className="catalog-toolbar">
                <div className="search-input-wrapper">
                  <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    className="catalog-search-input"
                    placeholder="Search Tamil & English songs, artists (A.R. Rahman, Anirudh, The Weeknd)..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setVisibleCount(36);
                    }}
                  />
                </div>

                <div className="filter-row">
                  <button
                    className={`lang-pill ${catalogLanguage === "All" ? "active" : ""}`}
                    onClick={() => {
                      setCatalogLanguage("All");
                      setVisibleCount(36);
                    }}
                  >
                    All Languages (1,000)
                  </button>
                  <button
                    className={`lang-pill ${catalogLanguage === "Tamil" ? "active" : ""}`}
                    onClick={() => {
                      setCatalogLanguage("Tamil");
                      setVisibleCount(36);
                    }}
                  >
                    Tamil Only (500)
                  </button>
                  <button
                    className={`lang-pill ${catalogLanguage === "English" ? "active" : ""}`}
                    onClick={() => {
                      setCatalogLanguage("English");
                      setVisibleCount(36);
                    }}
                  >
                    English Only (500)
                  </button>

                  <span style={{ color: "var(--border-subtle)" }}>|</span>

                  {/* Quick Genre Filters */}
                  {["All", "Melody", "Kuthu", "Pop", "Rock", "Synthwave", "Folk"].map((genre) => (
                    <button
                      key={genre}
                      className={`lang-pill ${catalogGenre === genre ? "active" : ""}`}
                      onClick={() => {
                        setCatalogGenre(genre);
                        setVisibleCount(36);
                      }}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cards Grid */}
              <div className="card-grid">
                {filteredCatalog.slice(0, visibleCount).map((t) => (
                  <div
                    key={t.id}
                    className="spotify-card"
                    onClick={() => void playCatalogTrack(t)}
                  >
                    <div className="card-cover">
                      {t.artworkUrl ? (
                        <img
                          src={t.artworkUrl}
                          alt={t.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <svg viewBox="0 0 24 24" width="36" height="36" fill={t.language === "Tamil" ? "var(--teal-primary)" : "#38bdf8"}>
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                          <circle cx="12" cy="12" r="4" />
                        </svg>
                      )}
                      <button className="card-play-btn" title={`Play ${t.title}`}>
                        <svg viewBox="0 0 24 24">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                    </div>
                    <div className="card-title">{t.title}</div>
                    <div className="card-subtitle">{t.artist}</div>
                    <div className="card-tags">
                      <span className={`badge-language ${t.language?.toLowerCase() || "tamil"}`}>
                        {t.language}
                      </span>
                      <span className="badge-genre">{t.genre}</span>
                      <span className="mood-chip">
                        V: {t.mood?.valence.toFixed(2) ?? "0.5"}
                      </span>
                      <a
                        href={getSpotifySearchUrl(t)}
                        target="_blank"
                        rel="noreferrer"
                        className="card-spotify-link"
                        title={`Listen to "${t.title}" on Spotify`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="#1ed760">
                          <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
                        </svg>
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Button */}
              {visibleCount < filteredCatalog.length && (
                <button
                  className="load-more-btn"
                  onClick={() => setVisibleCount((prev) => prev + 36)}
                >
                  + Load More Songs ({visibleCount} of {filteredCatalog.length} shown)
                </button>
              )}
            </div>
          )}

          {/* TAB 3: LIKED SONGS VIEW */}
          {activeTab === "liked" && (
            <div>
              <section className="hero-banner">
                <div className="hero-artwork" style={{ background: "linear-gradient(135deg, #0d7f72, #042e29)", display: "grid", placeItems: "center" }}>
                  <svg viewBox="0 0 24 24" width="80" height="80" fill="var(--teal-bright)">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </div>
                <div className="hero-info">
                  <span className="hero-type">PLAYLIST</span>
                  <h1 className="hero-title">Liked Songs</h1>
                  <p className="hero-desc">Your favorite Tamil & English songs saved during emotional sessions.</p>
                  <div className="hero-meta">
                    <strong>{userId}</strong>
                    <span className="hero-meta-dot" />
                    <span>{likedTrackIDs.length} songs</span>
                  </div>
                </div>
              </section>

              {likedTrackIDs.length === 0 ? (
                <p style={{ marginTop: "24px", color: "var(--text-muted)" }}>
                  No liked songs yet. Click the heart icon while listening to add songs here!
                </p>
              ) : (
                <table className="track-table">
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th>TITLE</th>
                      <th>LANGUAGE & GENRE</th>
                      <th className="col-time">TIME</th>
                    </tr>
                  </thead>
                  <tbody>
                    {likedTrackIDs.map((id, idx) => {
                      const track = tracks[id] || CATALOG_MAP[id];
                      return (
                        <tr
                          key={id + idx}
                          onClick={() => {
                            if (track) void playCatalogTrack(track);
                          }}
                        >
                          <td className="track-num-cell">{idx + 1}</td>
                          <td className="track-title-cell">
                            <div className="track-thumb">
                              {track?.artworkUrl ? (
                                <img
                                  src={track.artworkUrl}
                                  alt={track.title}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </div>
                            <div className="track-meta">
                              <span className="track-name">{track?.title || id}</span>
                              <span className="track-artist">{track?.artist || "Mood Drift"}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <span className={`badge-language ${track?.language?.toLowerCase() || "tamil"}`}>{track?.language}</span>
                              <span className="badge-genre">{track?.genre}</span>
                            </div>
                          </td>
                          <td className="track-time">
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
                              <span>{formatSeconds(track?.durationSeconds || 210)}</span>
                              <a
                                href={getSpotifySearchUrl(track)}
                                target="_blank"
                                rel="noreferrer"
                                className="track-spotify-btn"
                                title="Listen on Spotify"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                  <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
                                </svg>
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TAB 4: MOOD STUDIO (Interactive 2D Map & 1000 Songs Journey Planner) */}
          {activeTab === "studio" && (
            <div className="studio-grid">
              {/* Left Column: Interactive 2D Coordinate Plane */}
              <div className="studio-panel">
                <h3>Visual Emotional Map</h3>
                <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", margin: 0 }}>
                  Click anywhere on the coordinate plane to position your target mood (teal) or choose an emotional preset below.
                </p>

                {/* Preset Mood Chips */}
                <div className="preset-chips-row">
                  <button
                    className="preset-chip"
                    onClick={() => applyPreset(0.78, 0.32, "Tamil Melody Serenity")}
                  >
                    🪕 Tamil Melody (Munbe Vaa)
                  </button>
                  <button
                    className="preset-chip"
                    onClick={() => applyPreset(0.92, 0.94, "Arabic Kuthu Energy")}
                  >
                    🔥 Arabic Kuthu High
                  </button>
                  <button
                    className="preset-chip"
                    onClick={() => applyPreset(0.84, 0.88, "Synthwave Pulse")}
                  >
                    ⚡ Blinding Lights Pulse
                  </button>
                  <button
                    className="preset-chip"
                    onClick={() => applyPreset(0.30, 0.28, "Melancholic Rain")}
                  >
                    🌧️ Kadhale Kadhale Rain
                  </button>
                </div>

                <div className="mood-plane-wrapper">
                  <div
                    className="mood-plane-container"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
                      setTarget({ valence: Number(x.toFixed(2)), arousal: Number(y.toFixed(2)) });
                      showToast(`Target set: Valence ${(x * 100).toFixed(0)}%, Energy ${(y * 100).toFixed(0)}%`);
                    }}
                  >
                    <div className="mood-plane-grid" />
                    <div className="mood-axis-x" />
                    <div className="mood-axis-y" />

                    {/* Quadrant Labels */}
                    <span className="plane-quadrant-label top-left">Tense / High Arousal</span>
                    <span className="plane-quadrant-label top-right">Euphoric / Energetic</span>
                    <span className="plane-quadrant-label bottom-left">Melancholic / Low</span>
                    <span className="plane-quadrant-label bottom-right">Calm / Serene</span>

                    {/* Start Node */}
                    <div
                      className="mood-node start"
                      style={{
                        left: `${start.valence * 100}%`,
                        top: `${(1 - start.arousal) * 100}%`,
                      }}
                      title="Starting Mood"
                    />

                    {/* Target Node */}
                    <div
                      className="mood-node target"
                      style={{
                        left: `${target.valence * 100}%`,
                        top: `${(1 - target.arousal) * 100}%`,
                      }}
                      title="Target Mood"
                    />

                    {/* Track nodes from current queue */}
                    {session.queue.map((q, idx) => (
                      <div
                        key={idx}
                        className="mood-node track"
                        style={{
                          left: `${q.trackMood.valence * 100}%`,
                          top: `${(1 - q.trackMood.arousal) * 100}%`,
                        }}
                        title={tracks[q.trackId]?.title || q.trackId}
                      />
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", color: "var(--text-muted)" }}>
                    <span>🔵 Start: V {(start.valence * 100).toFixed(0)}% · A {(start.arousal * 100).toFixed(0)}%</span>
                    <span>🟢 Target: V {(target.valence * 100).toFixed(0)}% · A {(target.arousal * 100).toFixed(0)}%</span>
                  </div>
                </div>

                {/* Natural Language Check-in Box */}
                <div className="control-group">
                  <label className="control-label" htmlFor="check-in-text">
                    Optional Check-In (Natural Language)
                  </label>
                  <textarea
                    id="check-in-text"
                    className="spotify-textarea"
                    placeholder="Describe how you're feeling (e.g. 'Chill Tamil monsoon rain mood moving to celebratory upbeat kuthu')..."
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ alignSelf: "flex-start", marginTop: "4px" }}
                    onClick={suggestMood}
                    disabled={busy}
                  >
                    ✨ Predict Starting Mood
                  </button>
                  {prediction?.reason && (
                    <span style={{ fontSize: "0.78rem", color: "var(--teal-bright)" }}>
                      AI inference: {prediction.reason}
                    </span>
                  )}
                </div>
              </div>

              {/* Right Column: Sliders & Session Configuration */}
              <div className="studio-panel">
                <h3>Journey Parameters</h3>

                {/* Listener Name */}
                <div className="control-group">
                  <label className="control-label" htmlFor="listener-name">
                    Listener Name
                  </label>
                  <input
                    id="listener-name"
                    className="spotify-input"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    maxLength={64}
                  />
                </div>

                {/* Language Selection for Journey */}
                <div className="control-group">
                  <label className="control-label">
                    Song Language Preference
                  </label>
                  <select
                    className="spotify-select"
                    value={journeyLanguage}
                    onChange={(e) => setJourneyLanguage(e.target.value as "All" | "Tamil" | "English")}
                  >
                    <option value="All">Both Tamil & English (1,000 Songs)</option>
                    <option value="Tamil">Tamil Songs Only (500 Songs)</option>
                    <option value="English">English Songs Only (500 Songs)</option>
                  </select>
                </div>

                {/* Starting Mood Sliders */}
                <div className="control-group">
                  <label className="control-label">
                    Starting Valence (Mood) <span>{start.valence.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="spotify-range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={start.valence}
                    onChange={(e) => setStart({ ...start, valence: Number(e.target.value) })}
                  />
                </div>

                <div className="control-group">
                  <label className="control-label">
                    Starting Energy (Arousal) <span>{start.arousal.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="spotify-range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={start.arousal}
                    onChange={(e) => setStart({ ...start, arousal: Number(e.target.value) })}
                  />
                </div>

                {/* Target Mood Sliders */}
                <div className="control-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="control-label">
                      Target Valence <span>{target.valence.toFixed(2)}</span>
                    </label>
                    <span style={{ fontSize: "0.72rem", color: "var(--teal-bright)", fontWeight: 700 }}>
                      ✨ Ends in Melody
                    </span>
                  </div>
                  <input
                    type="range"
                    className="spotify-range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={target.valence}
                    onChange={(e) => setTarget({ ...target, valence: Number(e.target.value) })}
                  />
                </div>

                <div className="control-group">
                  <label className="control-label">
                    Target Energy <span>{target.arousal.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    className="spotify-range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={target.arousal}
                    onChange={(e) => setTarget({ ...target, arousal: Number(e.target.value) })}
                  />
                </div>

                {/* Queue Length */}
                <div className="control-group">
                  <label className="control-label">
                    Track Count <span>{count} songs</span>
                  </label>
                  <input
                    type="range"
                    className="spotify-range"
                    min="2"
                    max="12"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </div>

                {/* Submit Action */}
                <div className="studio-actions">
                  <button
                    className="btn-create-journey"
                    onClick={createJourney}
                    disabled={busy || !userId.trim()}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Create Listening Path (Drift to Melody)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PRIVACY & AUDIT LOG */}
          {activeTab === "audit" && (
            <div className="studio-panel" style={{ maxWidth: "800px", margin: "16px auto" }}>
              <h3>Privacy & Session Data</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", margin: 0 }}>
                Active session expires on{" "}
                <strong>{new Date(session.expiresAt).toLocaleDateString()}</strong>.
                Raw check-in text is never persisted to database.
              </p>

              {/* Playback Events List */}
              <div style={{ marginTop: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--teal-bright)", marginBottom: "8px" }}>
                  Playback Audit Events ({auditEvents.length})
                </h4>
                {auditEvents.length === 0 ? (
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    No playback events recorded yet. Play or skip tracks to generate audit records.
                  </p>
                ) : (
                  <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {auditEvents.map((e) => (
                      <div
                        key={e.eventId}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-input)",
                          fontSize: "0.78rem",
                          display: "flex",
                          justifyContent: "space-between",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span>
                          <strong>{e.type.toUpperCase()}</strong> · {tracks[e.trackId]?.title || e.trackId}
                        </span>
                        <span style={{ color: "var(--text-muted)" }}>
                          {new Date(e.acceptedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Check-ins List */}
              <div style={{ marginTop: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--teal-bright)", marginBottom: "8px" }}>
                  Mid-Session Check-Ins ({auditCheckIns.length})
                </h4>
                {auditCheckIns.length === 0 ? (
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    No check-ins performed yet during this session.
                  </p>
                ) : (
                  <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {auditCheckIns.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-input)",
                          fontSize: "0.78rem",
                          display: "flex",
                          justifyContent: "space-between",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span>
                          Valence: {(c.mood.valence * 100).toFixed(0)}% · Energy: {(c.mood.arousal * 100).toFixed(0)}%
                        </span>
                        <span style={{ color: "var(--text-muted)" }}>
                          {new Date(c.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ==========================================================================
          PERSISTENT SPOTIFY BOTTOM PLAYER BAR
          ========================================================================== */}
      <footer className="player-bar">
        {/* Left: Track Info & Like */}
        <div className="player-left">
          <div className={`player-thumb ${playing ? "spin" : ""}`}>
            {currentTrack.artworkUrl ? (
              <img
                src={currentTrack.artworkUrl}
                alt={currentTrack.title}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--radius-sm)" }}
              />
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </div>
          <div className="player-meta">
            <span
              className="player-title"
              onClick={() => setActiveTab("queue")}
            >
              {currentTrack?.title || "Ready to Drift"}
            </span>
            <span className="player-artist">
              {currentTrack?.artist || "Mood Drift"} · {currentTrack?.language}
            </span>
          </div>

          <button
            className={`player-btn-like ${likedTrackIDs.includes(current.trackId) ? "liked" : ""}`}
            onClick={() => toggleLike(current.trackId)}
            title={likedTrackIDs.includes(current.trackId) ? "Unlike" : "Like"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill={likedTrackIDs.includes(current.trackId) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Center: Controls & Scrubber */}
        <div className="player-center">
          <div className="player-controls">
            {/* Drift / Shuffle */}
            <button
              className={`control-btn ${shuffleMode ? "active" : ""}`}
              onClick={() => {
                setShuffleMode((v) => !v);
                showToast(shuffleMode ? "Sequential drift active" : "Random drift active");
              }}
              title="Drift Mode"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
            </button>

            {/* Replay */}
            <button
              className="control-btn"
              onClick={replayTrack}
              title="Replay"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="11 19 2 12 11 5 11 19" />
                <polygon points="22 19 13 12 22 5 22 19" />
              </svg>
            </button>

            {/* Play / Pause (Big Circular Button) */}
            <button
              className="control-btn-play"
              onClick={togglePlay}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            {/* Skip */}
            <button
              className="control-btn"
              onClick={skipTrack}
              title="Skip"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>

            {/* Repeat */}
            <button
              className="control-btn"
              onClick={replayTrack}
              title="Repeat"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
          </div>

          {/* Scrubber Progress Bar */}
          <div className="progress-bar-row">
            <span className="timestamp">{formatSeconds(progress)}</span>
            <div
              className="scrubber-track"
              onClick={handleScrubberClick}
              role="slider"
              aria-label="Playback progress"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={duration || 30}
            >
              <div
                className="scrubber-fill"
                style={{
                  width: `${Math.min(100, (progress / (duration || 30)) * 100)}%`,
                }}
              >
                <div className="scrubber-thumb" />
              </div>
            </div>
            <span className="timestamp">{formatSeconds(duration || 30)}</span>
          </div>
        </div>

        {/* Right: Mode Toggle, Canvas Video, Volume & Mood Coordinates */}
        <div className="player-right">
          {/* Engine Selector: Spotify (Full) vs YouTube (Full) vs 30s Snippet */}
          <div className="playback-mode-toggle">
            <button
              className={`mode-pill spotify-pill ${playbackMode === "spotify" ? "active" : ""}`}
              onClick={() => switchPlaybackMode("spotify")}
              title="Stream official full lengthy song directly through Spotify Master"
            >
              🟢 Spotify
            </button>
            <button
              className={`mode-pill ${playbackMode === "full" ? "active" : ""}`}
              onClick={() => switchPlaybackMode("full")}
              title="Play complete full-length YouTube video & audio (3-5+ mins)"
            >
              🎵 YouTube
            </button>
            <button
              className={`mode-pill ${playbackMode === "preview" ? "active" : ""}`}
              onClick={() => switchPlaybackMode("preview")}
              title="Play 30-second quick snippet"
            >
              ⚡ 30s
            </button>
          </div>

          {/* Open in Spotify App Link */}
          <a
            href={getSpotifySearchUrl(currentTrack)}
            target="_blank"
            rel="noreferrer"
            className="control-btn spotify-direct-btn"
            title="Open in Spotify App"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
            </svg>
          </a>

          {/* Continuous Run Mode Toggle */}
          <button
            className={`mode-pill ${continuousLoop ? "active" : ""}`}
            onClick={() => {
              setContinuousLoop((c) => {
                const nextVal = !c;
                showToast(nextVal ? "Continuous Loop: ON" : "Continuous Loop: OFF (auto next)");
                return nextVal;
              });
            }}
            title={continuousLoop ? "Loop current song continuously" : "Autoplay next in queue"}
          >
            {continuousLoop ? "🔁 Loop: ON" : "➡️ Autoplay Next"}
          </button>

          {/* Toggle Full Video Modal */}
          {currentTrack?.youtubeId && (
            <button
              className={`control-btn ${showVideoModal ? "active" : ""}`}
              onClick={() => setShowVideoModal((v) => !v)}
              title="Watch Official HD Music Video"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <polygon points="10 7 15 10 10 13 10 7" fill="currentColor" />
                <line x1="2" y1="21" x2="22" y2="21" />
              </svg>
            </button>
          )}

          <div className="mood-pill-mini">
            <span>V: {current.trackMood.valence.toFixed(2)}</span>
            <span>·</span>
            <span>A: {current.trackMood.arousal.toFixed(2)}</span>
          </div>

          <button
            className="control-btn"
            onClick={() => setShowCheckInModal(true)}
            title="Adjust Current Vibe"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
            </svg>
          </button>

          {/* Volume Control */}
          <div className="volume-row">
            <button
              className="volume-btn"
              onClick={() => setIsMuted((m) => !m)}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
            <input
              type="range"
              className="spotify-range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                if (isMuted) setIsMuted(false);
              }}
              title="Volume"
            />
          </div>
        </div>
      </footer>

      {/* ==========================================================================
          MID-SESSION CHECK-IN MODAL (Quick Tuning)
          ========================================================================== */}
      {showCheckInModal && (
        <div className="modal-backdrop" onClick={() => setShowCheckInModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Adjust Your Vibe Mid-Session</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowCheckInModal(false)}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
              Adjust where you are right now. The engine will smoothly re-route all upcoming tracks in the queue without interrupting current playback.
            </p>

            <div className="control-group">
              <label className="control-label">
                Current Feeling (Valence) <span>{sessionMood.valence.toFixed(2)}</span>
              </label>
              <input
                type="range"
                className="spotify-range"
                min="0"
                max="1"
                step="0.01"
                value={sessionMood.valence}
                onChange={(e) => setSessionMood({ ...sessionMood, valence: Number(e.target.value) })}
              />
            </div>

            <div className="control-group">
              <label className="control-label">
                Current Energy (Arousal) <span>{sessionMood.arousal.toFixed(2)}</span>
              </label>
              <input
                type="range"
                className="spotify-range"
                min="0"
                max="1"
                step="0.01"
                value={sessionMood.arousal}
                onChange={(e) => setSessionMood({ ...sessionMood, arousal: Number(e.target.value) })}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "10px" }}>
              <button
                className="btn-outline"
                onClick={() => setShowCheckInModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-pill"
                onClick={submitCheckIn}
                disabled={busy}
              >
                Update Upcoming Path
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          TOAST NOTIFICATION
          ========================================================================== */}
      {toastMessage && (
        <div className="toast-container">
          <div className="toast">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
