import { eq } from "drizzle-orm";
import { classifyDifficulty } from "../chart/classify-difficulty";
import { getDb } from "../db";
import { songs, songTracks } from "../db/schema";
import { parseGpToCharts } from "../gp/parse";
import { putObject } from "../s3/client";

export async function processGpBuffer(opts: {
  songId: string;
  buffer: Buffer;
}): Promise<void> {
  const { songId, buffer } = opts;
  const db = getDb();

  await db.delete(songTracks).where(eq(songTracks.songId, songId));

  const { tracks, chartsByTrack } = parseGpToCharts(buffer);
  const trackDifficulties: number[] = [];

  for (let i = 0; i < chartsByTrack.length; i++) {
    const summary = tracks[i];
    const chart = chartsByTrack[i];

    const hasNotes = chart.events.length > 0;
    const difficulty = classifyDifficulty(chart);
    const [trackRow] = await db
      .insert(songTracks)
      .values({
        songId,
        trackIndex: i,
        name: summary.name,
        instrument: summary.instrument,
        tuningJson: summary.tuning,
        isGuitar: summary.isGuitar,
        hasNotes,
        difficulty,
      })
      .returning();

    const trackId = trackRow.id;
    const machineKey = `songs/${songId}/tracks/${trackId}/machine/chart.json`;
    const sourceKey = `songs/${songId}/tracks/${trackId}/source/chart.json`;
    await putObject(machineKey, JSON.stringify(chart), "application/json");
    await putObject(sourceKey, JSON.stringify(chart), "application/json");
    await db.update(songTracks).set({ sourceChartObjectKey: sourceKey }).where(eq(songTracks.id, trackId));
    trackDifficulties.push(difficulty);
  }

  await db
    .update(songs)
    .set({ difficulty: trackDifficulties.length ? Math.max(...trackDifficulties) : 1 })
    .where(eq(songs.id, songId));
}
