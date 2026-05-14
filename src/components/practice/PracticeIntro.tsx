"use client";

type Props = {
  songTitle: string;
  trackName: string;
  bpm: number | undefined;
  tuning: string;
  capoLabel: string;
  keyLabel: string;
  onStart: () => void;
};

export function PracticeIntro({
  songTitle,
  trackName,
  bpm,
  tuning,
  capoLabel,
  keyLabel,
  onStart,
}: Props) {
  return (
    <div className="min-h-[70dvh] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 space-y-6 shadow-xl">
        <div className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Practice</p>
          <h2 className="text-xl font-semibold text-white leading-tight">{songTitle}</h2>
          <p className="text-sm text-zinc-400">{trackName}</p>
        </div>
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-zinc-800/80 pb-2">
            <dt className="text-zinc-500">BPM</dt>
            <dd className="font-mono text-zinc-200">{bpm ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/80 pb-2">
            <dt className="text-zinc-500 shrink-0">Tuning</dt>
            <dd className="font-mono text-zinc-200 text-right break-all">{tuning || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-800/80 pb-2">
            <dt className="text-zinc-500">Capo</dt>
            <dd className="font-mono text-zinc-200">{capoLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Key</dt>
            <dd className="font-mono text-zinc-200">{keyLabel}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={onStart}
          className="w-full py-4 rounded-xl bg-emerald-600 text-white font-semibold text-base hover:bg-emerald-500 active:scale-[0.99] transition touch-manipulation"
        >
          Start practice
        </button>
        <p className="text-xs text-zinc-500 text-center">
          Rotate to landscape for the full playfield. Use the on-screen menu for play, speed, and settings.
        </p>
      </div>
    </div>
  );
}
