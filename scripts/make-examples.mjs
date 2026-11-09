// Writes examples/*.html: three synthetic articles with Open Briefing tags,
// published on GitHub Pages so a consumer (ikku first) can be heard against a
// real page. Deterministic: run it again and nothing changes. All text is
// invented. Usage: node scripts/make-examples.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
mkdirSync(out, { recursive: true });
const BASE = "https://openbriefing.github.io/openbriefing/examples";
const MOD = "2026-11-08T22:00:00Z";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const meta = (k, v) => `  <meta property="${k}" content="${esc(v)}">`;
const words = (s) => s.trim().split(/\s+/).length;

// The article: what a reader of the page sees, and what a tool would
// summarize if the page carried no tags.
const ARTICLE = [
  "After eighteen months behind scaffolding, the Millbrook Public Library opened its doors again on Saturday morning, and the line of residents waiting outside stretched past the bakery on Elm Street by nine o'clock.",
  "The renovation, which cost the town just under four million dollars, replaced the leaking roof, rebuilt the children's wing, and turned the old periodicals room into what the library calls a listening room: a quiet space with armchairs, headphones and a collection of more than two thousand audiobooks.",
  "Head librarian Dana Okafor said the listening room was the part she was proudest of. Half the people who come in here are reading with their ears now, she said. Commuters, people with low vision, parents who only get to finish a book while they fold laundry. We wanted a room that took that seriously.",
  "The children's wing doubled in size. It now has a reading loft built into the old bell tower, a craft table that seats twenty, and a corner of picture books in eleven languages, chosen with families from the town's newer neighborhoods.",
  "Not everything is finished. The elevator to the second floor will not be inspected until December, so the local history collection is being brought downstairs on request. The café that was promised in the original plans was cut when costs rose, and the space is a seating area for now.",
  "The library also changed its hours. It now opens at eight on weekdays, an hour earlier than before, and stays open until nine on Thursdays. Late fees on children's books have been dropped for good, a change the town council approved in the spring.",
  "Residents seemed pleased. Retired teacher Walter Brandt, who said he had visited the library every week for forty years, called the new reading room the best thing the town had built since the bridge. A nine-year-old named Priya said the loft was the best part, because you can see the whole street from up there.",
  "The library will hold an open house next Saturday with tours every hour, and the listening room will run a free workshop on borrowing audiobooks through the library's app.",
].join("\n\n");

const TITLE = "Millbrook Library reopens with a room for listening";
const HEADLINE = "The Millbrook Public Library reopened after eighteen months of work, with a new listening room, a bigger children's wing and earlier hours.";
const SHORT = "The Millbrook Public Library reopened on Saturday after an eighteen-month renovation that cost just under four million dollars. Its centerpiece is a new listening room with two thousand audiobooks. The children's wing has doubled, the library now opens at eight on weekdays, and late fees on children's books are gone for good.";
const MEDIUM = [
  "The Millbrook Public Library reopened on Saturday after eighteen months of renovation, and residents lined up down Elm Street before the doors opened.",
  "The work cost the town just under four million dollars. It fixed the leaking roof, rebuilt the children's wing, and turned the old periodicals room into a listening room, with armchairs, headphones and more than two thousand audiobooks. Head librarian Dana Okafor said it was the part she was proudest of, because half of the library's visitors now read with their ears.",
  "The children's wing is twice its old size, with a reading loft in the bell tower, a craft table for twenty, and picture books in eleven languages chosen with families from the town's newer neighborhoods.",
  "Two things are not done. The elevator will not be inspected until December, so the local history collection is brought downstairs on request, and the café in the original plans was cut when costs rose.",
  "The library now opens at eight on weekdays and stays open until nine on Thursdays, and late fees on children's books have been dropped for good. Residents seemed pleased: a retired teacher who has visited every week for forty years called the reading room the best thing the town had built since the bridge. An open house with hourly tours is next Saturday, with a free workshop on borrowing audiobooks through the library's app.",
].join("\n\n");
const KEEP = [
  "The library reopened with a new listening room of more than two thousand audiobooks.",
  "Late fees on children's books have been dropped for good.",
  "The elevator will not be inspected until December.",
];
const ATTRIBUTION = "From the Millbrook Courier";
// Highlights: sentences of the article, word for word (spec §7).
const HIGHLIGHTS = [
  ["Half the people who come in here are reading with their ears now, she said.", "On listening"],
  ["Late fees on children's books have been dropped for good, a change the town council approved in the spring."],
  ["Retired teacher Walter Brandt, who said he had visited the library every week for forty years, called the new reading room the best thing the town had built since the bridge."],
];
const highlight = ([text, label]) => (label ? [meta("obs:highlight", text), meta("obs:highlight:label", label)] : [meta("obs:highlight", text)]);

