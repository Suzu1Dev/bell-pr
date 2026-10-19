/**
 * Records one shot of the promo footage from a Playwright page:
 *
 * - stills: PNG screenshots at named states (`<state>.png`);
 * - frame-stepped clips: with the page clock paused, the clock moves on by
 *   1/30 s and the page is screenshot (JPEG quality 100), frame after frame.
 *
 * Screenshots carry the window's device scale factor (4 for the promo: a
 * 1440x810 CSS viewport becomes 5760x3240 pixels).
 *
 * It also keeps element boxes (CSS pixels of the 1440x810 viewport) for the
 * cameras and the pointer, the pointer moves and clicks with their times,
 * named moments ("marks") for the cuts, and runs the privacy check at every
 * named state.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { allowedPlaceholders, privacyFindings, privacyRules } from "./privacy.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Installed in every page before its own scripts: checks the page text
 * after every DOM change and keeps the names of the rules it broke.
 */
export function privacyGuard({ rules, placeholders }) {
  const compiled = rules.map((rule) => ({
    name: rule.name,
    regex: new RegExp(rule.source, "i"),
  }));
  const state = { checks: 0, findings: [] };
  Object.defineProperty(window, "__promoPrivacy", { value: state });
  const check = () => {
    if (!document.body) return;
    let text = document.body.innerText;
    for (const placeholder of placeholders) text = text.split(placeholder).join("");
    state.checks += 1;
    for (const rule of compiled)
      if (rule.regex.test(text) && !state.findings.includes(rule.name))
        state.findings.push(rule.name);
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

/** The arguments for privacyGuard(). */
export const privacyGuardArgs = () => ({
  rules: privacyRules,
  placeholders: allowedPlaceholders,
});

/** Waits until React and the browser handled the work the clock released. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        // MessageChannel is not faked by the page clock; React schedules on it.
        let rounds = 4;
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          rounds -= 1;
          if (rounds > 0) channel.port2.postMessage(0);
          else resolve();
        };
        channel.port2.postMessage(0);
      }),
  );
}

export class ShotRecorder {
  /**
   * @param {object} options
   * @param {import("playwright-core").Page} options.page
   * @param {string} options.dir the shot's footage directory
   * @param {string} options.id the shot id, for the log
   * @param {boolean} options.workspace whether the sample badge must show
   * @param {(line: string) => void} options.log
   * @param {{ width: number, height: number, deviceScaleFactor: number }} options.viewport
   */
  constructor({ page, dir, id, workspace, log, viewport }) {
    Object.assign(this, { page, dir, id, workspace, log, viewport });
    this.boxes = {};
    this.events = [];
    /** Named moments of a clip, in seconds, for cuts in src/timeline.json. */
    this.marks = {};
    this.frames = [];
    this.method = "still";
    this.pointer = undefined;
  }

  async prepare() {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
  }

  /**
   * The privacy check of one captured state: the page text breaks no rule,
   * and in workspace shots the "Sample project" badge is visible.
   */
  async check(state) {
    const text = await this.page.evaluate(() => document.body.innerText);
    const findings = privacyFindings(text);
    const guard = await this.page.evaluate(() => window.__promoPrivacy ?? null);
    const seen = guard?.findings ?? [];
    const problems = [...new Set([...findings, ...seen])];
    let badge = "n/a";
    if (this.workspace) {
      const visible = await this.page
        .locator(".presentation-sample-badge")
        .first()
        .isVisible();
      badge = visible ? "visible" : "MISSING";
      if (!visible) problems.push("Sample project badge not visible");
    }
    const result = problems.length ? `FAIL (${problems.join("; ")})` : "ok";
    this.log(`${this.id} · ${state}: privacy ${result}; sample badge ${badge}`);
    if (problems.length)
      throw new Error(`${this.id} · ${state}: the privacy check failed: ${problems.join("; ")}.`);
  }

  /** Records a named element box (CSS pixels of the viewport) for the cursor. */
  async target(name, locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${this.id}: the cursor target "${name}" is not on the page.`);
    const rounded = Object.fromEntries(
      Object.entries(box).map(([key, value]) => [key, Math.round(value * 10) / 10]),
    );
    this.boxes[name] = rounded;
    return rounded;
  }

  /** A PNG screenshot of the current state, after the privacy check. */
  async still(state) {
    await this.check(state);
    await this.page.screenshot({
      path: path.join(this.dir, `${state}.png`),
      type: "png",
      caret: "hide",
      animations: "disabled",
    });
  }

  // Clips ----------------------------------------------------------------

  /** Seconds since the clip's first frame. */
  elapsed() {
    return this.frameIndex / 30;
  }

  /** Steps frames until `t` seconds after the clip's first frame. */
  async at(t) {
    while (this.frameIndex < Math.round(t * 30)) await this.frame();
  }

  /** Steps frames for `seconds` more: the page holds (or keeps playing). */
  async hold(seconds) {
    await this.at(this.elapsed() + seconds);
  }

  /** The pointer starts the clip where it was parked. */
  markStart() {
    if (this.pointer) this.events.push({ type: "start", t: 0, ...this.pointer });
  }

  /**
   * Frame stepping. The page clock (timers, Date, requestAnimationFrame),
   * which the caller installed and paused before the page loaded, moves on
   * by exactly 1/30 s per frame. CSS animations and transitions run on the
   * document timeline, which the clock does not drive: the timeline is
   * stopped through CDP (playback rate 0) and each frame moves every running
   * animation on by 1/30 s, so a dialog fades in over the same frames it
   * would on screen, however long a screenshot takes. Scrolls are tweened
   * per frame (scrollTo) rather than left to smooth scrolling.
   * Frame 0 is the state when this is called.
   */
  async startFrames() {
    this.method = "clock";
    this.frameIndex = 0;
    this.tweens = [];
    await mkdir(path.join(this.dir, "frames"), { recursive: true });
    // The clock is paused, so the page's time stands still between calls.
    this.clockAt = await this.page.evaluate(() => Date.now());
    this.clockStart = this.clockAt;
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send("Animation.enable");
    await this.cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
    this.markStart();
    await this.shoot();
  }

  /** Moves the clip on by one frame and screenshots it. */
  async frame() {
    this.frameIndex += 1;
    await this.advance(this.clockStart + Math.round((this.frameIndex * 1000) / 30) - this.clockAt);
    await this.shoot();
  }

  /** Moves the page's time on by `ms`: its timers, then its animations. */
  async advance(ms) {
    await this.page.clock.runFor(ms);
    this.clockAt += ms;
    // The document timeline stands still (playback rate 0); every running
    // animation and transition moves on by the same time.
    await this.page.evaluate((step) => {
      for (const animation of document.getAnimations())
        if (animation.playState === "running")
          animation.currentTime = Number(animation.currentTime ?? 0) + step;
    }, ms);
  }

  /**
   * Lets the page's time run on, unfilmed, until `condition()` is true (at
   * most `seconds` of page time): the clip cuts over a loading moment and
   * goes on from the next frame as if no time had passed.
   */
  async skipUntil(condition, seconds = 5) {
    let skipped = 0;
    while (!(await condition())) {
      if (skipped > seconds * 1000)
        throw new Error(`${this.id}: the page was not ready after ${seconds} s of page time.`);
      await this.advance(1000 / 30);
      await settle(this.page);
      skipped += 1000 / 30;
    }
    this.clockStart += skipped;
    if (skipped) this.log(`${this.id} · cut over ${Math.round(skipped)} ms of loading`);
  }

  /**
   * Runs `step(frameIndex)` before each frame's screenshot, after the page
   * settled, until it returns true. Scroll tweens are such steps.
   */
  onFrame(step) {
    this.tweens.push(step);
  }

  async shoot() {
    await settle(this.page);
    for (const step of [...this.tweens])
      if (await step(this.frameIndex)) this.tweens.splice(this.tweens.indexOf(step), 1);
    const file = `frames/${String(this.frameIndex).padStart(5, "0")}.jpg`;
    await this.page.screenshot({
      path: path.join(this.dir, file),
      type: "jpeg",
      quality: 100,
      caret: "hide",
    });
    this.frames.push({ file, timestamp: this.frameIndex / 30 });
  }

  async stopFrames() {
    await this.cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await this.cdp.detach();
    this.stopped = true;
  }

  /**
   * Scrolls `scroller` (an element handle, or the window when omitted) to
   * `top` over `duration` seconds from now, eased in and out, one step per
   * frame.
   */
  async scrollTo(top, { duration = 0.8, scroller } = {}) {
    const apply = (value) =>
      scroller
        ? scroller.evaluate((element, y) => (element.scrollTop = y), value)
        : this.page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), value);
    const from = await (scroller
      ? scroller.evaluate((element) => element.scrollTop)
      : this.page.evaluate(() => window.scrollY));
    const first = this.frameIndex;
    const frames = Math.max(1, Math.round(duration * 30));
    this.onFrame(async (index) => {
      const progress = Math.min(1, (index - first) / frames);
      // Quarter CSS pixels: whole device pixels at the 4x capture.
      await apply(Math.round((from + (top - from) * easeInOutCubic(progress)) * 4) / 4);
      return progress >= 1;
    });
  }

  /**
   * Lets the clip run until `condition()` resolves true, at most `seconds`;
   * frame by frame in a frame-stepped clip.
   */
  async until(condition, seconds = 10) {
    const end = this.elapsed() + seconds;
    while (!(await condition())) {
      if (this.elapsed() > end)
        throw new Error(`${this.id}: a step did not finish within ${seconds} s.`);
      await this.frame();
    }
  }

  /** Types `text` into the focused field at `cps` characters per second. */
  async type(text, { cps = 20 } = {}) {
    const first = this.frameIndex;
    let typed = 0;
    while (typed < text.length) {
      const due = Math.min(text.length, Math.floor(((this.frameIndex - first + 1) * cps) / 30));
      if (due > typed) {
        await this.page.keyboard.type(text.slice(typed, due));
        typed = due;
      }
      await this.frame();
    }
  }

  /** Names this moment of the clip; the log and targets.json list it. */
  mark(name) {
    this.marks[name] = round(this.elapsed());
    this.log(`${this.id} · mark "${name}" at ${this.marks[name].toFixed(3)} s (frame ${Math.round(this.marks[name] * 30)})`);
  }

  // The pointer -----------------------------------------------------------

  /** Puts the pointer somewhere before the clip starts; the cursor starts there. */
  async park(x, y) {
    await this.page.mouse.move(x, y);
    this.pointer = { x, y };
  }

  /**
   * Moves the cursor to a target over `duration` seconds. The real pointer
   * jumps there when the cursor arrives, so hover styles match the cursor.
   */
  async moveTo(name, locator, { duration = 0.5, dx = 0, dy = 0 } = {}) {
    const box = await this.target(name, locator);
    const x = Math.round((box.x + box.width / 2 + dx) * 10) / 10;
    const y = Math.round((box.y + box.height / 2 + dy) * 10) / 10;
    const start = this.elapsed();
    await this.at(start + duration);
    await this.page.mouse.move(x, y);
    this.events.push({ type: "move", from: round(start), t: round(this.elapsed()), x, y, target: name });
    this.pointer = { x, y };
  }

  /** The view cuts away from where the pointer is: the cursor goes with it. */
  hideCursor() {
    this.events.push({ type: "hide", t: round(this.elapsed()) });
  }

  /** Clicks where the cursor is; `shift` holds Shift for the click. */
  async click(name, { shift = false } = {}) {
    if (!this.pointer) throw new Error(`${this.id}: click "${name}" before any move.`);
    const t = this.elapsed();
    if (shift) await this.page.keyboard.down("Shift");
    await this.page.mouse.down();
    await this.frame();
    await this.page.mouse.up();
    if (shift) await this.page.keyboard.up("Shift");
    this.events.push({ type: "click", t: round(t), x: this.pointer.x, y: this.pointer.y, target: name });
  }

  // Output ----------------------------------------------------------------

  /**
   * Writes frames.json (clips) and targets.json (always), after a last
   * privacy check of the state the shot ends on.
   */
  async save() {
    await this.check("end of shot");
    const checks = await this.page.evaluate(() => window.__promoPrivacy?.checks ?? 0);
    this.log(`${this.id} · the privacy guard checked the page text after ${checks} DOM changes; no finding`);
    const { width, height, deviceScaleFactor: scale } = this.viewport;
    await writeFile(
      path.join(this.dir, "targets.json"),
      `${JSON.stringify({ viewport: this.viewport, boxes: this.boxes, events: this.events, marks: this.marks }, null, 2)}\n`,
    );
    if (this.method === "still") return;
    const frames = this.frames.map(({ file, timestamp }) => ({ file, t: round(timestamp, 4) }));
    await writeFile(
      path.join(this.dir, "frames.json"),
      `${JSON.stringify(
        {
          method: this.method,
          width: width * scale,
          height: height * scale,
          duration: frames.at(-1)?.t ?? 0,
          frames,
        },
        null,
        2,
      )}\n`,
    );
    this.log(
      `${this.id} · ${this.method} clip: ${frames.length} frames over ${(frames.at(-1)?.t ?? 0).toFixed(2)} s`,
    );
  }
}

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
