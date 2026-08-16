import {
  NOTE_GAME_CONFIG,
  getPitchClassesForAccidentalMode,
  getRegion,
  randomDisplayNameForPitchClass,
} from "./config";
import {
  challengeIdentity,
  clipRegionToFretboardLength,
  filterPositionsByRegion,
  filterPositionsByString,
  getAllPositions,
  getPositionsForPitchClass,
  uniquePitchClassesInPositions,
} from "./fretboard-model";
import type { FretPosition, GameMode, NoteChallenge, NoteGameSessionConfig } from "./types";

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randomString(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export class ChallengeGenerator {
  private recentIdentities: string[] = [];

  constructor(private config: NoteGameSessionConfig) {}

  updateConfig(config: NoteGameSessionConfig): void {
    this.config = config;
  }

  private getAllowedPositions(): FretPosition[] {
    const all = getAllPositions(this.config.fretboardLength);

    if (this.config.mode === "wide") return all;

    if (this.config.mode === "single-string") {
      // Positions for a random string are selected per-challenge
      return all;
    }

    const regionId = this.config.regionId ?? "middle";
    const region = getRegion(regionId);
    const clipped = clipRegionToFretboardLength(region, this.config.fretboardLength);
    if (!clipped) return [];
    return filterPositionsByRegion(all, clipped);
  }

  private getPositionsForMode(string?: number): FretPosition[] {
    const allowed = this.getAllowedPositions();

    if (this.config.mode === "single-string" && string != null) {
      return filterPositionsByString(allowed, string);
    }

    return allowed;
  }

  generate(nextString?: number): NoteChallenge | null {
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const string =
        this.config.mode === "single-string" ? (nextString ?? randomString()) : undefined;

      const allowedPositions = this.getPositionsForMode(string);
      if (allowedPositions.length === 0) continue;

      const availablePitchClasses = uniquePitchClassesInPositions(allowedPositions);
      const accidentalSet = getPitchClassesForAccidentalMode(this.config.accidentalMode);
      const candidates = availablePitchClasses.filter((pc) => accidentalSet.includes(pc));
      if (candidates.length === 0) continue;

      const targetPitchClass = randomItem(candidates);
      const validPositions = getPositionsForPitchClass(targetPitchClass, allowedPositions);
      if (validPositions.length === 0) continue;

      const regionId =
        this.config.mode === "region" ? (this.config.regionId ?? "middle") : undefined;

      const identity = challengeIdentity({
        targetPitchClass,
        mode: this.config.mode,
        string,
        regionId,
      });

      if (this.recentIdentities.includes(identity)) continue;

      const challenge: NoteChallenge = {
        id: crypto.randomUUID(),
        targetPitchClass,
        displayName: randomDisplayNameForPitchClass(targetPitchClass),
        mode: this.config.mode,
        string,
        regionId,
        validPositions,
        startedAt: Date.now(),
      };

      this.pushRecent(identity);
      return challenge;
    }

    return null;
  }

  private pushRecent(identity: string): void {
    this.recentIdentities.unshift(identity);
    if (this.recentIdentities.length > NOTE_GAME_CONFIG.recentHistorySize) {
      this.recentIdentities.pop();
    }
  }

  reset(): void {
    this.recentIdentities = [];
  }
}

export function modeLabel(mode: GameMode): string {
  switch (mode) {
    case "single-string":
      return "Single String";
    case "region":
      return "Region";
    case "wide":
      return "Wide";
  }
}
