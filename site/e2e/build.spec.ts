import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "kit", "examples");
const example = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");
const HELPER = "https://fetch.openbriefingstandard.org/**";

test("build from a file: checked as typed, the card, and escaped tags between Ghost's markers", async ({ page }) => {
  const requests: string[] = [];
  await page.goto("/build");
  page.on("request", (r) => requests.push(r.url()));
  await expect(page.locator("#build-output")).toBeHidden();
  await page.locator("#build-file").fill(example("quotes.yaml"));
  const result = page.locator("#build-result");
  await expect(result.locator(".verdict")).toHaveText("Usable. Nothing to fix.");
  await expect(result.locator(".state")).toHaveText("Marked approved.");
  await expect(result.locator(".brief-card .card-summary")).toContainText('"the best plot under 10 m²" & gave it first place');
  await expect(result.getByRole("rowheader", { name: "Fingerprint" })).toBeVisible();

  await expect(page.getByRole("tab", { name: "HTML head" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Ghost" }).click();
  const code = (await page.locator("#build-code").textContent()) ?? "";
  const lines = code.split("\n");
  expect(lines[0]).toBe("<!-- obs:start -->");
  expect(lines.at(-1)).toBe("<!-- obs:end -->");
  expect(code).toContain("&quot;the best plot under 10 m²&quot; &amp; gave it first place");
  expect(code).toContain("&lt; half");
  expect(code).toContain("&#10;&#10;");
  await page.getByRole("tab", { name: "RSS and Atom" }).click();
  await expect(page.locator("#build-code")).toContainText("<obs:derive>verbatim</obs:derive>");
  await page.getByRole("tab", { name: "Front matter" }).click();
  await expect(page.locator("#build-code")).toContainText("obs:\n  url: https://example.com/garden/what-the-judge-said");
  // Nothing typed is sent anywhere.
  expect(requests).toEqual([]);
});

test("a draft says so until it is marked approved; the tab is remembered", async ({ page }) => {
  await page.goto("/build");
  await page.getByRole("button", { name: "Start from an example" }).click();
  await expect(page.locator("#build-result .state")).toHaveText("A draft, until its status line says approved.");
  await expect(page.locator("#build-draft")).toBeVisible();
  await expect(page.locator("#build-code")).toContainText("<!-- obs: a draft, not yet approved by the author -->");
  await page.getByRole("tab", { name: "Ghost" }).click();
  await page.getByRole("button", { name: "mark it approved" }).click();
  await expect(page.locator("#build-file")).toHaveValue(/status: approved\n$/u);
  await expect(page.locator("#build-draft")).toBeHidden();
  await expect(page.locator("#build-code")).not.toContainText("a draft");
  await page.reload();
  await page.getByRole("button", { name: "Start from an example" }).click();
  await expect(page.getByRole("tab", { name: "Ghost" })).toHaveAttribute("aria-selected", "true");
});

test("over size: a 60-word headline is a warning in plain words, and the tags are still offered", async ({ page }) => {
  await page.goto("/build");
  await page.locator("#build-file").fill(`summary: A summary in my own words.\nheadline: ${"word ".repeat(60).trim()}\n`);
  const result = page.locator("#build-result");
  await expect(result.locator(".verdict")).toHaveText("Usable, with 1 thing to look at.");
  await expect(result.locator(".msg-warning")).toContainText("obs:headline: 60 words, over its size of 40");
  await expect(page.locator("#build-code")).toContainText('<meta property="obs:headline"');
});

test("what cannot be used is explained, and no tags are offered", async ({ page }) => {
  await page.goto("/build");
  await page.locator("#build-file").fill("headline: Only a headline");
  await expect(page.locator("#build-result .verdict")).toHaveText("Not usable yet.");
  await expect(page.locator("#build-result .msg-error")).toContainText("No summary");
  await expect(page.locator("#build-output")).toBeHidden();
  await page.locator("#build-file").fill("summary: [unclosed");
  await expect(page.locator("#build-result .msg-error")).toContainText("not valid YAML");
  await page.locator("#build-file").fill("");
  await expect(page.locator("#build-result")).toBeEmpty();
});

test("highlights are looked up in pasted text, or in the post read through the helper", async ({ page }) => {
  let asked = "";
  await page.route(HELPER, async (route) => {
    asked = new URL(route.request().url()).searchParams.get("url") ?? "";
    await route.fulfill({ json: { ok: true, url: asked, contentType: "text/html", text: "<html><body><script>var x = 'We had been drowning them out of kindness.'</script><p>“We had been drowning them out of kindness.”</p></body></html>" } });
  });
  await page.goto("/build");
  await page.getByRole("button", { name: "Start from an example" }).click();
  await page.getByText("Check the highlights against your post").click();
  await page.locator("#build-post").fill("A post about something else.");
  await expect(page.locator("#build-result .highlights")).toContainText("Not found in the post's text.");
  await expect(page.locator("#build-result .msg-warning")).toContainText("is not in the post's text");
  await page.getByRole("button", { name: "Read it from the post's address" }).click();
  await expect(page.locator("#build-result .highlights")).toContainText("Found in the post's text.");
  expect(asked).toBe("https://example.com/the-tomato-year");
  await expect(page.locator("#build-post")).toHaveValue("“We had been drowning them out of kindness.”");
});

test("the guide carries the prompt, and every new page answers and is in the nav", async ({ page, request }) => {
  for (const path of ["/build", "/publish"]) expect((await request.get(path)).status(), path).toBe(200);
  await page.goto("/publish");
  await expect(page.locator("#prompt-text")).toContainText("Always end the file with `status: draft`");
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Add your tags" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "the tag builder" }).click();
  await expect(page).toHaveURL(/\/build$/u);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "a builder" })).toHaveAttribute("href", "/build");
});
