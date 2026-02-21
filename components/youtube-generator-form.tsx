"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const SAMPLE_LINKS = [
  "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=3fumBcKC6RE",
];

export function YoutubeGeneratorForm() {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/google-config")
      .then((response) => response.json())
      .then((data: { enabled?: boolean }) => {
        setGoogleEnabled(Boolean(data?.enabled));
      })
      .catch(() => {
        setGoogleEnabled(false);
      });
  }, []);

  const signInUrl = useMemo(() => {
    if (googleEnabled) {
      return "/api/auth/signin/google?callbackUrl=/dashboard";
    }
    return "/api/auth/signin?callbackUrl=/dashboard";
  }, [googleEnabled]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ youtubeUrl }),
      });

      const payload = (await response.json()) as {
        error?: string;
        job?: {
          id: string;
        };
      };

      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "Não foi possível iniciar o processamento.");
      }

      router.push(`/dashboard?job=${payload.job.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro inesperado ao gerar cortes.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass reveal rounded-3xl p-4 shadow-glow md:p-6">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label htmlFor="youtube-url" className="text-sm font-semibold text-slate-300">
          Cole o link do vídeo do YouTube
        </label>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            id="youtube-url"
            type="url"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
            className="h-14 w-full rounded-2xl border border-indigo-300/30 bg-slate/70 px-4 text-sm text-white outline-none transition focus:border-electric"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-14 min-w-56 rounded-2xl bg-gradient-to-r from-electric to-neon px-6 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:brightness-75"
          >
            {loading ? "Processando vídeo..." : "Gerar cortes virais"}
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {SAMPLE_LINKS.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => setYoutubeUrl(sample)}
            className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:border-electric hover:text-electric"
          >
            Usar exemplo
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-indigo-200/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-300">
          Ideal para TikTok, Reels e Shorts. Resultado em 9:16 com legendas automáticas.
        </p>
        <a
          href={signInUrl}
          className="inline-flex items-center justify-center rounded-xl border border-indigo-300/40 px-4 py-2 text-xs font-semibold text-white transition hover:border-electric hover:text-electric"
        >
          {googleEnabled ? "Login com Google" : "Entrar (Google pronto para configurar)"}
        </a>
      </div>
    </div>
  );
}
