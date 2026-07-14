import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubePlayer, YOUTUBE_VIDEO_PREVIEW_MS } from "./YouTubePlayer";

interface PlayerEvents {
  onStateChange?: (event: { data: number }) => void;
}

class MockPlayer {
  static latest: MockPlayer | null = null;

  readonly options: Record<string, unknown>;
  readonly playVideo = vi.fn();
  readonly pauseVideo = vi.fn();
  readonly setVolume = vi.fn();
  readonly getPlayerState = vi.fn(() => 0);
  readonly destroy = vi.fn();

  constructor(_element: HTMLElement, options: Record<string, unknown>) {
    this.options = options;
    MockPlayer.latest = this;
  }

  emitState(data: number) {
    (this.options.events as PlayerEvents | undefined)?.onStateChange?.({ data });
  }
}

beforeEach(() => {
  MockPlayer.latest = null;
  Object.defineProperty(window, "YT", {
    configurable: true,
    value: { Player: MockPlayer },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderPlayer() {
  render(<YouTubePlayer onPreferenceChange={vi.fn()} />);
  await waitFor(() => expect(MockPlayer.latest).not.toBeNull());
  return MockPlayer.latest!;
}

describe("YouTubePlayer", () => {
  it("minimiza o vídeo pelo X sem pausar a música", async () => {
    const player = await renderPlayer();

    act(() => player.emitState(1));
    expect(document.querySelector(".youtube-popover")).toHaveClass("is-open");

    fireEvent.click(screen.getByRole("button", { name: "Minimizar vídeo" }));

    expect(document.querySelector(".youtube-popover")).not.toHaveClass("is-open");
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pausar música" })).toBeVisible();
  });

  it("mostra brevemente o vídeo ao dar play e o minimiza automaticamente", async () => {
    const player = await renderPlayer();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Ativar música" }));
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(document.querySelector(".youtube-popover")).toHaveClass("is-open");

    act(() => vi.advanceTimersByTime(YOUTUBE_VIDEO_PREVIEW_MS));

    expect(document.querySelector(".youtube-popover")).not.toHaveClass("is-open");
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });
});
