import type { ChartJson } from "./types";

/** User-saved tab replaces machine events; metadata kept from machine unless overridden. */
export function applyUserChart(machine: ChartJson, user: ChartJson | null): ChartJson {
  if (!user) return machine;
  return {
    version: 1,
    meta: { ...machine.meta, ...user.meta, tuning: user.meta.tuning ?? machine.meta.tuning },
    events: user.events,
    duration: user.duration,
  };
}
