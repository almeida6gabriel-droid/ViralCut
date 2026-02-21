interface ParsedYouTubeUrl {
  videoId: string;
  canonicalUrl: string;
}

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

function isValidVideoId(value: string | undefined | null): value is string {
  return Boolean(value && VIDEO_ID_REGEX.test(value));
}

export function parseYouTubeUrl(rawUrl: string): ParsedYouTubeUrl | null {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    const isYouTubeHost = [
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
    ].includes(host);

    if (!isYouTubeHost) {
      return null;
    }

    let videoId: string | undefined;

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0];
    } else {
      videoId =
        url.searchParams.get("v") ??
        url.pathname.match(/\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[2] ??
        undefined;
    }

    if (!isValidVideoId(videoId)) {
      return null;
    }

    return {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}
