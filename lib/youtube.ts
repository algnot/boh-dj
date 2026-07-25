const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export type YoutubeMeta = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
};

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

/** Find the first YouTube URL / id inside free-form chat text. */
export function extractYoutubeVideoIdFromText(text: string): string | null {
  const trimmed = text.trim();
  const direct = extractYoutubeVideoId(trimmed);
  if (direct) return direct;

  const urlMatch = trimmed.match(
    /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/\S+|youtu\.be\/\S+)/i,
  );
  if (urlMatch?.[0]) {
    return extractYoutubeVideoId(urlMatch[0]);
  }

  return null;
}

export function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
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
