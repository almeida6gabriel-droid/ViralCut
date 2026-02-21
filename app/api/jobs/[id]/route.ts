import { NextResponse } from "next/server";
import { z } from "zod";

import { getJob, updateClipCopy } from "@/lib/queue";

const updateClipSchema = z.object({
  clipId: z.string().min(1),
  title: z.string().min(3).max(140).optional(),
  transcriptSnippet: z.string().min(3).max(500).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const job = getJob(params.id);

  if (!job) {
    return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  try {
    const body = await request.json();
    const parsed = updateClipSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido para atualizar corte." }, { status: 400 });
    }

    const updated = updateClipCopy(params.id, parsed.data.clipId, {
      title: parsed.data.title,
      transcriptSnippet: parsed.data.transcriptSnippet,
    });

    if (!updated) {
      return NextResponse.json({ error: "Corte não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ clip: updated });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar o corte." }, { status: 500 });
  }
}
