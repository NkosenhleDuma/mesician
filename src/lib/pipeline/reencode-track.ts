import { eq } from "drizzle-orm";
import { classifyDifficulty } from "../chart/classify-difficulty";
import { applyUserChart } from "../chart/merge";
import { validateChartJson, type ChartJson } from "../chart/types";
import { getDb } from "../db";
import { songs, songTracks } from "../db/schema";
import { getObjectText, putObject } from "../s3/client";

export async function loadChartJson(key: string): Promise<ChartJson> {
  const raw = await getObjectText(key);
  return validateChartJson(JSON.parse(raw));
}

export async function reencodeTrack(opts: {
  songId: string;
  trackId: string;
  userSource: ChartJson;
}): Promise<void> {
  const { songId, trackId, userSource } = opts;
  const machineKey = `songs/${songId}/tracks/${trackId}/machine/chart.json`;
  const sourceKey = `songs/${songId}/tracks/${trackId}/source/chart.json`;
  const userKey = `songs/${songId}/tracks/${trackId}/user/chart.json`;

  const machine = await loadChartJson(machineKey);
  const effective = applyUserChart(machine, userSource);

  await putObject(userKey, JSON.stringify(userSource), "application/json");
  await putObject(sourceKey, JSON.stringify(effective), "application/json");

  const db = getDb();
  const hasNotes = effective.events.length > 0;
  const difficulty = classifyDifficulty(effective);
  await db
    .update(songTracks)
    .set({ sourceChartObjectKey: sourceKey, userChartObjectKey: userKey, hasNotes, difficulty })
    .where(eq(songTracks.id, trackId));

  const tracks = await db.query.songTracks.findMany({
    columns: { difficulty: true },
    where: eq(songTracks.songId, songId),
  });

  await db
    .update(songs)
    .set({ difficulty: tracks.length ? Math.max(...tracks.map((track) => track.difficulty)) : 1 })
    .where(eq(songs.id, songId));
}
