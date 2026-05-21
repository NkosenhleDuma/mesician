"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChartJson } from "@/lib/chart/types";
import { buildOpenStringCalibrationChart } from "@/lib/calibration/build-calibration-chart";
import { verdictKey, type Verdict } from "@/lib/scoring/engine";
import {
  blankStringProfile,
  mergeStringProfileSample,
  type StringProfile,
} from "@/lib/calibration/string-profile";
import { verifyCalibrationPitch } from "@/lib/calibration/verify-calibration-pitch";
import { setStoredStringProfile } from "@/lib/calibration/storage";
import { createTransport, getSongTime, pause, seek, type TransportState } from "@/lib/audio/transport";
import { AudioCaptureWorklet, type OnsetPayload } from "@/lib/audio/audio-capture-worklet";
import { BasicPitchDetector } from "@/lib/detection/basic-pitch-detector";
import { HighwayCanvas, type TimingFlashPayload } from "./HighwayCanvas";
import { CalibrationProceedModal } from "./CalibrationProceedModal";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

const MOBILE_MAX_W_PX = 767;
const MOBILE_BOTTOM_STRIP_PX = 36;

function getErrName(err: unknown): string | null {
  if (err && typeof err === "object" && "name" in err) {
    const n = (err as { name: unknown }).name;
    if (typeof n === "string") return n;
  }
  return null;
}

function describeMicError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Mic blocked: open this page over HTTPS or via localhost.";
  }
  const name = getErrName(err);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mic permission denied.";
  }
  if (name === "NotFoundError") {
    return "No microphone found.";
  }
  return "Mic unavailable.";
}

type Props = {
  sourceChart: ChartJson;
  songTitle: string;
  trackName: string;
  onFinished: (result: { savedProfile: StringProfile | null; skippedCalibration: boolean }) => void;
};

