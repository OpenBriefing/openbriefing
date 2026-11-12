# Changelog

Changes to the specification and to the `openbriefing` package, newest first. The spec and the package are versioned separately: the spec's major version is what `obs:version` carries.

## Version 1 final; package 1.0.0 (12 November 2026)

**Spec**

- Version 1 is final. The tag names are fixed: a tag's name and meaning never change, no tag is removed, and a minor version only adds optional tags. Nothing changed from the release candidate.
- The first full catalogue is tagged: rishidean.com, 104 posts, checked with `openbriefing check --sitemap`.

**Package**

- `openbriefing@1.0.0`. The same code as 0.5.1; from here the package follows semantic versioning.

## Package 0.5.1 (12 November 2026)

- `ghost hook` and `ghost draft` need the publisher's own `ANTHROPIC_API_KEY` and say so at start, instead of failing on the first post. The guide states that drafts are billed to that key and that nothing passes through openbriefingstandard.org.

## Package 0.5.0: tags on publish, for Ghost (11 November 2026)

No change to the specification.

- `openbriefing ghost hook` serves Ghost's webhooks. When a post is published it drafts the summary with Claude from `kit/prompt.md`, keeps only highlights found in the post's text, and writes the tags into the post's Code injection header. It registers its own webhooks when `OBS_HOOK_URL` is set.
- The hook's block carries a stamp, `<!-- obs:auto <fingerprint> -->`. While the tags match it the block is the hook's, and it is redone only when the post changes under a quote. Once the author edits the tags, or writes their own, the hook never writes to that post again.
- `openbriefing ghost draft` does the same for posts already published, one at a time, with `--slug`, `--limit` and `--dry-run`.
- Members-only posts and posts under 200 words are left alone.
- This publishes a drafted summary as the author's before they have read it. `ghost pull` and `ghost push` remain for an author who approves each one first.

## Package 0.4.0: the publisher's kit (11 November 2026)

No change to the specification.

**Package**

- **The briefing file:** a few lines of YAML (`summary`, `headline`, `keep`, `highlights`, `attribution`, `url`, `status`, and the optional keys that match the other tags), or the same keys under `obs:` in a post's front matter. A tool convention, not part of the standard.
- `openbriefing tags <file>` turns a briefing file into escaped tags: meta tags, feed elements (`--format feed`) or JSON. It checks each highlight against the post's text when the file is a post, and refuses a file whose `status` is not `approved` unless `--allow-draft` is given.
- `openbriefing ghost pull <folder>` writes one file per published Ghost post, with the post's text, and imports tags a post already carries as approved. It never changes Ghost and never overwrites a file.
- `openbriefing ghost push <folder>` writes each approved file's tags into its post's Code injection header, between `<!-- obs:start -->` and `<!-- obs:end -->`, and nothing else. A post whose tags have not changed is skipped. `--dry-run` writes nothing.
- `openbriefing/briefing` exports the same code for other tools: `parseBriefing`, `renderTags`, `markTags`, `replaceMarked`.

**Kit and site**

- `kit/prompt.md`: a drafting prompt for any assistant, in the public domain. `kit/skill/`: the same as an assistant skill. `kit/examples/`: example briefing files.
- [openbriefingstandard.org/publish](https://openbriefingstandard.org/publish): draft, review, place the tags, check.
- [openbriefingstandard.org/build](https://openbriefingstandard.org/build): paste a briefing file, see it checked as you type, copy tags for HTML, Ghost, front matter or a feed. Nothing typed leaves the page.

## Package 0.3.0, spec version 1 release candidate (10 November 2026)

**Spec**

- **One tag adopts OBS.** `obs:modified` is now optional. The tags are usable when at least one summary is present.
- **The effective modified time** is the first of `obs:modified`, the page's `article:modified_time`, and a feed item's `<updated>` or `<pubDate>`. With none, a reader tells a change by comparing the text of the tags.
- **Feed against page:** the later effective modified time stands; when the two are equal, or either side has none, the page stands.
- The normative sections now state only what the publisher intends. Two procedures for tools moved to Appendix A: which summary to derive from, and when a keep line fits.
- §16 names the newer neighbours: IETF AI Preferences, Content Signals, RSL, llms.txt, Markdown for Agents and Schema.org `speakable`.
- The status is "Version 1, release candidate". The 1.0 and 1.1 draft labels are retired; `obs:version` stays `1`.
- Every page that was valid under draft 1.1 is still valid and reads the same.

**Package**

- `ObsBrief.modified` is optional, and `modifiedFrom` says where it came from: `obs`, `article`, `feed` or `none`.
- `fingerprint(brief)`: a stable hash of every text value and setting, for telling a change when there is no modified time. `expected.json` records it for each fixture.
- A malformed `obs:modified` is now a warning, and the next source is used. It was an error.
- A value cut short by an unescaped double quote is reported, with the escape to write.
- `openbriefing check` reads a URL. `--feed --pages` fetches each item's page and says which stands. `--sitemap` checks every page a sitemap lists, one line each, and exits 1 only when a page has tags that are not usable.
- Fixtures: `missing-modified` and `bad-modified` are now usable; six fixtures added.

## Package 0.2.0, spec draft 1.1 (9 November 2026)

- `obs:highlight` and `obs:highlight:label`: up to five passages, word for word from the content, that may be quoted on their own with credit.
- `check` lists each highlight and warns when one is not found in the page's text.
- `obs:highlight:start` and `obs:highlight:end` are reserved.

## Package 0.1.1 (8 November 2026)

- The `openbriefing` command's path is fixed so that `npx openbriefing` runs.
- `check` shows control characters from a page instead of sending them to the terminal.

## Package 0.1.0, spec draft 1.0 (8 November 2026)

- The first draft of the specification: the publisher's summary as the anchor, five forms, `obs:derive`, keep lines, credit, the feed mirror.
- The reference parser (`parseObs`, `parseFeedObs`, `validateObs`, `mergeObs`), the fixtures with `expected.json`, and `openbriefing check` for local files.
