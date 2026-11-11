// The tag builder page. The file is read in the browser as it is typed;
// nothing is sent anywhere unless the writer asks for the post to be fetched.
import { approve, build, EXAMPLE, OUTPUTS, type Built, type OutputKind } from "../lib/builder-core";
import { copyButton, fetchPage, h, messageItem, renderBrief, stopSpeaking } from "./brief-view";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLTextAreaElement>("build-file");
const postInput = $<HTMLTextAreaElement>("build-post");
const out = $<HTMLDivElement>("build-result");
const status = $<HTMLParagraphElement>("build-status");
const output = $<HTMLElement>("build-output");
const draftNote = $<HTMLParagraphElement>("build-draft");
const tabs = output.querySelector<HTMLDivElement>(".tabs")!;
const code = $<HTMLElement>("build-code");
const note = $<HTMLParagraphElement>("build-note");
const SAVED = "obs-build-tab";

let current: Built | undefined;
let kind: OutputKind = "html";
try {
  const saved = window.localStorage.getItem(SAVED);
  if (OUTPUTS.some((o) => o.kind === saved)) kind = saved as OutputKind;
} catch {
  /* the tab is a convenience */
}

const buttons = OUTPUTS.map((o) => {
  const b = h("button", { type: "button", role: "tab", id: `tab-${o.kind}`, "aria-controls": "build-panel" }, o.label);
  b.addEventListener("click", () => select(o.kind));
  b.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const i = OUTPUTS.findIndex((x) => x.kind === kind);
    const next = OUTPUTS[(i + (event.key === "ArrowRight" ? 1 : OUTPUTS.length - 1)) % OUTPUTS.length]!;
    select(next.kind);
    document.getElementById(`tab-${next.kind}`)?.focus();
  });
  tabs.append(b);
  return b;
});
$("build-copy").append(copyButton("Copy", () => current?.outputs?.[kind] ?? ""));

function select(next: OutputKind): void {
  kind = next;
  try {
    window.localStorage.setItem(SAVED, kind);
  } catch {
    /* fine without it */
  }
  showOutput();
}

function showOutput(): void {
  OUTPUTS.forEach((o, i) => {
    buttons[i]!.setAttribute("aria-selected", String(o.kind === kind));
    buttons[i]!.tabIndex = o.kind === kind ? 0 : -1;
  });
  $("build-panel").setAttribute("aria-labelledby", `tab-${kind}`);
  note.textContent = OUTPUTS.find((o) => o.kind === kind)!.note;
  code.textContent = current?.outputs?.[kind] ?? "";
}

function render(): void {
  stopSpeaking();
  const file = fileInput.value;
  if (file.trim() === "") {
    current = undefined;
    out.replaceChildren();
    output.hidden = true;
    status.textContent = "";
    return;
  }
  current = build(file, postInput.value);
  const b = current.briefing;
  const result = { errors: b.errors, warnings: b.warnings, ...(b.brief ? { brief: b.brief } : {}) };
  out.replaceChildren();
  if (!b.brief) {
    out.append(h("p", { class: "verdict verdict-bad" }, "Not usable yet."), h("ul", { class: "messages" }, ...b.errors.map((e) => messageItem("error", e)), ...b.warnings.map((w) => messageItem("warning", w))));
    output.hidden = true;
    status.textContent = "Not usable yet.";
    return;
  }
  const n = b.warnings.length;
  const line = n === 0 ? "Usable. Nothing to fix." : `Usable, with ${n} thing${n === 1 ? "" : "s"} to look at.`;
  out.append(
    h("p", { class: "verdict verdict-ok" }, line),
    h("p", { class: "state" }, b.status === "approved" ? "Marked approved." : "A draft, until its status line says approved."),
    ...renderBrief(result, b.brief.title, "obs:title", { tags: false, source: "post" }),
  );
  output.hidden = false;
  draftNote.hidden = b.status === "approved";
  showOutput();
  status.textContent = line;
}

let timer: number | undefined;
const soon = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(render, 250);
};
fileInput.addEventListener("input", soon);
postInput.addEventListener("input", soon);

$("build-example").addEventListener("click", () => {
  if (fileInput.value.trim() !== "" && !window.confirm("Replace what is in the box with the example?")) return;
  fileInput.value = EXAMPLE;
  render();
  fileInput.focus();
});

$("build-approve").addEventListener("click", () => {
  fileInput.value = approve(fileInput.value);
  render();
});

const fetchButton = $<HTMLButtonElement>("build-fetch");
fetchButton.addEventListener("click", async () => {
  const address = current?.briefing.brief?.url;
  if (!address) {
    status.textContent = "";
    window.alert("Add the post's address to the file first, as a line starting url:");
    return;
  }
  fetchButton.disabled = true;
  status.textContent = "Reading the post…";
  const page = await fetchPage(address);
  fetchButton.disabled = false;
  if ("error" in page) {
    status.textContent = page.error;
    window.alert(page.error);
    return;
  }
  const doc = new DOMParser().parseFromString(page.text, "text/html");
  for (const el of Array.from(doc.querySelectorAll("script, style, noscript, template"))) el.remove();
  postInput.value = (doc.body?.textContent ?? "").replace(/[ \t]*\n\s*/gu, "\n").trim();
  render();
});

window.addEventListener("pagehide", stopSpeaking);
if (fileInput.value.trim() !== "") render();
