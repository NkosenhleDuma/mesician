"use client";

import { TUNING_PRESETS, type TuningPreset } from "@/lib/tuner/tuning-presets";

type Props = {
  value: TuningPreset;
  onChange: (preset: TuningPreset) => void;
  disabled?: boolean;
};

export function TuningSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="tuning-select" className="text-xs text-zinc-500 uppercase tracking-wide">
        Tuning
      </label>
      <select
        id="tuning-select"
        value={value.id}
        onChange={(e) => {
          const preset = TUNING_PRESETS.find((p) => p.id === e.target.value);
          if (preset) onChange(preset);
        }}
        disabled={disabled}
        className="
          bg-zinc-800 text-white border border-zinc-700 rounded-lg
          px-3 py-2 text-sm font-medium
          focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          appearance-none cursor-pointer
        "
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.5rem center",
          backgroundSize: "1.25rem",
          paddingRight: "2.5rem",
        }}
      >
        {TUNING_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name} ({preset.strings.map((s) => s.replace(/\d+$/, "")).join(" ")})
          </option>
        ))}
      </select>
    </div>
  );
}
