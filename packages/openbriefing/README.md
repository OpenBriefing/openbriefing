# openbriefing

This package is the reference parser and checker for the [Open Briefing Standard (OBS)](https://openbriefingstandard.org). OBS is how a publisher says how their content should be summarized and presented when software consumes it.

**Version 0.2.** It contains the parser and `openbriefing check`, and reads spec version 1.1, which adds `obs:highlight`: passages the publisher marks, word for word from the content, for quoting on their own with credit. `check` lists each highlight with its word count and label, and warns when one is not found in the page's text. Later versions add `generate`, `preview`, `backfill`, `review` and a Ghost integration.

## Check a page or a feed

```bash
npx openbriefing check ./post.html
npx openbriefing check ./feed.xml
curl -s https://example.com/post/ | npx openbriefing check - --url https://example.com/post/
```

`check` exits 1 when the tags are unusable, so a site's CI can gate on it. Add `--json` to get the parsed result as JSON.

## Use the parser

```ts
import { JSDOM } from "jsdom";
import { parseObs } from "openbriefing";

const dom = new JSDOM(html, { url });
const { brief, errors, warnings } = parseObs(dom.window.document, url);
// brief.summaries, brief.keep, brief.highlights (each { text, words, label?, inContent? }), …
```

| Export | What it does |
|--------|--------------|
| `parseObs(document, pageUrl)` | Reads a page's `obs:` meta tags |
| `parseFeedObs(itemElement, itemUrl?)` | Reads one RSS `<item>` or Atom `<entry>` |
| `validateObs(object)` | Checks an object already in the `ObsBrief` shape |
| `mergeObs(page, feed)` | Applies the feed-against-page rule: the later `obs:modified` stands, and the page wins a tie |
| `tierFor(words)`, `SIZES`, `normalizeUrl`, `looseText` | Helpers that use the spec's numbers and its loose text comparison |

The parser has no runtime dependencies. It takes any DOM `Document` (jsdom, linkedom, or a browser's `DOMParser`), makes no network requests, and never throws.

The test fixtures ship with the package in `openbriefing/fixtures/`, with `expected.json`.

MIT licence. The spec is dedicated to the public domain (CC0).
