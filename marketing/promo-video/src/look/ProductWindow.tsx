/**
 * The generic floating window around a real capture (lookdev STYLE-GUIDE
 * §5.1): no title bar, no window buttons, no device. Rounded corners, a
 * hairline, a top rim light, the tinted shadow stack of the light studio and,
 * when it floats, a contact shadow on the floor. Depth of field as a lift
 * (src/look/dof.ts): the window drops back (the same picture blurred
 * SOFT_BLUR px on screen, so it recedes the same at every magnification,
 * under a uniform veil of the studio's colour) and the component the take is
 * about comes forward as its own layer, cropped on its own border, a little
 * larger, with a soft layered shadow under it. A one-axis shutter blur only
 * while the window moves fast (§4.6; never CameraMotionBlur, which
 * posterizes).
 */
import { useId, type ReactNode } from "react";
import { Img } from "remotion";
import { CAPTURE } from "../footage.ts";
import { corners, PERSPECTIVE, PERSPECTIVE_ORIGIN, viewTransform, type View } from "./camera.ts";
import { LIFT_SCALE, SOFT_BLUR, VEIL, type Lift } from "./dof.ts";
import type { PointerState } from "./pointer.ts";

/**
 * The light studio's shadow stack, tinted with the token hue (STYLE-GUIDE
 * §5.1), one step deeper than the guide's starting values: on the studio
 * plate the window's white UI must read as a lit object, not as more white.
 */
const SHADOW = [
  [0, 0, 0, 1, "rgba(17,26,21,0.12)"],
  [0, 1, 2, 0, "rgba(22,43,36,0.08)"],
  [0, 4, 12, 0, "rgba(22,43,36,0.08)"],
  [0, 16, 40, 0, "rgba(22,43,36,0.12)"],
  [0, 40, 100, 0, "rgba(22,43,36,0.20)"],
  [0, 90, 160, -40, "rgba(22,43,36,0.26)"],
] as const;

const px = (value: number) => `${+value.toFixed(3)}px`;

/** The lifted layer's shadow (screen px at 1080p): variant B's layered stack, smaller, so the component floats just off the page. */
const LIFT_SHADOW = [
  [0, 0, 0, 1, "rgba(17,26,21,0.10)"],
  [0, 1, 2, 0, "rgba(22,43,36,0.10)"],
  [0, 6, 16, 0, "rgba(22,43,36,0.12)"],
  [0, 18, 44, 0, "rgba(22,43,36,0.16)"],
] as const;

/** A lift as the window draws it: the component and how far forward it is (0..1). */
export interface LiftState {
  lift: Lift;
  on: number;
}

export interface WindowProps {
  view: View;
  /** Layout px per capture CSS px. */
  layout: number;
  /** The sharp picture. */
  src: string;
  /** How far the window drops back behind its lifts (0..1): the back plane's blur and veil. */
  focus?: number;
  /** The components lifted out of the page. */
  lifts?: LiftState[];
  /** The window's visible height in capture px (it may end above the viewport's bottom, in a gutter). */
  height?: number;
  /** 0..1 progress of the one light sweep across the window, or undefined. */
  sweep?: number;
  pointer?: PointerState;
  /** Shutter blur (screen px, x and y) from the window's own speed. */
  shutter?: { x: number; y: number };
  /** The contact shadow under a floating window (0..1 strength). */
  contact?: number;
  opacity?: number;
  children?: ReactNode;
}

