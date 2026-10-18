/**
 * The generic floating window around a real capture (lookdev STYLE-GUIDE
 * §5.1): no title bar, no window buttons, no device. Rounded corners, a
 * hairline, a top rim light, the tinted shadow stack of the light studio and,
 * when it floats, a contact shadow on the floor. Two-plane depth of field
 * (§5.3): the pre-blurred copy behind, the sharp copy in front under a mask
 * drawn in capture CSS px. A one-axis shutter blur only while the window
 * moves fast (§4.6; never CameraMotionBlur, which posterizes).
 */
import { useId, type ReactNode } from "react";
import { Img } from "remotion";
import { CAPTURE } from "../footage.ts";
import { corners, PERSPECTIVE, PERSPECTIVE_ORIGIN, viewTransform, type View } from "./camera.ts";
import type { PointerState } from "./pointer.ts";

const SHADOW = [
  [0, 0, 0, 1, "rgba(17,26,21,0.07)"],
  [0, 1, 2, 0, "rgba(22,43,36,0.06)"],
  [0, 4, 12, 0, "rgba(22,43,36,0.06)"],
  [0, 16, 40, 0, "rgba(22,43,36,0.08)"],
  [0, 40, 100, 0, "rgba(22,43,36,0.12)"],
  [0, 90, 160, -40, "rgba(22,43,36,0.20)"],
] as const;

const px = (value: number) => `${+value.toFixed(3)}px`;

export interface WindowProps {
  view: View;
  /** Layout px per capture CSS px. */
  layout: number;
  /** The sharp picture. */
  src: string;
  /** The pre-blurred picture, when depth of field is on. */
  soft?: string;
  /** CSS mask layers (intersected) for the sharp plane, in capture CSS px; opaque = sharp. */
  mask?: string[];
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
  soft,
  mask,
  sweep,
  pointer,
  shutter,
  contact = 0,
  opacity = 1,
  children,
}) => {
  const id = `shutter${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const w = CAPTURE.width * layout;
  const h = CAPTURE.height * layout;
  // On-screen px -> layout px: the element is scaled by view.m / layout.
  const k = layout / view.m;
  const radius = 0.0095 * CAPTURE.width * layout;
  const shadow = SHADOW.map(([x, y, blur, spread, color]) => `${px(x * k)} ${px(y * k)} ${px(blur * k)} ${px(spread * k)} ${color}`).join(", ");
  const scaledMask = mask?.map((layer) => layer.replace(/(-?\d*\.?\d+)cpx/g, (_, n: string) => px(parseFloat(n) * layout)));
  // A short shutter (about 90 degrees, capped at 8 px): the rise reads as motion, not as a smear.
  const sx = Math.min(8, Math.abs(shutter?.x ?? 0) * 0.1);
  const sy = Math.min(8, Math.abs(shutter?.y ?? 0) * 0.1);
  const blurOn = sx >= 0.3 || sy >= 0.3;
  const image = { position: "absolute", left: 0, top: 0, width: w, height: h, maxWidth: "none", display: "block" } as const;
  const floor = contact > 0 ? contactShadow(view) : undefined;
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
            background: "radial-gradient(closest-side, rgba(22,43,36,0.18), rgba(22,43,36,0.08) 55%, rgba(22,43,36,0) 100%)",
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
            {soft && scaledMask ? <Img src={soft} style={image} /> : null}
            <Img
              src={src}
              style={{
                ...image,
                maskImage: scaledMask?.join(", "),
                WebkitMaskImage: scaledMask?.join(", "),
                maskComposite: scaledMask && scaledMask.length > 1 ? "intersect" : undefined,
                WebkitMaskComposite: scaledMask && scaledMask.length > 1 ? "source-in" : undefined,
              }}
            />
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
                boxShadow: `inset 0 ${px(k)} 0 rgba(255,255,255,0.9), inset 0 0 0 ${px(k)} rgba(17,26,21,0.06)`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

/** The neutral round pointer on the light UI: a 20 px ink disc with a white ring and a soft shadow; a green ring where it clicks. */
const Pointer: React.FC<{ state: PointerState; layout: number; k: number }> = ({ state, layout, k }) => {
  if (state.opacity <= 0.001) return null;
  const size = 20 * k * (1 - 0.18 * state.press);
  const ring = state.ripple === undefined ? undefined : state.ripple / 0.5;
  return (
    <>
      {ring === undefined ? null : (
        <div
          style={{
            position: "absolute",
            left: state.x * layout,
            top: state.y * layout,
            width: (22 + 40 * ring) * k,
            height: (22 + 40 * ring) * k,
            marginLeft: (-(22 + 40 * ring) * k) / 2,
            marginTop: (-(22 + 40 * ring) * k) / 2,
            borderRadius: "50%",
            border: `${px(2 * k)} solid rgba(31,109,80,${(0.55 * (1 - ring) * state.opacity).toFixed(3)})`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: state.x * layout,
          top: state.y * layout,
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          borderRadius: "50%",
          background: "rgba(17,26,21,0.78)",
          boxShadow: `0 0 0 ${px(2 * k)} rgba(255,255,255,0.95), 0 ${px(2 * k)} ${px(8 * k)} rgba(17,26,21,0.3)`,
          opacity: state.opacity,
        }}
      />
    </>
  );
};

/** The contact shadow's ellipse on the floor under the window's projected bottom edge. */
function contactShadow(view: View) {
  const [, , br, bl] = corners(view);
  const width = Math.hypot(br.x - bl.x, br.y - bl.y);
  return { x: (br.x + bl.x) / 2, y: Math.max(br.y, bl.y) + 40, w: width * 0.7, h: Math.max(24, width * 0.05) };
}
