// What a brief looks like on the page: the card, the tables, the messages.
// Shared by the checker and the tag builder. Everything a page or a file gives
// us is untrusted, so it only ever reaches the document as text (textContent),
// never as markup.
import {
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
  type ObsBrief,
  type ParseResult,
} from "../lib/checker-core";

const ENDPOINT: string = (import.meta.env.PUBLIC_FETCH_ENDPOINT as string | undefined) ?? "https://fetch.openbriefingstandard.org/";

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}


/** A button that copies what `text()` returns, and says so. */
export function copyButton(label: string, text: () => string): HTMLButtonElement {
  const button = h("button", { type: "button", class: "quiet" }, label);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select the text and copy it";
    }
    setTimeout(() => (button.textContent = label), 2500);
  });
  return button;
}

let speaking: HTMLButtonElement | undefined;

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (speaking) {
    speaking.textContent = "Listen";
    speaking.setAttribute("aria-pressed", "false");
    speaking = undefined;
  }
}

export function listenButton(brief: ObsBrief): HTMLElement | null {
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

export function messageItem(kind: "error" | "warning", message: string): HTMLElement {
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

export function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "result-section" }, h("h3", {}, title), ...children);
}

export function verdict(r: ParseResult, what: "page" | "item"): HTMLElement {
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

export function renderBrief(r: ParseResult, title: string | undefined, titleFrom: string | undefined, options: { tags?: boolean; source?: "page" | "post" } = {}): HTMLElement[] {
  const b = r.brief;
  const where = options.source ?? "page";
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
                x.inContent === true ? `. Found in the ${where}'s text.` : x.inContent === false ? ". " : ".",
                x.inContent === false ? h("strong", { class: "size-over" }, `Not found in the ${where}'s text.`) : null,
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

  if (options.tags !== false) {
    const tags = tagsFor(b);
    parts.push(section("Your tags, tidied", h("p", { class: "note" }, "The same tags written out with every character escaped as HTML needs. Paste them into the page's head."), h("pre", {}, h("code", {}, tags)), h("p", {}, copyButton("Copy the tags", () => tags))));
  }
  return parts;
}

export async function fetchPage(address: string): Promise<{ url: string; contentType: string; text: string } | { error: string }> {
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

