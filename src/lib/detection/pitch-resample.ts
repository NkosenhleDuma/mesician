/** Resample mono Float32 PCM using OfflineAudioContext (quality vs speed trade-off). */
export async function resampleMonoTo22050(pcm: Float32Array, fromSampleRate: number): Promise<Float32Array> {
  if (fromSampleRate === 22050) return pcm.slice();
  const toSr = 22050;
  const lengthOut = Math.max(1, Math.ceil((pcm.length * toSr) / fromSampleRate));
  const oac = new OfflineAudioContext(1, lengthOut, toSr);
  const buf = oac.createBuffer(1, pcm.length, fromSampleRate);
  buf.copyToChannel(Float32Array.from(pcm), 0, 0);
  const src = oac.createBufferSource();
  src.buffer = buf;
  src.connect(oac.destination);
  src.start(0);
  const rendered = await oac.startRendering();
  return rendered.getChannelData(0).slice();
}

export function rmsFloat32(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i] ?? 0;
    acc += x * x;
  }
  return Math.sqrt(acc / pcm.length);
}
