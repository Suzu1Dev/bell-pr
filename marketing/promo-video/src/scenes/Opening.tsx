/**
 * S1 Problem and S2 Turn on the dark stage (variant C): the lines pull into
 * focus over a soft, endless queue of identical pull-request cards (a
 * metaphor: no names, numbers or platform chrome) while one reviewer's
 * pointer pings on the beat. On the riser the queue slows to a halt; on the
 * kick one card lifts out of it and turns to face the viewer; on the stop
 * everything freezes for a beat, exhales, and the stage goes dark for the
 * four frames before the first hit.
 */
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { blurCss, ease, mix, tween } from "../look/motion.ts";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { music } from "../music.ts";
import { darkFrom, exhale, halt, liftFrom, stop } from "../moments.ts";
import { shotById } from "../timeline.ts";

const s1 = shotById("s1-problem");
const s2 = shotById("s2-turn");
const beat = music.beatFrames;
const riser = s2.from;

const CARD = { w: 300, h: 176, gap: 40 };
const ROWS = [
  { y: 790, scale: 1, speed: 2.4, blur: 3, alpha: 0.9, phase: 0 },
  { y: 640, scale: 0.7, speed: 1.5, blur: 8, alpha: 0.55, phase: 150 },
] as const;

/** The queue's travel (px) at frame f: constant speed, then an even slow-down to a halt over two beats. */
export const queueTravel = (f: number, speed: number) => {
  if (f <= riser) return speed * f;
  const span = halt - riser;
  const p = Math.min(1, (f - riser) / span);
  return speed * (riser + span * (p - (p * p) / 2));
};

/** The front-row card nearest the centre once the queue halts: the one that lifts out. */
const liftedIndex = (() => {
  const travel = queueTravel(halt, ROWS[0].speed);
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < 18; i += 1) {
    const x = cardX(i, travel, ROWS[0]);
    if (Math.abs(x - 960) < distance) {
      distance = Math.abs(x - 960);
      best = i;
    }
  }
  return best;
})();

function cardX(index: number, travel: number, row: (typeof ROWS)[number]) {
  const pitch = (CARD.w + CARD.gap) * row.scale;
  return -2 * pitch + row.phase + index * pitch - travel;
}

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  // Everything but the exits reads a frozen clock from the stop on.
  const f = Math.min(frame, stop);
  const [c1, c2] = s1.captions;
  const [c3] = s2.captions;
  const lift = tween(f, liftFrom, stop, ease.standard);
  const out = tween(frame, exhale, darkFrom, ease.standard);
  const drift = 1 + (0.012 * f) / music.barFrames;
  const queueIn = tween(frame, s1.captions[0].from, s1.captions[0].from + 2 * beat, ease.softArrive);
  return (
    <AbsoluteFill style={{ backgroundColor: DARK.edge }}>
      <StageImage kind="dark" />
      <AbsoluteFill style={{ transform: `scale(${drift.toFixed(5)})`, transformOrigin: "50% 45%" }}>
        {ROWS.map((row, r) => {
          const travel = queueTravel(f, row.speed);
          const pitch = (CARD.w + CARD.gap) * row.scale;
          return (
            <div key={r} style={{ position: "absolute", inset: 0, opacity: queueIn }}>
              {Array.from({ length: 18 }, (_, i) => i).map((i) => {
                const x = cardX(i, travel, row);
                if (x < -pitch * 1.2 || x > 1920 + pitch * 1.2) return null;
                const lifted = r === 0 && i === liftedIndex;
                const rest = { blur: row.blur + 6 * lift, alpha: row.alpha * (1 - 0.55 * lift) };
                if (lifted) return <LiftedCard key={i} x={x} y={row.y} lift={lift} />;
                return <PrCard key={i} x={x} y={row.y} scale={row.scale} blur={rest.blur} alpha={rest.alpha} lit={0} />;
              })}
            </div>
          );
        })}
        <Reviewer frame={f} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center" }}>
        <FocusLine
          words={words(c1.text)}
          frame={frame}
          enter={c1.from}
          exit={{ start: c1.to - 12, end: c1.to }}
          role={ROLES.displayM}
          color={DARK.text}
          style={{ position: "absolute", top: 352 }}
        />
        <FocusLine
          words={words(c2.text, { 0: "soft", 1: "soft", 2: "soft", 3: "key" })}
          frame={frame}
          enter={c2.from}
          exit={{ start: c2.to - 12, end: c2.to }}
          rack={{ at: c2.from + 2 * beat, dimTo: DARK.dim, soften: 3 }}
          role={ROLES.displayM}
          color={DARK.text}
          style={{ position: "absolute", top: 352 }}
        />
        {c3.lines.map((line, index) => (
          <FocusLine
            key={index}
            words={words(line)}
            frame={frame}
            enter={c3.from + index * 2 * beat}
            exit={{ start: exhale, end: darkFrom }}
            role={ROLES.displayM}
            color={DARK.text}
            style={{ position: "absolute", top: 270 + index * 95 }}
          />
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: DARK.edge, opacity: out }} />
    </AbsoluteFill>
  );
};

