"use client";

import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { chordLabelFromMidis } from "@/lib/chart/chord-label";
import type { ChartEvent, ChartJson, ChartNote } from "@/lib/chart/types";
import type { Verdict } from "@/lib/scoring/engine";

const LANES = 6;
const PX_PER_SEC = 180;
const X_PLAYHEAD = 120;
const MIN_PILL_W = 22;
const PILL_H = 22;
const PILL_R = 9;

const HIT_VERDICT_FILL = 0x22c55e;
const MISS_VERDICT_FILL = 0xef4444;
/** Above anchor lane (clear pills / badges). */
const TIMING_FLASH_Y_OFFSET = 30;
const TIMING_FLASH_MS = 550;

const TECH_LETTER: Record<string, string> = {
  slide: "S",
  hammer: "H",
  pull: "P",
  mute: "M",
  bend: "B",
};

function formatTechTokens(
  raw: string[] | undefined,
  opts?: { omitHammerPull?: boolean },
): string {
  if (!raw?.length) return "";
  const omit = opts?.omitHammerPull ? new Set(["hammer", "pull"]) : null;
  const letters = [
    ...new Set(
      raw
        .filter((t) => !omit?.has(t))
        .map((t) => (TECH_LETTER[t] != null ? TECH_LETTER[t] : t.slice(0, 1).toUpperCase())),
    ),
  ].sort();
  return letters.join("");
}

/** GP string 1 = high E (top in AlphaTab); `7 - s` places that string on the bottom staff line. */
function displayStringIndex(gpString: number): number {
  if (gpString >= 1 && gpString <= LANES) return LANES + 1 - gpString;
  return gpString;
}

function pillFill(note: ChartNote, kind: "chord" | "note", verdict?: Verdict): number {
  if (verdict) return verdict === "miss" ? MISS_VERDICT_FILL : HIT_VERDICT_FILL;
  if (note.dead || note.palmMute) return 0x5c2d2d;
  if (note.fret === 0) return 0x6b7280;
  return kind === "chord" ? 0x44aaff : 0x66ff99;
}

export type TimingFlashPayload = {
  key: number;
  eventId: string;
  verdict: Verdict;
};

function timingFlashLabel(verdict: Verdict): string {
  switch (verdict) {
    case "perfect":
      return "perfect";
    case "slightEarly":
      return "a bit early";
    case "slightLate":
      return "a bit late";
    case "early":
      return "early";
    case "late":
      return "late";
    case "miss":
      return "";
  }
}

/** Piecewise fade-in / hold / fade-out over TIMING_FLASH_MS (approx. CSS-style flash). */
function timingFlashOpacity(elapsedMs: number): number {
  const t = elapsedMs / TIMING_FLASH_MS;
  if (t <= 0 || t >= 1) return 0;
  const a = 0.15;
  const b = 0.55;
  if (t < a) return t / a;
  if (t < b) return 1;
  return 1 - (t - b) / (1 - b);
}

function resolveTimingFlashLayout(
  flashEventId: string,
  songTime: number,
  byId: Map<string, ChartEvent>,
  yForString: (gpString: number) => number,
): { x: number; y: number; inWindow: boolean } | null {
  let ev = byId.get(flashEventId);
  if (!ev) return null;

  const peerMaybe = ev.hammerPullPeerId ? byId.get(ev.hammerPullPeerId) : undefined;
  if (peerMaybe && ev.t0 > peerMaybe.t0) {
    ev = peerMaybe;
  }

  const hpPeer = ev.hammerPullPeerId ? byId.get(ev.hammerPullPeerId) : undefined;
  const mergedHp =
    hpPeer &&
    ev.t0 < hpPeer.t0 &&
    ev.notes.length === 1 &&
    hpPeer.notes.length === 1;

  const inWindow = !(ev.t1 < songTime - 1.5 || ev.t0 > songTime + 12);

  if (mergedHp) {
    const n1 = ev.notes[0];
    const n2 = hpPeer!.notes[0];
    const anchorGpString = Math.min(n1.string, n2.string);
    const x0 = X_PLAYHEAD + (ev.t0 - songTime) * PX_PER_SEC;
    const wTotal = Math.max(MIN_PILL_W, (hpPeer!.t1 - ev.t0) * PX_PER_SEC);
    return {
      x: x0 + wTotal / 2,
      y: yForString(anchorGpString) - TIMING_FLASH_Y_OFFSET,
      inWindow,
    };
  }

  const x0 = X_PLAYHEAD + (ev.t0 - songTime) * PX_PER_SEC;
  const pillW = Math.max(MIN_PILL_W, (ev.t1 - ev.t0) * PX_PER_SEC);
  const anchorGpString = Math.min(...ev.notes.map((n) => n.string));
  return {
    x: x0 + pillW / 2,
    y: yForString(anchorGpString) - TIMING_FLASH_Y_OFFSET,
    inWindow,
  };
}

