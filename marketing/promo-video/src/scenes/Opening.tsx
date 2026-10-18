/**
 * S1 Problem and S2 Turn on the dark stage (variant C): the lines pull into
 * focus over a queue of identical pull-request cards (a metaphor: a generic
 * pull-request glyph, title bars and a green/red diff stat, no names,
 * numbers or platform chrome). The queue grows faster than it is reviewed:
 * cards drop in on the beats and pile up two rows deep behind the front
 * row, while the one reviewer (a round pointer with a ring) opens one card,
 * clears it, and sees another take its place. On the riser the queue stops
 * growing; on the kick one card lifts out, turns to face the viewer and
 * lights up; on the stop everything freezes for a beat, exhales, and the
 * stage goes dark for the four frames before the first hit.
 */
import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import { blurCss, ease, mix, springs, tween } from "../look/motion.ts";
import { DARK, StageImage } from "../look/Stage.tsx";
import { FocusLine, ROLES, words } from "../look/type.tsx";
import { music } from "../music.ts";
import { darkFrom, exhale, liftFrom, stop } from "../moments.ts";
import { shotById } from "../timeline.ts";

const s1 = shotById("s1-problem");
const s2 = shotById("s2-turn");
const beat = music.beatFrames;
const riser = s2.from;

export const CARD = { w: 300, h: 176 } as const;

/** The queue's rows: front (sharp, bright) to back (smaller, softer, dimmer). */
const ROWS = [
  { y: 812, scale: 1, blur: 0.6, alpha: 1, xs: [260, 610, 960, 1310, 1660] },
  { y: 706, scale: 0.8, blur: 2.5, alpha: 0.7, xs: [260, 540, 820, 1100, 1380, 1660] },
  { y: 628, scale: 0.64, blur: 5, alpha: 0.45, xs: [288, 512, 736, 960, 1184, 1408, 1632] },
] as const;

/** The card the reviewer opens and clears, the card that refills its slot, and the next one it opens. */
const OPENED = { row: 0, slot: 2 } as const;
const NEXT = { row: 0, slot: 3 } as const;

interface Arrival {
  row: number;
  slot: number;
  /** The beat frame it lands on (0 = there from the start). */
  at: number;
  /** Diff-stat bar lengths (px): green, red. */
  stat: [number, number];
}

/** Cards land on every beat until the riser, two at a time from the third beat: the pile grows faster than one reviewer clears it. */
export const arrivals: Arrival[] = (() => {
  const b = (n: number) => music.beatFrame(n);
  const list: [number, number, number][] = [
    [0, 1, 0], [0, 2, 0], [0, 3, 0],
    [0, 0, b(1)], [0, 4, b(2)], [1, 2, b(2)], [1, 3, b(3)], [1, 1, b(3)],
    [1, 4, b(4)], [1, 0, b(4)], [1, 5, b(5)], [2, 3, b(5)], [2, 2, b(6)], [2, 4, b(6)],
    [2, 1, b(7)], [2, 5, b(7)], [2, 0, b(8)], [2, 6, b(8)],
  ];
  return list.map(([row, slot, at], i) => ({ row, slot, at, stat: [26 + ((i * 37) % 54), 8 + ((i * 23) % 30)] }));
})();

/** The reviewer: opens the centre card on the third beat, clears it on the seventh, moves on as a new card takes the slot. */
const REVIEW = { open: music.beatFrame(2), clear: music.beatFrame(6), refill: music.beatFrame(7), next: music.beatFrame(7) };

