# Open Briefing Standard (OBS)

The Open Briefing Standard lets a publisher state how their content should be presented when software, rather than a person, consumes it: when it is summarized, read aloud, excerpted, shown as a card or used to answer a question.

The publisher's summary is the anchor. A tool that honours OBS uses the publisher's words as written where they fit. Any other form it needs, such as a card title, a one-line teaser or a translation, it derives from that summary within the limits the publisher sets, never from its own reading of the content. OBS is a format, in the spirit of OpenGraph. It states the publisher's intent and does not enforce it.

Adopting it takes two tags:

```html
<meta property="obs:summary" content="The publisher's own summary, in plain text.">
<meta property="obs:modified" content="2026-11-08T14:00:00Z">
```

## Status

Draft. Read the draft spec: [spec/v1.md](spec/v1.md). Test fixtures are in [spec/fixtures](spec/fixtures), and the reference parser and checker are in [packages/openbriefing](packages/openbriefing):

```bash
npx openbriefing check ./post.html
```

The spec is dedicated to the public domain ([CC0 1.0](LICENSE-SPEC)). The code is [MIT](LICENSE). Version 1 of the spec, its test fixtures, a reference parser and the `openbriefing` tools (`check`, `generate`, `preview`, `backfill`, `review` and a Ghost integration) are being prepared and will be published here.

Website: [openbriefingstandard.org](https://openbriefingstandard.org) (coming soon).

## Examples

Three synthetic pages carrying the tags, for hearing a consumer against a real page, are published at <https://openbriefing.github.io/openbriefing/examples/>: a full set of forms, one summary that shorter forms may be cut from, and one marked verbatim. `node scripts/make-examples.mjs` rewrites them.
