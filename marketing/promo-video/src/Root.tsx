import { Composition } from "remotion";
import { loadFootage } from "./footage.ts";
import { Promo, type PromoProps } from "./Promo.tsx";
import { timeline } from "./timeline.ts";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Promo"
    component={Promo}
    width={timeline.width}
    height={timeline.height}
    fps={timeline.fps}
    durationInFrames={timeline.durationInFrames}
    defaultProps={{ footage: null } satisfies PromoProps}
    calculateMetadata={async ({ props }) => ({ props: { ...props, footage: await loadFootage() } })}
  />
);
