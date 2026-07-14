export type YouTubeSource =
  | { kind: "video"; videoId: string; playlistId?: string; url: string }
  | { kind: "playlist"; playlistId: string; url: string };

export const DEFAULT_YOUTUBE_URL = "https://youtu.be/5tMdvZvKWYs";
export const LEGACY_DEFAULT_YOUTUBE_URL = "https://youtu.be/4VXErA63_eg";
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export function parseYouTubeSource(input: string): YouTubeSource | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return null;
    const playlistId = url.searchParams.get("list") ?? undefined;
    let videoId: string | undefined;
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0];
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? undefined;
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
      videoId = match?.[1];
    }
    if (videoId && ID_PATTERN.test(videoId)) {
      return { kind: "video", videoId, playlistId: playlistId && ID_PATTERN.test(playlistId) ? playlistId : undefined, url: value };
    }
    if (playlistId && ID_PATTERN.test(playlistId)) return { kind: "playlist", playlistId, url: value };
    return null;
  } catch {
    return null;
  }
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
}
