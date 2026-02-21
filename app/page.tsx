import Link from "next/link";

import { YoutubeGeneratorForm } from "@/components/youtube-generator-form";

const benefits = [
  "IA identifica os melhores momentos com potencial viral",
  "Cortes prontos no formato vertical 9:16",
  "Legendas dinâmicas e sincronizadas automaticamente",
  "Pronto para TikTok, Reels e YouTube Shorts",
];

const names = ["ClipAI", "CorteX", "ViralCuts", "MagoCuts", "ClipMago", "AutoCortes AI"];

export default function HomePage() {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 px-4 pb-20 pt-8 sm:px-6 lg:px-8">
      <header className="glass reveal grid-lights rounded-3xl p-6 md:p-8">
        <nav className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-electric">ViralCut AI</p>
            <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
              Transforme qualquer vídeo do YouTube em cortes virais em segundos com IA
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
              Cole um link e receba de 3 a 10 cortes com score de viralização, títulos prontos e render 9:16
              com legenda dinâmica para creators de alta produção.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-indigo-300/40 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-electric"
          >
            Abrir dashboard
          </Link>
        </nav>

        <div className="mt-8">
          <YoutubeGeneratorForm />
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="glass reveal rounded-3xl p-6">
          <h2 className="text-xl font-semibold text-white">Demonstração visual</h2>
          <p className="mt-2 text-sm text-slate-300">
            Pipeline automatizado em três etapas para transformar vídeos longos em conteúdo curto de alto impacto.
          </p>
          <div className="mt-6 grid gap-3">
            {[
              ["1. Coleta", "Captura vídeo, extrai áudio e transcreve com IA."],
              ["2. Viral Score", "Detecta hooks, energia, polêmica e curiosidade."],
              ["3. Render", "Converte para 9:16 e aplica legenda dinâmica."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-2xl border border-indigo-300/20 bg-slate/60 p-4">
                <p className="text-sm font-semibold text-electric">{title}</p>
                <p className="mt-1 text-xs text-slate-300">{description}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="glass reveal rounded-3xl p-6">
          <h2 className="text-xl font-semibold text-white">Benefícios para canais de cortes</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-200">
            {benefits.map((item) => (
              <li key={item} className="rounded-2xl border border-indigo-300/20 bg-slate/50 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-2xl border border-electric/25 bg-electric/10 p-4 text-xs text-slate-100">
            Máximo por corte: <strong>1min15s</strong>. Janela padrão entre <strong>30s e 75s</strong>.
          </div>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="glass rounded-3xl p-6 md:col-span-2">
          <h3 className="text-lg font-semibold text-white">Pricing preparado para escalar</h3>
          <p className="mt-2 text-sm text-slate-300">
            Estrutura já pronta para plano free, plano pro, sistema de créditos e watermark no plano gratuito.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-indigo-300/20 bg-slate/60 p-4">
              <p className="text-sm font-semibold text-slate-100">Plano Free</p>
              <p className="mt-2 text-xs text-slate-300">Limite mensal de cortes, watermark automático e fila padrão.</p>
            </div>
            <div className="rounded-2xl border border-electric/30 bg-electric/10 p-4">
              <p className="text-sm font-semibold text-electric">Plano Pro</p>
              <p className="mt-2 text-xs text-slate-200">Mais cortes por vídeo, export sem marca e prioridade na fila.</p>
            </div>
          </div>
        </article>

        <article className="glass rounded-3xl p-6">
          <h3 className="text-lg font-semibold text-white">Nomes sugeridos</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {names.map((name) => (
              <span
                key={name}
                className="rounded-full border border-indigo-300/25 bg-slate/60 px-3 py-1 text-xs text-slate-100"
              >
                {name}
              </span>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