function labelFill(note: ChartNote): number {
  if (note.dead || note.palmMute) return 0xffaaaa;
  if (note.fret === 0) return 0x111118;
  return 0x12121a;
}

function drawMuteX(g: Graphics, cx: number, scale = 1): void {
  const s = 5 * scale;
  g.moveTo(cx - s, -s)
    .lineTo(cx + s, s)
    .moveTo(cx + s, -s)
    .lineTo(cx - s, s)
    .stroke({ width: 2, color: 0xff3333 });
}

function drawBendArrow(g: Graphics, cx: number, yTop: number): void {
  const h = 7;
  const w = 5;
  g.moveTo(cx, yTop - h)
    .lineTo(cx - w, yTop - h + w * 0.9)
    .lineTo(cx + w, yTop - h + w * 0.9)
    .lineTo(cx, yTop - h)
    .fill({ color: 0xffcc66 });
}

function drawVibratoWave(g: Graphics, cx: number, y: number, width: number): void {
  const amp = 2.5;
  const cycles = 2.5;
  const steps = 24;
  const x0 = cx - width / 2;
  g.moveTo(x0, y);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + t * width;
    const yy = y + Math.sin(t * Math.PI * 2 * cycles) * amp;
    g.lineTo(x, yy);
  }
  g.stroke({ width: 1.35, color: 0xd4c4b0 });
}

function drawDecor(
  g: Graphics,
  w: number,
  hasBend: boolean,
  hasVibrato: boolean,
): void {
  g.clear();
  if (!hasBend && !hasVibrato) return;
  const cx = w / 2;
  const top = -PILL_H / 2;
  if (hasVibrato) drawVibratoWave(g, cx, top - 5, Math.min(w, 36));
  if (hasBend) drawBendArrow(g, hasVibrato ? cx + 10 : cx, top);
}

type NoteSlot = {
  root: Container;
  pill: Graphics;
  xMark: Graphics;
  decor: Graphics;
  label: Text;
};

type HpSlot = {
  root: Container;
  pill: Graphics;
  xMark: Graphics;
  decor: Graphics;
  labelL: Text;
  labelR: Text;
};

type BadgeSlot = {
  root: Container;
  tech: Text;
  chord: Text;
};

type Props = {
  chart: ChartJson;
  getSongTime: () => number;
  getVerdict: (eventId: string, gpString: number) => Verdict | undefined;
  capoFret?: number | null;
  height?: number;
  timingFlashRef: RefObject<TimingFlashPayload | null>;
  timingFlashStartedMsRef: RefObject<number>;
};

function makeNoteSlot(): NoteSlot {
  const root = new Container();
  const pill = new Graphics();
  const xMark = new Graphics();
  const decor = new Graphics();
  const label = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, Segoe UI, sans-serif",
      fontSize: 15,
      fontWeight: "700",
      fill: 0x12121a,
    },
  });
  label.anchor.set(0.5);
  root.addChild(pill);
  root.addChild(xMark);
  root.addChild(decor);
  root.addChild(label);
  return { root, pill, xMark, decor, label };
}

