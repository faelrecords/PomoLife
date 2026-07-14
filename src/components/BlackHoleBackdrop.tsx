import { useEffect, useRef, useState } from "react";

export function BlackHoleBackdrop({ paused }: { paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => {
      if (paused || reduced || document.hidden) video.pause();
      else void video.play().catch(() => setFailed(true));
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [failed, paused]);

  return (
    <div className={`black-hole-backdrop ${failed ? "is-fallback" : ""}`} aria-hidden="true">
      {!failed && (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          poster={`${import.meta.env.BASE_URL}og.png`}
          onError={() => setFailed(true)}
        >
          <source src={`${import.meta.env.BASE_URL}black-hole-hero.mp4`} type="video/mp4" />
        </video>
      )}
      <div className="black-hole-shade" />
      <div className="black-hole-grid" />
    </div>
  );
}