export const ProductWindow: React.FC<WindowProps> = ({
  view,
  layout,
  src,
  focus = 0,
  lifts = [],
  height = CAPTURE.height,
  sweep,
  pointer,
  shutter,
  contact = 0,
  opacity = 1,
  children,
}) => {
  const id = `shutter${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const w = CAPTURE.width * layout;
  const h = height * layout;
  const full = CAPTURE.height * layout;
  // On-screen px -> layout px: the element is scaled by view.m / layout.
  const k = layout / view.m;
  const radius = 0.0095 * CAPTURE.width * layout;
  const shadow = SHADOW.map(([x, y, blur, spread, color]) => `${px(x * k)} ${px(y * k)} ${px(blur * k)} ${px(spread * k)} ${color}`).join(", ");
  const liftShadow = LIFT_SHADOW.map(([x, y, blur, spread, color]) => `${px(x * k)} ${px(y * k)} ${px(blur * k)} ${px(spread * k)} ${color}`).join(", ");
  // A short shutter (about 90 degrees, capped at 4 px): the rise reads as motion, and UI titles stay legible.
  const sx = Math.min(4, Math.abs(shutter?.x ?? 0) * 0.1);
  const sy = Math.min(4, Math.abs(shutter?.y ?? 0) * 0.1);
  const blurOn = sx >= 0.3 || sy >= 0.3;
  const image = { position: "absolute", left: 0, top: 0, width: w, height: full, maxWidth: "none", display: "block" } as const;
  const floor = contact > 0 ? contactShadow(view, height) : undefined;
  const back = focus > 0.001;
  return (
    <>
      {floor ? (
        <div
          style={{
            position: "absolute",
            left: floor.x - floor.w / 2,
            top: floor.y - floor.h / 2,
            width: floor.w,
            height: floor.h,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(22,43,36,0.30), rgba(22,43,36,0.12) 55%, rgba(22,43,36,0) 100%)",
            filter: "blur(18px)",
            opacity: contact * opacity,
          }}
        />
      ) : null}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} />
        </filter>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          perspective: PERSPECTIVE,
          perspectiveOrigin: `${PERSPECTIVE_ORIGIN.x}px ${PERSPECTIVE_ORIGIN.y}px`,
          filter: blurOn ? `url(#${id})` : undefined,
          opacity,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            transformOrigin: "0 0",
            transform: viewTransform(view, layout),
          }}
        >
          <div style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden", background: "#ffffff", boxShadow: shadow }}>
            {back ? (
              <>
                <Img src={src} style={{ ...image, filter: `blur(${((SOFT_BLUR * focus * layout) / view.m).toFixed(3)}px)` }} />
                <div style={{ position: "absolute", inset: 0, background: `rgba(${VEIL.color.join(",")},${(VEIL.alpha * focus).toFixed(3)})` }} />
              </>
            ) : (
              <Img src={src} style={image} />
            )}
            {back
              ? lifts.map(({ lift, on }, index) => (on * focus > 0.001 ? <Lifted key={index} lift={lift} on={on * focus} src={src} layout={layout} shadow={liftShadow} /> : null))
              : null}
            {children}
            {pointer ? <Pointer state={pointer} layout={layout} k={k} /> : null}
            {sweep === undefined ? null : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  mixBlendMode: "soft-light",
                  background:
                    "linear-gradient(105deg, rgba(255,255,255,0) 42%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 58%)",
                  backgroundSize: "300% 100%",
                  backgroundPosition: `${((1 - sweep) * 100).toFixed(3)}% 0`,
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: radius,
                // The top rim light (two px of white along the top edge) and an ink hairline all round.
                boxShadow: `inset 0 ${px(2 * k)} 0 rgba(255,255,255,0.95), inset 0 0 0 ${px(k)} rgba(17,26,21,0.09)`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

/**
 * One lifted component: the same picture cropped on the component's box,
 * scaled about the box's centre (laid out larger, not transformed, so the
 * raster stays crisp), with its shadow on the page under it.
 */
const Lifted: React.FC<{ lift: Lift; on: number; src: string; layout: number; shadow: string }> = ({ lift, on, src, layout, shadow }) => {
  const s = 1 + (LIFT_SCALE - 1) * on;
  const [x0, y0, x1, y1] = lift.box.map((v) => v * layout);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const left = cx + (x0 - cx) * s;
  const top = cy + (y0 - cy) * s;
  const width = (x1 - x0) * s;
  const height = (y1 - y0) * s;
  const r = lift.radius ?? 8;
  const radius = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => px(v * layout * s)).join(" ");
  const box = { position: "absolute", left, top, width, height, borderRadius: radius } as const;
  return (
    <>
      <div style={{ ...box, boxShadow: shadow, opacity: Math.min(1, on * 1.4) }} />
      <div style={{ ...box, overflow: "hidden", opacity: on >= 0.999 ? 1 : on }}>
        <Img
          src={src}
          style={{
            position: "absolute",
            left: cx * (1 - s) - left,
            top: cy * (1 - s) - top,
            width: CAPTURE.width * layout * s,
            height: CAPTURE.height * layout * s,
            maxWidth: "none",
            display: "block",
          }}
        />
      </div>
    </>
  );
};

/**
 * The neutral round pointer on the light UI: an ink disc (70%) with a white
 * ring and a soft shadow, drawn beside its hotspot like an arrow's body
 * beside its tip (by default 9 capture px right of and 11 below it; per
 * click, wherever the footage leaves it off every glyph, scripts/
 * pointer-spots.mjs), so it never sits on the text it clicks; a thin green
 * ring round the disc where it clicks.
 */
export const POINTER_OFFSET = { x: 9, y: 11 } as const;

const Pointer: React.FC<{ state: PointerState; layout: number; k: number }> = ({ state, layout, k }) => {
  if (state.opacity <= 0.001 && state.ripple === undefined) return null;
  const size = 20 * k * (1 - 0.18 * state.press);
  const offset = state.offset ?? POINTER_OFFSET;
  const disc = { x: (state.x + offset.x) * layout, y: (state.y + offset.y) * layout };
  const ring = state.ripple;
  return (
    <>
      {ring === undefined ? null : (
        <div
          style={{
            position: "absolute",
            // Round the disc, not the hotspot: the hotspot is on the label clicked, and a ring there crossed its glyphs.
            left: ((state.rippleAt?.x ?? state.x) + offset.x) * layout,
            top: ((state.rippleAt?.y ?? state.y) + offset.y) * layout,
            width: (22 + 26 * ring) * k,
            height: (22 + 26 * ring) * k,
            marginLeft: (-(22 + 26 * ring) * k) / 2,
            marginTop: (-(22 + 26 * ring) * k) / 2,
            borderRadius: "50%",
            border: `${px(2 * k)} solid rgba(31,109,80,${(0.55 * (1 - ring)).toFixed(3)})`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: disc.x,
          top: disc.y,
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          borderRadius: "50%",
          background: "rgba(17,26,21,0.7)",
          boxShadow: `0 0 0 ${px(2 * k)} rgba(255,255,255,0.95), 0 ${px(2 * k)} ${px(8 * k)} rgba(17,26,21,0.3)`,
          opacity: state.opacity,
        }}
      />
    </>
  );
};

/** The contact shadow's ellipse on the floor under the window's projected bottom edge. */
function contactShadow(view: View, height: number) {
  const [, , br, bl] = corners(view, height);
  const width = Math.hypot(br.x - bl.x, br.y - bl.y);
  return { x: (br.x + bl.x) / 2, y: Math.max(br.y, bl.y) + 40, w: width * 0.7, h: Math.max(24, width * 0.05) };
}
