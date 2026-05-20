"use client";

export function CalibrationProceedModal({
  open,
  skipped,
  stringCountDone,
  onContinue,
}: {
  open: boolean;
  skipped: boolean;
  stringCountDone: number;
  onContinue: () => void;
}) {
  if (!open) return null;
  const title = skipped ? "Skipped string check" : "Strings calibrated";
  const body = skipped
    ? "Practice will use default pitch thresholds until you complete calibration."
    : `Captured ${stringCountDone} / 6 open strings with your mic. Profile is saved on this device.`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-proceed-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-xl space-y-4">
        <h2 id="cal-proceed-title" className="text-lg font-semibold text-white">
          {title}
        </h2>
        <p className="text-sm text-zinc-400">{body}</p>
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition touch-manipulation"
        >
          Continue to practice
        </button>
      </div>
    </div>
  );
}
