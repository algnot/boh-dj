const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

export type YoutubeMeta = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
};

function isYoutubeHost(host: string) {
  return (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be"
  );
}

export function extractYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v") ?? "";
        return YOUTUBE_ID_RE.test(id) ? id : null;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (
        (parts[0] === "embed" ||
          parts[0] === "shorts" ||
          parts[0] === "live") &&
        parts[1] &&
        YOUTUBE_ID_RE.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function extractYoutubePlaylistId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (PLAYLIST_ID_RE.test(raw) && raw.startsWith("PL")) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (!isYoutubeHost(host) || host === "youtu.be") return null;

    const list = url.searchParams.get("list") ?? "";
    if (list && PLAYLIST_ID_RE.test(list)) return list;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "playlist" && parts[1] && PLAYLIST_ID_RE.test(parts[1])) {
      return parts[1];
    }
  } catch {
    return null;
  }

  return null;
}

function firstUrlInText(text: string): string | null {
  const urlMatch = text.match(
    /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/\S+|youtu\.be\/\S+)/i,
  );
  return urlMatch?.[0] ?? null;
}

/** Find the first YouTube URL / id inside free-form chat text. */
export function extractYoutubeVideoIdFromText(text: string): string | null {
  const trimmed = text.trim();
  const direct = extractYoutubeVideoId(trimmed);
  if (direct) return direct;

  const url = firstUrlInText(trimmed);
  if (url) return extractYoutubeVideoId(url);

  return null;
}

export function extractYoutubePlaylistIdFromText(text: string): string | null {
  const trimmed = text.trim();
  const direct = extractYoutubePlaylistId(trimmed);
  if (direct) return direct;

  const url = firstUrlInText(trimmed);
  if (url) return extractYoutubePlaylistId(url);

  return null;
}

/**
 * Resolve a playable video id from free-form text.
 * Prefer an explicit video link; otherwise take the first item of a playlist.
 */
export async function resolveYoutubeVideoIdFromText(
  text: string,
): Promise<string | null> {
  const videoId = extractYoutubeVideoIdFromText(text);
  if (videoId) return videoId;

  const playlistId = extractYoutubePlaylistIdFromText(text);
  if (!playlistId) return null;

  return fetchFirstPlaylistVideoId(playlistId);
}

export function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function fetchFirstPlaylistVideoIdViaApi(
  playlistId: string,
): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails,snippet");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{
        contentDetails?: { videoId?: string };
        snippet?: { resourceId?: { videoId?: string } };
      }>;
    };
    const item = data.items?.[0];
    const id =
      item?.contentDetails?.videoId ?? item?.snippet?.resourceId?.videoId ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Public Atom feed — no API key required. */
async function fetchFirstPlaylistVideoIdViaFeed(
  playlistId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(
        playlistId,
      )}`,
      {
        headers: { Accept: "application/atom+xml,application/xml,text/xml" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const match =
      xml.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/) ??
      xml.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    const id = match?.[1] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function fetchFirstPlaylistVideoId(
  playlistId: string,
): Promise<string | null> {
  const fromApi = await fetchFirstPlaylistVideoIdViaApi(playlistId);
  if (fromApi) return fromApi;
  return fetchFirstPlaylistVideoIdViaFeed(playlistId);
}

export async function fetchYoutubeMeta(videoId: string): Promise<YoutubeMeta> {
  const fallback: YoutubeMeta = {
    videoId,
    title: `YouTube ${videoId}`,
    thumbnailUrl: youtubeThumbnailUrl(videoId),
  };

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as { title?: string };
    return {
      videoId,
      title: data.title?.trim() || fallback.title,
      thumbnailUrl: fallback.thumbnailUrl,
    };
  } catch {
    return fallback;
  }
}

type YtReadyCallback = () => void;

let apiPromise: Promise<void> | null = null;

export function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube API is browser-only"));
  }

  const w = window as Window & {
    YT?: { Player: unknown };
    onYouTubeIframeAPIReady?: YtReadyCallback;
  };

  if (w.YT?.Player) return Promise.resolve();

  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };

    if (
      !document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      )
    ) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

export type YtPlayer = {
  destroy: () => void;
  loadVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (args: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  getDuration: () => number;
};

export type YtPlayerEvent = {
  data: number;
  target: YtPlayer;
};

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId?: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YtPlayer }) => void;
            onStateChange?: (event: YtPlayerEvent) => void;
          };
        },
      ) => YtPlayer;
    };
  }
}
