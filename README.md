# Open Briefing Standard (OBS)

The Open Briefing Standard lets a publisher state how their content should be presented when software, rather than a person, consumes it: when it is summarized, read aloud, excerpted, shown as a card or used to answer a question.

The publisher's summary is the anchor. A tool that honours OBS uses the publisher's words as written where they fit. Any other form it needs, such as a card title, a one-line teaser or a translation, it derives from that summary within the limits the publisher sets, never from its own reading of the content. OBS is a format, in the spirit of OpenGraph. It states the publisher's intent and does not enforce it.

Adopting it takes one tag:

```html
<meta property="obs:summary" content="The publisher's own summary, in plain text.">
```

A publisher can also mark passages of the content that may be quoted on their own, with credit:

```html
<meta property="obs:highlight" content="A line from the content, word for word.">
```

## Status

Version 1, release candidate. The tag names are frozen when version 1 is final. Read the spec: [spec/v1.md](spec/v1.md). The [changelog](CHANGELOG.md) records what changed, and [GOVERNANCE.md](GOVERNANCE.md) says how the standard is run and what will never change.

## Check your page

```bash
npx openbriefing check https://example.com/a-post/
npx openbriefing check https://example.com/sitemap.xml --sitemap
```

The reference parser and checker are in [packages/openbriefing](packages/openbriefing), and the test fixtures, with the expected result for each, are in [spec/fixtures](spec/fixtures). Any implementation can test itself against them.

## Add your tags

[openbriefingstandard.org/publish](https://openbriefingstandard.org/publish) walks through it. The pieces are in this repository:

- [`kit/prompt.md`](kit/prompt.md): a prompt that has your assistant draft the summary as a briefing file. [`kit/skill/`](kit/skill/SKILL.md) is the same as a skill.
- [The tag builder](https://openbriefingstandard.org/build) and `npx openbriefing tags`: check a briefing file and write the tags.
- `npx openbriefing ghost pull` and `ghost push`: keep one briefing file per Ghost post and write the approved ones.
- `npx openbriefing ghost hook`: tags drafted and written when a Ghost post is published; edit them in the post afterwards.

## Who uses it

Publishers and tools are listed in [adopters.yml](adopters.yml). To add yours, open an issue with the "List an adopter" template.

The spec is dedicated to the public domain ([CC0 1.0](LICENSE-SPEC)). The code is [MIT](LICENSE).

Website: [openbriefingstandard.org](https://openbriefingstandard.org).

## Examples

Three synthetic pages carrying the tags, for hearing a consumer against a real page, are published at <https://openbriefingstandard.org/examples/>: a full set of forms with three highlights, one summary that shorter forms may be cut from with one highlight, and one marked verbatim with none. `node scripts/make-examples.mjs` rewrites them.
