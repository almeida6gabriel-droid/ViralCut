import { NextResponse } from "next/server";
import { z } from "zod";

import { createProcessingJob, listJobs } from "@/lib/queue";
import { parseYouTubeUrl } from "@/lib/youtube";

const createJobSchema = z.object({
  youtubeUrl: z.string().url(),
});

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = createJobSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Envie um link válido de vídeo do YouTube." },
        { status: 400 }
      );
    }

    const parsedYoutube = parseYouTubeUrl(parsedBody.data.youtubeUrl);

    if (!parsedYoutube) {
      return NextResponse.json(
        { error: "Link inválido. Use URL do YouTube no formato watch, shorts ou youtu.be." },
        { status: 400 }
      );
    }

    console.info(`[jobs] URL recebida: ${parsedBody.data.youtubeUrl}`);
    console.info(`[jobs] videoId extraído: ${parsedYoutube.videoId}`);

    const job = createProcessingJob(parsedYoutube.canonicalUrl, parsedYoutube.videoId);

    return NextResponse.json({ job }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível iniciar o processamento." }, { status: 500 });
  }
}
