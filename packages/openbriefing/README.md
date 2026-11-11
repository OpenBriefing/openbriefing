# openbriefing

This package is the reference parser and checker for the [Open Briefing Standard (OBS)](https://openbriefingstandard.org). OBS is how a publisher says how their content should be summarized and presented when software consumes it.

**Version 0.3.** It contains the parser and `openbriefing check`, and reads spec version 1 (release candidate). One tag, `obs:summary`, is enough: `obs:modified` is optional, and the parser reports where a modified time came from. `check` reads a page, a feed or a whole sitemap from the web.

## Check a page, a feed or a site

```bash
npx openbriefing check https://example.com/a-post/
npx openbriefing check ./post.html
npx openbriefing check https://example.com/rss/ --feed --pages
npx openbriefing check https://example.com/sitemap.xml --sitemap
```

- **A page:** prints each form with its word count, the keep lines, the highlights (and whether each is in the page's text), the modified time and its source, and a fingerprint.
- **`--feed`:** checks every item. With `--pages` it also fetches each item's page and says which of the two stands.
- **`--sitemap`:** one line per page (`ok`, `ok, 2 warnings`, `no tags`, `not usable`) and a total. `--limit 20` checks the first 20.

`check` exits 1 when tags are present but unusable, so a site's CI can gate on it. A page with no tags is not an error in a sitemap. Add `--json` for the parsed result. For a file with no canonical link, `--url` gives the page's address; `-` reads standard input.

Fetching is bounded: `http` and `https` only, 10 seconds, 5 MB, 5 redirects, and it names itself `openbriefing-check/<version>`.

## Use the parser

```ts
import { JSDOM } from "jsdom";
import { parseObs } from "openbriefing";

const dom = new JSDOM(html, { url });
const { brief, errors, warnings } = parseObs(dom.window.document, url);
// brief.summaries, brief.keep, brief.highlights (each { text, words, label?, inContent? }),
// brief.modified (optional) and brief.modifiedFrom ("obs" | "article" | "feed" | "none"), …
```

| Export | What it does |
|--------|--------------|
| `parseObs(document, pageUrl)` | Reads a page's `obs:` meta tags |
| `parseFeedObs(itemElement, itemUrl?)` | Reads one RSS `<item>` or Atom `<entry>` |
| `validateObs(object)` | Checks an object already in the `ObsBrief` shape |
| `mergeObs(page, feed)` | Applies the feed-against-page rule: the later effective modified time stands; the page wins a tie, and when either has no time |
| `fingerprint(brief)` | A stable 16-character hash of every text value and setting. Compare two to tell whether a brief changed, with or without a modified time |
| `tierFor(words)`, `SIZES`, `normalizeUrl`, `looseText` | Helpers that use the spec's numbers and its loose text comparison |

The parser has no runtime dependencies. It takes any DOM `Document` (jsdom, linkedom, or a browser's `DOMParser`), makes no network requests, and never throws. The bounded fetch that `check` uses is exported separately as `openbriefing/fetch`.

The test fixtures ship with the package in `openbriefing/fixtures/`, with `expected.json`.

MIT licence. The spec is dedicated to the public domain (CC0).
