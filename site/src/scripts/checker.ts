// The checker page. Everything a page or feed gives us is untrusted, so it only
// ever reaches the document as text (textContent), never as markup.
import { guardUrl } from "../../../worker/fetch/src/guard";
import {
  check,
  DERIVE_WORDS,
  fingerprint,
  hasNoTags,
  listenText,
  MODIFIED_WORDS,
  SECTION_ANCHOR,
  SIZES,
  sizeNote,
  splitSection,
  tagsFor,
  TIER_NAME,
  countWords,
  type Check,
  type ObsBrief,
  type ParseResult,
} from "../lib/checker-core";

const ENDPOINT: string = (import.meta.env.PUBLIC_FETCH_ENDPOINT as string | undefined) ?? "https://fetch.openbriefingstandard.org/";

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("check-form");
const urlInput = $<HTMLInputElement>("check-url");
const sourceInput = $<HTMLTextAreaElement>("check-source");
const pasteUrlInput = $<HTMLInputElement>("check-source-url");
const out = $<HTMLDivElement>("check-result");
const status = $<HTMLParagraphElement>("check-status");
const runButton = $<HTMLButtonElement>("check-run");

let speaking: HTMLButtonElement | undefined;

function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (speaking) {
    speaking.textContent = "Listen";
    speaking.setAttribute("aria-pressed", "false");
    speaking = undefined;
  }
}

function listenButton(brief: ObsBrief): HTMLElement | null {
  if (!("speechSynthesis" in window)) return null;
  const button = h("button", { type: "button", class: "quiet listen", "aria-pressed": "false" }, "Listen");
  button.addEventListener("click", () => {
    if (speaking === button) return stopSpeaking();
    stopSpeaking();
    const { credit, summary } = listenText(brief);
    const say = new SpeechSynthesisUtterance(`${credit} ${summary}`);
    if (brief.lang) say.lang = brief.lang;
    say.rate = 1;
    say.onend = say.onerror = () => {
      if (speaking === button) stopSpeaking();
    };
    speaking = button;
    button.textContent = "Stop";
    button.setAttribute("aria-pressed", "true");
    window.speechSynthesis.speak(say);
  });
  return button;
}

function messageItem(kind: "error" | "warning", message: string): HTMLElement {
  const { text, section } = splitSection(message);
  const anchor = section ? SECTION_ANCHOR[section] : undefined;
  return h(
    "li",
    { class: `msg msg-${kind}` },
    h("span", { class: "msg-kind" }, kind === "error" ? "Problem" : "Look at"),
    h("span", {}, text, anchor ? " " : null, anchor ? h("a", { href: `/spec/v1#${anchor}` }, `Spec section ${section}`) : null),
  );
}

function row(label: string, ...value: Child[]): HTMLElement {
  return h("tr", {}, h("th", { scope: "row" }, label), h("td", {}, ...value));
}

function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "result-section" }, h("h3", {}, title), ...children);
}

function verdict(r: ParseResult, what: "page" | "item"): HTMLElement {
  if (r.brief) {
    const n = r.warnings.length;
    return h("p", { class: "verdict verdict-ok" }, n === 0 ? "Usable. Nothing to fix." : `Usable, with ${n} thing${n === 1 ? "" : "s"} to look at.`);
  }
  if (hasNoTags(r)) {
    return h(
      "p",
      { class: "verdict verdict-none" },
      what === "page" ? "This page has no obs: tags yet. " : "This item has no obs: tags. ",
      what === "page" ? h("a", { href: "/#start" }, "Start with one tag.") : null,
    );
  }
  return h("p", { class: "verdict verdict-bad" }, "The tags are here, but a reader cannot use them.");
}

