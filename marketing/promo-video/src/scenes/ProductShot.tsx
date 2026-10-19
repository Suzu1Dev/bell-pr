/**
 * A product shot: its takes in order, each a camera on one captured state
 * (src/shots.ts) in the light studio. Takes cut hard on their beats.
 */
import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { clipFrameAt, densityFor, frameUrl, stillUrl, type Footage } from "../footage.ts";
import { focusAmount, liftOn } from "../look/dof.ts";
import { speed } from "../look/camera.ts";
import { takeMaxM, takeOpacity, takeView } from "../takes.ts";
import { ease, tween } from "../look/motion.ts";
import { takePointer } from "../look/pointer.ts";
import { ProductWindow } from "../look/ProductWindow.tsx";
import { hiDpi, StageImage } from "../look/Stage.tsx";
import { music } from "../music.ts";
import { looks, type TakeLook } from "../shots.ts";
import { footagePatch, PATCH_BOX, SIDEBAR_PAPER } from "../bell.ts";
import type { Shot, Take } from "../timeline.ts";

export const ProductShot: React.FC<{
  shot: Shot;
  footage: Footage;
  skip?: string[];
  /** Drawn on the studio, under the takes (S3's first-hit lockup). */
  under?: ReactNode;
  bellProbe?: "flight" | "footage";
  /** The pointer check (scripts/check-pointer.mjs): no pointer, or the pointer at full opacity wherever it is. */
  pointerProbe?: "none" | "solid";
}> = ({ shot, footage, skip = [], under, bellProbe, pointerProbe }) => (
  <AbsoluteFill>
    <StageImage kind="light" />
    {under}
    {shot.takes
      .filter((take) => !skip.includes(take.id))
      .map((take) => {
        const look = looks[shot.id]?.[take.id];
        if (!look) throw new Error(`No look for ${shot.id}/${take.id} in src/shots.ts.`);
        return (
          <Sequence key={take.id} from={take.from - shot.from} durationInFrames={take.to - take.from} name={`${shot.id}/${take.id}`}>
            <TakeView look={look} take={take} footage={footage} bellProbe={bellProbe} pointerProbe={pointerProbe} />
          </Sequence>
        );
      })}
  </AbsoluteFill>
);

const TakeView: React.FC<{
  look: TakeLook;
  take: Take;
  footage: Footage;
  bellProbe?: "flight" | "footage";
  pointerProbe?: "none" | "solid";
}> = ({ look, take, footage, bellProbe, pointerProbe }) => {
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
  const t = Math.min(look.clipTo ?? Infinity, (look.clipFrom ?? 0) + (f / 30) * (look.rate ?? 1));
  let src: string;
  if (look.still) src = stillUrl(look.state, look.still, density);
  else {
    if (!state.frames) throw new Error(`${look.state} has no clip frames.`);
    src = frameUrl(look.state, clipFrameAt(state.frames, t).file, density);
  }
  const lifts = look.lifts ?? [];
  const focus = lifts.length ? focusAmount(look.focus ?? [{ at: 0, amount: 1 }], f / music.beatFrames) : 0;
  const liftStates = lifts.map((lift) => ({ lift, on: liftOn(lift, f) }));
  // The window centre's screen speed, for the shutter blur.
  const moving = speed(takeView(look, f - 0.5), takeView(look, f + 0.5), 720, 405);
  // The drawn pointer (src/look/pointer.ts): in the plane of what it clicks, never faded by the depth of field.
  const pointer =
    (look.pointer ?? !look.still) && pointerProbe !== "none" ? takePointer(look, frames, state).at(f, pointerProbe === "solid") : undefined;
  const sweep = look.sweepAt === undefined ? undefined : sweepAt(f, look.sweepAt * music.beatFrames);
  const opacity = takeOpacity(look, f);
  // While the first-hit bell flies onto the app's own bell, the footage's bell is covered with the sidebar's paper,
  // so only one bell shows; from the landing the flying bell carries that paper itself (src/bell.ts HANDOFF).
  const patch = !look.bellPatch || bellProbe === "footage" ? 0 : bellProbe === "flight" ? 1 : footagePatch(take.from + f);
  return (
    <ProductWindow
      view={view}
      layout={layout}
      src={src}
      focus={focus}
      lifts={liftStates}
      height={look.height}
      pointer={pointer}
      shutter={{ x: moving.dx, y: moving.dy }}
      contact={look.float ? contactFor(view.m) : 0}
      sweep={sweep}
      opacity={opacity}
    >
      {patch > 0.001 ? (
        <div
          style={{
            position: "absolute",
            left: PATCH_BOX[0] * layout,
            top: PATCH_BOX[1] * layout,
            width: (PATCH_BOX[2] - PATCH_BOX[0]) * layout,
            height: (PATCH_BOX[3] - PATCH_BOX[1]) * layout,
            background: SIDEBAR_PAPER,
            opacity: patch,
          }}
        />
      ) : null}
    </ProductWindow>
  );
};

/** The contact shadow belongs to the whole floating window: it fades as a push takes the window past its rest size. */
export const contactFor = (m: number) => Math.min(1, Math.max(0, (1.2 - m) / 0.2));

/** How far the window drops back behind its lifts (src/look/dof.ts, where the pointer's plane needs it too). */
export { focusAmount };

const sweepAt = (f: number, start: number) => {
  if (f < start || f > start + 24) return undefined;
  return tween(f, start, start + 24, ease.sweep);
};
