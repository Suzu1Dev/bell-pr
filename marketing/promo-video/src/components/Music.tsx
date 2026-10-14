/**
 * The soundtrack: the two source segments of src/music.ts, each in its own
 * sequence, with the fade-in, the gain and the 2-frame crossfade at 40 s.
 */
import { Audio, Sequence, staticFile } from "remotion";
import { musicFile, segmentVolume, segments } from "../music.ts";

export const Music: React.FC = () => {
  const [first, second] = segments;
  return (
    <>
      {/* One frame past the cut, for the crossfade's second half. */}
      <Sequence from={first.from} durationInFrames={first.to - first.from + 1} name="Music: source 9.1-49.1 s">
        <Audio
          src={staticFile(musicFile)}
          trimBefore={first.trimBefore}
          volume={(frame) => segmentVolume(0, first.from + frame)}
        />
      </Sequence>
      {/* One frame before the cut, for the crossfade's first half. */}
      <Sequence from={second.from - 1} durationInFrames={second.to - second.from + 1} name="Music: source 65.1 s to the end">
        <Audio
          src={staticFile(musicFile)}
          trimBefore={second.trimBefore - 1}
          volume={(frame) => segmentVolume(1, second.from - 1 + frame)}
        />
      </Sequence>
    </>
  );
};
