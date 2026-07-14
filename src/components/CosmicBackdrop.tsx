export function CosmicBackdrop({ paused }: { paused: boolean }) {
  return (
    <div className={`cosmic-backdrop ${paused ? "is-paused" : ""}`} aria-hidden="true">
      <div className="cosmic-glow cosmic-glow-one" />
      <div className="cosmic-glow cosmic-glow-two" />
      <div className="star-field star-field-one" />
      <div className="star-field star-field-two" />
      <div className="orbit-system">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="orbit orbit-three" />
        <span className="orbit-core" />
      </div>
      <div className="noise-layer" />
    </div>
  );
}

