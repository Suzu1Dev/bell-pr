/** Picks clip frames by time, for screencast and frame-stepped clips. */
export interface ClipFrame {
  /** Path inside the shot's footage directory. */
  file: string;
  /** Seconds since the clip's first frame. */
  t: number;
}

/**
 * The frame on screen at `t` seconds into the clip: the last one painted at
 * or before `t`. Before the first frame that is the first; after the last,
 * the last one holds. Time is never stretched.
 */
export function frameAt(frames: readonly ClipFrame[], t: number): ClipFrame {
  if (frames.length === 0) throw new Error("A clip needs at least one frame.");
  let low = 0;
  let high = frames.length - 1;
  if (t <= frames[0].t) return frames[0];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= t + 1e-6) low = middle;
    else high = middle - 1;
  }
  return frames[low];
}

/** A stretch of clip seconds the shot jumps over, such as a loading moment. */
export type Skip = readonly [from: number, to: number];

/**
 * Seconds into the clip at `seconds` into the shot: from `startAt`, at real
 * speed, jumping over each skipped stretch. A skip is a cut, never a speed-up.
 */
export function clipTime(startAt: number, seconds: number, skips: readonly Skip[] = []): number {
  let t = startAt + seconds;
  for (const [from, to] of [...skips].sort((a, b) => a[0] - b[0])) if (t >= from) t += to - from;
  return t;
}
