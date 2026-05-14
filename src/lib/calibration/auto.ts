/** Estimate latency from scheduled click time vs detected onset (MVP: peak in first hop). */
export function estimateLatencyFromClick(
  scheduledClickAtCtx: number,
  audioBuffer: Float32Array,
  ctx: AudioContext,
  threshold = 0.02,
): number {
  let peakI = 0;
  let peak = 0;
  for (let i = 0; i < audioBuffer.length; i++) {
    const a = Math.abs(audioBuffer[i]);
    if (a > peak) {
      peak = a;
      peakI = i;
    }
  }
  if (peak < threshold) return 0;
  const detectedAt = ctx.currentTime - (audioBuffer.length - peakI) / ctx.sampleRate;
  return (detectedAt - scheduledClickAtCtx) * 1000;
}
