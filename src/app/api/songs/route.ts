import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db.query.songs.findMany({
    where: eq(songs.userId, session.sub),
    orderBy: [desc(songs.createdAt)],
  });
  return NextResponse.json({ songs: rows });
}

const createSchema = z.object({
  title: z.string().min(1).max(512),
  artist: z.string().max(512).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const db = getDb();
  const [row] = await db
    .insert(songs)
    .values({
      userId: session.sub,
      title: parsed.data.title,
      artist: parsed.data.artist ?? null,
      difficulty: 1,
    })
    .returning();
  return NextResponse.json({ song: row });
}
