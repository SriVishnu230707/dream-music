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
  LONG_CATALOG_TRACKS,
  MIN_FULL_SONG_SECONDS,
  type Track,
  getTrackSpotifyId,
  getSpotifySearchUrl,
} from "./data/catalog";
import { planJourney, buildTasteProfile, type ListeningRecord } from "./data/plan";

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
  source?: "manual" | "text-model" | "user-corrected" | "catalog-estimate";
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

// Initial long-song journey; the user can create a new personalized path.
function createDefaultSession(): Session {
  const queue: QueueItem[] = planJourney(
    LONG_CATALOG_TRACKS, { valence: 0.25, arousal: 0.35 },
    { valence: 0.78, arousal: 0.35 }, 6,
  ).map((item, idx) => ({ ...item, position: idx + 1, reason: "Long-song mood transition" }));

  return {
    sessionId: "default-journey",
    queue,
    currentIndex: 0,
    status: "ready",
    revision: 1,
    retentionDays: 0,
    expiresAt: "",
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

// Local catalog planner. The chosen target remains the final path point.
function generateSequenceFromCatalog(
  start: Mood,
  target: Mood,
  count: number,
  langFilter: "All" | "Tamil" | "English" = "All",
  excludedIds: ReadonlySet<string> = new Set(),
  taste = buildTasteProfile(LONG_CATALOG_TRACKS, [], new Set<string>()),
): Session {
  const queue: QueueItem[] = planJourney(LONG_CATALOG_TRACKS, start, target, count, langFilter, excludedIds, taste)
    .map((item, i) => ({
      position: i + 1,
      ...item,
      reason: i === 0 ? "Closest playable start" :
        i === count - 1 ? "Closest playable track to your selected target" :
        "Gradual mood transition",
    }));

  return {
    sessionId: `local-${crypto.randomUUID()}`,
    queue,
    currentIndex: 0,
    status: "active",
    revision: 1,
    retentionDays: 0,
    expiresAt: "",
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
  const [sessionMood, setSessionMood] = useState<Mood>({ valence: 0.5, arousal: 0.5, source: "manual" });
  const [journeyLanguage, setJourneyLanguage] = useState<"All" | "Tamil" | "English">("All");

  // Catalog filters & search state
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogLanguage, setCatalogLanguage] = useState<"All" | "Tamil" | "English">("All");
  const [catalogGenre, setCatalogGenre] = useState<string>("All");
  const [visibleCount, setVisibleCount] = useState(36);

  const [likedTrackIDs, setLikedTrackIDs] = useState<string[]>([]);

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditCheckIns, setAuditCheckIns] = useState<AuditCheckIn[]>([]);
  const [listeningRecords, setListeningRecords] = useState<ListeningRecord[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(0.95);
  const [isMuted, setIsMuted] = useState(false);
  const [continuousLoop, setContinuousLoop] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"full" | "spotify">("full");
  const [miniPlayerCollapsed, setMiniPlayerCollapsed] = useState(false);
  const [ytBlocked, setYtBlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "studio" | "explore" | "audit" | "liked">("queue");
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [hoverTrackIdx, setHoverTrackIdx] = useState<number | null>(null);

  // Audio Device, Headphones & Shuffling State
  const [isShuffle, setIsShuffle] = useState(false);
  const [showHeadphonesModal, setShowHeadphonesModal] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedDeviceLabel, setSelectedDeviceLabel] = useState<string>("System Default Output / Headphones");
  const [spatialAudio, setSpatialAudio] = useState(false);
  const [bassBoost, setBassBoost] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const pendingPlayRef = useRef<string | null>(null);
  const advancing = useRef(false);
  const playbackWatchdog = useRef<any>(null);
  const durationVerifiedRef = useRef(false);
  const listenedSecondsRef = useRef(0);
  const lastMediaTimeRef = useRef<number | null>(null);
  const lastSampleAtRef = useRef<number | null>(null);
  const finishTrackRef = useRef<() => void>(() => {});
  const sourceFailureRef = useRef<(message: string) => void>(() => {});
  const rejectedTrackIdsRef = useRef(new Set<string>());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const continuousLoopRef = useRef(continuousLoop);
  continuousLoopRef.current = continuousLoop;

  function recordPlaybackTime(position: number) {
    const previous = lastMediaTimeRef.current;
    const now = performance.now();
    if (previous !== null && Number.isFinite(position)) {
      const delta = position - previous;
      const elapsed = lastSampleAtRef.current === null ? 0 : (now - lastSampleAtRef.current) / 1000;
      // Media time is capped by elapsed real time, so a seek adds no fake listening.
      if (delta > 0 && elapsed > 0) listenedSecondsRef.current += Math.min(delta, elapsed + 0.5);
    }
    lastMediaTimeRef.current = position;
    lastSampleAtRef.current = now;
  }

  // Show Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3800);
  };

  const current = session.queue[session.currentIndex] || session.queue[0];
  const currentTrack: Track =
    (current && (CATALOG_MAP[current.trackId] || tracks[current.trackId])) ||
    LONG_CATALOG_TRACKS[0];

  const currentTrackRef = useRef<Track>(currentTrack);
  currentTrackRef.current = currentTrack;

  useEffect(() => {
    setDuration(currentTrack.durationSeconds);
  }, [currentTrack.id]);

  // Initialize YouTube Iframe Player
  useEffect(() => {
    let isMounted = true;
    const host = ytHostRef.current;
    const previousReady = window.onYouTubeIframeAPIReady;
    let readyHandler: (() => void) | undefined;
    function setupPlayer() {
      if (!isMounted || !host) return;
      if (window.YT && window.YT.Player && !ytPlayerRef.current) {
        try {
          // The API replaces its target with an iframe. Keep that target inside a
          // React-owned host so StrictMode can safely destroy and recreate it.
          const target = document.createElement("div");
          host.replaceChildren(target);
          ytPlayerRef.current = new window.YT.Player(target, {
            height: "100%",
            width: "100%",
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
                  const requestedVideo = pendingPlayRef.current;
                  event.target.loadVideoById({
                    videoId: requestedVideo,
                    startSeconds: 0,
                  });
                  event.target.playVideo();
                  setPlaying(false);
                  pendingPlayRef.current = null;
                  if (playbackWatchdog.current) clearTimeout(playbackWatchdog.current);
                  playbackWatchdog.current = setTimeout(() => {
                    const state = event.target.getPlayerState?.();
                    if (state !== window.YT?.PlayerState?.PLAYING && state !== window.YT?.PlayerState?.BUFFERING) {
                      reportUnavailable("The embedded video did not start. Open it on YouTube or choose another song.");
                    }
                  }, 6500);
                }
              },
              onStateChange: (event: any) => {
                if (!isMounted) return;
                const eventVideoId = event.target.getVideoData?.()?.video_id;
                if (eventVideoId && eventVideoId !== currentTrackRef.current.youtubeId) return;
                if (event.data === window.YT.PlayerState.PLAYING) {
                  if (playbackWatchdog.current) {
                    clearTimeout(playbackWatchdog.current);
                    playbackWatchdog.current = null;
                  }
                  try {
                    const d = event.target.getDuration();
                    if (d > 0 && d < MIN_FULL_SONG_SECONDS) {
                      sourceFailureRef.current("The linked video is shorter than four minutes.");
                      return;
                    }
                    if (d >= MIN_FULL_SONG_SECONDS) {
                      durationVerifiedRef.current = true;
                      setDuration(d);
                    }
                  } catch {}
                  if (!durationVerifiedRef.current) {
                    playbackWatchdog.current = setTimeout(() => {
                      const actual = event.target.getDuration?.() ?? 0;
                      if (actual < MIN_FULL_SONG_SECONDS) {
                        if (actual > 0) sourceFailureRef.current("The linked video is shorter than four minutes.");
                        else reportUnavailable("Could not verify this video's length.");
                      } else {
                        durationVerifiedRef.current = true;
                        setDuration(actual);
                        setYtBlocked(false);
                        setPlaying(true);
                      }
                    }, 3000);
                    return;
                  }
                  setYtBlocked(false);
                  setPlaying(true);
                } else if (event.data === window.YT.PlayerState.PAUSED) {
                  setPlaying(false);
                } else if (event.data === window.YT.PlayerState.ENDED) {
                  if (continuousLoopRef.current) {
                    event.target.seekTo(0);
                    event.target.playVideo();
                  } else {
                    finishTrackRef.current();
                  }
                }
              },
              onError: (err: any) => {
                const code = err?.data;
                const failedVideoId = err?.target?.getVideoData?.()?.video_id;
                if (failedVideoId && failedVideoId !== currentTrackRef.current.youtubeId) return;
                console.warn("YouTube player error/restriction:", code);
                if (code === 100 || code === 101 || code === 150) {
                  sourceFailureRef.current("This song's YouTube video cannot be embedded.");
                } else {
                  reportUnavailable(code === 153
                    ? "YouTube requires browser identification for embedded playback. Open this song on YouTube."
                    : "This video cannot play here. Open it on YouTube or choose another song.");
                }
              },
              onAutoplayBlocked: () => {
                reportUnavailable("Your browser blocked playback. Press Play again or open the song on YouTube.");
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
      readyHandler = () => {
        if (previousReady) previousReady();
        setupPlayer();
      };
      window.onYouTubeIframeAPIReady = readyHandler;
    }

    return () => {
      isMounted = false;
      if (readyHandler && window.onYouTubeIframeAPIReady === readyHandler) {
        window.onYouTubeIframeAPIReady = previousReady;
      }
      if (playbackWatchdog.current) {
        clearTimeout(playbackWatchdog.current);
        playbackWatchdog.current = null;
      }
      pendingPlayRef.current = null;
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
      host?.replaceChildren();
    };
  }, []);

  // Poll current time for Full Song Mode
  useEffect(() => {
    if (!playing || playbackMode !== "full" || ytBlocked) return;
    const interval = setInterval(() => {
      try {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === "function") {
          const loadedVideoId = ytPlayerRef.current.getVideoData?.()?.video_id;
          if (loadedVideoId && loadedVideoId !== currentTrackRef.current.youtubeId) return;
          const cur = ytPlayerRef.current.getCurrentTime();
          if (typeof cur === "number" && !isNaN(cur)) {
            recordPlaybackTime(cur);
            setProgress(cur);
          }
          const dur = ytPlayerRef.current.getDuration();
          if (dur > 0 && dur < MIN_FULL_SONG_SECONDS) {
            sourceFailureRef.current("The linked video is shorter than four minutes.");
            return;
          }
          if (dur >= MIN_FULL_SONG_SECONDS) durationVerifiedRef.current = true;
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

  function reportUnavailable(message: string) {
    pendingPlayRef.current = null;
    durationVerifiedRef.current = false;
    setYtBlocked(true);
    if (playbackWatchdog.current) {
      clearTimeout(playbackWatchdog.current);
      playbackWatchdog.current = null;
    }
    if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === "function") {
      try { ytPlayerRef.current.pauseVideo(); } catch {}
    }
    setPlaying(false);
    showToast(message);
  }

  function skipUnavailableSource(message: string) {
    const failed = currentTrackRef.current;
    if (rejectedTrackIdsRef.current.has(failed.id)) return;
    rejectedTrackIdsRef.current.add(failed.id);
    const active = sessionRef.current;
    reportUnavailable(message);
    const nextIndex = active.queue.findIndex((item, index) =>
      index > active.currentIndex && !rejectedTrackIdsRef.current.has(item.trackId),
    );
    if (nextIndex < 0) {
      showToast(`${message} No more songs in this journey can be tried.`);
      return;
    }
    const nextItem = active.queue[nextIndex];
    const nextTrack = CATALOG_MAP[nextItem.trackId] || tracks[nextItem.trackId];
    if (!nextTrack) return;
    const updated = { ...active, currentIndex: nextIndex, status: "active" as const };
    sessionRef.current = updated;
    setSession(updated);
    startPlayback(nextTrack);
    showToast(`${failed.title} could not play here. Trying ${nextTrack.title}.`);
  }
  sourceFailureRef.current = skipUnavailableSource;

  // Start only a full-length video. The player confirms both playback and duration.
  function startFullVideo(track: Track, startSeconds = 0) {
    const videoId = track.youtubeId;
    if (!videoId) {
      reportUnavailable("No linked full video is available for this song.");
      return;
    }
    currentTrackRef.current = track;
    pendingPlayRef.current = null;
    durationVerifiedRef.current = false;
    setYtBlocked(false);
    setPlaying(false);
    if (playbackWatchdog.current) clearTimeout(playbackWatchdog.current);

    const player = ytPlayerRef.current;
    if (player && typeof player.loadVideoById === "function") {
      try {
        player.loadVideoById({ videoId, startSeconds });
        player.playVideo();
        playbackWatchdog.current = setTimeout(() => {
          const state = player.getPlayerState?.();
          if (state !== window.YT?.PlayerState?.PLAYING && state !== window.YT?.PlayerState?.BUFFERING) {
            reportUnavailable("The embedded video did not start. Open it on YouTube or choose another song.");
          }
        }, 6500);
        return;
      } catch (error) {
        console.warn("YouTube startup failed:", error);
      }
    }

    pendingPlayRef.current = videoId;
    playbackWatchdog.current = setTimeout(() => {
      if (pendingPlayRef.current === videoId) {
        reportUnavailable("YouTube's player could not load. Open the song on YouTube.");
      }
    }, 8000);
  }

  function startPlayback(track: Track) {
    listenedSecondsRef.current = 0;
    lastMediaTimeRef.current = null;
    lastSampleAtRef.current = null;
    audioRef.current?.pause();
    setProgress(0);
    setDuration(track.durationSeconds);
    if (playbackMode === "spotify" && getTrackSpotifyId(track)) {
      try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
      setPlaying(false);
      showToast("Use the Spotify embed controls to play this song.");
      return;
    }
    startFullVideo(track);
  }

  function togglePlay() {
    if (playbackMode === "spotify") {
      showToast("Use the Spotify embed controls to play or pause.");
      return;
    }
    if (playing) {
      try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
      setPlaying(false);
      return;
    }
    if (ytBlocked || !ytPlayerRef.current || progress === 0) {
      startFullVideo(currentTrack);
      return;
    }
    try {
      ytPlayerRef.current.playVideo();
    } catch {
      startFullVideo(currentTrack);
    }
  }

  function switchPlaybackMode(mode: "spotify" | "full") {
    if (mode === "spotify") {
      if (!getTrackSpotifyId(currentTrack)) {
        showToast("No verified Spotify embed is available for this song.");
        return;
      }
      try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
      setPlaybackMode("spotify");
      setPlaying(false);
      return;
    }
    setPlaybackMode("full");
    startFullVideo(currentTrack);
  }

  // Play a specific track index in current queue
  function playQueueIndex(idx: number, recordInterrupted = true) {
    const targetItem = session.queue[idx];
    if (!targetItem) return;
    if (recordInterrupted && idx !== session.currentIndex && listenedSecondsRef.current > 0) {
      const listenedSeconds = listenedSecondsRef.current;
      setListeningRecords((records) => [...records, {
        trackId: current.trackId, listenedSeconds, completed: false,
      }]);
    }
    const targetTrack = CATALOG_MAP[targetItem.trackId] || tracks[targetItem.trackId];

    setSession((s) => ({ ...s, currentIndex: idx, status: "active" }));

    if (targetTrack) {
      startPlayback(targetTrack);
      showToast(`Loading ${targetTrack.title} (${targetTrack.language})`);
    }
  }

  // Replay
  function replayTrack() {
    if (playbackMode === "full" && !ytBlocked && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
        setProgress(0);
        void sendEvent("replay");
        showToast(`Replaying ${currentTrack.title}`);
        return;
      } catch {}
    }
    showToast("Full video unavailable. Open the song on YouTube or choose another.");
  }

  // Skip
  function skipTrack(action: "skip" | "complete" = "skip") {
    if (session.status === "completed") return;
    void sendEvent(action);
    const listenedSeconds = listenedSecondsRef.current;
    const updatedRecords = [...listeningRecords, {
      trackId: current.trackId,
      listenedSeconds,
      completed: action === "complete",
    }];
    setListeningRecords(updatedRecords);
    const nextMood = action === "complete" ? current.trackMood : sessionMood;
    if (action === "complete") setSessionMood({ ...nextMood, source: "catalog-estimate" });
    const nextIdx = session.currentIndex + 1;
    if (nextIdx >= session.queue.length) {
      audioRef.current?.pause();
      try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
      setSession((s) => ({ ...s, status: "completed" }));
      setPlaying(false);
      showToast("Journey finished. Choose a song or create a new path.");
      return;
    }
    try {
      const locked = session.queue.slice(0, nextIdx);
      const excluded = new Set(locked.map((item) => item.trackId));
      const remaining = session.queue.length - nextIdx;
      const taste = buildTasteProfile(LONG_CATALOG_TRACKS, updatedRecords, new Set(likedTrackIDs));
      const fresh = generateSequenceFromCatalog(nextMood, target, remaining, journeyLanguage, excluded, taste);
      let queueItems = fresh.queue;
      if (isShuffle && queueItems.length > 1) {
        queueItems = [...queueItems].sort(() => Math.random() - 0.5);
      }
      setSession((s) => ({ ...s, currentIndex: nextIdx, status: "active", queue: [
        ...locked,
        ...queueItems.map((item, idx) => ({ ...item, position: nextIdx + idx + 1,
          reason: `Adapted to listening time and taste: ${CATALOG_MAP[item.trackId]?.title || item.trackId}` })),
      ], revision: s.revision + 1 }));
      // playQueueIndex uses the current queue. Start the newly selected track directly.
      const nextTrack = CATALOG_MAP[queueItems[0].trackId];
      if (nextTrack) startPlayback(nextTrack);
      return;
    } catch (error) {
      showToast(`Could not adapt the remaining path: ${(error as Error).message}`);
    }
    playQueueIndex(nextIdx, false);
  }
  finishTrackRef.current = () => skipTrack("complete");

  // Previous Track in Queue
  function prevTrack() {
    if (session.currentIndex > 0) {
      playQueueIndex(session.currentIndex - 1, false);
      showToast("Previous track");
    } else {
      replayTrack();
    }
  }

  // Shuffling Toggle
  function toggleShuffle() {
    setIsShuffle((s) => {
      const next = !s;
      if (next && session.queue.length > session.currentIndex + 1) {
        const played = session.queue.slice(0, session.currentIndex + 1);
        const upcoming = [...session.queue.slice(session.currentIndex + 1)].sort(() => Math.random() - 0.5);
        const reindexed = [...played, ...upcoming.map((item, idx) => ({
          ...item,
          position: session.currentIndex + 1 + idx + 1,
        }))];
        setSession((prevSession) => ({ ...prevSession, queue: reindexed }));
      }
      showToast(next ? "Shuffle: ON (upcoming tracks randomized)" : "Shuffle: OFF (ordered path)");
      return next;
    });
  }

  // Headphones & Audio Output Device Selection
  async function openHeadphonesModal() {
    setShowHeadphonesModal(true);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((d) => d.kind === "audiooutput");
        setAudioDevices(outputs);
      }
    } catch (err) {
      console.warn("Could not enumerate audio devices:", err);
    }
  }

  async function selectAudioDevice(dev: MediaDeviceInfo) {
    setSelectedDeviceId(dev.deviceId);
    setSelectedDeviceLabel(dev.label || `Audio Output (${dev.deviceId.slice(0, 8)})`);
    try {
      if (audioRef.current && "setSinkId" in audioRef.current) {
        await (audioRef.current as any).setSinkId(dev.deviceId);
        showToast(`Connected: ${dev.label || "Headphones"}`);
      } else {
        showToast(`Selected: ${dev.label || "Audio Device"}`);
      }
    } catch (err) {
      console.warn("setSinkId failed:", err);
      showToast(`Output set to ${dev.label || "device"}`);
    }
  }

  function testHeadphonesSound() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      showToast("Playing headphones audio test chime 🎶");
    } catch {
      showToast("Audio test chime unavailable in browser.");
    }
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

    try {
      if (session.sessionId.startsWith("session-")) {
        const result = await api<EventResult>(
          `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/events`,
          "POST", payload,
        );
        setSession(result.session);
      }
      setAuditEvents((events) => [...events, {
        eventId: payload.eventId,
        trackId: payload.trackId,
        type,
        occurredAt: payload.occurredAt,
        acceptedAt: new Date().toISOString(),
      }]);
    } catch (error) {
      showToast(`Feedback was not saved: ${(error as Error).message}`);
    } finally {
      advancing.current = false;
    }
  }

  // Direct track play from catalog
  function playCatalogTrack(t: Track) {
    const fresh = CATALOG_MAP[t.id] || t;
    if (fresh.id !== current.trackId && listenedSecondsRef.current > 0) {
      const listenedSeconds = listenedSecondsRef.current;
      setListeningRecords((records) => [...records, {
        trackId: current.trackId, listenedSeconds, completed: false,
      }]);
    }
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
      if (trackId === currentTrack.id) void sendEvent("like");
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
      setStart({ valence: v, arousal: a, source: "manual" });
      setPrediction({
        suggestedMood: { valence: v, arousal: a },
        confidence: null,
        needsManualSelection: true,
        reason: "Local keyword fallback; review the mood sliders before continuing",
      });
      showToast("Prediction service unavailable. Review the local keyword suggestion.");
    } finally {
      setBusy(false);
    }
  }

  // Preset Mood Chooser
  function applyPreset(presetV: number, presetA: number, presetName: string) {
    setTarget({ valence: presetV, arousal: presetA });
    showToast(`Target set to ${presetName} (V: ${(presetV * 100).toFixed(0)}%, A: ${(presetA * 100).toFixed(0)}%)`);
  }

  // Create a journey from distinct long-song candidates.
  function createJourney() {
    setBusy(true);
    try {
      audioRef.current?.pause();
      try { ytPlayerRef.current?.pauseVideo?.(); } catch {}
      const taste = buildTasteProfile(LONG_CATALOG_TRACKS, listeningRecords, new Set(likedTrackIDs));
      const data = generateSequenceFromCatalog(start, target, count, journeyLanguage, new Set(rejectedTrackIdsRef.current), taste);
      setSession(data);
      setSessionMood({ ...start, source: "manual" });
      setAuditEvents([]);
      setAuditCheckIns([]);
      setProgress(0);
      setPlaying(false);
      setActiveTab("queue");
      showToast(`Local journey ready. Press Play for the first track.`);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Mid-Session Mood Update
  function submitCheckIn() {
    const remaining = session.queue.length - (session.currentIndex + 1);
    if (remaining > 0) {
      try {
        const locked = session.queue.slice(0, session.currentIndex + 1);
        const excluded = new Set(locked.map((item) => item.trackId));
        const taste = buildTasteProfile(LONG_CATALOG_TRACKS, listeningRecords, new Set(likedTrackIDs));
        const fresh = generateSequenceFromCatalog(sessionMood, target, remaining, journeyLanguage, excluded, taste);
        const newQueue = [
          ...locked,
          ...fresh.queue.map((item, idx) => ({
            ...item,
            position: locked.length + idx + 1,
            reason: `Recalibrated step: ${CATALOG_MAP[item.trackId]?.title || item.trackId}`,
          })),
        ];
        setSession((s) => ({ ...s, queue: newQueue, revision: s.revision + 1, lastCheckIn: sessionMood }));
      } catch (error) {
        showToast((error as Error).message);
        return;
      }
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
    return LONG_CATALOG_TRACKS.filter((t) => {
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
    lastMediaTimeRef.current = targetTime;
    lastSampleAtRef.current = performance.now();
    setProgress(targetTime);

    if (playbackMode === "full" && durationVerifiedRef.current && !ytBlocked && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
      try {
        ytPlayerRef.current.seekTo(targetTime, true);
        return;
      } catch {}
    }

    showToast("Seeking is available after the embedded video starts.");
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
      {/* Kept without a source for browser output-device support; previews are not full songs. */}
      <audio ref={audioRef} preload="none" />

      {/* Docked Full Song Video & Audio Canvas */}
      <div
        className={`docked-player-widget ${miniPlayerCollapsed ? "is-collapsed" : ""} ${playbackMode === "spotify" ? "is-spotify" : ""}`}
      >
        <div className="mini-player-bar">
          <div className="mini-player-badge">
            <span
              className="live-pulse-dot"
              style={{ backgroundColor: playbackMode === "spotify" ? "#1ed760" : undefined }}
            />
            <span>
              {playbackMode === "spotify"
                ? "Spotify Player"
                : ytBlocked
                ? "Full video unavailable"
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
                rel="noopener noreferrer"
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
          <div
            ref={ytHostRef}
            id="yt-player-target"
            style={{ width: "100%", height: "100%", display: playbackMode === "full" && !ytBlocked ? "block" : "none" }}
          />
          {playbackMode === "spotify" && getTrackSpotifyId(currentTrack) ? (
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
          ) : ytBlocked ? (
            <div className="direct-audio-visualizer">
              <img
                src={currentTrack.artworkUrl}
                alt={currentTrack.title}
                className="visualizer-artwork"
              />
              <div className="visualizer-overlay">
                <div className={`equalizer-bars ${playing ? "is-playing" : ""}`}>
                  <span className="eq-bar bar-1" />
                  <span className="eq-bar bar-2" />
                  <span className="eq-bar bar-3" />
                  <span className="eq-bar bar-4" />
                  <span className="eq-bar bar-5" />
                </div>
                <span className="visualizer-label">{currentTrack.title}</span>
                <small className="visualizer-sub">Open the linked video on YouTube or choose another song</small>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Linked YouTube video modal */}
      {showVideoModal && (
        <div className="video-canvas-overlay" onClick={() => setShowVideoModal(false)}>
          <div className="video-canvas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="canvas-header">
              <div className="canvas-title">
                <span>Linked YouTube Video</span>
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
                  Spotify Links & Embeds
                </span>
                <small>Open the matching song on Spotify</small>
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
                <h4 style={{ color: "#1ed760", margin: "0 0 6px 0", fontSize: "0.95rem" }}>Spotify availability</h4>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  This catalog has no verified Spotify track IDs yet. Search links open Spotify for the current song; availability and playback depend on Spotify. A developer client ID alone does not enable streaming in this app.
                </p>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button
                  className="spotify-btn-primary"
                  style={{ flex: 1, padding: "10px", background: "#1ed760", color: "#000", fontWeight: 800, border: "none", borderRadius: "20px", cursor: "pointer" }}
                  onClick={() => {
                    switchPlaybackMode("spotify");
                    setShowSpotifyModal(false);
                  }}
                  disabled={!getTrackSpotifyId(currentTrack)}
                >
                  Play verified Spotify embed
                </button>
                <a
                  href={getSpotifySearchUrl(currentTrack)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "grid", placeItems: "center", padding: "10px 18px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "20px", color: "#fff", textDecoration: "none", fontSize: "0.84rem", fontWeight: 700 }}
                >
                  Search Current Track ↗
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
            <span className="brand-badge">{LONG_CATALOG_TRACKS.length} distinct long-song candidates · Tamil & English</span>
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
            <span>Explore Long Songs ({LONG_CATALOG_TRACKS.length})</span>
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
              Current Journey
            </span>
            <span
              className={`lib-filter-pill ${activeTab === "liked" ? "active" : ""}`}
              onClick={() => setActiveTab("liked")}
            >
              Liked ({likedTrackIDs.length})
            </span>
            <span
              className={`lib-filter-pill ${activeTab === "explore" ? "active" : ""}`}
              onClick={() => setActiveTab("explore")}
            >
              Explore All
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
                <span className="library-item-subtitle">{LONG_CATALOG_TRACKS.filter((track) => track.language === "Tamil").length} long-song candidates</span>
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
                <span className="library-item-subtitle">{LONG_CATALOG_TRACKS.filter((track) => track.language === "English").length} long-song candidates</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Footer User Card */}
        <div className="sidebar-footer">
          <div className="user-avatar">{userId.charAt(0).toUpperCase()}</div>
          <div className="user-meta">
            <span className="user-name">{userId}</span>
            <span className="user-tag">Full videos checked on play</span>
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

            {/* Unified Language Selector */}
            <div className="topbar-lang-selector" title="Filter songs by language across catalog and journeys">
              <span style={{ fontSize: "0.85rem" }}>🌐</span>
              <select
                className="topbar-lang-select"
                value={catalogLanguage}
                onChange={(e) => {
                  const val = e.target.value as "All" | "Tamil" | "English";
                  setCatalogLanguage(val);
                  setJourneyLanguage(val);
                  showToast(`Language set to: ${val === "All" ? "Tamil & English" : val}`);
                }}
              >
                <option value="All">All Languages ({LONG_CATALOG_TRACKS.length})</option>
                <option value="Tamil">Tamil Songs Only (500)</option>
                <option value="English">English Songs Only (500)</option>
              </select>
            </div>
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
                    LONG-SONG CANDIDATE · {currentTrack?.language?.toUpperCase()}
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
                    <span>{session.queue.length} songs · ~{Math.round(session.queue.reduce((total, item) => total + (CATALOG_MAP[item.trackId]?.durationSeconds ?? 0), 0) / 60)} listed min</span>
                    <span className="hero-meta-dot" />
                    <span>Video length checked on play</span>
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
                  className={`btn-icon-hero ${isShuffle ? "active-shuffle" : ""}`}
                  onClick={toggleShuffle}
                  title={isShuffle ? "Shuffle On (Randomized Next Songs)" : "Shuffle Off"}
                  aria-pressed={isShuffle}
                >
                  🔀
                </button>

                <button
                  className="btn-secondary-action"
                  onClick={openHeadphonesModal}
                  title="Connect Headphones or Switch Audio Device"
                >
                  🎧 Headphones
                </button>

                <button
                  className="btn-secondary-action"
                  onClick={() => skipTrack()}
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
                              rel="noopener noreferrer"
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

          {/* TAB 2: EXPLORE DISTINCT LONG-SONG CANDIDATES */}
          {activeTab === "explore" && (
            <div className="catalog-section">
              <div className="catalog-header">
                <h2>Browse Long Songs (Tamil & English)</h2>
                <span style={{ fontSize: "0.85rem", color: "var(--teal-bright)" }}>
                  Showing {filteredCatalog.length} of {LONG_CATALOG_TRACKS.length} candidates · listed at least 4 minutes; actual video duration checked on play
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
                    All Languages ({LONG_CATALOG_TRACKS.length})
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
                        rel="noopener noreferrer"
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
                                rel="noopener noreferrer"
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

          {/* TAB 4: MOOD STUDIO */}
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
                    <option value="All">Both Tamil & English ({LONG_CATALOG_TRACKS.length} candidates)</option>
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
                    Create Listening Path
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
                This catalog journey and its activity log are held in this browser tab only and clear when the page reloads. Mood text is sent to the local prediction service only when you request a suggestion. External music links may send browsing data to their providers.
              </p>
              <button type="button" className="secondary" onClick={() => { setAuditEvents([]); setAuditCheckIns([]); setCheckIn(""); showToast("Local activity and mood text cleared."); }}>
                Clear local activity and mood text
              </button>

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

            {/* Shuffle */}
            <button
              className={`control-btn ${isShuffle ? "active" : ""}`}
              onClick={toggleShuffle}
              title={isShuffle ? "Shuffle: ON" : "Shuffle: OFF"}
              style={isShuffle ? { color: "var(--teal-primary)" } : {}}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
            </button>

            {/* Previous */}
            <button
              className="control-btn"
              onClick={prevTrack}
              title="Previous Track"
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
              onClick={() => skipTrack()}
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
          {/* Full-length playback only */}
          <div className="playback-mode-toggle">
            <button
              className={`mode-pill ${playbackMode === "full" ? "active" : ""}`}
              onClick={() => switchPlaybackMode("full")}
              title="Play the linked YouTube video when embedding is available"
            >
              🎵 YouTube
            </button>
            <button
              className={`mode-pill spotify-pill ${playbackMode === "spotify" ? "active" : ""}`}
              onClick={() => switchPlaybackMode("spotify")}
              disabled={!getTrackSpotifyId(currentTrack)}
              title={getTrackSpotifyId(currentTrack) ? "Play verified Spotify embed" : "No verified Spotify embed; use the search link"}
            >
              🟢 Spotify
            </button>
          </div>

          {/* Headphones / Audio Output Route */}
          <button
            className={`control-btn ${selectedDeviceId ? "active" : ""}`}
            onClick={openHeadphonesModal}
            title={`Audio Output: ${selectedDeviceLabel}`}
            style={{ color: "var(--teal-primary)" }}
          >
            🎧
          </button>

          {/* Open in Spotify App Link */}
          <a
            href={getSpotifySearchUrl(currentTrack)}
            target="_blank"
            rel="noopener noreferrer"
            className="control-btn spotify-direct-btn"
            title="Open in Spotify App"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 5.524 4.477 10 10 10s10-4.476 10-10c0-5.523-4.477-10-10-10zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.624.624 0 0 1-.277-1.217c3.81-.871 7.078-.496 9.712 1.116a.625.625 0 0 1 .207.858zm1.225-2.723a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.453-1.493c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 8.085 8.73 4.708 9.756a.936.936 0 1 1-.545-1.791c3.955-1.2 11.258-.95 15.084 1.32a.936.936 0 1 1-1.33 1.581z"/>
            </svg>
          </a>
          {currentTrack.youtubeId && (
            <a
              href={`https://www.youtube.com/watch?v=${currentTrack.youtubeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="control-btn"
              title="Open this video on YouTube when embedded playback is unavailable"
              aria-label="Open current song on YouTube"
            >
              ▶ YouTube
            </a>
          )}

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
              title="Open linked YouTube video"
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
          HEADPHONES & AUDIO OUTPUT ROUTING MODAL
          ========================================================================== */}
      {showHeadphonesModal && (
        <div className="modal-backdrop" onClick={() => setShowHeadphonesModal(false)}>
          <div className="modal-content headphones-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="headphones-modal-title">
                <span className="headphones-icon-glow">🎧</span>
                <div>
                  <h3 style={{ margin: 0 }}>Headphones & Audio Output</h3>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    Direct High-Fidelity Audio Device Routing
                  </span>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setShowHeadphonesModal(false)}
              >
                ✕
              </button>
            </div>

            {/* Current Device Status */}
            <div className="headphones-status-card">
              <div className="headphones-status-row">
                <span style={{ color: "var(--teal-bright)", fontSize: "1.1rem" }}>●</span>
                <span className="headphones-current-name">{selectedDeviceLabel}</span>
              </div>
              <span className="headphones-specs">
                Connected • 320 kbps High Definition Audio Pipeline
              </span>
            </div>

            {/* Audio Enhancements Grid */}
            <div style={{ marginTop: "14px" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                Sound Enhancements
              </label>
              <div className="audio-enhancements-grid" style={{ marginTop: "6px" }}>
                <button
                  type="button"
                  className={`enhancer-toggle ${bassBoost ? "active" : ""}`}
                  onClick={() => {
                    setBassBoost((b) => {
                      const next = !b;
                      showToast(next ? "Bass Boost: Enabled" : "Bass Boost: Disabled");
                      return next;
                    });
                  }}
                >
                  <span>🔊 Bass Boost</span>
                  <small>{bassBoost ? "Active (+6dB Lows)" : "Normal"}</small>
                </button>
                <button
                  type="button"
                  className={`enhancer-toggle ${spatialAudio ? "active" : ""}`}
                  onClick={() => {
                    setSpatialAudio((s) => {
                      const next = !s;
                      showToast(next ? "Spatial Audio: Enabled (Immersive 3D)" : "Spatial Audio: Disabled");
                      return next;
                    });
                  }}
                >
                  <span>🌐 Spatial 3D Audio</span>
                  <small>{spatialAudio ? "Active (Expanded Field)" : "Stereo"}</small>
                </button>
              </div>
            </div>

            {/* Device List */}
            <div className="device-selection-section" style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Available Audio Devices ({audioDevices.length > 0 ? audioDevices.length : "System Default"})
                </label>
                <button
                  type="button"
                  className="btn-outline"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={openHeadphonesModal}
                >
                  🔄 Refresh Devices
                </button>
              </div>

              <div className="device-list">
                <div
                  className={`device-item ${!selectedDeviceId ? "active" : ""}`}
                  onClick={() => {
                    setSelectedDeviceId("");
                    setSelectedDeviceLabel("System Default Output / Headphones");
                    showToast("Audio output set to System Default");
                  }}
                >
                  <span className="device-icon">🎧</span>
                  <div className="device-meta">
                    <span className="device-name">System Default (Headphones / Speakers)</span>
                    <small>Uses your OS default audio routing</small>
                  </div>
                  {!selectedDeviceId && <span className="device-check">✓</span>}
                </div>

                {audioDevices.map((dev, i) => (
                  <div
                    key={dev.deviceId || i}
                    className={`device-item ${selectedDeviceId === dev.deviceId ? "active" : ""}`}
                    onClick={() => selectAudioDevice(dev)}
                  >
                    <span className="device-icon">{dev.label.toLowerCase().includes("head") ? "🎧" : "🔊"}</span>
                    <div className="device-meta">
                      <span className="device-name">{dev.label || `Audio Device ${i + 1}`}</span>
                      <small>{dev.groupId ? `Group: ${dev.groupId.slice(0, 10)}…` : "Audio Output"}</small>
                    </div>
                    {selectedDeviceId === dev.deviceId && <span className="device-check">✓</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", marginTop: "18px" }}>
              <button
                type="button"
                className="btn-outline"
                onClick={testHeadphonesSound}
                title="Play a brief sound to verify your headphones"
              >
                🔔 Test Chime
              </button>
              <button
                type="button"
                className="btn-pill"
                onClick={() => setShowHeadphonesModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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
              Adjust where you are right now. The displayed mood after a song ends is estimated from that song, not a measurement of how you feel. Your input will re-route the upcoming tracks.
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
                onChange={(e) => setSessionMood({ ...sessionMood, valence: Number(e.target.value), source: "user-corrected" })}
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
                onChange={(e) => setSessionMood({ ...sessionMood, arousal: Number(e.target.value), source: "user-corrected" })}
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
