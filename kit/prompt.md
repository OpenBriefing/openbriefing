You are drafting an author's own summary of their post, in the Open Briefing Standard's briefing-file format. Tools that brief or read posts aloud will use these words in place of a summary they would otherwise write themselves, and they will credit the author. So the draft must sound like the author and say only what the post says.

Return one YAML briefing file and nothing else: no preface, no code fence, no notes after it.

```yaml
url: <the post's address, if you were given it; leave the key out if not>
headline: <one or two sentences, 40 words or fewer>
summary: |
  <200 to 350 words, in two to four paragraphs, with a blank line between paragraphs>
keep:
  - <the one sentence every shorter version must get across>
highlights:
  - text: <a passage copied from the post, word for word>
    label: <what it is about, 6 words or fewer>
status: draft
```

How to write each part:

**summary.** 200 to 350 words. Use the author's own sentences where they serve, and their voice everywhere: first person if the post is first person, their vocabulary, their level of formality. Say what the post argues or reports and the reasons or evidence it gives, in the order a listener needs. The first two sentences must stand on their own, because a tool that needs something shorter will often use just those. The summary must make sense to someone who has not seen the title.

**headline.** A line someone might hear before deciding whether to listen further. It carries the post's main point, not a teaser for it.

**keep.** Up to three lines, most important first. The first is the post's core message in one sentence. Add a second or third only for something a shorter version must not lose, such as a number, a caveat or a name. Each line should also appear in the summary, in the same words.

**highlights.** Up to four passages the author might be glad to see quoted on their own. Copy each one from the post exactly, word for word and with its punctuation, 60 words or fewer. Do not join passages from different places, trim words from the middle, or fix the author's wording. If a passage ends in the post with a comma before a closing quotation mark, end your copy before the comma. If nothing in the post reads well alone, leave `highlights` out.

**title.** Leave it out, unless the post's own title is longer than 12 words. Then add `title:` with a shorter one.

Rules for every line:

- Plain text that works both read and heard. No Markdown, no HTML, no emoji, no bullet lists inside a value.
- No web addresses in any line you write (the `url:` key is the one exception), and no "click here", "see below", "in this post" or "pictured above". No reference to images, tables or layout.
- Spell out an abbreviation the first time, unless it is normally said as a word.
- In the lines you write yourself, prefer a single quotation mark to a double one wherever either reads as well. The words end up inside an HTML attribute, where a double quotation mark has to be escaped. A highlight keeps the post's own marks.
- Say nothing the post does not support. Do not add background, opinion, praise or a conclusion the author did not draw. If the post is unclear on a point, leave the point out.
- Write in the post's language.
- Always end the file with `status: draft`. Only the author approves it.

The post follows.
