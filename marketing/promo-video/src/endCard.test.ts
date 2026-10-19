import assert from "node:assert/strict";
import { test } from "node:test";
import { chordFrame, END_LOGO } from "./logo.ts";
import { END_CARD, endCardRows, lineInk, lineTop } from "./scenes/endCardLayout.ts";
import { timeline } from "./timeline.ts";

const end = timeline.shots.at(-1)!;
/** The card's slow drift at its last frame: +0.8% a bar about 45% of the height (src/scenes/EndCard.tsx). */
const drift = 1 + (0.008 * (end.to - 1 - end.from)) / 72;
const drifted = (y: number) => 1080 * 0.45 + (y - 1080 * 0.45) * drift;

test("the end card's lines never touch: logo, headline, the command alone, the facts alone, the footer", () => {
  for (const withHomepage of [false, true]) {
    const rows = endCardRows(withHomepage);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["logo", "headline 1", "headline 2", "command", "facts", ...(withHomepage ? ["homepage"] : []), "footer"],
    );
    rows.forEach((row, i) => {
      assert.ok(row.bottom > row.top, row.name);
      if (i === 0) return;
      const gap = row.top - rows[i - 1].bottom;
      assert.ok(gap >= row.gapAbove, `${row.name}: ${gap.toFixed(1)} px under ${rows[i - 1].name} (at least ${row.gapAbove})`);
    });
    // Everything inside the frame to the last frame, with the drift.
    assert.ok(drifted(rows[0].top) >= 60 && drifted(rows.at(-1)!.bottom) <= 1080 - 60, "inside a 60 px margin");
  }
});

test("`npx bell-pr` is prominent and alone on its line, the facts smaller and quieter on their own line under it", () => {
  const rows = endCardRows();
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  assert.ok(END_CARD.command.size >= 56 && END_CARD.command.face === "mono");
  assert.ok(END_CARD.facts.size < END_CARD.command.size * 0.6 && END_CARD.facts.face === "sans");
  // Clear space above the command (it stands apart from the headline) and below it (the facts start under its descenders).
  assert.ok(byName.command.top - byName["headline 2"].bottom >= 64);
  assert.ok(byName.facts.top - byName.command.bottom >= 24);
  assert.ok(byName.footer.top - byName.facts.bottom >= 80);
  // The facts sit closer to the command than the command to the headline: one call to action, then its subline.
  assert.ok(byName.facts.top - byName.command.bottom < byName.command.top - byName["headline 2"].bottom);
});

test("each line's box puts its baseline where the layout says, and the footer stays where the reviewed card had it", () => {
  for (const line of [END_CARD.command, END_CARD.facts, END_CARD.homepage, END_CARD.footer]) {
    const ink = lineInk(line);
    const top = lineTop(line);
    assert.ok(top < ink.top && top + line.lineHeight >= ink.bottom - 1, `${line.name}: the ink inside its line box`);
  }
  assert.ok(Math.abs(lineTop(END_CARD.footer) - 968) < 1e-9);
  // The logo's slot and the chord are unchanged: the logo lands on the final chord, then moves up above the headline.
  assert.equal(END_LOGO.slot.cy, 222);
  assert.ok(END_LOGO.moveFrom > chordFrame && END_LOGO.moveTo <= end.captions[0].from);
});
