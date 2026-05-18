import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { debugReportBodySchema } from "@/lib/scoring/debug-report-schema";
import { getObjectBuffer, getObjectText, putObject } from "@/lib/s3/client";

export const runtime = "nodejs";

/** Sidecar recordings can exceed JSON max (25 MB). */
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function debugJsonKeyOwnedByUser(userId: string, key: string): boolean {
  const segs = key.split("/");
  return (
    segs.length === 4 &&
    segs[0] === "debug" &&
    segs[1] === userId &&
    segs[2].length > 0 &&
    segs[3]!.endsWith(".json")
  );
}

function debugSessionAudioKeyOwnedByUser(userId: string, key: string): boolean {
  const segs = key.split("/");
  return (
    segs.length === 4 &&
    segs[0] === "debug" &&
    segs[1] === userId &&
    segs[2].length > 0 &&
    /\.(webm|ogg|mp4|mpeg)$/i.test(segs[3] ?? "")
  );
}

function extForContentType(ct: string): string {
  const c = ct.toLowerCase();
  if (c.includes("ogg")) return ".ogg";
  if (c.includes("mp4") || c.includes("mpeg")) return ".mp4";
  return ".webm";
}

/**
 * POST: upload session audio for an existing debug JSON report; merges `meta.audioRecording*` on the JSON object.
 * Query: `jsonKey` = full S3 key returned from POST /api/debug/note-decisions
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const jsonKeyRaw = url.searchParams.get("jsonKey");
  if (!jsonKeyRaw) {
    return NextResponse.json({ error: "Provide jsonKey" }, { status: 400 });
  }
  let jsonKey: string;
  try {
    jsonKey = decodeURIComponent(jsonKeyRaw);
  } catch {
    return NextResponse.json({ error: "Invalid jsonKey" }, { status: 400 });
  }

  if (!debugJsonKeyOwnedByUser(session.sub, jsonKey)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const len = req.headers.get("content-length");
  if (len != null) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (buf.length === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const contentType =
    req.headers.get("content-type")?.split(";")[0]?.trim() || "audio/webm";

  let text: string;
  try {
    text = await getObjectText(jsonKey);
  } catch {
    return NextResponse.json({ error: "JSON report not found" }, { status: 404 });
  }

  const ext = extForContentType(contentType);
  const audioKey = jsonKey.replace(/\.json$/i, ext);

  await putObject(audioKey, buf, contentType);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "Stored JSON corrupt" }, { status: 500 });
  }

  const reparsed = debugReportBodySchema.safeParse(parsedJson);
  if (!reparsed.success) {
    return NextResponse.json({ error: "Stored JSON invalid" }, { status: 500 });
  }

  const merged = {
    ...reparsed.data,
    meta: {
      ...reparsed.data.meta,
      audioRecordingKey: audioKey,
      audioRecordingMime: contentType,
    },
  };

  await putObject(jsonKey, JSON.stringify(merged), "application/json");

  console.info(
    `[debug-session-audio] audioKey=${audioKey} bytes=${buf.length} user=${session.sub}`,
  );

  return NextResponse.json({ audioKey, mime: contentType });
}

/**
 * GET: fetch recorded bytes for an owned sidecar key (`debug/{user}/{track}/….webm`).
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  let key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Provide key" }, { status: 400 });
  }
  try {
    key = decodeURIComponent(key);
  } catch {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  if (!debugSessionAudioKeyOwnedByUser(session.sub, key)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await getObjectBuffer(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase();
  const ct =
    ext === "ogg" || ext === "oga"
      ? "audio/ogg"
      : ext === "mp4" || ext === "m4a"
        ? "audio/mp4"
        : "audio/webm";

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
