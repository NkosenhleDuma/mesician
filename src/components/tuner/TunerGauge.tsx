"use client";

import { useMemo } from "react";

type Props = {
  cents: number | null;
  noteName: string;
  inTuneProgress: number;
};

const GAUGE_RANGE = 50;
const ARC_START_ANGLE = -135;
const ARC_END_ANGLE = -45;
const ARC_TOTAL = ARC_END_ANGLE - ARC_START_ANGLE;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function centsToAngle(cents: number): number {
  const clamped = Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, cents));
  const ratio = (clamped + GAUGE_RANGE) / (2 * GAUGE_RANGE);
  return ARC_START_ANGLE + ratio * ARC_TOTAL;
}

function getCentsColor(cents: number): string {
  const absCents = Math.abs(cents);
  if (absCents <= 5) return "#10b981";
  if (absCents <= 15) return "#eab308";
  return "#ef4444";
}

export function TunerGauge({ cents, noteName, inTuneProgress }: Props) {
  const cx = 150;
  const cy = 130;
  const radius = 100;

  const needleAngle = useMemo(() => {
    if (cents === null) return ARC_START_ANGLE + ARC_TOTAL / 2;
    return centsToAngle(cents);
  }, [cents]);

  const needleEnd = useMemo(() => {
    return polarToCartesian(cx, cy, radius - 10, needleAngle);
  }, [needleAngle]);

  const color = cents !== null ? getCentsColor(cents) : "#71717a";

  const redArcLeft = describeArc(cx, cy, radius, ARC_START_ANGLE, ARC_START_ANGLE + ARC_TOTAL * 0.3);
  const yellowArcLeft = describeArc(cx, cy, radius, ARC_START_ANGLE + ARC_TOTAL * 0.3, ARC_START_ANGLE + ARC_TOTAL * 0.4);
  const greenArc = describeArc(cx, cy, radius, ARC_START_ANGLE + ARC_TOTAL * 0.4, ARC_START_ANGLE + ARC_TOTAL * 0.6);
  const yellowArcRight = describeArc(cx, cy, radius, ARC_START_ANGLE + ARC_TOTAL * 0.6, ARC_START_ANGLE + ARC_TOTAL * 0.7);
  const redArcRight = describeArc(cx, cy, radius, ARC_START_ANGLE + ARC_TOTAL * 0.7, ARC_END_ANGLE);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 300 180" className="w-full max-w-xs">
        <path d={redArcLeft} fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
        <path d={yellowArcLeft} fill="none" stroke="#eab308" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
        <path d={greenArc} fill="none" stroke="#10b981" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
        <path d={yellowArcRight} fill="none" stroke="#eab308" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
        <path d={redArcRight} fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.3" />

        <line
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          style={{
            transition: "all 0.1s ease-out",
          }}
        />
        <circle cx={cx} cy={cy} r="8" fill={color} style={{ transition: "fill 0.1s ease-out" }} />

        <text x="50" y="170" fill="#71717a" fontSize="12" textAnchor="middle">
          -50
        </text>
        <text x="150" y="50" fill="#71717a" fontSize="12" textAnchor="middle">
          0
        </text>
        <text x="250" y="170" fill="#71717a" fontSize="12" textAnchor="middle">
          +50
        </text>
      </svg>

      <div className="text-center -mt-2">
        <div
          className="text-5xl font-bold font-mono tracking-tight"
          style={{ color, transition: "color 0.1s ease-out" }}
        >
          {noteName}
        </div>
        <div className="text-lg text-zinc-400 font-mono mt-1">
          {cents !== null ? (
            <>
              {cents >= 0 ? "+" : ""}
              {cents.toFixed(0)} cents
            </>
          ) : (
            "—"
          )}
        </div>
      </div>

      {inTuneProgress > 0 && (
        <div className="w-full max-w-xs mt-4">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-100"
              style={{ width: `${inTuneProgress * 100}%` }}
            />
          </div>
          <div className="text-xs text-zinc-500 text-center mt-1">
            Hold steady...
          </div>
        </div>
      )}
    </div>
  );
}
