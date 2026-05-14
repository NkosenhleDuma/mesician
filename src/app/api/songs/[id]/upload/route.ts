import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs, songUploads } from "@/lib/db/schema";
import { processGpBuffer } from "@/lib/pipeline/ingest";
import { putObject } from "@/lib/s3/client";

const EXT_BY_FORMAT = { gp3: "gp3", gp4: "gp4", gp5: "gp5", gpx: "gpx", gp: "gp" } as const;
type GpFormat = keyof typeof EXT_BY_FORMAT;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: songId } = await ctx.params;
  const db = getDb();
  const song = await db.query.songs.findFirst({
    where: and(eq(songs.id, songId), eq(songs.userId, session.sub)),
  });
  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  const name = file.name.toLowerCase();
  let gpFormat: GpFormat;
  if (name.endsWith(".gp3")) gpFormat = "gp3";
  else if (name.endsWith(".gp4")) gpFormat = "gp4";
  else if (name.endsWith(".gp5")) gpFormat = "gp5";
  else if (name.endsWith(".gpx")) gpFormat = "gpx";
  else if (name.endsWith(".gp")) gpFormat = "gp";
  else {
    return NextResponse.json(
      { error: "Only .gp, .gp3, .gp4, .gp5, and .gpx files are supported" },
      { status: 400 },
    );
  }

  const uploadId = uuidv4();
  const ext = EXT_BY_FORMAT[gpFormat];
  const minioKey = `songs/${songId}/uploads/${uploadId}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject(minioKey, buf, "application/octet-stream");

  await db.insert(songUploads).values({
    songId,
    filename: file.name,
    gpFormat,
    minioObjectKey: minioKey,
  });

  await processGpBuffer({ songId, buffer: buf });

  return NextResponse.json({ ok: true, uploadId, gpFormat });
}
