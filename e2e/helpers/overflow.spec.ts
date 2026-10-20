// The overflow helper on small fixed pages: what it must catch and what it
// must leave alone.
import { expect, test } from "@playwright/test";
import { expectNoOverflow, findOverflow } from "./overflow";

const long = "A sentence that is far too long for a box this narrow";

async function show(page: import("@playwright/test").Page, body: string) {
  await page.setContent(
    `<!doctype html><html><head><style>body{font:16px sans-serif;margin:0}.w{width:90px}</style></head><body>${body}</body></html>`,
  );
}

test("text that fits passes", async ({ page }) => {
  await show(page, `<h1>Title</h1><p class="w">Short words wrap fine</p><button>OK</button>`);
  await expectNoOverflow(page);
});

test("text that spills out, is cut off or is clamped fails", async ({ page }) => {
  await show(
    page,
    `<div id="spill" class="w" style="white-space:nowrap">${long}</div>
     <div id="cut" class="w" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${long}</div>
     <div id="clip" class="w" style="white-space:nowrap;overflow:hidden">${long}</div>
     <p id="clamp" class="w" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${long} ${long}</p>
     <div id="inline" class="w" style="white-space:nowrap"><span>${long}</span></div>
     <div class="w" style="overflow-wrap:anywhere">Averyveryverylongwordthatbreaks</div>`,
  );
  const problems = await findOverflow(page);
  expect(problems.map((problem) => [problem.element, problem.reason])).toEqual([
    ["div#spill.w", "overflow"],
    ["div#cut.w", "ellipsis"],
    ["div#clip.w", "overflow"],
    ["p#clamp.w", "line-clamp"],
    ["div#inline.w", "overflow"],
  ]);
  expect(problems[0].text).toBe(long);
  expect(problems[0].scrollWidth).toBeGreaterThan(problems[0].clientWidth + 1);
  await expect(expectNoOverflow(page)).rejects.toThrow(/ellipsis: div#cut\.w/);
});

test("scrolling code, hidden text and other scopes pass", async ({ page }) => {
  await show(
    page,
    `<div class="w" style="overflow-x:auto"><pre style="margin:0">${long}</pre></div>
     <div class="w" style="overflow-x:auto"><div class="line" style="white-space:pre">${long}</div></div>
     <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${long}</span>
     <div class="w" style="display:none;white-space:nowrap">${long}</div>
     <div class="w" style="visibility:hidden;white-space:nowrap">${long}</div>
     <details><summary>More</summary><div class="w" style="white-space:nowrap">${long}</div></details>
     <div class="w" style="position:relative;overflow:hidden"><span>Fits</span><i style="position:absolute;right:-40px;top:0;width:60px;height:10px"></i></div>
     <p style="position:relative;width:200px">Fits too<b style="position:absolute;left:180px;width:80px;height:4px"></b></p>
     <section id="fine"><p>Fits</p></section>
     <section id="broken"><div class="w" style="white-space:nowrap">${long}</div></section>`,
  );
  // Decorations that overflow on purpose are no text problem.
  expect(await findOverflow(page)).toEqual([
    expect.objectContaining({ element: "div.w", reason: "overflow" }),
  ]);
  await expectNoOverflow(page, ["#fine"]);
  expect(await findOverflow(page, ["#fine", "pre"])).toEqual([]);
  await expect(expectNoOverflow(page, ["#broken"])).rejects.toThrow(/overflow: div\.w/);
});
