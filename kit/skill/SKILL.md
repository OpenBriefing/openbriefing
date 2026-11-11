---
name: open-briefing-draft
description: Draft an author's own summary of a post as an Open Briefing Standard briefing file (headline, summary, keep lines, highlights), ready for the tag builder or `openbriefing tags`. Use when someone asks to add obs tags to a post, draft an OBS summary, or prepare a post for briefing tools.
---

# Draft an Open Briefing Standard summary

The Open Briefing Standard (https://openbriefingstandard.org) lets a publisher say, in a few `obs:` meta tags, how a post should be summarized. Your job is the first draft, as a briefing file. The author reviews it; a tool turns it into tags.

## Steps

1. Get the post's full text, and its address if there is one. If you were given only an address and can fetch pages, fetch it. Otherwise ask for the text. Do not draft from a title or an excerpt.
2. Draft the briefing file by following `prompt.md`, which sits beside this skill's folder in the kit (https://github.com/OpenBriefing/openbriefing/blob/main/kit/prompt.md). Its rules are the whole method: the author's voice, nothing the post does not support, highlights copied word for word.
3. Check your own draft before you show it:
   - Every highlight appears in the post exactly as you wrote it. Search for it. If you cannot find it character for character, fix it or drop it.
   - The summary is 200 to 350 words, and its first two sentences stand alone.
   - Every keep line appears in the summary in the same words.
   - The file ends with `status: draft`.
4. If you can run commands, validate it: `npx openbriefing tags draft.yaml --allow-draft`. Fix what it warns about.
5. Give the author the file, and tell them what to do next:
   - Read every line. These words will be presented as theirs, and a summary cannot be recalled once a tool has used it.
   - When it reads right, change `status: draft` to `status: approved`.
   - Turn it into tags at https://openbriefingstandard.org/build or with `npx openbriefing tags`, and put them in the page's head.
   - Check the live page at https://openbriefingstandard.org/check.

## Do not

- Do not set `status: approved` yourself, and do not publish tags for a draft the author has not read.
- Do not improve on the author. If their post hedges, the summary hedges.
- Do not write a short or a long summary unless asked. One medium summary is what the standard needs; tools shorten it within the author's rules.
