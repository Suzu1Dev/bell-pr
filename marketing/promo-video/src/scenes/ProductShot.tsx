/**
 * A product shot: its takes in order, each a camera on one captured state
 * (src/shots.ts) in the light studio. Takes cut hard on their beats.
 */
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { clipFrameAt, densityFor, frameUrl, stillUrl, type Footage } from "../footage.ts";
import { speed } from "../look/camera.ts";
import { takeMaxM, takeView } from "../takes.ts";
import { ease, mix, tween } from "../look/motion.ts";
import { pointerAt } from "../look/pointer.ts";
import { ProductWindow } from "../look/ProductWindow.tsx";
import { hiDpi, StageImage } from "../look/Stage.tsx";
import { music } from "../music.ts";
import { looks, type TakeLook } from "../shots.ts";
import type { Shot, Take } from "../timeline.ts";

export const ProductShot: React.FC<{ shot: Shot; footage: Footage; skip?: string[] }> = ({ shot, footage, skip = [] }) => (
  <AbsoluteFill>
    <StageImage kind="light" />
    {shot.takes
      .filter((take) => !skip.includes(take.id))
      .map((take) => {
        const look = looks[shot.id]?.[take.id];
        if (!look) throw new Error(`No look for ${shot.id}/${take.id} in src/shots.ts.`);
        return (
          <Sequence key={take.id} from={take.from - shot.from} durationInFrames={take.to - take.from} name={`${shot.id}/${take.id}`}>
            <TakeView look={look} take={take} footage={footage} />
          </Sequence>
        );
      })}
  </AbsoluteFill>
);

const TakeView: React.FC<{ look: TakeLook; take: Take; footage: Footage }> = ({ look, take, footage }) => {
  const f = useCurrentFrame();
  const frames = take.to - take.from;
  const view = takeView(look, f);
  const maxM = takeMaxM(look, frames);
  const dpr = hiDpi() ? 2 : 1;
  const layout = maxM * (look.float ? 1.5 : 1);
  // A supersampled floating window wants a little more than its output size.
  const density = densityFor(maxM * dpr * (look.float ? 1.25 : 1));
  const state = footage[look.state];
  if (!state) throw new Error(`No footage for ${look.state}.`);
  const t = (look.clipFrom ?? 0) + (f / 30) * (look.rate ?? 1);
  let src: string;
  let soft: string | undefined;
  if (look.still) {
    src = stillUrl(look.state, look.still, density);
    soft = stillUrl(look.state, look.still, "soft");
  } else {
    if (!state.frames) throw new Error(`${look.state} has no clip frames.`);
    const frame = clipFrameAt(state.frames, t);
    src = frameUrl(look.state, frame.file, density);
    soft = frameUrl(look.state, frame.file, "soft");
  }
  const amount = look.dof ? dofAmount(look.dof.keys, f / music.beatFrames) : 0;
  const mask = look.dof && amount > 0.001 ? look.dof.mask(amount) : undefined;
  // The window centre's screen speed, for the shutter blur.
  const moving = speed(takeView(look, f - 0.5), takeView(look, f + 0.5), 720, 405);
  const pointer = (look.pointer ?? !look.still) ? pointerAt(state.events, t) : undefined;
  const sweep = look.sweepAt === undefined ? undefined : sweepAt(f, look.sweepAt * music.beatFrames);
  return (
    <ProductWindow
      view={view}
      layout={layout}
      src={src}
      soft={mask ? soft : undefined}
      mask={mask}
      pointer={pointer}
      shutter={{ x: moving.dx, y: moving.dy }}
      contact={look.float ? 1 : 0}
      sweep={sweep}
    />
  );
};

const dofAmount = (keys: { at: number; amount: number }[], beats: number) => {
  if (beats <= keys[0].at) return keys[0].amount;
  for (let i = 1; i < keys.length; i += 1)
    if (beats <= keys[i].at)
      return mix(keys[i - 1].amount, keys[i].amount, ease.standard((beats - keys[i - 1].at) / (keys[i].at - keys[i - 1].at)));
  return keys.at(-1)!.amount;
};

const sweepAt = (f: number, start: number) => {
  if (f < start || f > start + 24) return undefined;
  return tween(f, start, start + 24, ease.sweep);
};
