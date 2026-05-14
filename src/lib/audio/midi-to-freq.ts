export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
