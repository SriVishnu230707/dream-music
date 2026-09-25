import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

type Mood = {
  valence: number;
  arousal: number;
  source?: "manual" | "text-model" | "user-corrected";
  confidence?: number;
};
type QueueItem = {
  position: number;
  trackId: string;
  pathPoint: { valence: number; arousal: number };
  trackMood: { valence: number; arousal: number };
  reason: string;
};
type Session = {
  sessionId: string;
  queue: QueueItem[];
  currentIndex: number;
  status: "ready" | "active" | "completed";
  revision: number;
  retentionDays: number;
  expiresAt: string;
  lastCheckIn?: Mood;
};
type PlaybackEvent = "start" | "skip" | "complete" | "replay" | "like";
type AuditEvent = {
  eventId: string;
  trackId: string;
  type: PlaybackEvent;
  occurredAt: string;
  acceptedAt: string;
};
type AuditCheckIn = { id: string; mood: Mood; createdAt: string };
type EventResult = {
  accepted: boolean;
  revision: number;
  queueChanged: boolean;
  futureReplanned: boolean;
  session: Session;
};
type Track = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  durationSeconds: number;
  attribution: string;
  audioUrl: string;
};
type Prediction = {
  suggestedMood: { valence: number; arousal: number } | null;
  confidence: number | null;
  needsManualSelection: boolean;
  reason: string | null;
};

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const raw = await response.text();
  if (response.status === 204) return undefined as T;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "The listening service is unavailable. Start the local API and try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`,
    );
  return data as T;
}

