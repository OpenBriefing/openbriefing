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

## Write your tags

A briefing file is a few lines of YAML that you, or your assistant, write for a post. `tags` turns it into escaped tags.

```yaml
url: https://example.com/a-post/
headline: One or two lines to hear before going further.
summary: |
  Your summary, in plain text. Around 200 to 350 words.

  A blank line is a paragraph break.
keep:
  - The one sentence every version must get across.
highlights:
  - text: A passage from the post, word for word.
    label: On control
attribution: From Example Blog
status: approved
```

```sh
npx openbriefing tags a-post.yaml                 # meta tags for the page's head
npx openbriefing tags a-post.yaml --format feed   # elements for an RSS item or Atom entry
npx openbriefing tags content/a-post.md           # the same keys under obs: in a post's front matter
```

A file whose `status` is not `approved` is refused (exit 1) unless you pass `--allow-draft`, so a build cannot publish a draft by accident. A drafting prompt for your assistant, and a builder that does the same in the browser, are at [openbriefingstandard.org/publish](https://openbriefingstandard.org/publish).

### Ghost

```sh
export GHOST_URL=https://your-site.example
export GHOST_ADMIN_API_KEY=…   # Ghost Admin → Integrations → add a custom integration

npx openbriefing ghost pull posts/             # one file per published post, with its text
npx openbriefing ghost push posts/ --dry-run   # say what would be written
npx openbriefing ghost push posts/             # write the approved ones
```

`pull` never changes Ghost and never overwrites a file. `push` writes only approved files, only between `<!-- obs:start -->` and `<!-- obs:end -->` in the post's Code injection header, and skips a post whose tags have not changed. The folder holds your posts: keep it out of public repositories.

To have the tags written when a post is published, run the hook where Ghost can reach it:

```bash
export GHOST_WEBHOOK_SECRET=…                   # any long random text
export ANTHROPIC_API_KEY=…
export OBS_HOOK_URL=https://your-hook.example   # registers the two webhooks on start
npx openbriefing ghost hook                     # POST /ghost, GET /healthz, on PORT or 8080
npx openbriefing ghost draft --dry-run          # the same for posts already published
```

The hook drafts with Claude (`OBS_MODEL` picks the model), keeps only highlights it finds in the post, and stamps its block `<!-- obs:auto … -->`. Edit the tags in the post's Code injection and they are yours: the hook never writes to that post again. It leaves members-only posts and posts under 200 words alone. These tags are published before you read them; use `pull` and `push` if you would rather approve each one.

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
