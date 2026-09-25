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
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [moodConfirmed, setMoodConfirmed] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const advancing = useRef(false);

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
        .then(setSession)
        .catch(() => {
          try {
            localStorage.removeItem("mood-drift-session");
          } catch {}
          setMessage("Saved session could not be restored. Start a new one.");
        });
  }, []);

  const current = session?.queue[session.currentIndex];
  const currentTrack = current && tracks[current.trackId];
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
        taste: { preferredGenres: [], likedTrackIds: [] },
      });
      setSession(data);
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
  async function advance(action: "skip" | "complete") {
    if (!session || advancing.current) return;
    advancing.current = true;
    setBusy(true);
    audio.current?.pause();
    setPlaying(false);
    try {
      const data = await api<Session>(
        `/api/v1/sessions/${encodeURIComponent(session.sessionId)}/advance`,
        "POST",
        { expectedRevision: session.revision, action },
      );
      setSession(data);
      setProgress(0);
    } catch (e) {
      setMessage((e as Error).message);
      try {
        setSession(
          await api<Session>(
            `/api/v1/sessions/${encodeURIComponent(session.sessionId)}`,
          ),
        );
      } catch {}
    } finally {
      advancing.current = false;
      setBusy(false);
    }
  }
  async function toggle() {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.current.play();
      setPlaying(true);
      setMessage("");
    } catch {
      setMessage(
        "Playback was blocked or audio is unavailable. Press Play again or skip this track.",
      );
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
                onEnded={() => void advance("complete")}
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
                  onClick={() => void advance("skip")}
                  disabled={busy}
                >
                  Skip
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