export function StringCalibrationFlow({
  sourceChart,
  songTitle,
  trackName,
  onFinished,
}: Props) {
  const calibrationChart = useMemo(
    () => buildOpenStringCalibrationChart(sourceChart),
    [sourceChart],
  );

  const transportRef = useRef<TransportState | null>(null);
  const verdictsRef = useRef(new Map<string, Verdict>());
  const profileRef = useRef<StringProfile | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const basicPitchRef = useRef<BasicPitchDetector | null>(null);
  const captureDisconnectRef = useRef<(() => void) | null>(null);

  const currentStepRef = useRef(0);

  const timingFlashRef = useRef<TimingFlashPayload | null>(null);
  const timingFlashStartedMsRef = useRef(0);

  const [tick, setTick] = useState(0);
  const [started, setStarted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showProceed, setShowProceed] = useState(false);
  const [skippedFlag, setSkippedFlag] = useState(false);

  const mainRef = useRef<HTMLDivElement>(null);
  const [highwayMobileH, setHighwayMobileH] = useState(360);

  const [isMobile, setIsMobile] = useState(false);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_W_PX}px)`);
    const or = window.matchMedia("(orientation: portrait)");
    const sync = () => {
      setIsMobile(mq.matches);
      setPortrait(or.matches && mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    or.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      or.removeEventListener("change", sync);
    };
  }, []);

  const meta = calibrationChart.meta;
  const tuningLabel = meta.tuning.length ? meta.tuning.join(" ") : "—";
  const capoLabel =
    meta.capoFret != null && meta.capoFret > 0 ? `Capo ${meta.capoFret}` : "No capo";
  const bpmLabel = meta.tempoMap[0]?.bpm;

  const resetVerdictState = useCallback(() => {
    verdictsRef.current.clear();
    currentStepRef.current = 0;
    setCurrentStep(0);
    profileRef.current = blankStringProfile({
      tuning: [...meta.tuning],
      capoFret: meta.capoFret ?? null,
      capturedAtIso: new Date().toISOString(),
    });
    setTick((x) => x + 1);
  }, [meta.capoFret, meta.tuning]);

  useEffect(() => {
    const t = createTransport(calibrationChart, { playbackVolume: 0 });
    transportRef.current = t;
    profileRef.current = blankStringProfile({
      tuning: [...meta.tuning],
      capoFret: meta.capoFret ?? null,
      capturedAtIso: new Date().toISOString(),
    });
    return () => {
      pause(t);
      micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
      micStreamRef.current = null;
      captureDisconnectRef.current?.();
      captureDisconnectRef.current = null;
      basicPitchRef.current?.dispose();
      basicPitchRef.current = null;
      void t.ctx.close();
      transportRef.current = null;
    };
  }, [calibrationChart, meta.capoFret, meta.tuning]);

  useEffect(() => {
    document.body.classList.add("mobile-no-scroll");
    return () => document.body.classList.remove("mobile-no-scroll");
  }, []);

  useLayoutEffect(() => {
    if (!isMobile) return;
    const el = mainRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight - MOBILE_BOTTOM_STRIP_PX;
      setHighwayMobileH(Math.max(140, Math.floor(h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  const getSongTimeFn = useCallback(() => {
    const tr = transportRef.current;
    return tr ? getSongTime(tr) : 0;
  }, []);

  const getVerdict = useCallback((eventId: string, gpString: number) => {
    return verdictsRef.current.get(verdictKey(eventId, gpString));
  }, []);

  const requestMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("no-media");
    }
    try {
      return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      if (getErrName(err) === "OverconstrainedError") {
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }, []);

  const beginCalibrationCapture = useCallback(async () => {
    const tr = transportRef.current;
    if (!tr) return false;

    captureDisconnectRef.current?.();
    captureDisconnectRef.current = null;
    basicPitchRef.current?.dispose();
    basicPitchRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    setBusy(true);
    setMicError(null);

    try {
      const stream = await requestMic();
      micStreamRef.current = stream;
      await tr.ctx.resume().catch(() => {});

      const capture = new AudioCaptureWorklet(tr.ctx);

      const onPayload = (payload: OnsetPayload) => {
        const trInner = transportRef.current;
        if (!trInner) return;

        const events = calibrationChart.events;
        const stepIdx = currentStepRef.current;
        const bestEv = events[stepIdx];
        if (!bestEv || bestEv.notes.length !== 1) return;

        const n = bestEv.notes[0]!;
        if (verdictsRef.current.has(verdictKey(bestEv.id, n.string))) return;

        const onsetCtxMs = payload.audioContextTime * 1000;
        const evidence = basicPitchRef.current?.midisEvidenceAt(onsetCtxMs) ?? new Set<number>();
        const v = verifyCalibrationPitch(
          n.midi,
          payload.waveSnippet,
          payload.spectrum,
          payload.sampleRate,
          evidence,
        );

        if (!v.ok || v.detectedMidi == null) return;

        const centsErr =
          v.cents != null
            ? v.cents
            : 1200 * Math.log2(v.detectedMidi / n.midi);

        verdictsRef.current.set(verdictKey(bestEv.id, n.string), "perfect");
        const prof = profileRef.current;
        if (prof) {
          profileRef.current = mergeStringProfileSample(prof, {
            gpString: n.string,
            expectedMidi: n.midi,
            detectedMidi: v.detectedMidi,
            centsError: centsErr,
            rms: payload.rms,
            harmonicSupport: v.harmonicSupport,
          });
        }

        const doneNow = calibrationChart.events.every((ev) =>
          ev.notes.every((nn) => verdictsRef.current.has(verdictKey(ev.id, nn.string))),
        );
        if (doneNow && profileRef.current) {
          pause(trInner);
          setStoredStringProfile(profileRef.current);
          setSkippedFlag(false);
          setShowProceed(true);
        } else {
          const next = stepIdx + 1;
          currentStepRef.current = next;
          setCurrentStep(next);
          pause(trInner);
          if (events[next]) seek(trInner, events[next].t0);
        }
        setTick((x) => x + 1);
      };

      capture.setOnsetHandler(onPayload);
      await capture.connect(stream);

      const det = new BasicPitchDetector(tr.ctx);
      basicPitchRef.current = det;
      det.attachCapture(capture);

      captureDisconnectRef.current = () => {
        capture.disconnect();
      };

      setBusy(false);

      det.start();
      void det.init().catch(() => {});

      return true;
    } catch (e) {
      setMicError(describeMicError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [calibrationChart, requestMic]);

  const onStartCalibration = useCallback(async () => {
    const tr = transportRef.current;
    if (!tr) return;
    resetVerdictState();
    const micOk = await beginCalibrationCapture();
    if (!micOk) return;
    try {
      await tr.ctx.resume();
      pause(tr);
      currentStepRef.current = 0;
      setCurrentStep(0);
      const first = calibrationChart.events[0];
      if (first) seek(tr, first.t0);
      setStarted(true);
      setTick((x) => x + 1);
    } catch {
      /* ignore */
    }
  }, [beginCalibrationCapture, calibrationChart.events, resetVerdictState]);

  const onRestartCalibration = useCallback(async () => {
    const tr = transportRef.current;
    if (!tr) return;
    pause(tr);
    resetVerdictState();
    const micOk = await beginCalibrationCapture();
    if (!micOk) return;
    await tr.ctx.resume();
    pause(tr);
    currentStepRef.current = 0;
    setCurrentStep(0);
    const first = calibrationChart.events[0];
    if (first) seek(tr, first.t0);
    setTick((x) => x + 1);
  }, [beginCalibrationCapture, calibrationChart.events, resetVerdictState]);

  const onSkip = useCallback(() => {
    const tr = transportRef.current;
    if (tr) pause(tr);
    setSkippedFlag(true);
    setShowProceed(true);
  }, []);

  const doneCount = useMemo(() => {
    void tick;
    let count = 0;
    for (const ev of calibrationChart.events) {
      for (const nt of ev.notes) {
        if (verdictsRef.current.has(verdictKey(ev.id, nt.string))) count += 1;
      }
    }
    return count;
  }, [calibrationChart.events, tick]);

  const highway = (
    <HighwayCanvas
      chart={calibrationChart}
      getSongTime={getSongTimeFn}
      getVerdict={getVerdict}
      capoFret={meta.capoFret}
      height={isMobile ? highwayMobileH : 360}
      timingFlashRef={timingFlashRef}
      timingFlashStartedMsRef={timingFlashStartedMsRef}
    />
  );

  const handleProceedContinue = useCallback(() => {
    const allDone =
      calibrationChart.events.length > 0 &&
      calibrationChart.events.every((ev) =>
        ev.notes.every((n) => verdictsRef.current.has(verdictKey(ev.id, n.string))),
      );
    let savedProfile: StringProfile | null = null;
    if (!skippedFlag && allDone && profileRef.current && profileRef.current.strings.length > 0) {
      savedProfile = profileRef.current;
    }
    onFinished({
      savedProfile,
      skippedCalibration: skippedFlag,
    });
  }, [calibrationChart, skippedFlag, onFinished]);

  const activeEv = calibrationChart.events[currentStep];
  const gpString = activeEv?.notes[0]?.string;
  const expectPitchLabel =
    gpString != null && meta.tuning.length === 6 ? meta.tuning[6 - gpString] : undefined;

  const header = (
    <div className="space-y-1 shrink-0">
      <p className="text-xs uppercase tracking-wide text-zinc-500">String calibration</p>
      <h2 className="text-xl font-semibold text-white leading-tight">{songTitle}</h2>
      <p className="text-sm text-zinc-400">{trackName}</p>
      <dl className="grid gap-1 text-xs font-mono text-zinc-500 mt-2">
        <div className="flex justify-between gap-2">
          <span>BPM</span>
          <span className="text-zinc-300">{bpmLabel ?? "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Tuning</span>
          <span className="text-zinc-300 text-right break-all">{tuningLabel}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Capo</span>
          <span className="text-zinc-300">{capoLabel}</span>
        </div>
      </dl>
      <p className="text-sm text-zinc-400 mt-2">
        {started && expectPitchLabel != null ? (
          <>
            Pluck the open{" "}
            <span className="font-mono text-emerald-200">{expectPitchLabel}</span>
            {" — "}
            <span className="text-zinc-300">
              Guitar string {gpString} ({currentStep + 1}/6).
            </span>{" "}
            It turns green when detected; highway jumps to the next string ({doneCount}/6 done).
          </>
        ) : (
          <>
            After you grant the mic we expect one open string at a time; detected strings turn green
            ({doneCount}/6).
          </>
        )}
      </p>
      {micError ? <p className="text-sm text-amber-400 mt-2">{micError}</p> : null}
    </div>
  );

  const controls = (
    <div className="flex flex-col gap-3 w-full shrink-0">
      {!started ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onStartCalibration()}
          className="w-full py-4 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50 touch-manipulation"
        >
          {busy ? "Starting…" : "Start calibration (grant mic)"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onRestartCalibration()}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white font-medium touch-manipulation"
        >
          Restart calibration
        </button>
      )}
      <button
        type="button"
        onClick={onSkip}
        className="w-full py-3 rounded-xl border border-zinc-600 text-zinc-300 hover:bg-zinc-900 touch-manipulation"
      >
        Skip for now
      </button>
    </div>
  );

  if (meta.tuning.length !== 6) {
    return (
      <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-amber-200 text-sm">
        This chart has no six-string tuning; skipping calibration gate.
      </div>
    );
  }

  const layoutClass = isMobile
    ? "fixed inset-0 z-40 flex flex-col bg-[#12121a] min-h-[100dvh] max-h-[100dvh] overflow-hidden"
    : "flex flex-col gap-6 w-full max-w-5xl mx-auto";

  return (
    <>
      <CalibrationProceedModal
        open={showProceed}
        skipped={skippedFlag}
        stringCountDone={skippedFlag ? doneCount : 6}
        onContinue={handleProceedContinue}
      />
      {!showProceed ? (
        <div className={layoutClass}>
          {isMobile && portrait && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-950/95 p-6 text-center">
              <p className="text-lg font-medium text-white">Rotate to landscape for calibration</p>
              <p className="text-sm text-zinc-400 max-w-xs">
                The fretboard step-by-step cues use the wide layout more clearly.
              </p>
            </div>
          )}
          {isMobile ? (
            <>
              <div ref={mainRef} className="flex-1 min-h-0 w-full relative px-2 pt-2 pb-px">
                <div className="absolute inset-x-2 top-10 bottom-0 min-h-0 flex items-stretch">{highway}</div>
              </div>
              <div className="shrink-0 border-t border-zinc-800 p-3 pb-[max(env(safe-area-inset-bottom),12px)] space-y-3 overflow-y-auto max-h-[45dvh]">
                {header}
                {controls}
              </div>
            </>
          ) : (
            <>
              {header}
              <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950/80">
                {highway}
              </div>
              {controls}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
