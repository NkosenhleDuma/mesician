import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs, songTracks } from "@/lib/db/schema";
import { debugReportBodySchema } from "@/lib/scoring/debug-report-schema";
import { getObjectText, listJsonObjectsByPrefix, putObject } from "@/lib/s3/client";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const LIST_DEFAULT = 80;
const LIST_MAX = 100;

function debugKeyOwnedByUser(userId: string, key: string): boolean {
  const segs = key.split("/");
  return (
    segs.length === 4 &&
    segs[0] === "debug" &&
    segs[1] === userId &&
    segs[2].length > 0 &&
    segs[3]!.endsWith(".json")
  );
}

async function trackOwnedByUser(trackId: string, userId: string) {
  const db = getDb();
  const track = await db.query.songTracks.findFirst({
    where: eq(songTracks.id, trackId),
  });
  if (!track) return null;
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, track.songId), eq(songs.userId, userId)),
  });
  if (!song) return null;
  return track;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const len = req.headers.get("content-length");
  if (len != null) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = debugReportBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const meta = parsed.data.meta;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, meta.songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const track = await db.query.songTracks.findFirst({
    where: and(eq(songTracks.id, meta.trackId), eq(songTracks.songId, meta.songId)),
  });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const slug = `${meta.capturedAtIso.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const key = `debug/${session.sub}/${meta.trackId}/${slug}.json`;

  await putObject(key, serialized, "application/json");
  console.info(
    `[debug-note-decisions] key=${key} decisions=${parsed.data.decisions.length} user=${session.sub} reason=${parsed.data.meta.reason ?? "legacy"}`,
  );

  return NextResponse.json({ key });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const keyParam = searchParams.get("key");
  const trackId = searchParams.get("trackId");
  const limitRaw = searchParams.get("limit");

  if (keyParam) {
    let keyDecoded: string;
    try {
      keyDecoded = decodeURIComponent(keyParam);
    } catch {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }
    if (!debugKeyOwnedByUser(session.sub, keyDecoded)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    let text: string;
    try {
      text = await getObjectText(keyDecoded);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({ error: "Invalid stored JSON" }, { status: 500 });
    }
    const valid = debugReportBodySchema.safeParse(parsed);
    if (!valid.success) return NextResponse.json({ error: "Invalid report shape" }, { status: 500 });
    return NextResponse.json(valid.data);
  }

  if (!trackId) {
    return NextResponse.json({ error: "Provide trackId or key" }, { status: 400 });
  }

  const trackOk = z.string().uuid().safeParse(trackId);
  if (!trackOk.success) return NextResponse.json({ error: "Invalid trackId" }, { status: 400 });

  const owned = await trackOwnedByUser(trackId, session.sub);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limit = Math.min(
    LIST_MAX,
    Math.max(1, Number.parseInt(limitRaw ?? String(LIST_DEFAULT), 10) || LIST_DEFAULT),
  );
  const prefix = `debug/${session.sub}/${trackId}/`;
  const items = await listJsonObjectsByPrefix(prefix, limit);
  return NextResponse.json({ items });
}
