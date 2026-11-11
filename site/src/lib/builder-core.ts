// The tag builder's logic, apart from the page. It is the package's own code,
// so what the builder writes is what `openbriefing tags` writes.
import { checkHighlights, frontMatterBlock, markTags, parseBriefing, renderTags, DRAFT_NOTE, type Briefing } from "../../../packages/openbriefing/src/briefing";

export type OutputKind = "html" | "ghost" | "frontmatter" | "feed";

export interface Built {
  briefing: Briefing;
  /** Absent when the file has no usable summary. */
  outputs?: Record<OutputKind, string>;
}

export const OUTPUTS: { kind: OutputKind; label: string; note: string }[] = [
  { kind: "html", label: "HTML head", note: "Paste these into the page's head. This is what openbriefing tags prints." },
  { kind: "ghost", label: "Ghost", note: "Paste into the post's settings, under Code injection, in the post header box. The two comments let a tool find and replace the block later." },
  { kind: "frontmatter", label: "Front matter", note: "For a static site: add this to the post's front matter, and have your head template write each key as a tag." },
  { kind: "feed", label: "RSS and Atom", note: "Elements for the post's item or entry. The feed's root element needs xmlns:obs=\"https://openbriefingstandard.org/ns#\"." },
];

/** Reads a briefing file and writes every output. `postText`, when given, is what highlights are checked against. */
export function build(file: string, postText = ""): Built {
  const briefing = parseBriefing(file);
  const brief = briefing.brief;
  if (!brief) return { briefing };
  if (briefing.body === undefined && postText.trim() !== "") checkHighlights(brief, postText, briefing.warnings);
  const draft = briefing.status !== "approved";
  const html = renderTags(brief, "html");
  const feed = renderTags(brief, "feed");
  return {
    briefing,
    outputs: {
      html: draft ? `${DRAFT_NOTE}\n${html}` : html,
      ghost: markTags(html, draft),
      frontmatter: frontMatterBlock(brief),
      feed: draft ? `${DRAFT_NOTE}\n${feed}` : feed,
    },
  };
}

/** The file with its status set to approved, leaving every other line as typed. */
export function approve(file: string): string {
  const line = /^([ \t]*)status:[^\n]*$/mu;
  if (line.test(file)) return file.replace(line, (_m, indent: string) => `${indent}status: approved`);
  return `${file.replace(/\s+$/u, "")}\nstatus: approved\n`;
}

export const EXAMPLE = `url: https://example.com/the-tomato-year/
headline: The club's best harvest came from doing less, not more.
summary: |
  The Garden Club grew more tomatoes this year than in any year since it
  began, and it did so by watering less. Members stopped the daily hose and
  moved to one deep soak a week, under a thick straw mulch. The change came
  from a single bed that was neglected during a holiday the year before and
  outgrew every bed around it.

  The plants rooted deeper, the fruit split less, and blight arrived three
  weeks later than usual. The club measured the soil at a hand's depth each
  Saturday and found it damp all week under the straw, and dry by Tuesday
  without it. Water use fell by more than half.

  The club will keep the method next year and extend it to the peppers and
  squash. It will also stop feeding in August, which the same neglected bed
  suggested the plants never needed.

  None of this cost anything. The straw came from a member's field, and the
  only new tool was a notebook for the Saturday readings. The members who
  doubted the method most were the ones who had watered most faithfully, and
  by July they were the ones showing visitors the notebook. The secretary's
  account of the year ends with an apology to the plants.
keep:
  - One deep soak a week beat daily watering.
highlights:
  - text: We had been drowning them out of kindness.
    label: On watering
attribution: From the Garden Club newsletter
status: draft
`;
