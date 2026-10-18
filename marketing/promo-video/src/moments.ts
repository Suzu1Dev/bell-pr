/**
 * Named moments of the cut that more than one file needs (the opening's
 * breath, the sound effects, the tests), derived from the music and the
 * timeline only.
 */
import { music } from "./music.ts";
import { shotById } from "./timeline.ts";

const s2 = shotById("s2-turn");
const beat = music.beatFrames;

/** The first hit: the cut to the light studio. */
export const hit = s2.to;
/** The stop (kick and bass out): everything freezes for a beat. */
export const stop = music.stop?.from ?? hit - 2 * beat;
/** One beat after the stop the lines leave and the stage dims... */
export const exhale = stop + beat;
/** ...to four dark frames before the hit. */
export const darkFrom = hit - 4;
/** The queue slows from the riser to a halt two beats later. */
export const halt = s2.from + 2 * beat;
/** One card lifts out of the halted queue from here to the stop. */
export const liftFrom = halt + 2 * beat;
