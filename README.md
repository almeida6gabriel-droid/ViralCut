# ViralCut AI (MVP)

SaaS para gerar cortes virais a partir de links do YouTube.

## Stack

- Frontend: Next.js (App Router), React, Tailwind
- Backend: API Routes no Next.js (Node runtime)
- Download YouTube: `yt-dlp` com resolucao automatica de runtime Python em `lib/ytdlp.ts`
- Video: `ffmpeg` (resolvido por `FFMPEG_BIN`, `ffmpeg-static` ou sistema)

## Como o yt-dlp e resolvido

A aplicacao tenta, nesta ordem:

1. `YTDLP_PYTHON` (se definido)
2. `.venv`/`venv` do projeto
3. `VIRTUAL_ENV` ativo
4. `py -3` (Windows)
5. `python` no PATH
6. `yt-dlp` binario no PATH (fallback)

No Windows, o Python da Microsoft Store (`WindowsApps`) e ignorado para evitar erro de modulo ausente.

## Requisitos

- Node.js 20+
- Python 3.x
- Dependencia Python: `yt-dlp` (arquivo `requirements.txt`)

## Setup rapido (Windows / PowerShell)

```powershell
# 1) Dependencias Node
npm install

# 2) Venv Python local do projeto
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# 3) (Opcional) Fixar interpretador Python usado pelo app
$pythonPath = (Resolve-Path .\.venv\Scripts\python.exe).Path
setx YTDLP_PYTHON "$pythonPath"

# 4) Arquivo de ambiente
Copy-Item .env.example .env.local

# 5) Rodar app
npm run dev
```

## Estrutura principal

- `app/api/jobs/route.ts`: cria job + valida URL/videoId
- `lib/queue.ts`: orquestracao da pipeline
- `lib/ytdlp.ts`: metadados/download/legendas automaticas via yt-dlp
- `lib/transcription.ts`: segmentos de transcricao + energia de audio
- `lib/viral.ts`: scoring viral e sugestao de cortes
- `lib/render.ts`: render dos clips 9:16 + legendas

Variaveis uteis de render:
- `FFMPEG_BIN`: caminho do ffmpeg (opcional)
- `POPPINS_FONT_FILE`: caminho absoluto para `Poppins-ExtraBold.ttf` (opcional, recomendado para manter o visual no export)

## Observacao

Estado de jobs e fila fica em memoria (MVP). Reiniciar o servidor limpa os jobs da RAM.
