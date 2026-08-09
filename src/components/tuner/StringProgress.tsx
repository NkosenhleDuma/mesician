"use client";

import type { TuningPreset } from "@/lib/tuner/tuning-presets";

type Props = {
  tuning: TuningPreset;
  currentStringIndex: number;
  completedStrings: Set<number>;
};

export function StringProgress({ tuning, currentStringIndex, completedStrings }: Props) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-3">
        {tuning.strings.map((note, idx) => {
          const isComplete = completedStrings.has(idx);
          const isCurrent = idx === currentStringIndex;
          const stringNumber = 6 - idx;

          return (
            <div key={idx} className="flex flex-col items-center gap-1">
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center
                  text-sm font-semibold transition-all duration-200
                  ${isComplete
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                      ? "bg-zinc-700 text-white ring-2 ring-emerald-500 ring-offset-2 ring-offset-zinc-950"
                      : "bg-zinc-800 text-zinc-500"
                  }
                `}
              >
                {isComplete ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stringNumber
                )}
              </div>
              <span
                className={`text-xs font-mono ${
                  isCurrent ? "text-emerald-400" : isComplete ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {note.replace(/\d+$/, "")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-sm text-zinc-500 mt-2">
        String {6 - currentStringIndex} of 6
      </div>
    </div>
  );
}
