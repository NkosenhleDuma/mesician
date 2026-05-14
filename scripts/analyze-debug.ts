/**
 * Aggregate mic debug blobs under MinIO prefix `debug/` (see POST /api/debug/note-decisions).
 * Reports may include optional `meta.audioSampleRate` for offline replay; legacy blobs omit it.
 *
 * Env: same S3_* vars as the app (`src/lib/env.ts`).
 *
 * Examples:
 *   npm run analyze:debug
 *   npm run analyze:debug -- --user <uuid>
 *   npm run analyze:debug -- --track <uuid> --limit 50
 *   npm run analyze:debug -- --dump debug/<user>/<track>/<file>.json --out ./report.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { getEnv } from "@/lib/env";
import { getS3 } from "@/lib/s3/client";
import type { DebugDecisionOutcome, DebugReport, DebugReportFlushReason } from "@/lib/scoring/debug-capture";

function parseArgs(argv: string[]) {
  const out: {
    user?: string;
    track?: string;
    since?: string;
    limit: number;
    dump?: string;
    outFile?: string;
  } = { limit: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user" && argv[i + 1]) {
      out.user = argv[++i];
    } else if (a === "--track" && argv[i + 1]) {
      out.track = argv[++i];
    } else if (a === "--since" && argv[i + 1]) {
      out.since = argv[++i];
    } else if (a === "--limit" && argv[i + 1]) {
      out.limit = Math.max(1, Math.min(5000, Number.parseInt(argv[++i], 10) || 200));
    } else if (a === "--dump" && argv[i + 1]) {
      out.dump = argv[++i];
    } else if (a === "--out" && argv[i + 1]) {
      out.outFile = argv[++i];
    }
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) >> 1;
  return s.length % 2 ? s[mid]! : (s[mid]! + s[mid + 1]!) / 2;
}

function p90(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * 0.9));
  return s[idx]!;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function getObjectJson(key: string): Promise<DebugReport> {
  const env = getEnv();
  const out = await getS3().send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
  const str = await out.Body?.transformToString();
  if (str === undefined) throw new Error(`Empty body: ${key}`);
  return JSON.parse(str) as DebugReport;
}

async function dumpKey(key: string, outPath: string) {
  const rep = await getObjectJson(key);
  const txt = JSON.stringify(rep, null, 2);
  const abs = path.resolve(outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, txt, "utf8");
  console.log(`Wrote ${abs} (${rep.decisions.length} decisions)`);
}

function keyMatches(key: string, user?: string, track?: string, sinceTs?: number): boolean {
  const parts = key.split("/");
  if (parts.length < 4 || parts[0] !== "debug") return false;
  const u = parts[1];
  const t = parts[2];
  if (user && u !== user) return false;
  if (track && t !== track) return false;
  if (sinceTs != null) {
    const base = parts[3] ?? "";
    const isoStart = base.slice(0, 19).replace(/-/g, ":");
    const approx = Date.parse(isoStart.replace("T", " "));
    if (Number.isFinite(approx) && approx < sinceTs) return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.dump) {
    const outp = args.outFile ?? `./debug-dump-${path.basename(args.dump)}`;
    await dumpKey(args.dump, outp);
    return;
  }

  const prefix = args.user ? `debug/${args.user}/` : "debug/";
  const sinceTs = args.since != null ? Date.parse(args.since) : Number.NaN;
  const env = getEnv();
  let token: string | undefined;
  const keys: string[] = [];

  do {
    const list = await getS3().send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (!obj.Key?.endsWith(".json")) continue;
      if (!keyMatches(obj.Key, args.user, args.track, Number.isFinite(sinceTs) ? sinceTs : undefined)) {
        continue;
      }
      keys.push(obj.Key);
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token && keys.length < args.limit * 3);

  const useKeys = keys.slice(-args.limit);
  console.log(`Loading ${useKeys.length} report(s)…`);

  const reasons: Partial<Record<DebugReportFlushReason, number>> & { legacy?: number } = {};
  const bumpReason = (r: DebugReportFlushReason | undefined) => {
    if (r == null) {
      reasons.legacy = (reasons.legacy ?? 0) + 1;
    } else {
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
  };

  const outcomeHist: Record<DebugDecisionOutcome, number> = {
    accepted: 0,
    "wrong-pitch": 0,
    "timing-miss": 0,
    "unmatched-onset": 0,
    "missed-no-onset": 0,
  };
  let totalDecisions = 0;

  const timingMissMs: number[] = [];
  const monoWrongCents: number[] = [];
  const polyWrongSupport: number[] = [];

  const fluxRatioAccepted: number[] = [];
  const fluxRatioUnmatched: number[] = [];
  const fluxRatioWrongPitch: number[] = [];

  for (const key of useKeys) {
    let rep: DebugReport;
    try {
      rep = await getObjectJson(key);
    } catch {
      console.warn(`skip ${key}`);
      continue;
    }
    bumpReason(rep.meta.reason);

    for (const d of rep.decisions) {
      outcomeHist[d.outcome]++;
      totalDecisions++;

      if (d.outcome === "timing-miss" && d.timingErrorMs != null) timingMissMs.push(d.timingErrorMs);

      if (d.outcome === "wrong-pitch" && d.trace?.kind === "mono") {
        for (const c of d.trace.centsPerNote) {
          if (c.cents != null && Number.isFinite(c.cents)) monoWrongCents.push(Math.abs(c.cents));
        }
      }
      if (d.outcome === "wrong-pitch" && d.trace?.kind === "poly") {
        for (const p of d.trace.perNote) {
          if (!p.pitchOk) polyWrongSupport.push(p.support);
        }
      }

      const fr =
        d.flux != null && d.fluxThreshold != null && d.fluxThreshold > 0 ? d.flux / d.fluxThreshold : null;
      if (fr != null && Number.isFinite(fr)) {
        if (d.outcome === "accepted") fluxRatioAccepted.push(fr);
        else if (d.outcome === "unmatched-onset") fluxRatioUnmatched.push(fr);
        else if (d.outcome === "wrong-pitch") fluxRatioWrongPitch.push(fr);
      }
    }
  }

  console.log("\n=== Upload reason (reports) ===");
  const pairs = Object.entries(reasons).filter(([, v]) => v > 0) as [string, number][];
  pairs.sort((a, b) => b[1] - a[1]);
  if (pairs.length === 0) console.log("(none)");
  else for (const [k, n] of pairs) console.log(`${k.padEnd(16)} ${n}`);

  console.log("\n=== Outcomes (decisions) ===");
  for (const k of Object.keys(outcomeHist) as DebugDecisionOutcome[]) {
    const n = outcomeHist[k];
    const pct = totalDecisions ? ((100 * n) / totalDecisions).toFixed(1) : "0";
    console.log(`${k.padEnd(18)} ${n} (${pct}%)`);
  }

  console.log("\n=== timing-miss Δt (timingErrorMs ms) ===");
  console.log(
    `n=${timingMissMs.length} mean=${mean(timingMissMs).toFixed(1)} med=${median(timingMissMs).toFixed(
      1,
    )} p90=${p90(timingMissMs).toFixed(1)}`,
  );

  console.log("\n=== wrong-pitch mono |cents| ===");
  console.log(
    `n=${monoWrongCents.length} mean=${mean(monoWrongCents).toFixed(1)} med=${median(monoWrongCents).toFixed(
      1,
    )} p90=${p90(monoWrongCents).toFixed(1)}`,
  );

  console.log("\n=== wrong-pitch poly support (failed strings) ===");
  console.log(
    `n=${polyWrongSupport.length} mean=${mean(polyWrongSupport).toFixed(3)} med=${median(polyWrongSupport).toFixed(
      3,
    )} p90=${p90(polyWrongSupport).toFixed(3)}`,
  );

  console.log("\n=== flux / threshold ratio (median) ===");
  console.log(`accepted           med=${median(fluxRatioAccepted).toFixed(2)} (n=${fluxRatioAccepted.length})`);
  console.log(`wrong-pitch        med=${median(fluxRatioWrongPitch).toFixed(2)} (n=${fluxRatioWrongPitch.length})`);
  console.log(`unmatched-onset    med=${median(fluxRatioUnmatched).toFixed(2)} (n=${fluxRatioUnmatched.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
