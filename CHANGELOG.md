# Changelog

Changes to the specification and to the `openbriefing` package, newest first. The spec and the package are versioned separately: the spec's major version is what `obs:version` carries.

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
