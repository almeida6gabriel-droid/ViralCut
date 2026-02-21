import { NextResponse } from "next/server";
import { z } from "zod";

import { generateSeoPack } from "@/lib/viral";

const schema = z.object({
  sourceText: z.string().min(8),
  contextTitle: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Texto insuficiente para gerar SEO." }, { status: 400 });
    }

    return NextResponse.json(generateSeoPack(parsed.data.sourceText, parsed.data.contextTitle));
  } catch {
    return NextResponse.json({ error: "Falha ao gerar títulos e hashtags." }, { status: 500 });
  }
}
