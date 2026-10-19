/**
 * The music edit (src/music.ts: the analysis segments, the gain, the fade-in
 * and the equal-power crossfade before each join) and the sound effects
 * (src/sfx.ts). `music: false` or `sfx: false` mute either for the level
 * checks of scripts/check-output.mjs.
 */
import { Audio, Sequence, staticFile } from "remotion";
import type { Footage } from "./footage.ts";
import { music } from "./music.ts";
import { cueGain, sfxCues } from "./sfx.ts";

export const Soundtrack: React.FC<{ footage: Footage; withMusic?: boolean; withSfx?: boolean }> = ({
  footage,
  withMusic = true,
  withSfx = true,
}) => (
  <>
    {withMusic
      ? music.segments.map((segment, index) => {
          // A later segment starts early by the crossfade.
          const lead = index > 0 ? music.crossfadeFrames : 0;
          const from = segment.from - lead;
          return (
            <Sequence key={index} from={from} durationInFrames={segment.to - from} name={`Music: segment ${index + 1}`}>
              <Audio
                src={staticFile(music.musicFile)}
                trimBefore={segment.trimBefore - lead}
                volume={(f) => music.volume * music.segmentGain(index, from + f)}
              />
            </Sequence>
          );
        })
      : null}
    {withSfx
      ? sfxCues(footage).map((cue, index) => (
          <Sequence key={index} from={cue.from} durationInFrames={cue.durationInFrames} name={`SFX: ${cue.name}`}>
            <Audio src={staticFile(`sfx/${cue.file}`)} trimBefore={cue.trimBefore} volume={(f) => cueGain(cue, f)} />
          </Sequence>
        ))
      : null}
  </>
);
