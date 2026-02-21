import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { getClipFileAsset } from "@/lib/queue";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; clipId: string }> }
) {
  const params = await context.params;
  const asset = getClipFileAsset(params.id, params.clipId);

  if (!asset) {
    return NextResponse.json({ error: "Corte não encontrado para download." }, { status: 404 });
  }

  const stream = createReadStream(asset.filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Disposition": `attachment; filename=\"${asset.filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
