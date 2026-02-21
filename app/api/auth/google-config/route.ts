import { NextResponse } from "next/server";

import { googleLoginConfigured } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    enabled: googleLoginConfigured,
  });
}
