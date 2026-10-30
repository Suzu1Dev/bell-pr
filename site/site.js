// Progressive enhancement for the landing site; every page works without it.
// A button with data-copy="<element id>" copies that element's text. The
// buttons stay hidden when the Clipboard API is unavailable (for example on
// plain http), and the command remains selectable text.
"use strict";

(() => {
  const status = document.getElementById("copy-status");
  const isZh = (document.documentElement.lang || "").toLowerCase().startsWith("zh");
  const msg = {
    copied: isZh ? "已複製" : "Copied",
    selected: isZh ? "已選取" : "Selected",
    announceOk: isZh ? "已複製到剪貼簿。" : "Copied to the clipboard.",
    announceFail: isZh
      ? "複製失敗。指令已選取；請用鍵盤複製。"
      : "Copying failed. The command is selected; copy it with your keyboard.",
  };
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
        button.textContent = msg.copied;
        announce(msg.announceOk);
      } catch {
        // Permission denied: select the text so the reader can copy it.
        window.getSelection().selectAllChildren(source);
        button.textContent = msg.selected;
        announce(msg.announceFail);
      }
      reset = window.setTimeout(() => {
        button.textContent = label;
      }, 2000);
    });
  }
})();