function RecordScene({
  valence,
  arousal,
  playing,
  title,
}: {
  valence: number;
  arousal: number;
  playing: boolean;
  title: string;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const hue = Math.round(260 - 95 * valence + 20 * arousal);
  const style = { "--mood-hue": hue } as CSSProperties;
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (
      !scene.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const box = scene.current.getBoundingClientRect();
    scene.current.style.setProperty(
      "--tilt-x",
      `${((event.clientY - box.top) / box.height - 0.5) * -10}deg`,
    );
    scene.current.style.setProperty(
      "--tilt-y",
      `${((event.clientX - box.left) / box.width - 0.5) * 10}deg`,
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
      aria-label={`Dimensional record art for ${title}`}
      onPointerMove={tilt}
      onPointerLeave={reset}
    >
      <div className="scene-glow" />
      <div className="scene-grid" />
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="record-shadow" />
      <div className="record-disc">
        <div className="record-grooves" />
        <div className="record-label">
          MOOD
          <br />
          DRIFT
          <span />
        </div>
      </div>
      <div className="spark spark-one" />
      <div className="spark spark-two" />
      <div className="spark spark-three" />
    </div>
  );
}

export default function App() {
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [userId, setUserId] = useState("local-listener");
  const [checkIn, setCheckIn] = useState("");
  const [start, setStart] = useState<Mood>({
    valence: 0.3,
    arousal: 0.3,
    source: "manual",
  });
  const [target, setTarget] = useState<Mood>({ valence: 0.7, arousal: 0.5 });
  const [count, setCount] = useState(5);
  const [retentionDays, setRetentionDays] = useState(7);
  const [sessionMood, setSessionMood] = useState<Mood>({
    valence: 0.5,
    arousal: 0.5,
    source: "manual",
  });
  const [likedTrackIDs, setLikedTrackIDs] = useState<string[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditCheckIns, setAuditCheckIns] = useState<AuditCheckIn[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [moodConfirmed, setMoodConfirmed] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const advancing = useRef(false);
  const startedTrack = useRef<string | null>(null);

  useEffect(() => {
    api<{ tracks: Track[] }>("/api/v1/catalog")
      .then((data) =>
        setTracks(Object.fromEntries(data.tracks.map((t) => [t.id, t]))),
      )
      .catch((e) => setMessage(e.message));
    let id: string | null = null;
    try {
      id = localStorage.getItem("mood-drift-session");
    } catch {
      /* Storage can be disabled. */
    }
    if (id)
      api<Session>(`/api/v1/sessions/${encodeURIComponent(id)}`)
        .then((data) => {
          setSession(data);
          setSessionMood(
            data.lastCheckIn || {
              valence: data.queue[data.currentIndex]?.trackMood.valence ?? 0.5,
              arousal: data.queue[data.currentIndex]?.trackMood.arousal ?? 0.5,
              source: "manual",
            },
          );
          void loadHistory(id);
        })
        .catch(() => {
          try {
            localStorage.removeItem("mood-drift-session");
          } catch {}
          setMessage("Saved session could not be restored. Start a new one.");
        });
  }, []);

  const current = session?.queue[session.currentIndex];
  const currentTrack = current && tracks[current.trackId];
  async function loadHistory(id: string) {
    try {
      const [events, checkIns] = await Promise.all([
        api<{ events: AuditEvent[] }>(
          `/api/v1/sessions/${encodeURIComponent(id)}/events`,
        ),
        api<{ checkIns: AuditCheckIn[] }>(
          `/api/v1/sessions/${encodeURIComponent(id)}/check-ins`,
        ),
      ]);
      setAuditEvents(events.events);
      setAuditCheckIns(checkIns.checkIns);
      setLikedTrackIDs(
        events.events.filter((e) => e.type === "like").map((e) => e.trackId),
      );
    } catch {
      /* Session remains usable if history cannot load. */
    }
  }
  async function suggest() {
    if (!checkIn.trim()) {
      setMessage("Write a check-in or set your mood manually.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api<Prediction>("/api/v1/mood/predict", "POST", {
        text: checkIn,
      });
      setPrediction(result);
      setMoodConfirmed(false);
      if (result.suggestedMood) {
        setStart({
          ...result.suggestedMood,
          source: "text-model",
          confidence: result.confidence ?? undefined,
        });
      } else
        setMessage("No clear suggestion. Please choose your mood manually.");
    } catch (e) {
      setMessage(`${(e as Error).message} Manual mood selection is available.`);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setMessage("");
    try {
      const data = await api<Session>("/api/v1/sessions", "POST", {
        userId: userId.trim(),
        startMood: start,
        targetMood: { valence: target.valence, arousal: target.arousal },
        trackCount: count,
        retentionDays,
        taste: { preferredGenres: [], likedTrackIds: [] },
      });
      setSession(data);
      setSessionMood({
        valence: data.queue[0]?.trackMood.valence ?? start.valence,
        arousal: data.queue[0]?.trackMood.arousal ?? start.arousal,
        source: "manual",
      });
      setAuditEvents([]);
      setAuditCheckIns([]);
      setLikedTrackIDs([]);
      startedTrack.current = null;
      try {
        localStorage.setItem("mood-drift-session", data.sessionId);
      } catch {}
      setPlaying(false);
      setProgress(0);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendEvent(type: PlaybackEvent) {
    if (!session || !current || advancing.current) return null;
    advancing.current = true;
    setBusy(true);
    const moving = type === "skip" || type === "complete";
    if (moving) {
      audio.current?.pause();
      setPlaying(false);
    }
    const payload = {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      trackId: current.trackId,
      type,
      occurredAt: new Date().toISOString(),
      expectedRevision: session.revision,
      ...(type === "start" ? {} : { listenedSeconds: Math.max(0, progress) }),
    };
    try {
      const result = await api<EventResult>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/events`,
        "POST",
        payload,
      );
      setSession(result.session);
      if (moving) {
        setProgress(0);
        startedTrack.current = null;
        const next = result.session.queue[result.session.currentIndex];
        if (next)
          setSessionMood({
            valence: next.trackMood.valence,
            arousal: next.trackMood.arousal,
            source: "manual",
          });
      }
      if (type === "start") startedTrack.current = current.trackId;
      if (type === "like")
        setLikedTrackIDs((ids) => [...new Set([...ids, current.trackId])]);
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
      if (result.queueChanged)
        setMessage("Upcoming tracks were adjusted using your feedback.");
      return result;
    } catch (e) {
      setMessage((e as Error).message);
      try {
        setSession(
          await api<Session>(
            `/api/v1/sessions/${encodeURIComponent(session.sessionId)}`,
          ),
        );
      } catch {
        setMessage(
          "Could not reconnect to this session. Refresh the page to retry.",
        );
      }
      return null;
    } finally {
      advancing.current = false;
      setBusy(false);
    }
  }
  async function toggle() {
    if (!audio.current || busy) return;
    if (playing) {
      audio.current.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.current.play();
      if (current && startedTrack.current !== current.trackId) {
        if (!(await sendEvent("start"))) {
          audio.current.pause();
          return;
        }
      }
      setPlaying(true);
      setMessage("");
    } catch {
      setMessage(
        "Playback was blocked or audio is unavailable. Press Play again or skip this track.",
      );
    }
  }
  async function replay() {
    if (!audio.current || !(await sendEvent("replay"))) return;
    audio.current.currentTime = 0;
    try {
      await audio.current.play();
      setPlaying(true);
    } catch {
      setMessage("Playback could not restart.");
    }
  }
  async function submitCheckIn() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const updated = await api<Session>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/check-ins`,
        "POST",
        {
          expectedRevision: session.revision,
          valence: sessionMood.valence,
          arousal: sessionMood.arousal,
          source: "manual",
        },
      );
      setSession(updated);
      setAuditCheckIns((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          mood: { ...sessionMood, source: "manual" },
          createdAt: new Date().toISOString(),
        },
      ]);
      setMessage("Your check-in adjusted upcoming tracks.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeCheckIns() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const updated = await api<Session>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/check-ins`,
        "DELETE",
        { expectedRevision: session.revision },
      );
      setSession(updated);
      setAuditCheckIns([]);
      setMessage("Saved check-ins were removed.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteSession() {
    if (
      !session ||
      busy ||
      !window.confirm(
        "Delete this session, its feedback, and check-ins permanently?",
      )
    )
      return;
    setBusy(true);
    try {
      await api<void>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}`,
        "DELETE",
      );
      audio.current?.pause();
      try {
        localStorage.removeItem("mood-drift-session");
      } catch {}
      setSession(null);
      setPlaying(false);
      setAuditEvents([]);
      setAuditCheckIns([]);
      setMessage("Session and its saved data were deleted.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function moodControl(
    label: string,
    value: Mood,
    onChange: (m: Mood) => void,
    source = false,
  ) {
    return (
      <fieldset>
        <legend>{label}</legend>
        {(["valence", "arousal"] as const).map((key) => (
          <label key={key}>
            {key === "valence"
              ? "Valence (low → positive)"
              : "Arousal (calm → energetic)"}{" "}
            <strong>{value[key].toFixed(2)}</strong>
            <input
              aria-label={`${label} ${key}`}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={value[key]}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]: Number(e.target.value),
                  ...(source
                    ? {
                        source: "user-corrected" as const,
                        confidence: undefined,
                      }
                    : {}),
                })
              }
            />
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <nav className="topbar" aria-label="Project">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>{" "}
          mood<span>drift</span>
        </span>
        <span className="local-pill">
          <i /> LOCAL DEMO
        </span>
      </nav>
      <header>
        <span className="eyebrow">A NEW WAY TO LISTEN</span>
        <h1>
          Find your <em>flow.</em>
        </h1>
        <p>
          Begin with how you feel. Choose where the music takes you. Every track
          becomes part of your journey.
        </p>
      </header>
      {message && (
        <div role="alert" className="notice">
          {message}
        </div>
      )}
      {!session && (
        <div className="setup-layout">
          <section className="panel setup">
            <div className="section-heading">
              <span className="step">01</span>
              <div>
                <h2>Set your starting point</h2>
                <p>Choose what feels right for this moment.</p>
              </div>
            </div>
            <label>
              Listener name
              <input
                value={userId}
                maxLength={128}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>
            <label>
              Optional check-in
              <textarea
                value={checkIn}
                maxLength={1000}
                placeholder="How does this moment feel?"
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={suggest}
            >
              Suggest a starting mood
            </button>
            {prediction && (
              <p className="hint">
                {prediction.suggestedMood
                  ? `Suggestion ready${prediction.needsManualSelection ? " — review it carefully" : ""}. Confirm the starting mood before creating a session.`
                  : "Use the sliders to select a starting mood."}
              </p>
            )}
            {moodControl(
              "Starting mood",
              start,
              (m) => {
                setStart(m);
                setMoodConfirmed(false);
              },
              true,
            )}
            {!moodConfirmed && (
              <button
                type="button"
                className="secondary"
                onClick={() => setMoodConfirmed(true)}
              >
                Confirm starting mood
              </button>
            )}
            {moodControl("Target mood", target, setTarget)}
            <label>
              Number of tracks <strong>{count}</strong>
              <input
                type="range"
                min="1"
                max="12"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label>
              Keep this session for
              <select
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={busy || !userId.trim() || !moodConfirmed}
              onClick={create}
            >
              Create listening path <span aria-hidden="true">↗</span>
            </button>
            <p className="hint">
              Your written check-in is used only for a requested mood suggestion
              and is not saved with the session.
            </p>
          </section>
          <aside className="visual-side">
            <RecordScene
              valence={start.valence}
              arousal={start.arousal}
              playing={false}
              title="your starting mood"
            />
            <div className="mood-card">
              <span className="eyebrow">YOUR EMOTIONAL SPACE</span>
              <div className="mood-points">
                <div>
                  <small>START</small>
                  <strong>
                    {Math.round(start.valence * 100)} /{" "}
                    {Math.round(start.arousal * 100)}
                  </strong>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>TARGET</small>
                  <strong>
                    {Math.round(target.valence * 100)} /{" "}
                    {Math.round(target.arousal * 100)}
                  </strong>
                </div>
              </div>
              <p>Each track connects these two points.</p>
            </div>
          </aside>
        </div>
      )}
      {session && (
        <section className="panel player">
          <div className="row">
            <div>
              <span className="eyebrow">
                {session.status === "completed"
                  ? "JOURNEY COMPLETE"
                  : "NOW PLAYING"}
              </span>
              <h2>
                {session.status === "completed"
                  ? "Session complete"
                  : currentTrack?.title || "Loading track"}
              </h2>
              <p>
                {session.status === "completed"
                  ? "You reached the end of this listening path."
                  : `${currentTrack?.artist || ""} · ${currentTrack?.genre || ""}`}
              </p>
            </div>
            <span className="badge">
              {Math.min(session.currentIndex + 1, session.queue.length)} /{" "}
              {session.queue.length}
            </span>
          </div>
          <RecordScene
            valence={current?.trackMood?.valence ?? start.valence}
            arousal={current?.trackMood?.arousal ?? start.arousal}
            playing={playing}
            title={currentTrack?.title || "current track"}
          />
          {session.status !== "completed" && current && (
            <>
              <audio
                ref={audio}
                key={current.trackId}
                src={currentTrack?.audioUrl || `/audio/${current.trackId}`}
                preload="metadata"
                onEnded={() => void sendEvent("complete")}
                onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
                onError={() => {
                  setPlaying(false);
                  setMessage(
                    "Audio could not be loaded. Retry Play or skip this track.",
                  );
                }}
              />
              <div className="controls">
                <button onClick={toggle} disabled={busy}>
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  className="secondary"
                  onClick={() => void sendEvent("skip")}
                  disabled={busy}
                >
                  Skip
                </button>
                <button
                  className="secondary"
                  onClick={() => void replay()}
                  disabled={busy}
                >
                  Replay
                </button>
                <button
                  className="secondary"
                  onClick={() => void sendEvent("like")}
                  disabled={busy || likedTrackIDs.includes(current.trackId)}
                  aria-pressed={likedTrackIDs.includes(current.trackId)}
                >
                  {likedTrackIDs.includes(current.trackId)
                    ? "Liked ♥"
                    : "Like ♡"}
                </button>
                <span aria-live="polite">
                  {Math.floor(progress)}s /{" "}
                  {currentTrack?.durationSeconds || "…"}s
                </span>
              </div>
              <p className="hint">{currentTrack?.attribution}</p>
            </>
          )}
          <ol className="queue">
            {session.queue.map((item, i) => (
              <li
                key={item.trackId}
                className={
                  i === session.currentIndex
                    ? "current"
                    : i < session.currentIndex
                      ? "past"
                      : ""
                }
              >
                <strong>{tracks[item.trackId]?.title || item.trackId}</strong>
                <span>
                  {i < session.currentIndex
                    ? "Played"
                    : i === session.currentIndex &&
                        session.status !== "completed"
                      ? "Now playing"
                      : "Up next"}{" "}
                  · {item.reason}
                </span>
              </li>
            ))}
          </ol>
          {session.status !== "completed" && (
            <div className="feedback-panel">
              <h3>Check in again</h3>
              <p>Only tracks after the current one will change.</p>
              {moodControl("Your mood now", sessionMood, setSessionMood)}
              <button
                type="button"
                onClick={() => void submitCheckIn()}
                disabled={busy}
              >
                Update upcoming tracks
              </button>
            </div>
          )}
          <div className="privacy-panel">
            <h3>Your session data</h3>
            <p>
              Stored until{" "}
              {session.expiresAt
                ? new Date(session.expiresAt).toLocaleDateString()
                : `${session.retentionDays || 30} days from creation`}
              . Raw check-in text is never stored.
            </p>
            <div className="privacy-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowHistory((v) => !v);
                  if (!showHistory) void loadHistory(session.sessionId);
                }}
              >
                {showHistory ? "Hide history" : "View feedback history"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void removeCheckIns()}
                disabled={busy || (!session.lastCheckIn && auditCheckIns.length === 0)}
              >
                Delete saved check-ins
              </button>
              <button
                type="button"
                className="danger-action"
                onClick={() => void deleteSession()}
                disabled={busy}
              >
                Delete session and data
              </button>
            </div>
            {showHistory && (
              <div className="history-list">
                <strong>Playback events</strong>
                {auditEvents.length === 0 ? (
                  <p>No events yet.</p>
                ) : (
                  <ul>
                    {auditEvents.map((item) => (
                      <li key={item.eventId}>
                        {item.type} ·{" "}
                        {tracks[item.trackId]?.title || item.trackId} ·{" "}
                        {new Date(item.acceptedAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
                <strong>Explicit check-ins</strong>
                {auditCheckIns.length === 0 ? (
                  <p>No saved check-ins.</p>
                ) : (
                  <ul>
                    {auditCheckIns.map((item) => (
                      <li key={item.id}>
                        {Math.round(item.mood.valence * 100)}% valence ·{" "}
                        {Math.round(item.mood.arousal * 100)}% energy ·{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            className="text"
            onClick={() => {
              audio.current?.pause();
              try {
                localStorage.removeItem("mood-drift-session");
              } catch {}
              setSession(null);
              setPlaying(false);
            }}
          >
            Start another session ↗
          </button>
        </section>
      )}
      <footer>
        Original synthesized demo audio. Track mood coordinates are design
        proxies and make no therapeutic claim.
      </footer>
    </main>
  );
}
