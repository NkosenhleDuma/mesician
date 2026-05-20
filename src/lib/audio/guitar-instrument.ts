import { Soundfont } from "smplr";
import type { TransportState } from "./transport";

/** GM-style name from smplr / gleitz MIDI.js soundfonts — steel acoustic reads well for tab playback. */
export const GUITAR_SOUNDFONT_NAME = "acoustic_guitar_steel" as const;

/**
 * One-off soundfont for debug / standalone preview (no transport). Fails soft → caller uses triangle/sine fallback.
 */
export async function loadGuitarSoundfontForPreview(
  ctx: AudioContext,
  destination: AudioNode,
): Promise<Soundfont | undefined> {
  try {
    const sf = new Soundfont(ctx, {
      instrument: GUITAR_SOUNDFONT_NAME,
      kit: "MusyngKite",
      destination,
      volume: 78,
      extraGain: 0.22,
    });
    await sf.load;
    return sf;
  } catch {
    return undefined;
  }
}

async function loadGuitarOnce(transport: TransportState): Promise<Soundfont | undefined> {
  if (transport.guitar) return transport.guitar;
  try {
    const sf = new Soundfont(transport.ctx, {
      instrument: GUITAR_SOUNDFONT_NAME,
      kit: "MusyngKite",
      destination: transport.outputGain,
      volume: 78,
      /** Default 5 in smplr is very hot; keep chart playback near triangle levels. */
      extraGain: 0.22,
    });
    await sf.load;
    transport.guitar = sf;
    return sf;
  } catch (err) {
    transport.guitarLoadError = true;
    console.warn("mesician: guitar soundfont failed to load; using built-in synth", err);
    return undefined;
  }
}

/**
 * Loads gleitz/midi-js-soundfonts samples once per transport (client + network).
 * After a load failure, returns `undefined` without retrying (avoid hammering the CDN).
 */
export function resolveGuitarInstrument(transport: TransportState): Promise<Soundfont | undefined> {
  if (transport.guitarLoadError) return Promise.resolve(undefined);
  if (transport.guitar) return Promise.resolve(transport.guitar);
  if (!transport.guitarLoadPromise) {
    transport.guitarLoadPromise = loadGuitarOnce(transport);
  }
  return transport.guitarLoadPromise;
}
