"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import { getRegion } from "@/lib/exercises/note-selection/config";
import type {
  FretPosition,
  FretboardLength,
  FretboardRegionId,
  GameMode,
} from "@/lib/exercises/note-selection/types";

const STRINGS = 6;
const FRET_MARKER_POSITIONS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

export type FretboardCanvasProps = {
  fretboardLength: FretboardLength;
  mode: GameMode;
  highlightString?: number;
  regionId?: FretboardRegionId;
  revealedPositions?: FretPosition[];
  showReveal?: boolean;
};

function displayStringY(string: number, height: number, padding: number): number {
  const innerH = height - padding * 2;
  const lane = (STRINGS + 1 - string) / STRINGS;
  return padding + innerH * lane;
}

export function FretboardCanvas({
  fretboardLength,
  mode,
  highlightString,
  regionId,
  revealedPositions = [],
  showReveal = false,
}: FretboardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let app: Application | null = null;

    const setup = async () => {
      app = new Application();
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: host,
      });
      if (disposed) {
        app.destroy(true);
        return;
      }

      host.replaceChildren(app.canvas);
      appRef.current = app;

      const draw = () => {
        if (!app) return;
        app.stage.removeChildren();

        const w = app.screen.width;
        const h = app.screen.height;
        const padding = 16;
        const nutW = 10;
        const labelW = 28;
        const playableW = w - padding * 2 - nutW - labelW;
        const fretW = playableW / fretboardLength;

        const root = new Container();
        app.stage.addChild(root);

        const board = new Graphics();
        board.roundRect(padding, padding, w - padding * 2, h - padding * 2, 8);
        board.fill({ color: 0x1a1a1a });
        board.stroke({ color: 0x3f3f46, width: 1 });
        root.addChild(board);

        const region =
          mode === "region" && regionId ? getRegion(regionId) : null;

        if (region) {
          const x0 =
            padding + nutW + labelW + region.minFret * fretW - (region.minFret === 0 ? 0 : fretW / 2);
          const x1 =
            padding +
            nutW +
            labelW +
            region.maxFret * fretW +
            fretW / 2;
          const y0 = displayStringY(region.maxString, h, padding) - 12;
          const y1 = displayStringY(region.minString, h, padding) + 12;
          const regionGfx = new Graphics();
          regionGfx.rect(x0, y0, x1 - x0, y1 - y0);
          regionGfx.fill({ color: 0x0ea5e9, alpha: 0.12 });
          regionGfx.stroke({ color: 0x38bdf8, width: 2, alpha: 0.5 });
          root.addChild(regionGfx);
        }

        const nutGfx = new Graphics();
        nutGfx.rect(padding + labelW, padding + 8, nutW, h - padding * 2 - 16);
        nutGfx.fill({ color: 0xf4f4f5 });
        root.addChild(nutGfx);

        for (let f = 1; f <= fretboardLength; f++) {
          const x = padding + labelW + nutW + f * fretW;
          const fretLine = new Graphics();
          fretLine.moveTo(x, padding + 8);
          fretLine.lineTo(x, h - padding - 8);
          fretLine.stroke({ color: 0x71717a, width: f % 12 === 0 ? 2.5 : 1.5 });
          root.addChild(fretLine);

          if (FRET_MARKER_POSITIONS.includes(f) && f <= fretboardLength) {
            const marker = new Graphics();
            marker.circle(x - fretW / 2, h / 2, 4);
            marker.fill({ color: 0x52525b });
            root.addChild(marker);
          }
        }

        for (let s = 1; s <= STRINGS; s++) {
          const y = displayStringY(s, h, padding);
          const isHighlighted =
            mode === "single-string" ? highlightString === s : true;
          const alpha =
            mode === "single-string" && !isHighlighted ? 0.25 : mode === "wide" ? 1 : 0.85;

          const stringLine = new Graphics();
          stringLine.moveTo(padding + labelW, y);
          stringLine.lineTo(w - padding, y);
          stringLine.stroke({
            color: isHighlighted && mode === "single-string" ? 0x38bdf8 : 0xa1a1aa,
            width: s <= 3 ? 1.5 : 2,
            alpha,
          });
          root.addChild(stringLine);

          const label = new Text({
            text: String(s),
            style: { fill: 0xd4d4d8, fontSize: 11 },
          });
          label.x = padding + 6;
          label.y = y - 8;
          label.alpha = alpha;
          root.addChild(label);
        }

        if (showReveal && revealedPositions.length > 0) {
          for (const pos of revealedPositions) {
            const cx =
              padding +
              labelW +
              nutW +
              (pos.fret === 0 ? 0 : pos.fret * fretW - fretW / 2);
            const cy = displayStringY(pos.string, h, padding);
            const dot = new Graphics();
            dot.circle(cx, cy, 10);
            dot.fill({ color: 0x22c55e, alpha: 0.85 });
            dot.stroke({ color: 0xbbf7d0, width: 2 });
            root.addChild(dot);
          }
        }
      };

      draw();
      app.renderer.on("resize", draw);
    };

    void setup();

    return () => {
      disposed = true;
      app?.destroy(true);
      appRef.current = null;
    };
  }, [fretboardLength, mode, highlightString, regionId, revealedPositions, showReveal]);

  return (
    <div
      ref={hostRef}
      className="w-full h-48 sm:h-56 rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden"
    />
  );
}
