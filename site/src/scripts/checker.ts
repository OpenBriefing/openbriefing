// The checker page.
import { guardUrl } from "../../../worker/fetch/src/guard";
import { check, hasNoTags, type Check } from "../lib/checker-core";
import { fetchPage, h, renderBrief, stopSpeaking, verdict } from "./brief-view";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("check-form");
const urlInput = $<HTMLInputElement>("check-url");
const sourceInput = $<HTMLTextAreaElement>("check-source");
const pasteUrlInput = $<HTMLInputElement>("check-source-url");
const out = $<HTMLDivElement>("check-result");
const status = $<HTMLParagraphElement>("check-status");
const runButton = $<HTMLButtonElement>("check-run");

function render(c: Check, shownUrl: string | undefined): void {
  stopSpeaking();
  out.replaceChildren();
  if (shownUrl) out.append(h("p", { class: "checked-url" }, "Checked ", h("code", {}, shownUrl)));
  if (c.kind === "page") {
    out.append(verdict(c.result, "page"), ...renderBrief(c.result, c.title, c.titleFrom));
  } else {
    const usable = c.items.filter((i) => i.result.brief).length;
    const broken = c.items.filter((i) => !i.result.brief && !hasNoTags(i.result)).length;
    const cls = broken > 0 ? "verdict-bad" : usable > 0 ? "verdict-ok" : "verdict-none";
    const text =
      c.items.length === 0
        ? "This feed has no items."
        : `A feed with ${c.items.length} item${c.items.length === 1 ? "" : "s"}: ${usable} with usable tags, ${c.items.length - usable - broken} with none${broken > 0 ? `, ${broken} with tags a reader cannot use` : ""}.`;
    out.append(h("p", { class: `verdict ${cls}` }, text));
    c.items.forEach((item, i) => {
      const state = item.result.brief ? "usable" : hasNoTags(item.result) ? "no tags" : "not usable";
      const details = h("details", { class: "feed-item" }, h("summary", {}, h("span", { class: "feed-item-title" }, item.title ?? item.link ?? `Item ${i + 1}`), h("span", { class: `note state-${state.replace(/\s/gu, "-")}` }, ` ${state}`)));
      if (!hasNoTags(item.result)) details.append(...renderBrief(item.result, item.result.brief?.title ?? item.title, item.result.brief?.title ? "obs:title" : "the item's title"));
      if (c.items.length === 1 || (i === 0 && item.result.brief)) details.open = true;
      out.append(details);
    });
  }
  out.focus({ preventScroll: true });
  out.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function problem(message: string, offerPaste = true): void {
  stopSpeaking();
  out.replaceChildren(h("p", { class: "verdict verdict-bad" }, message));
  if (offerPaste) out.append(h("p", { class: "note" }, "You can also paste the page's source below. Pasted text is checked in your browser and goes nowhere."));
}

async function run(): Promise<void> {
  const source = sourceInput.value.trim();
  const address = urlInput.value.trim();
  if (source !== "" && address === "") {
    const given = pasteUrlInput.value.trim();
    const pageUrl = given !== "" && guardUrl(given).ok ? given : "https://localhost/";
    render(check(source, pageUrl), undefined);
    status.textContent = "Checked the pasted source.";
    return;
  }
  if (address === "") {
    problem("Enter a page's address, or paste its source.", false);
    urlInput.focus();
    return;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/iu.test(address) ? address : `https://${address}`;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(withScheme).origin === window.location.origin;
  } catch {
    /* guardUrl reports it */
  }
  if (!sameOrigin) {
    const guard = guardUrl(withScheme);
    if (!guard.ok) return problem(guard.reason);
  }
  runButton.disabled = true;
  status.textContent = "Reading the page…";
  const page = await fetchPage(withScheme);
  runButton.disabled = false;
  if ("error" in page) {
    status.textContent = "";
    return problem(page.error);
  }
  const params = new URLSearchParams(window.location.search);
  params.set("url", withScheme);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  render(check(page.text, page.url, page.contentType), page.url);
  status.textContent = "Checked.";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void run();
});

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-example]"))) {
  button.addEventListener("click", () => {
    sourceInput.value = "";
    urlInput.value = new URL(button.dataset.example!, window.location.origin).href;
    void run();
  });
}

window.addEventListener("pagehide", stopSpeaking);

const preset = new URLSearchParams(window.location.search).get("url");
if (preset) {
  urlInput.value = preset;
  void run();
}