function makeHpSlot(): HpSlot {
  const root = new Container();
  const pill = new Graphics();
  const xMark = new Graphics();
  const decor = new Graphics();
  const labelL = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, Segoe UI, sans-serif",
      fontSize: 13,
      fontWeight: "700",
      fill: 0x12121a,
    },
  });
  const labelR = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, Segoe UI, sans-serif",
      fontSize: 13,
      fontWeight: "700",
      fill: 0x12121a,
    },
  });
  labelL.anchor.set(0.5);
  labelR.anchor.set(0.5);
  root.addChild(pill);
  root.addChild(xMark);
  root.addChild(decor);
  root.addChild(labelL);
  root.addChild(labelR);
  return { root, pill, xMark, decor, labelL, labelR };
}

function makeBadgeSlot(): BadgeSlot {
  const root = new Container();
  const chord = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, Segoe UI, sans-serif",
      fontSize: 11,
      fontWeight: "600",
      fill: 0xe8dcc8,
    },
  });
  const tech = new Text({
    text: "",
    style: {
      fontFamily: "system-ui, Segoe UI, sans-serif",
      fontSize: 10,
      fontWeight: "600",
      fill: 0x8899cc,
    },
  });
  chord.anchor.set(0.5, 1);
  tech.anchor.set(0.5, 1);
  chord.position.set(0, -34);
  tech.position.set(0, -22);
  root.addChild(chord);
  root.addChild(tech);
  return { root, chord, tech };
}

function eventHasVibrato(ev: ChartEvent): boolean {
  return ev.notes.some((n) => n.vibrato);
}

