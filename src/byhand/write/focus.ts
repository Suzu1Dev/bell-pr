import { useEffect, useRef, type FocusEvent } from "react";
import { focusWhenShown } from "../../app/hooks/useByHand";

/** The fields the focus can come back to: never a read-only one. */
const fields = "textarea:not([readonly]), input.text-input:not([readonly])";

/**
 * Keeps the focus in a writing view when the control that had it turns off
 * (a request on its way) or goes away (a step done, a test run that ended):
 * it moves to the first field of the part of the view the control was in
 * (its section, form or group), else to the view's first field, never to
 * the page, so the keyboard and a screen reader stay where the person was.
 * Spread the result on the view's root element.
 */
export function useFocusHome<T extends HTMLElement>() {
  const root = useRef<T>(null);
  const had = useRef<{ control: Element; part: Element | null }>(undefined);
  useEffect(() => {
    const { control, part } = had.current ?? {};
    const active = document.activeElement;
    if (!control || (active !== control && active !== document.body) || (control.isConnected && !control.matches(":disabled"))) return;
    had.current = undefined;
    const home = part?.isConnected && root.current?.contains(part) ? part.querySelector<HTMLElement>(fields) : null;
    (home ?? root.current?.querySelector<HTMLElement>(fields))?.focus();
  });
  return {
    ref: root,
    onFocus: (event: FocusEvent<T>) => void (had.current = { control: event.target, part: event.target.closest("section, form, [role=group]") }),
  };
}

/**
 * After Mark it ready the Ready dialog and the footer's button give way (the
 * footer waits while the guide reviews): the focus goes to what comes next,
 * Explain it back ("Take the check now"), else to the run's title, once the
 * dialog has gone.
 */
export const focusAfterReady = () =>
  focusWhenShown(() =>
    document.querySelector("[role=dialog]") ? null : (document.querySelector<HTMLElement>(".check-link") ?? document.querySelector<HTMLElement>(".title-row h1")),
  );

/** After This is my plan the plan gives way to Code changes: the focus goes to that tab, not to the page. */
export const focusAfterPlan = () => focusWhenShown(() => document.querySelector<HTMLElement>("#workspace-tab-changes[aria-selected=true]"));

/** After "Add a step" the focus goes to the new step's title, so typing never lands in another field (or adds steps). */
export const focusById = (id: string) => focusWhenShown(() => document.getElementById(id));
