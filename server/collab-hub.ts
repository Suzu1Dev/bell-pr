/**
 * Group work's live boards. A page asks for a repository's board; when it
 * already has the current one, its request waits here until the board or
 * the people looking at it change, or its time is up (long polling).
 *
 * A caller is current when it sends back what it was last given: `epoch`
 * (random, another one each time BELL PR starts), `version` (rises when
 * the board's JSON differs) and `seen` (rises when the people present
 * change). Present is whoever has a request waiting on the project or
 * asked within the last 40 seconds. All of it is in memory only.
 *
 * A change builds the answer once and gives that one string to every
 * request waiting on the project. At most 2 requests wait per participant
 * and 64 in all. One timer runs, and only while a request waits.
 */
import { randomBytes } from "node:crypto";
import { refuse } from "./collab-refusal.js";
import type { Actor } from "./coordination.js";

/** How long a person stays present after their last request. */
export const presenceTtl = 40_000;
export const maxWaiters = 64;
export const maxWaitersEach = 2;

interface Waiter {
  feed: Feed;
  actor: Actor;
  /** When its time is up. */
  until: number;
  /** Sends the body, or 204 without one. */
  answer: (body?: string) => void;
}

interface Feed {
  projectId: string;
  /** The board as JSON, as last read; read again before the next answer when stale. */
  board?: string;
  stale: boolean;
  version: number;
  /** The ids of the people present as JSON, as last counted. */
  present: string;
  seen: number;
  /** When each person last asked or stopped waiting, by participant id. */
  asked: Map<string, number>;
  waiters: Set<Waiter>;
}

export interface FeedQuestion {
  projectId: string;
  actor: Actor;
  epoch?: string;
  version?: number;
  seen?: number;
  /** Seconds to wait while nothing changes; 0 answers at once. */
  wait: number;
}

export class CollabHub {
  readonly epoch = randomBytes(8).toString("hex");
  private readonly feeds = new Map<string, Feed>();
  private parked = 0;
  private timer: NodeJS.Timeout | undefined;

  /**
   * `read` gives a project's board as JSON. The coordinator wants to know
   * who reads, so it gets the actor of a request that asks for the board;
   * the board itself is the same for everyone.
   */
  constructor(private readonly read: (projectId: string, actor: Actor) => string) {}

  /**
   * Answers at once when the caller is behind, else when something changes
   * or after `wait` seconds (204). Refuses a request that would wait beyond
   * the limits: 429 `tooManyWaiters`. Returns what to call when the client
   * goes away, so a request nobody reads keeps no place.
   */
  ask(question: FeedQuestion, answer: (body?: string) => void): () => void {
    const { projectId, actor } = question;
    const now = Date.now();
    let feed = this.feeds.get(projectId);
    if (!feed) {
      feed = {
        projectId,
        stale: true,
        version: 0,
        present: "[]",
        seen: 0,
        asked: new Map(),
        waiters: new Set(),
      };
      this.feeds.set(projectId, feed);
    }
    feed.asked.set(actor.id, now);
    const rebuilt = feed.stale && this.rebuild(feed, actor);
    // This request may be what changes who is present: the others hear of it.
    if (this.count(feed, now) || rebuilt) this.wake(feed, rebuilt, now);
    const behind = question.epoch !== this.epoch || question.version !== feed.version;
    if (behind || question.seen !== feed.seen) {
      answer(this.body(feed, behind, now));
      return () => undefined;
    }
    if (question.wait <= 0) {
      answer();
      return () => undefined;
    }
    if (this.parked >= maxWaiters || this.waitingOf(actor.id) >= maxWaitersEach)
      throw refuse(429, "tooManyWaiters", (m) => m.collab.tooManyWaiters);
    const waiter: Waiter = { feed, actor, until: now + question.wait * 1000, answer };
    feed.waiters.add(waiter);
    this.parked += 1;
    this.arm();
    return () => {
      if (this.leave(waiter)) this.arm();
    };
  }

