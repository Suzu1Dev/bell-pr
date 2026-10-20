/**
 * Moves focus to the learning panel's tab panel from a button that is
 * about to give way to the progress it starts (a request made again, or
 * asked for), so keyboard and screen-reader users stay in the panel
 * rather than land on the page.
 */
export function focusPanel(event: { currentTarget: HTMLElement }) {
  event.currentTarget.closest<HTMLElement>("[role=tabpanel]")?.focus();
}

/** A click handler that keeps focus in the panel (focusPanel), then runs `action`. */
export function inPanel(action: () => void) {
  return (event: { currentTarget: HTMLElement }) => {
    focusPanel(event);
    action();
  };
}
