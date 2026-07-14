import "@testing-library/jest-dom/vitest";

Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  matchMedia: () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  }),
});

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: () => undefined,
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: () => undefined,
});
