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

  for (const widget of document.querySelectorAll("[data-install]")) {
    const tabList = widget.querySelector("[data-install-tabs]");
    const platform = widget.querySelector("[data-install-platform]");
    const tabs = [...widget.querySelectorAll("[data-install-target]")];
    const panels = tabs.map((tab) => document.getElementById(tab.dataset.installTarget));
    if (!tabList || !platform || !tabs.length || panels.some((panel) => !panel)) continue;

    const select = (index, focus = false) => {
      tabs.forEach((tab, position) => {
        const selected = position === index;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panels[position].hidden = !selected;
      });
      platform.textContent = panels[index].dataset.platform;
      if (focus) tabs[index].focus();
    };
    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panels[index].id);
      panels[index].setAttribute("role", "tabpanel");
      panels[index].setAttribute("aria-labelledby", tab.id);
      tab.addEventListener("click", () => select(index));
      tab.addEventListener("keydown", (event) => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(next, true);
      });
    });
    tabList.setAttribute("role", "tablist");
    select(0);
    widget.classList.add("install-enhanced");
    tabList.hidden = false;
    platform.hidden = false;
  }

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
        button.dataset.copyState = "copied";
        announce(msg.announceOk);
      } catch {
        // Permission denied: select the text so the reader can copy it.
        window.getSelection().selectAllChildren(source);
        button.textContent = msg.selected;
        delete button.dataset.copyState;
        announce(msg.announceFail);
      }
      reset = window.setTimeout(() => {
        button.textContent = label;
        delete button.dataset.copyState;
      }, 2000);
    });
  }
})();
