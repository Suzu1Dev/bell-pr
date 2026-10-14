// Progressive enhancement for the landing site; every page works without it.
// A button with data-copy="<element id>" copies that element's text. The
// buttons stay hidden when the Clipboard API is unavailable (for example on
// plain http), and the command remains selectable text.
"use strict";

(() => {
  const status = document.getElementById("copy-status");
  const announce = (message) => {
    if (!status) return;
    status.textContent = "";
    // A fresh text node makes screen readers announce repeated messages.
    window.setTimeout(() => {
      status.textContent = message;
    }, 50);
  };

  for (const button of document.querySelectorAll("button[data-copy]")) {
    const source = document.getElementById(button.dataset.copy);
    if (!source || !navigator.clipboard || !window.isSecureContext) continue;
    const label = button.textContent;
    let reset;
    button.hidden = false;
    button.addEventListener("click", async () => {
      window.clearTimeout(reset);
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        button.textContent = "Copied";
        announce("Copied to the clipboard.");
      } catch {
        // Permission denied: select the text so the reader can copy it.
        window.getSelection().selectAllChildren(source);
        button.textContent = "Selected";
        announce("Copying failed. The command is selected; copy it with your keyboard.");
      }
      reset = window.setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  }
})();
