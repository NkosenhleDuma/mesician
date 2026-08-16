import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { noteGameSessions } from "@/lib/db/schema";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const db = getDb();

  const row = await db.query.noteGameSessions.findFirst({
    where: and(eq(noteGameSessions.id, id), eq(noteGameSessions.userId, session.sub)),
  });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    session: {
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      config: row.config,
      result: row.result,
    },
  });
}
