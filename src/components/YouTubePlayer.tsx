import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Music2, Pause, Play, Search, Settings2, Video, Volume2, X } from "lucide-react";
import { DEFAULT_YOUTUBE_URL, parseYouTubeSource, youtubeSearchUrl, type YouTubeSource } from "../lib/youtube";
import { Modal } from "./Modal";

interface PlayerApi {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(value: number): void;
  getPlayerState(): number;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => PlayerApi;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeNamespace> | null = null;
export const YOUTUBE_VIDEO_PREVIEW_MS = 1_000;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    }
  });
  return apiPromise;
}

interface YouTubePlayerProps {
  initialUrl?: string;
  initialVolume?: number;
  onPreferenceChange: (url: string, volume: number) => void;
}

export function YouTubePlayer({ initialUrl = DEFAULT_YOUTUBE_URL, initialVolume = 35, onPreferenceChange }: YouTubePlayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerApi | null>(null);
  const volumeRef = useRef(initialVolume);
  const minimizeTimerRef = useRef<number | null>(null);
  const [source, setSource] = useState<YouTubeSource>(() => parseYouTubeSource(initialUrl) ?? parseYouTubeSource(DEFAULT_YOUTUBE_URL)!);
  const [volume, setVolume] = useState(initialVolume);
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(true);
  const [videoOpen, setVideoOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const cancelAutomaticMinimize = useCallback(() => {
    if (minimizeTimerRef.current !== null) {
      window.clearTimeout(minimizeTimerRef.current);
      minimizeTimerRef.current = null;
    }
  }, []);

  const showVideoTemporarily = useCallback(() => {
    cancelAutomaticMinimize();
    setVideoOpen(true);
    minimizeTimerRef.current = window.setTimeout(() => {
      setVideoOpen(false);
      minimizeTimerRef.current = null;
    }, YOUTUBE_VIDEO_PREVIEW_MS);
  }, [cancelAutomaticMinimize]);

  useEffect(() => {
    let disposed = false;
    void loadYouTubeApi().then((YT) => {
      if (disposed || !mountRef.current) return;
      playerRef.current?.destroy();
      const list = source.kind === "playlist" ? source.playlistId : source.playlistId;
      playerRef.current = new YT.Player(mountRef.current, {
        host: "https://www.youtube-nocookie.com",
        videoId: source.kind === "video" ? source.videoId : undefined,
        playerVars: {
          autoplay: 1,
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
          ...(list ? { listType: "playlist", list } : source.kind === "playlist" ? { listType: "playlist", list: source.playlistId } : { loop: 1, playlist: source.videoId }),
        },
        events: {
          onReady: (event: { target: PlayerApi }) => {
            event.target.setVolume(volumeRef.current);
            event.target.playVideo();
            window.setTimeout(() => {
              const active = event.target.getPlayerState() === 1;
              setPlaying(active);
              setAutoplayBlocked(!active);
            }, 900);
          },
          onStateChange: (event: { data: number }) => {
            setPlaying(event.data === 1);
            if (event.data === 1) { setAutoplayBlocked(false); showVideoTemporarily(); }
          },
          onAutoplayBlocked: () => setAutoplayBlocked(true),
        },
      });
    });
    return () => {
      disposed = true;
      cancelAutomaticMinimize();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [cancelAutomaticMinimize, showVideoTemporarily, source]);

  useEffect(() => { volumeRef.current = volume; playerRef.current?.setVolume(volume); }, [volume]);

  const applyUrl = () => {
    const parsed = parseYouTubeSource(urlInput);
    if (!parsed) { setError("Cole um link válido de vídeo ou playlist do YouTube."); return; }
    setSource(parsed);
    setError("");
    setModalOpen(false);
    onPreferenceChange(urlInput.trim(), volume);
  };

  return (
    <>
      <div className="header-player" aria-label="Música de foco do YouTube">
        <button type="button" className="header-player-action" aria-label={playing ? "Pausar música" : "Ativar música"} onClick={() => {
          if (playing) playerRef.current?.pauseVideo();
          else { showVideoTemporarily(); playerRef.current?.playVideo(); }
        }}>
          <span className="header-player-icon">{playing ? <Pause size={14} /> : <Play size={14} />}</span>
          <span><small>Música de foco</small><strong>{autoplayBlocked ? "Ativar música" : playing ? "Tocando agora" : "Pausada"}</strong></span>
        </button>
        <label className="header-volume"><Volume2 size={14} /><span className="sr-only">Volume</span><input type="range" min={0} max={100} value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); onPreferenceChange(source.url, next); }} /></label>
        <button className="header-player-button" type="button" aria-label={videoOpen ? "Minimizar vídeo oficial" : "Mostrar vídeo oficial"} onClick={() => {
          cancelAutomaticMinimize();
          setVideoOpen((open) => !open);
        }}><Video size={15} /></button>
        <button className="header-player-button" type="button" aria-label="Trocar música" onClick={() => { playerRef.current?.pauseVideo(); setVideoOpen(false); setModalOpen(true); }}><Settings2 size={15} /></button>
        <div className={`youtube-popover ${videoOpen ? "is-open" : ""}`} aria-hidden={!videoOpen}>
          <div className="youtube-popover-heading"><span><Music2 size={14} /> Player oficial do YouTube</span><button type="button" aria-label="Minimizar vídeo" onClick={() => { cancelAutomaticMinimize(); setVideoOpen(false); }}><X size={15} /></button></div>
          <div className="youtube-frame"><div key={source.url} ref={mountRef} /></div>
        </div>
      </div>

      <Modal open={modalOpen} labelledBy="music-modal-title" onClose={() => setModalOpen(false)} className="compact-modal music-modal">
        <div className="modal-header"><div><p className="eyebrow"><Music2 size={14} /> Player oficial</p><h2 id="music-modal-title">Escolher trilha</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setModalOpen(false)}><X size={18} /></button></div>
        <div className="music-form">
          <label>Link de vídeo ou playlist<input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://youtube.com/watch?v=…" data-autofocus /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="button button-primary" type="button" onClick={applyUrl}><Play size={16} /> Carregar no player</button>
          <div className="music-search"><span>ou pesquise sem chave de API</span><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="lo-fi, synthwave, sons de chuva…" /></label><button className="button button-secondary" type="button" disabled={!query.trim()} onClick={() => window.open(youtubeSearchUrl(query), "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> Abrir resultados no YouTube</button></div>
          <small>Escolha um resultado, copie o link e cole acima. O YouTube recebe dados técnicos quando o player é carregado.</small>
        </div>
      </Modal>
    </>
  );
}