/** One identical pull-request card: avatar, status pill, two title bars, a footer. No text. */
const PrCard: React.FC<{ x: number; y: number; scale: number; blur: number; alpha: number; lit: number }> = ({ x, y, scale, blur, alpha, lit }) => {
  const ink = (a: number) => `rgba(185,220,198,${a.toFixed(3)})`;
  return (
    <div
      style={{
        position: "absolute",
        left: x - CARD.w / 2,
        top: y - CARD.h / 2,
        width: CARD.w,
        height: CARD.h,
        transform: `scale(${scale})`,
        borderRadius: 16,
        background: `rgba(${mix(18, 30, lit).toFixed(0)},${mix(34, 54, lit).toFixed(0)},${mix(27, 43, lit).toFixed(0)},0.92)`,
        boxShadow: `inset 0 0 0 1px ${ink(mix(0.14, 0.42, lit))}, 0 18px 40px rgba(0,0,0,0.45)${lit > 0 ? `, 0 0 ${(90 * lit).toFixed(1)}px rgba(63,138,105,${(0.5 * lit).toFixed(3)})` : ""}`,
        filter: blurCss(blur),
        opacity: alpha,
      }}
    >
      <div style={{ position: "absolute", left: 22, top: 22, width: 24, height: 24, borderRadius: 12, background: ink(mix(0.2, 0.34, lit)) }} />
      <div style={{ position: "absolute", left: 58, top: 26, width: 58, height: 16, borderRadius: 8, background: `rgba(63,138,105,${mix(0.55, 0.95, lit).toFixed(3)})` }} />
      <div style={{ position: "absolute", left: 22, top: 66, width: 226, height: 13, borderRadius: 6, background: ink(mix(0.2, 0.42, lit)) }} />
      <div style={{ position: "absolute", left: 22, top: 90, width: 156, height: 13, borderRadius: 6, background: ink(mix(0.2, 0.42, lit)) }} />
      {[44, 30, 56].map((width, i) => (
        <div key={i} style={{ position: "absolute", left: 22 + [0, 58, 102][i], top: 142, width, height: 9, borderRadius: 4, background: ink(mix(0.11, 0.22, lit)) }} />
      ))}
    </div>
  );
};

/** The card that lifts out of the halted queue and turns to face the viewer (kick to stop). */
const LiftedCard: React.FC<{ x: number; y: number; lift: number }> = ({ x, y, lift }) => {
  const cx = mix(x, 960, lift);
  const cy = mix(y, 676, lift);
  const scale = mix(1, 1.45, lift);
  const ry = mix(26, 0, lift) * Math.min(1, lift * 3);
  const rx = mix(0, 0, lift) + 14 * Math.sin(Math.PI * lift) * 0.6;
  return (
    <div style={{ position: "absolute", inset: 0, perspective: 1600, perspectiveOrigin: `${cx}px ${cy}px` }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transformOrigin: `${cx}px ${cy}px`,
          transform: `translate3d(${(cx - x).toFixed(3)}px, ${(cy - y).toFixed(3)}px, 0) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
        }}
      >
        <PrCard x={x} y={y} scale={1} blur={mix(3, 0, lift)} alpha={mix(0.9, 1, lift)} lit={lift} />
      </div>
    </div>
  );
};

/** The one reviewer: a neutral round pointer hovering over the front row, pinging on every other beat. */
const Reviewer: React.FC<{ frame: number }> = ({ frame }) => {
  const appear = tween(frame, 12, 30, ease.softArrive);
  const leave = 1 - tween(frame, riser, riser + beat, ease.standard);
  const opacity = 0.9 * appear * leave;
  if (opacity <= 0.001) return null;
  const x = 1265 + 6 * Math.sin(frame / 23);
  const y = 742 + 4 * Math.sin(frame / 31);
  const pings: number[] = [];
  for (let at = music.beatFrame(2); at < riser; at += 2 * beat) if (frame >= at && frame < at + 22) pings.push((frame - at) / 22);
  return (
    <>
      {pings.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x - mix(12, 48, p),
            top: y - mix(12, 48, p),
            width: 2 * mix(12, 48, p),
            height: 2 * mix(12, 48, p),
            borderRadius: "50%",
            border: `2px solid rgba(185,220,198,${(0.6 * (1 - p) * opacity).toFixed(3)})`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: x - 11,
          top: y - 11,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(244,247,243,0.92)",
          boxShadow: "0 0 0 1px rgba(2,4,3,0.5), 0 3px 10px rgba(0,0,0,0.5)",
          opacity,
        }}
      />
    </>
  );
};