const slotX = (row: number, slot: number) => ROWS[row].xs[slot];

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  // Everything but the exits reads a frozen clock from the stop on.
  const f = Math.min(frame, stop);
  const [c1, c2] = s1.captions;
  const [c3] = s2.captions;
  const lift = tween(f, liftFrom, stop, ease.standard);
  const out = tween(frame, exhale, darkFrom, ease.standard);
  const drift = 1 + (0.012 * f) / music.barFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: DARK.edge }}>
      <StageImage kind="dark" />
      <AbsoluteFill style={{ transform: `scale(${drift.toFixed(5)})`, transformOrigin: "50% 45%" }}>
        {[2, 1, 0].map((row) =>
          arrivals
            .filter((card) => card.row === row)
            .map((card) => {
              const opened = row === OPENED.row && card.slot === OPENED.slot;
              const next = row === NEXT.row && card.slot === NEXT.slot;
              const key = `${row}-${card.slot}`;
              const rest = { blur: ROWS[row].blur + 6 * lift, alpha: ROWS[row].alpha * (1 - 0.55 * lift) };
              const drop = dropIn(f, card.at);
              if (opened) {
                // The opened card leaves when it is cleared; a new one drops into its slot, and that one lifts out in S2.
                const cleared = tween(f, REVIEW.clear, REVIEW.clear + 10, ease.depart);
                const refill = dropIn(f, REVIEW.refill);
                return (
                  <div key={key}>
                    {cleared < 1 ? (
                      <PrCard
                        x={slotX(row, card.slot)}
                        y={ROWS[row].y + drop.y + 40 * cleared}
                        scale={ROWS[row].scale}
                        blur={rest.blur}
                        alpha={rest.alpha * drop.opacity * (1 - cleared)}
                        stat={card.stat}
                        review={tween(f, REVIEW.open, REVIEW.clear, ease.drift)}
                        focus={tween(f, REVIEW.open, REVIEW.open + 8, ease.softArrive) * (1 - cleared)}
                      />
                    ) : null}
                    {f >= REVIEW.refill - 9 ? (
                      <LiftedCard x={slotX(row, card.slot)} y={ROWS[row].y + refill.y} alpha={refill.opacity} lift={lift} />
                    ) : null}
                  </div>
                );
              }
              return (
                <PrCard
                  key={key}
                  x={slotX(row, card.slot)}
                  y={ROWS[row].y + drop.y}
                  scale={ROWS[row].scale}
                  blur={rest.blur}
                  alpha={rest.alpha * drop.opacity}
                  stat={card.stat}
                  focus={next ? tween(f, REVIEW.next, REVIEW.next + 8, ease.softArrive) * (1 - tween(f, riser, riser + beat, ease.standard)) : 0}
                />
              );
            }),
        )}
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
        {frame < c2.to ? (
          // "Reviewing them still" stays on, racked soft, until the hard cut to the question on the riser.
          <FocusLine
            words={words(c2.text, { 0: "soft", 1: "soft", 2: "soft", 3: "key" })}
            frame={frame}
            enter={c2.from}
            rack={{ at: c2.from + 2 * beat, dimTo: DARK.dim, soften: 3 }}
            role={ROLES.displayM}
            color={DARK.text}
            style={{ position: "absolute", top: 352 }}
          />
        ) : null}
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

/** A card dropping into its slot: it lands on its beat (a 9-frame settle that ends there), fading in on the way. */
function dropIn(f: number, at: number) {
  if (at <= 0) return { y: 0, opacity: tween(f, s1.captions[0].from, s1.captions[0].from + 12, ease.softArrive) };
  const p = spring({ frame: f - (at - 9), fps: 30, config: springs.heroSettle, durationInFrames: 9 });
  return { y: -64 * (1 - p), opacity: tween(f, at - 9, at - 3, ease.softArrive) };
}

const CARD_FILL = "#18261f";
const BAR = "#7d9387";

/**
 * One identical pull-request card: a pull-request glyph (two branch dots
 * joined, drawn here, no platform mark), two title bars, a green and a red
 * diff-stat bar. No text, no numbers. `focus` lights its outline (the
 * reviewer has it open) and `review` fills its progress line.
 */
