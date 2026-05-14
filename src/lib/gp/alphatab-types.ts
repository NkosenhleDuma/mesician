/** Narrow types for alphaTab runtime objects used in parsing (mirrors alphaTab model). */

export type BeatLike = {
  timer: number | null;
  playbackDuration: number;
  notes: NoteLike[];
  nextBeat: BeatLike | null;
};

export type NoteLike = {
  string: number;
  fret: number;
  realValue: number;
  isHammerPullOrigin: boolean;
  isHammerPullDestination: boolean;
  hasBend: boolean;
  isPalmMute: boolean;
  isDead: boolean;
  beat: BeatLike;
};