function page(name, heading, note, tags) {
  const url = `${BASE}/${name}.html`;
  const body = ARTICLE.split("\n\n").map((p) => `    <p>${esc(p)}</p>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head prefix="obs: https://openbriefingstandard.org/ns#">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(TITLE)} | Millbrook Courier (example)</title>
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="${esc(TITLE)}">
  <meta property="og:site_name" content="Millbrook Courier (Open Briefing example)">
${tags.join("\n")}
  <style>body{font:18px/1.6 Georgia,serif;max-width:40em;margin:2em auto;padding:0 1em;color:#222}aside{font:14px/1.5 system-ui,sans-serif;background:#f4f1ea;padding:.75em 1em;border-radius:6px}</style>
</head>
<body>
  <aside>An <a href="https://github.com/OpenBriefing/openbriefing">Open Briefing Standard</a> example page. ${esc(note)} Everything here is invented.</aside>
  <article>
    <h1>${esc(heading)}</h1>
    <p><em>By the Courier staff · November 8, 2026</em></p>
${body}
  </article>
</body>
</html>
`;
  writeFileSync(join(out, `${name}.html`), html);
  return { name, url, note };
}

const common = [meta("obs:modified", MOD), meta("obs:title", TITLE), meta("obs:attribution", ATTRIBUTION)];

const pages = [
  page("full-set", TITLE, "It carries a headline, a short and a medium summary, three keep lines, three highlights (one with a label) and an attribution, so every length is the author's own words.", [
    ...common,
    meta("obs:headline", HEADLINE),
    meta("obs:summary:short", SHORT),
    meta("obs:summary:medium", MEDIUM),
    ...KEEP.map((k) => meta("obs:keep", k)),
    ...HIGHLIGHTS.flatMap(highlight),
  ]),
  page("one-summary", TITLE, "It carries one summary, two keep lines and one highlight. A tool may cut shorter forms from that summary, but not write longer ones.", [
    ...common,
    meta("obs:summary", MEDIUM),
    ...KEEP.slice(0, 2).map((k) => meta("obs:keep", k)),
    ...highlight(HIGHLIGHTS[0]),
  ]),
  page("verbatim", TITLE, "It carries one summary marked verbatim and no highlights: a tool may play the summary as written or not at all, and may make no other form from it. Verbatim does not create highlights.", [
    ...common,
    meta("obs:summary", MEDIUM),
    meta("obs:derive", "verbatim"),
  ]),
];

const list = pages.map((p) => `    <li><a href="${p.name}.html">${p.name}</a>: ${esc(p.note)}</li>`).join("\n");
writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Briefing examples</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:40em;margin:2em auto;padding:0 1em}</style></head>
<body><h1>Open Briefing examples</h1>
<p>Synthetic pages carrying Open Briefing Standard tags, for hearing and checking a consumer against a real page.</p>
<ul>
${list}
</ul></body></html>
`);
console.log(`examples: ${pages.length} pages · short ${words(SHORT)} words · medium ${words(MEDIUM)} words · headline ${words(HEADLINE)} words · article ${words(ARTICLE)} words`);
