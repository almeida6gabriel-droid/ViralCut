import { NextResponse } from "next/server";

import { regenerateMoreCuts } from "@/lib/queue";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  try {
    const job = await regenerateMoreCuts(params.id);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar novos cortes.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
