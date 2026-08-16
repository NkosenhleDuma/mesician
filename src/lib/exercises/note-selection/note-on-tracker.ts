import type { NoteOnEvent } from "./types";

type ActiveNote = {
  pitchMidi: number;
  mergedStartMs: number;
};

/**
 * Emits note_on-style events when new pitches appear in the stabilizer snapshot.
 */
export class NoteOnTracker {
  private prevActive = new Map<number, number>();

  reset(): void {
    this.prevActive.clear();
  }

  poll(activeNotes: ActiveNote[], nowMs: number): NoteOnEvent[] {
    const events: NoteOnEvent[] = [];
    const seen = new Set<number>();

    for (const note of activeNotes) {
      const midi = Math.round(note.pitchMidi);
      seen.add(midi);
      const prevStart = this.prevActive.get(midi);
      const isNew =
        prevStart == null || Math.abs(note.mergedStartMs - prevStart) > 80;
      this.prevActive.set(midi, note.mergedStartMs);

      if (isNew) {
        events.push({
          pitchMidi: midi,
          timeMs: nowMs,
          velocity: 100,
        });
      }
    }

    for (const midi of [...this.prevActive.keys()]) {
      if (!seen.has(midi)) this.prevActive.delete(midi);
    }

    return events;
  }
}
