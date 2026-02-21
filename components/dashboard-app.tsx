"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProcessingJob, ViralClip } from "@/lib/types";

function stageLabel(stage: ProcessingJob["stage"]) {
  switch (stage) {
    case "queued":
      return "Na fila";
    case "collecting":
      return "Coletando dados";
    case "analyzing":
      return "IA analisando viralização";
    case "rendering":
      return "Renderizando 9:16";
    case "completed":
      return "Concluído";
    case "failed":
      return "Falhou";
    default:
      return stage;
  }
}

function formatSeconds(total: number) {
  const value = Math.max(0, Math.floor(total));
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

interface SeoPack {
  titles: string[];
  description: string;
  hashtags: string[];
}

interface DashboardAppProps {
  initialJobId?: string;
}

export function DashboardApp({ initialJobId }: DashboardAppProps) {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>(initialJobId);
  const [activeClipId, setActiveClipId] = useState<string | undefined>();
  const [expandedClipId, setExpandedClipId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [downloadingClipId, setDownloadingClipId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [seoByClip, setSeoByClip] = useState<Record<string, SeoPack>>({});
  const [drafts, setDrafts] = useState<Record<string, { title: string; transcriptSnippet: string }>>({});

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Falha ao buscar histórico de jobs.");
      }

      const payload = (await response.json()) as { jobs: ProcessingJob[] };
      setJobs(payload.jobs);
      setSelectedJobId((current) => {
        if (current && payload.jobs.some((job) => job.id === current)) {
          return current;
        }

        if (initialJobId && payload.jobs.some((job) => job.id === initialJobId)) {
          return initialJobId;
        }

        return payload.jobs[0]?.id;
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }, [initialJobId]);

  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(() => {
      void fetchJobs();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchJobs]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0],
    [jobs, selectedJobId]
  );

  useEffect(() => {
    if (!selectedJob) return;

    setSelectedJobId(selectedJob.id);

    if (!activeClipId || !selectedJob.clips.some((clip) => clip.id === activeClipId)) {
      setActiveClipId(selectedJob.clips[0]?.id);
    }

    setDrafts((current) => {
      const next = { ...current };
      for (const clip of selectedJob.clips) {
        if (!next[clip.id]) {
          next[clip.id] = {
            title: clip.title,
            transcriptSnippet: clip.transcriptSnippet,
          };
        }
      }
      return next;
    });
  }, [selectedJob, activeClipId]);

  const activeClip = useMemo(
    () => selectedJob?.clips.find((clip) => clip.id === activeClipId) ?? selectedJob?.clips[0],
    [selectedJob, activeClipId]
  );

  async function saveClip(clipId: string) {
    if (!selectedJob) return;
    const draft = drafts[clipId];
    if (!draft) return;

    setBusyClipId(clipId);

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clipId,
          title: draft.title,
          transcriptSnippet: draft.transcriptSnippet,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Falha ao salvar alterações.");
      }

      await fetchJobs();
      setExpandedClipId(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar corte.");
    } finally {
      setBusyClipId(null);
    }
  }

  async function generateMoreCuts() {
    if (!selectedJob) return;

    setRegenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/jobs/${selectedJob.id}/regenerate`, {
        method: "POST",
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao gerar mais cortes.");
      }

      await fetchJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível regenerar cortes.");
    } finally {
      setRegenerating(false);
    }
  }

  async function generateSeo(clip: ViralClip) {
    setBusyClipId(clip.id);

    try {
      const response = await fetch("/api/seo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceText: clip.transcriptSnippet,
          contextTitle: clip.title,
        }),
      });

      const payload = (await response.json()) as SeoPack & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao gerar SEO.");
      }

      setSeoByClip((current) => ({
        ...current,
        [clip.id]: {
          titles: payload.titles,
          description: payload.description,
          hashtags: payload.hashtags,
        },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao gerar títulos.");
    } finally {
      setBusyClipId(null);
    }
  }

  async function downloadClip(clip: ViralClip) {
    setDownloadingClipId(clip.id);
    setError(null);

    try {
      const response = await fetch(clip.downloadUrl, { method: "GET" });
      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok || !contentType.toLowerCase().startsWith("video/")) {
        let message = "Falha ao baixar o corte.";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload?.error) {
            message = payload.error;
          }
        } catch {
          // keep generic message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("O arquivo de vídeo foi retornado vazio.");
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const fallbackName = `${clip.id}.mp4`;
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || fallbackName;

      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao baixar corte.");
    } finally {
      setDownloadingClipId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 lg:px-8">
      <header className="glass grid-lights rounded-3xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-electric">Dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">Painel de cortes virais</h1>
            <p className="mt-2 text-sm text-slate-300">
              Acompanhe processamento, edite legendas e exporte cortes otimizados para Shorts, Reels e TikTok.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-indigo-300/35 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-electric"
            >
              Novo vídeo
            </Link>
            <a
              href="/api/auth/signin?callbackUrl=/dashboard"
              className="rounded-xl border border-electric/35 bg-electric/10 px-4 py-2 text-xs font-semibold text-electric transition hover:bg-electric/20"
            >
              Login com Google
            </a>
          </div>
        </div>
      </header>

      <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="glass soft-scroll rounded-3xl p-4 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Histórico de vídeos</h2>
            <span className="rounded-full border border-indigo-300/30 px-2 py-1 text-xs text-slate-300">
              {jobs.length}
            </span>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-400">Carregando histórico...</p> : null}

          {!loading && jobs.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-indigo-300/20 p-4 text-sm text-slate-300">
              Nenhum vídeo processado ainda. Volte para a landing e envie um link.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  selectedJob?.id === job.id
                    ? "border-electric bg-electric/10"
                    : "border-indigo-300/20 bg-slate/60 hover:border-indigo-300/45"
                }`}
              >
                <p className="line-clamp-2 text-xs font-semibold text-white">
                  {job.video?.title ?? job.input.youtubeUrl}
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                  <span>{stageLabel(job.stage)}</span>
                  <span>{job.progress}%</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{formatDate(job.createdAt)}</p>
              </button>
            ))}
          </div>
        </aside>

        <div className="glass soft-scroll rounded-3xl p-4 md:p-5 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-400/30 bg-red-900/20 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {!selectedJob ? (
            <div className="rounded-2xl border border-indigo-300/20 bg-slate/50 p-6 text-sm text-slate-300">
              Selecione um job para visualizar os cortes.
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-indigo-300/20 bg-slate/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{selectedJob.video?.title ?? "Processando vídeo"}</h3>
                    <p className="mt-1 text-xs text-slate-300">{selectedJob.video?.channelName ?? "Canal"}</p>
                  </div>
                  <div className="rounded-full border border-indigo-300/30 px-3 py-1 text-xs text-slate-100">
                    {stageLabel(selectedJob.stage)}
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-electric to-neon transition-all"
                    style={{ width: `${selectedJob.progress}%` }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={generateMoreCuts}
                    disabled={selectedJob.stage !== "completed" || regenerating}
                    className="rounded-xl border border-electric/45 px-4 py-2 text-xs font-semibold text-electric transition hover:bg-electric/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {regenerating ? "Gerando..." : "Gerar mais cortes"}
                  </button>
                  <span className="rounded-xl border border-indigo-300/30 px-4 py-2 text-xs text-slate-300">
                    {selectedJob.clips.length} cortes gerados
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  {selectedJob.logs.slice(0, 4).map((log) => (
                    <div
                      key={`${log.at}-${log.message}`}
                      className="rounded-xl border border-indigo-300/15 bg-slate-900/40 px-3 py-2 text-xs text-slate-300"
                    >
                      <span className="font-semibold text-electric">{stageLabel(log.stage)}</span> {log.message}
                    </div>
                  ))}
                </div>
              </section>

              {selectedJob.clips.length > 0 ? (
                <section className="mt-5 grid gap-4 xl:grid-cols-[360px_1fr]">
                  <article className="rounded-2xl border border-indigo-300/20 bg-slate/60 p-4">
                    <h4 className="text-sm font-semibold text-slate-100">Preview estilo TikTok</h4>
                    {activeClip ? (
                      <div className="mt-4 flex justify-center">
                        <div className="relative aspect-[9/16] w-64 overflow-hidden rounded-[2.4rem] border border-indigo-300/30 bg-black p-2 shadow-glow">
                          <video
                            key={activeClip.id}
                            src={activeClip.previewUrl}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="h-full w-full rounded-[2rem] object-cover"
                          />
                          <div className="pointer-events-none absolute inset-x-3 bottom-4 rounded-xl bg-black/45 p-2 text-[11px] font-semibold leading-snug text-white">
                            {activeClip.subtitles
                              .slice(0, 10)
                              .map((item) => `${item.text}${item.emoji ? ` ${item.emoji}` : ""}`)
                              .join(" ")}
                          </div>
                          <div className="absolute left-3 right-3 top-4 rounded-lg bg-black/45 px-2 py-1 text-center text-[10px] font-semibold text-white">
                            {activeClip.title}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-xs text-slate-300">Selecione um corte para visualizar.</p>
                    )}
                  </article>

                  <article className="rounded-2xl border border-indigo-300/20 bg-slate/60 p-4">
                    <h4 className="text-sm font-semibold text-slate-100">Cortes gerados</h4>
                    <div className="mt-3 grid gap-3">
                      {selectedJob.clips.map((clip) => {
                        const draft = drafts[clip.id] ?? {
                          title: clip.title,
                          transcriptSnippet: clip.transcriptSnippet,
                        };
                        const seo = seoByClip[clip.id];

                        return (
                          <div
                            key={clip.id}
                            className={`rounded-2xl border p-3 ${
                              activeClip?.id === clip.id
                                ? "border-electric bg-electric/10"
                                : "border-indigo-300/20 bg-slate-900/35"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setActiveClipId(clip.id)}
                              className="w-full text-left"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-white">{clip.title}</p>
                                <span className="rounded-full border border-indigo-300/35 px-2 py-1 text-[11px] text-slate-200">
                                  Score {clip.score}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-300">
                                {formatSeconds(clip.startSec)} - {formatSeconds(clip.endSec)} | {clip.durationSec}s
                              </p>
                            </button>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => downloadClip(clip)}
                                disabled={downloadingClipId === clip.id}
                                className="rounded-lg border border-indigo-300/35 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-electric"
                              >
                                {downloadingClipId === clip.id ? "Baixando..." : "Download"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setExpandedClipId(expandedClipId === clip.id ? undefined : clip.id)}
                                className="rounded-lg border border-indigo-300/35 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-electric"
                              >
                                Editar corte
                              </button>
                              <button
                                type="button"
                                onClick={() => generateSeo(clip)}
                                disabled={busyClipId === clip.id}
                                className="rounded-lg border border-electric/45 px-3 py-1.5 text-xs font-semibold text-electric transition hover:bg-electric/15 disabled:opacity-55"
                              >
                                Gerar títulos virais
                              </button>
                            </div>

                            {expandedClipId === clip.id ? (
                              <div className="mt-3 grid gap-2 rounded-xl border border-indigo-300/20 bg-slate-950/40 p-3">
                                <input
                                  value={draft.title}
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [clip.id]: {
                                        ...draft,
                                        title: event.target.value,
                                      },
                                    }))
                                  }
                                  className="rounded-lg border border-indigo-300/30 bg-slate/70 px-3 py-2 text-xs text-white outline-none focus:border-electric"
                                />
                                <textarea
                                  value={draft.transcriptSnippet}
                                  onChange={(event) =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [clip.id]: {
                                        ...draft,
                                        transcriptSnippet: event.target.value,
                                      },
                                    }))
                                  }
                                  rows={3}
                                  className="rounded-lg border border-indigo-300/30 bg-slate/70 px-3 py-2 text-xs text-white outline-none focus:border-electric"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveClip(clip.id)}
                                  disabled={busyClipId === clip.id}
                                  className="rounded-lg bg-gradient-to-r from-electric to-neon px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60"
                                >
                                  {busyClipId === clip.id ? "Salvando..." : "Salvar edição"}
                                </button>
                              </div>
                            ) : null}

                            {seo ? (
                              <div className="mt-3 rounded-xl border border-electric/25 bg-electric/10 p-3 text-xs text-slate-100">
                                <p className="font-semibold text-electric">Títulos sugeridos</p>
                                <div className="mt-1 grid gap-1">
                                  {seo.titles.slice(0, 3).map((title) => (
                                    <p key={title}>• {title}</p>
                                  ))}
                                </div>
                                <p className="mt-2 font-semibold text-electric">Descrição + hashtags</p>
                                <p className="mt-1 whitespace-pre-wrap text-slate-200">{seo.description}</p>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                </section>
              ) : (
                <section className="mt-5 rounded-2xl border border-dashed border-indigo-300/20 bg-slate/45 p-5 text-sm text-slate-300">
                  {selectedJob.stage === "failed"
                    ? selectedJob.error ?? "Processamento falhou."
                    : "A IA ainda está processando este vídeo. Os cortes aparecerão aqui automaticamente."}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