const PrCard: React.FC<{
  x: number;
  y: number;
  scale: number;
  blur: number;
  alpha: number;
  stat: [number, number];
  focus?: number;
  review?: number;
  lit?: number;
}> = ({ x, y, scale, blur, alpha, stat, focus = 0, review, lit = 0 }) => {
  const fill = lit > 0 ? mixColor(CARD_FILL, "#dfeae3", lit) : CARD_FILL;
  const ink = lit > 0 ? mixColor(BAR, "#2c4a3b", lit) : BAR;
  const green = lit > 0 ? mixColor("#3f8a69", "#1f6d50", lit) : "#3f8a69";
  const red = lit > 0 ? mixColor("#9a5a52", "#a3473d", lit) : "#9a5a52";
  const outline = `rgba(185,220,198,${(0.16 + 0.6 * Math.max(focus, lit)).toFixed(3)})`;
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
        background: fill,
        boxShadow: `inset 0 0 0 ${(1 + focus).toFixed(2)}px ${outline}, 0 18px 40px rgba(0,0,0,0.45)${lit > 0 ? `, 0 0 ${(80 * lit).toFixed(1)}px rgba(141,187,159,${(0.4 * lit).toFixed(3)})` : ""}`,
        filter: blurCss(blur),
        opacity: alpha,
      }}
    >
      <svg width={30} height={30} viewBox="0 0 24 24" style={{ position: "absolute", left: 20, top: 20 }} aria-hidden>
        <g fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round">
          <circle cx={6} cy={5.5} r={2.6} />
          <circle cx={6} cy={18.5} r={2.6} />
          <circle cx={18} cy={18.5} r={2.6} />
          <path d="M6 8.1v7.8" />
          <path d="M18 15.9V10a3 3 0 0 0-3-3h-3.5" />
          <path d="M13.5 4.6 11.4 7l2.1 2.4" />
        </g>
      </svg>
      <div style={{ position: "absolute", left: 62, top: 26, width: 64, height: 16, borderRadius: 8, background: green, opacity: 0.85 }} />
      <div style={{ position: "absolute", left: 22, top: 70, width: 228, height: 13, borderRadius: 6, background: ink, opacity: 0.75 }} />
      <div style={{ position: "absolute", left: 22, top: 94, width: 158, height: 13, borderRadius: 6, background: ink, opacity: 0.75 }} />
      <div style={{ position: "absolute", left: 22, top: 140, width: stat[0], height: 10, borderRadius: 5, background: green }} />
      <div style={{ position: "absolute", left: 28 + stat[0], top: 140, width: stat[1], height: 10, borderRadius: 5, background: red }} />
      {review !== undefined && review > 0 ? (
        <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: CARD.w * review, background: DARK.mint, opacity: 0.85 }} />
      ) : null}
    </div>
  );
};

const mixColor = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], t))).join(",")})`;
};

/** The card that lifts out of the halted queue, turns to face the viewer and lights up (kick to stop). */
const LiftedCard: React.FC<{ x: number; y: number; alpha: number; lift: number }> = ({ x, y, alpha, lift }) => {
  const cx = mix(x, 960, lift);
  const cy = mix(y, 676, lift);
  const scale = mix(1, 1.45, lift);
  const ry = mix(26, 0, lift) * Math.min(1, lift * 3);
  const rx = 14 * Math.sin(Math.PI * lift) * 0.6;
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
        <PrCard x={x} y={y} scale={1} blur={mix(ROWS[0].blur, 0, lift)} alpha={alpha} stat={[58, 18]} lit={lift} />
      </div>
    </div>
  );
};

/** The one reviewer: a round pointer with a ring; it opens the centre card, pings on the beats while it reads, then moves on. */
const Reviewer: React.FC<{ frame: number }> = ({ frame }) => {
  const appear = tween(frame, 12, 26, ease.softArrive);
  const leave = 1 - tween(frame, riser, riser + beat, ease.standard);
  const opacity = appear * leave;
  if (opacity <= 0.001) return null;
  const opened = { x: slotX(OPENED.row, OPENED.slot) + 70, y: ROWS[0].y - 30 };
  const next = { x: slotX(NEXT.row, NEXT.slot) + 70, y: ROWS[0].y - 30 };
  const toOpen = tween(frame, REVIEW.open - 14, REVIEW.open, ease.standard);
  const toNext = tween(frame, REVIEW.next - 14, REVIEW.next, ease.standard);
  const x = mix(mix(1240, opened.x, toOpen), next.x, toNext) + 3 * Math.sin(frame / 23);
  const y = mix(mix(690, opened.y, toOpen), next.y, toNext) + 2 * Math.sin(frame / 31);
  const pings: number[] = [];
  for (const at of [REVIEW.open, REVIEW.open + 2 * beat, REVIEW.next]) if (frame >= at && frame < at + 24) pings.push((frame - at) / 24);
  return (
    <>
      {pings.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x - mix(16, 64, p),
            top: y - mix(16, 64, p),
            width: 2 * mix(16, 64, p),
            height: 2 * mix(16, 64, p),
            borderRadius: "50%",
            border: `3px solid rgba(185,220,198,${(0.75 * (1 - p) * opacity).toFixed(3)})`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: x - 24,
          top: y - 24,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "2px solid rgba(185,220,198,0.55)",
          opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - 12,
          top: y - 12,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "rgba(244,247,243,0.95)",
          boxShadow: "0 0 0 1px rgba(2,4,3,0.5), 0 3px 10px rgba(0,0,0,0.5)",
          opacity,
        }}
      />
    </>
  );
};
