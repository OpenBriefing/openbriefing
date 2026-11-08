# openbriefing

This package is the reference parser and checker for the [Open Briefing Standard (OBS)](https://openbriefingstandard.org). OBS is how a publisher says how their content should be summarized and presented when software consumes it.

**Version 0.1.** It contains the parser and `openbriefing check`. Later versions add `generate`, `preview`, `backfill`, `review` and a Ghost integration.

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
```

| Export | What it does |
|--------|--------------|
| `parseObs(document, pageUrl)` | Reads a page's `obs:` meta tags |
| `parseFeedObs(itemElement, itemUrl?)` | Reads one RSS `<item>` or Atom `<entry>` |
| `validateObs(object)` | Checks an object already in the `ObsBrief` shape |
| `mergeObs(page, feed)` | Applies the feed-against-page rule: the later `obs:modified` stands, and the page wins a tie |
| `tierFor(words)`, `SIZES`, `normalizeUrl` | Helpers that use the spec's numbers |

The parser has no runtime dependencies. It takes any DOM `Document` (jsdom, linkedom, or a browser's `DOMParser`), makes no network requests, and never throws.

The test fixtures ship with the package in `openbriefing/fixtures/`, with `expected.json`.

MIT licence. The spec is dedicated to the public domain (CC0).