  /** The board of one project may differ now; with no id (a change of people), every board. */
  changed(projectId?: string) {
    const feeds = projectId === undefined ? [...this.feeds.values()] : [this.feeds.get(projectId)];
    const now = Date.now();
    for (const feed of feeds) {
      if (!feed) continue;
      feed.stale = true;
      const [waiter] = feed.waiters;
      // Nobody waits: whoever asks next reads it.
      if (!waiter) continue;
      try {
        const rebuilt = this.rebuild(feed, waiter.actor);
        if (this.count(feed, now) || rebuilt) this.wake(feed, rebuilt, now);
      } catch {
        // The board cannot be read now. They ask again and hear why.
        this.release(feed);
      }
    }
    this.arm();
  }

  /** A removed person: their waiting requests end, and they are present nowhere. */
  forget(participantId: string) {
    for (const feed of this.feeds.values()) {
      for (const waiter of [...feed.waiters])
        if (waiter.actor.id === participantId && this.leave(waiter)) waiter.answer();
      feed.asked.delete(participantId);
    }
    this.arm();
  }

  /** Answers every waiting request (204), so stopping never waits for one. */
  close() {
    for (const feed of this.feeds.values()) this.release(feed);
    this.arm();
  }

  private release(feed: Feed) {
    for (const waiter of [...feed.waiters]) if (this.leave(waiter)) waiter.answer();
  }

  /** Reads the board again; true when it differs from the one before. */
  private rebuild(feed: Feed, actor: Actor) {
    const board = this.read(feed.projectId, actor);
    feed.stale = false;
    if (board === feed.board) return false;
    feed.board = board;
    feed.version += 1;
    return true;
  }

  /** Counts who is present; true when they differ from the ones before. */
  private count(feed: Feed, now: number) {
    const ids = new Set<string>();
    for (const waiter of feed.waiters) ids.add(waiter.actor.id);
    for (const [id, at] of feed.asked) {
      if (now - at < presenceTtl) ids.add(id);
      else feed.asked.delete(id);
    }
    const present = JSON.stringify([...ids].sort());
    if (present === feed.present) return false;
    feed.present = present;
    feed.seen += 1;
    return true;
  }

  /** The answer as JSON. The board and the people present are JSON already and go in as they are. */
  private body(feed: Feed, withBoard: boolean, now: number) {
    const head = JSON.stringify({
      epoch: this.epoch,
      version: feed.version,
      seen: feed.seen,
      asOf: new Date(now).toISOString(),
    });
    const board = withBoard ? `,"board":${feed.board}` : "";
    return `${head.slice(0, -1)}${board},"present":${feed.present}}`;
  }

  /** One string for every request waiting on the project. */
  private wake(feed: Feed, withBoard: boolean, now: number) {
    if (!feed.waiters.size) return;
    const body = this.body(feed, withBoard, now);
    for (const waiter of [...feed.waiters]) if (this.leave(waiter)) waiter.answer(body);
  }

  /** Stops a request waiting; false when it already has. Its person stays present from now. */
  private leave(waiter: Waiter) {
    if (!waiter.feed.waiters.delete(waiter)) return false;
    this.parked -= 1;
    waiter.feed.asked.set(waiter.actor.id, Date.now());
    return true;
  }

  private waitingOf(participantId: string) {
    let waiting = 0;
    for (const feed of this.feeds.values())
      for (const waiter of feed.waiters) if (waiter.actor.id === participantId) waiting += 1;
    return waiting;
  }

  /** Sets the one timer for what comes next: a request's time is up, or someone is no longer present. */
  private arm() {
    clearTimeout(this.timer);
    this.timer = undefined;
    let next = Infinity;
    for (const feed of this.feeds.values()) {
      if (!feed.waiters.size) continue;
      for (const waiter of feed.waiters) next = Math.min(next, waiter.until);
      for (const at of feed.asked.values()) next = Math.min(next, at + presenceTtl);
    }
    if (next === Infinity) return;
    this.timer = setTimeout(() => this.tick(), Math.max(0, next - Date.now()));
    this.timer.unref();
  }

  private tick() {
    const now = Date.now();
    for (const feed of this.feeds.values()) {
      for (const waiter of [...feed.waiters])
        if (waiter.until <= now && this.leave(waiter)) waiter.answer();
      if (feed.waiters.size && this.count(feed, now)) this.wake(feed, false, now);
    }
    this.arm();
  }
}