export function HighwayCanvas({
  chart,
  getSongTime,
  getVerdict,
  capoFret,
  height = 360,
  timingFlashRef,
  timingFlashStartedMsRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const poolRef = useRef<NoteSlot[]>([]);
  const hpPoolRef = useRef<HpSlot[]>([]);
  const badgePoolRef = useRef<BadgeSlot[]>([]);
  const getSongTimeRef = useRef(getSongTime);
  const getVerdictRef = useRef(getVerdict);
  getSongTimeRef.current = getSongTime;
  getVerdictRef.current = getVerdict;

  const yOnStringLine = useCallback((h: number) => {
    const laneH = (h - 40) / LANES;
    return (gpString: number) => {
      const d = displayStringIndex(gpString);
      return 20 + (d - 1) * laneH;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      const app = new Application();
      await app.init({
        width: host.clientWidth,
        height,
        background: 0x12121a,
        preference: "webgl",
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      host.appendChild(app.canvas as HTMLCanvasElement);

      const w = app.renderer.width;
      const laneH = (height - 40) / LANES;
      const laneG = new Graphics();
      for (let s = 1; s <= LANES; s++) {
        const y = 20 + (s - 1) * laneH;
        laneG.moveTo(0, y).lineTo(w, y).stroke({ width: 1, color: 0x333350 });
      }
      laneG.moveTo(X_PLAYHEAD, 20).lineTo(X_PLAYHEAD, height - 20).stroke({ width: 2, color: 0xff4466 });

      const notes = new Container();
      const badges = new Container();
      app.stage.addChild(laneG);
      app.stage.addChild(notes);
      app.stage.addChild(badges);

      const timingFlashRoot = new Container();
      const timingFlashText = new Text({
        text: "",
        style: {
          fontFamily: "system-ui, Segoe UI, sans-serif",
          fontSize: 17,
          fontWeight: "700",
          fill: 0xe4e4e7,
          stroke: { color: 0x18181b, width: 4 },
          align: "center",
        },
      });
      timingFlashText.anchor.set(0.5, 1);
      timingFlashRoot.addChild(timingFlashText);
      app.stage.addChild(timingFlashRoot);

      const flashPayloadRef = timingFlashRef;
      const flashStartedMsRef = timingFlashStartedMsRef;

      const byId = new Map(chart.events.map((e) => [e.id, e]));

      const tick = () => {
        const songTime = getSongTimeRef.current();
        const yForString = yOnStringLine(height);
        const pool = poolRef.current;
        const hpPool = hpPoolRef.current;
        const badgePool = badgePoolRef.current;
        let i = 0;
        let hi = 0;
        let bi = 0;

        for (const ev of chart.events) {
          if (ev.t1 < songTime - 1.5 || ev.t0 > songTime + 12) continue;

          const peer = ev.hammerPullPeerId ? byId.get(ev.hammerPullPeerId) : undefined;
          if (peer && ev.t0 > peer.t0) {
            continue;
          }

          if (peer && ev.t0 < peer.t0 && ev.notes.length === 1 && peer.notes.length === 1) {
            const n1 = ev.notes[0];
            const n2 = peer.notes[0];
            const y = yForString(n1.string);
            const x0 = X_PLAYHEAD + (ev.t0 - songTime) * PX_PER_SEC;
            const wTotal = Math.max(MIN_PILL_W, (peer.t1 - ev.t0) * PX_PER_SEC);
            let divider = (ev.t1 - ev.t0) * PX_PER_SEC;
            if (!Number.isFinite(divider) || divider <= 0) divider = wTotal / 2;
            divider = Math.min(Math.max(divider, PILL_R + 1), wTotal - PILL_R - 1);

            let slot = hpPool[hi];
            if (!slot) {
              slot = makeHpSlot();
              hpPool[hi] = slot;
              notes.addChild(slot.root);
            }
            hi++;
            slot.root.visible = true;
            slot.root.position.set(x0, y);

            const c1 = pillFill(n1, ev.kind, getVerdictRef.current(ev.id, n1.string));
            const c2 = pillFill(n2, peer.kind, getVerdictRef.current(peer.id, n2.string));
            slot.pill.clear();
            slot.pill.roundRect(0, -PILL_H / 2, Math.max(divider + PILL_R * 0.5, PILL_R * 2), PILL_H, PILL_R).fill({ color: c1 });
            slot.pill
              .roundRect(
                Math.max(0, divider - PILL_R * 0.5),
                -PILL_H / 2,
                wTotal - Math.max(0, divider - PILL_R * 0.5),
                PILL_H,
                PILL_R,
              )
              .fill({ color: c2 });
            slot.pill
              .roundRect(0, -PILL_H / 2, wTotal, PILL_H, PILL_R)
              .stroke({ width: 1, color: 0x2a2a3a });
            slot.pill.moveTo(divider, -PILL_H / 2).lineTo(divider, PILL_H / 2).stroke({ width: 1.25, color: 0x1a1a28 });

            slot.xMark.clear();
            if (n1.dead || n1.palmMute) drawMuteX(slot.xMark, divider * 0.5);
            if (n2.dead || n2.palmMute) drawMuteX(slot.xMark, divider + (wTotal - divider) * 0.5);

            const techMerged = [...new Set([...(ev.tech ?? []), ...(peer.tech ?? [])])];
            const hasBend = techMerged.includes("bend");
            const vib = eventHasVibrato(ev) || eventHasVibrato(peer);
            drawDecor(slot.decor, wTotal, hasBend, vib);

            const f1 = String(n1.fret);
            const f2 = String(n2.fret);
            if (slot.labelL.text !== f1) slot.labelL.text = f1;
            if (slot.labelR.text !== f2) slot.labelR.text = f2;
            slot.labelL.style.fill = labelFill(n1);
            slot.labelR.style.fill = labelFill(n2);
            slot.labelL.position.set(divider * 0.5, 0);
            slot.labelR.position.set(divider + (wTotal - divider) * 0.5, 0);

            const techStr = formatTechTokens(techMerged, { omitHammerPull: true });
            const chordStr =
              ev.kind === "chord" || peer.kind === "chord"
                ? chordLabelFromMidis([...ev.notes, ...peer.notes].map((n) => n.midi), capoFret)
                : null;
            if (techStr || chordStr) {
              let b = badgePool[bi];
              if (!b) {
                b = makeBadgeSlot();
                badgePool[bi] = b;
                badges.addChild(b.root);
              }
              bi++;
              b.root.visible = true;
              b.root.position.set(x0 + wTotal / 2, y);
              const tTech = techStr || "";
              const tChord = chordStr || "";
              if (b.tech.text !== tTech) b.tech.text = tTech;
              if (b.chord.text !== tChord) b.chord.text = tChord;
              b.tech.visible = !!techStr;
              b.chord.visible = !!chordStr;
            }

            continue;
          }

          let minY = Infinity;
          const x0 = X_PLAYHEAD + (ev.t0 - songTime) * PX_PER_SEC;
          const pillW = Math.max(MIN_PILL_W, (ev.t1 - ev.t0) * PX_PER_SEC);
          const techStr = formatTechTokens(ev.tech);
          const chordStr =
            ev.kind === "chord" ? chordLabelFromMidis(ev.notes.map((n) => n.midi), capoFret) : null;
          const hasBend = (ev.tech ?? []).includes("bend");
          const vib = eventHasVibrato(ev);
          const topY = Math.min(...ev.notes.map((nn) => yForString(nn.string)));

          for (const n of ev.notes) {
            let slot = pool[i];
            if (!slot) {
              slot = makeNoteSlot();
              pool[i] = slot;
              notes.addChild(slot.root);
            }
            i++;
            slot.root.visible = true;
            const y = yForString(n.string);
            if (y < minY) minY = y;
            slot.root.position.set(x0, y);
            const fill = pillFill(n, ev.kind, getVerdictRef.current(ev.id, n.string));
            slot.pill.clear();
            slot.pill.roundRect(0, -PILL_H / 2, pillW, PILL_H, PILL_R).fill({ color: fill });
            slot.pill.roundRect(0, -PILL_H / 2, pillW, PILL_H, PILL_R).stroke({ width: 1, color: 0x2a2a3a });
            slot.xMark.clear();
            if (n.dead || n.palmMute) drawMuteX(slot.xMark, pillW / 2);
            const yN = yForString(n.string);
            const isTopString = yN === topY;
            drawDecor(slot.decor, pillW, isTopString && hasBend, isTopString && vib);
            const fretStr = String(n.fret);
            if (slot.label.text !== fretStr) slot.label.text = fretStr;
            slot.label.style.fill = labelFill(n);
            slot.label.position.set(pillW / 2, 0);
          }

          if (techStr || chordStr) {
            let b = badgePool[bi];
            if (!b) {
              b = makeBadgeSlot();
              badgePool[bi] = b;
              badges.addChild(b.root);
            }
            bi++;
            b.root.visible = true;
            const cx = x0 + pillW / 2;
            b.root.position.set(cx, minY);
            const tTech = techStr || "";
            const tChord = chordStr || "";
            if (b.tech.text !== tTech) b.tech.text = tTech;
            if (b.chord.text !== tChord) b.chord.text = tChord;
            b.tech.visible = !!techStr;
            b.chord.visible = !!chordStr;
          }
        }

        for (let j = i; j < pool.length; j++) {
          const slot = pool[j];
          if (slot) slot.root.visible = false;
        }
        for (let j = hi; j < hpPool.length; j++) {
          const slot = hpPool[j];
          if (slot) slot.root.visible = false;
        }
        for (let j = bi; j < badgePool.length; j++) {
          const b = badgePool[j];
          if (b) b.root.visible = false;
        }

        const flashPayload = flashPayloadRef.current;
        const flashStartedMs = flashStartedMsRef.current;
        if (
          !flashPayload ||
          flashPayload.verdict === "miss" ||
          flashStartedMs <= 0
        ) {
          timingFlashRoot.visible = false;
        } else {
          const elapsed = performance.now() - flashStartedMs;
          const alpha = timingFlashOpacity(elapsed);
          const layout = resolveTimingFlashLayout(
            flashPayload.eventId,
            songTime,
            byId,
            yForString,
          );
          if (!layout || !layout.inWindow || alpha <= 0) {
            timingFlashRoot.visible = false;
          } else {
            timingFlashRoot.visible = true;
            timingFlashRoot.alpha = alpha;
            timingFlashRoot.position.set(layout.x, layout.y);
            const lab = timingFlashLabel(flashPayload.verdict);
            if (timingFlashText.text !== lab) timingFlashText.text = lab;
          }
        }
      };

      app.ticker.add(tick);
    })();

    return () => {
      cancelled = true;
      appRef.current?.destroy(true);
      appRef.current = null;
      poolRef.current = [];
      hpPoolRef.current = [];
      badgePoolRef.current = [];
    };
  }, [chart, height, yOnStringLine, capoFret]);

  return <div ref={hostRef} className="w-full rounded-lg overflow-hidden border border-zinc-700 min-h-[200px]" />;
}
