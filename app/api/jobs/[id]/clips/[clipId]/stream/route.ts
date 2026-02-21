import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getClipFileAsset } from "@/lib/queue";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; clipId: string }> }
) {
  const params = await context.params;
  const asset = getClipFileAsset(params.id, params.clipId);

  if (!asset) {
    return NextResponse.json({ error: "Arquivo do corte não encontrado para preview." }, { status: 404 });
  }

  const stream = createReadStream(asset.filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Disposition": `inline; filename="${asset.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