function renderBrief(r: ParseResult, title: string | undefined, titleFrom: string | undefined): HTMLElement[] {
  const b = r.brief;
  const parts: HTMLElement[] = [];
  const messages = [...r.errors.filter((e) => !hasNoTags(r) || e !== r.errors[0]).map((e) => messageItem("error", e)), ...r.warnings.map((w) => messageItem("warning", w))];
  if (messages.length > 0) parts.push(h("ul", { class: "messages" }, ...messages));
  if (!b) return parts;

  // The card a tool would show.
  const lead = b.summaries.find((s) => s.tier === "short") ?? b.summaries[0]!;
  const credit = b.attribution ? `${b.attribution.replace(/[.\s]+$/u, "")}, in the author's words` : "In the author's words";
  const card = h(
    "article",
    { class: "brief-card" },
    title ? h("p", { class: "card-title" }, title) : null,
    b.headline ? h("p", { class: "card-headline" }, b.headline) : null,
    h("p", { class: "card-summary" }, lead.words > 90 ? `${lead.text.split(/\s+/u).slice(0, 70).join(" ")} …` : lead.text),
    b.highlights[0] ? h("blockquote", { class: "card-quote" }, h("span", { class: "marked" }, b.highlights[0].text)) : null,
    h("p", { class: "card-credit" }, h("span", {}, credit), listenButton(b)),
  );
  const cardNotes: string[] = [];
  if (title && titleFrom && titleFrom !== "obs:title") cardNotes.push(`The title comes from the page's ${titleFrom}, because there is no obs:title.`);
  if (!b.headline) cardNotes.push("There is no obs:headline, so a tool would write its own line or go without.");
  if (!b.attribution) cardNotes.push("There is no obs:attribution, so a tool credits you however it normally does.");
  if (lead.words > 90) cardNotes.push("The summary is cut here to fit a card. A tool shows or reads the whole of it.");
  parts.push(
    section(
      "What a reader's tool can show",
      card,
      "speechSynthesis" in window ? h("p", { class: "note" }, "Listen reads the credit and the summary in your browser's own voice. It is a rough guide to how the words sound aloud, not a briefing voice.") : null,
      ...cardNotes.map((n) => h("p", { class: "note" }, n)),
    ),
  );

  // Summaries
  parts.push(
    section(
      "Summaries",
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h("tbody", {}, ...b.summaries.map((s) => {
            const note = sizeNote(s);
            return row(
              TIER_NAME[s.tier],
              h("span", { class: `size size-${note.state}` }, note.text),
              h("span", { class: "note" }, s.from === "tiered" ? ` Written for this size (obs:summary:${s.tier}).` : " From obs:summary; its size comes from its length."),
            );
          })),
        ),
      ),
      ...b.summaries.map((s) => h("details", { class: "fulltext" }, h("summary", {}, `Read the ${s.tier} summary`), h("p", { class: "summary-text" }, s.text))),
    ),
  );

  if (b.keep.length > 0) {
    parts.push(
      section(
        "Lines every version should keep",
        h("ol", { class: "keeps" }, ...b.keep.map((k, i) => h("li", {}, h("span", { class: "keep-line" }, k), i === 0 ? h("span", { class: "note" }, " The core message.") : null))),
      ),
    );
  }

  if (b.highlights.length > 0) {
    parts.push(
      section(
        "Passages that may be quoted",
        h(
          "ul",
          { class: "highlights" },
          ...b.highlights.map((x) =>
            h(
              "li",
              {},
              h("span", { class: "marked" }, x.text),
              h(
                "span",
                { class: "note" },
                ` ${x.words} of ${SIZES.highlight} words`,
                x.label ? `, labelled "${x.label}"` : "",
                x.inContent === true ? ". Found in the page's text." : x.inContent === false ? ". " : ".",
                x.inContent === false ? h("strong", { class: "size-over" }, "Not found in the page's text.") : null,
              ),
            ),
          ),
        ),
      ),
    );
  }

  const modified = b.modified === undefined ? "None. A reader tells a change by comparing the text of the tags." : `${b.modified}, ${MODIFIED_WORDS[b.modifiedFrom]}`;
  parts.push(
    section(
      "What you allow, and the details",
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h(
            "tbody",
            {},
            row("Making other versions", h("code", {}, b.derive.mode), ` ${DERIVE_WORDS[b.derive.mode]}`),
            row("Translating", b.derive.translate ? "Allowed" : "Not allowed"),
            row("Combining with other sources", b.derive.combine ? "Allowed" : "Not allowed"),
            row("You would rather a tool present", b.preference === "full" ? "The whole piece" : "The summary"),
            b.title ? row("Title", `${b.title} (${countWords(b.title)} of ${SIZES.title} words)`) : null,
            b.headline ? row("Headline", `${countWords(b.headline)} of ${SIZES.headline} words`) : null,
            b.lang ? row("Language", b.lang) : null,
            row("Last changed", modified),
            b.url ? row("Describes", b.url, b.describesThisPage ? "" : " (another page, named by obs:url)") : null,
            row("Fingerprint", h("code", {}, fingerprint(b)), " Changes when any of the words or settings change."),
          ),
        ),
      ),
    ),
  );

  const tags = tagsFor(b);
  const copy = h("button", { type: "button", class: "quiet" }, "Copy the tags");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(tags);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the text and copy it";
    }
    setTimeout(() => (copy.textContent = "Copy the tags"), 2500);
  });
  parts.push(section("Your tags, tidied", h("p", { class: "note" }, "The same tags written out with every character escaped as HTML needs. Paste them into the page's head."), h("pre", {}, h("code", {}, tags)), h("p", {}, copy)));
  return parts;
}

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

async function fetchPage(address: string): Promise<{ url: string; contentType: string; text: string } | { error: string }> {
  const target = new URL(address);
  try {
    if (target.origin === window.location.origin) {
      // This site's own pages (the examples) need no helper.
      const res = await fetch(target.href, { headers: { accept: "text/html,application/xml" } });
      if (!res.ok) return { error: `The page answered ${res.status}.` };
      return { url: target.href, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
    }
    const res = await fetch(`${ENDPOINT}?url=${encodeURIComponent(target.href)}`);
    const body = (await res.json()) as { ok: boolean; error?: string; url?: string; contentType?: string; text?: string };
    if (!body.ok || body.text === undefined) return { error: body.error ?? "The page could not be fetched." };
    return { url: body.url ?? target.href, contentType: body.contentType ?? "", text: body.text };
  } catch {
    return { error: "The fetch helper could not be reached, so this page cannot be read from here right now." };
  }
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
