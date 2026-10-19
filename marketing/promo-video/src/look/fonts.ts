/** The film's type: DM Sans (opsz) and IBM Plex Mono. Rendering waits for every weight the frames use. */
import "./fonts.css";
import { cancelRender, continueRender, delayRender } from "remotion";

export const SANS = '"Promo DM Sans", sans-serif';
export const MONO = '"Promo Plex Mono", monospace';

const waiting = delayRender("Loading DM Sans (opsz) and IBM Plex Mono");
Promise.all([
  ...[450, 500, 560, 600, 650].flatMap((weight) => [
    document.fonts.load(`${weight} 88px "Promo DM Sans"`, "Vibe coding’"),
    document.fonts.load(`${weight} 22px "Promo DM Sans"`, "Vibe coding’"),
  ]),
  document.fonts.load(`500 44px "Promo Plex Mono"`, "npx bell-pr"),
])
  .then((faces) => {
    if (faces.some((list) => list.length === 0)) throw new Error("a face did not match");
    continueRender(waiting);
  })
  .catch((error: Error) => cancelRender(new Error(`The fonts did not load: ${error.message}`)));
