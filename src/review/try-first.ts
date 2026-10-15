/**
 * Shared pieces of the try-first cards (QuizAttempt and RoadChoice): which
 * saved attempt belongs to the file on screen, what each button saves, the
 * rule that a save resolves before anything is revealed, and the demo's
 * typewriter.
 */
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../shared/i18n/locale";
import type {
  Confidence,
  FileAttempt,
  FileAttemptInput,
} from "../../shared/understanding";
import { ApiError } from "../api";
import { getDemo } from "../demo";

/** What a quiz save sends: PATCH /api/runs/:id/attempts `quiz`. */
export type QuizInput = NonNullable<FileAttemptInput["quiz"]>;
/** What a road-choice save sends: PATCH /api/runs/:id/attempts `road`. */
export type RoadInput = NonNullable<FileAttemptInput["road"]>;
/** A quiz as the card shows it: saved earlier, or saved in this session. */
export type QuizRecord = Omit<NonNullable<FileAttempt["quiz"]>, "at">;
/** A road choice as the card shows it. */
export type RoadRecord = Omit<NonNullable<FileAttempt["road"]>, "at">;

/**
 * The saved attempt when it was made on this version of the file, so an
 * attempt on an earlier diff starts over. The demo diff has no
 * fingerprints; its attempts always belong to the file.
 */
export function currentAttempt(
  attempt: FileAttempt | undefined,
  fingerprint: string | undefined,
): FileAttempt | undefined {
  if (!attempt) return undefined;
  return !fingerprint || attempt.fingerprint === fingerprint
    ? attempt
    : undefined;
}

/**
 * What "Show answer" saves: the answer with its confidence, or, with the
 * field empty, a one-click skip.
 */
export function revealInput(answer: string, confidence?: Confidence): QuizInput {
  const text = answer.trim();
  if (!text) return { skipped: true };
  return confidence ? { answer: text, confidence } : { answer: text };
}

/** "I don't know": a missed attempt at Guessing, with anything already typed. */
export function dontKnowInput(answer: string): QuizInput {
  const text = answer.trim();
  return {
    ...(text ? { answer: text } : {}),
    confidence: "guess",
    grade: "missed",
  };
}

/**
 * Saves `input` and resolves with it only once the save has resolved, so
 * the caller reveals the reference after the answer is on record. A failed
 * save rejects and reveals nothing. Without `save` (no onAttempt), the
 * attempt stays in the card while it is on screen and resolves at once.
 */
export async function saveFirst<T>(
  input: T,
  save?: (input: T) => Promise<void>,
): Promise<T> {
  if (save) await save(input);
  return input;
}

/**
 * The message for a failed save: a 409 means the diff moved on, the
 * attempt is already final or the run no longer takes attempts (the
 * caller reloads the run; the server sends no code to tell them apart);
 * anything else carries its own message.
 */
export function attemptError(error: unknown, fileChanged: string): string {
  if (error instanceof ApiError && error.status === 409) return fileChanged;
  return error instanceof Error && error.message ? error.message : fileChanged;
}

/** The demo's sample answers for one file: the quiz answer and the road choice's guess and why. */
export function demoSamples(locale: Locale, path: string) {
  const demo = getDemo(locale);
  const quizzes: Record<string, { answer: string } | undefined> =
    demo.quizSamples ?? {};
  const roads: Record<string, { guess: string; why: string } | undefined> =
    demo.roadSamples ?? {};
  const road = roads[path];
  return {
    quiz: quizzes[path]?.answer,
    road: road && { guess: road.guess, why: road.why },
  };
}

/** One character per step: a steady rate that a test clock can step. */
export const typewriterStepMs = 30;

/**
 * Types a text into a field one character at a time, on a timer (not
 * requestAnimationFrame), so Playwright's page.clock can step it. A new
 * text or `stop()` ends the one being typed; unmounting ends it too.
 */
export function useTypewriter() {
  const timer = useRef<number | undefined>(undefined);
  const [typing, setTyping] = useState(false);

  function stop() {
    window.clearInterval(timer.current);
    timer.current = undefined;
    setTyping(false);
  }

  function type(text: string, onText: (value: string) => void) {
    stop();
    const characters = Array.from(text);
    let length = 0;
    setTyping(true);
    timer.current = window.setInterval(() => {
      length += 1;
      onText(characters.slice(0, length).join(""));
      if (length >= characters.length) stop();
    }, typewriterStepMs);
  }

  useEffect(() => () => window.clearInterval(timer.current), []);

  return { typing, type, stop };
}
