import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "spec", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const HELPER = "https://fetch.openbriefingstandard.org/**";

test("every page answers, and /ns is the namespace page", async ({ page, request }) => {
  for (const path of ["/", "/spec/v1", "/ns", "/check", "/adopters", "/healthz", "/examples/", "/examples/full-set.html"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  await page.goto("/ns");
  await expect(page.locator("tbody tr")).toHaveCount(18);
  await expect(page.getByText("https://openbriefingstandard.org/ns#").first()).toBeVisible();
  await page.goto("/spec/v1");
  await expect(page.locator('[id="13-freshness"]')).toBeVisible();
  await expect(page.getByText("Informative. This appendix is guidance")).toBeVisible();
});

test("check by paste: the card, every form, and no request leaves the page", async ({ page }) => {
  const requests: string[] = [];
  await page.goto("/check");
  page.on("request", (r) => requests.push(r.url()));
  await page.getByText("Or paste the page's source").click();
  await page.locator("#check-source").fill(fixture("valid-full.html"));
  await page.getByRole("button", { name: "Check the pasted source" }).click();
  const result = page.locator("#check-result");
  await expect(result.locator(".verdict")).toHaveText("Usable. Nothing to fix.");
  await expect(result.locator(".brief-card .card-credit")).toContainText("From the Garden Club newsletter, in the author's words");
  for (const tier of ["Short", "Medium", "Long"]) await expect(result.getByRole("rowheader", { name: tier, exact: true })).toBeVisible();
  await expect(result.locator(".keeps li")).toHaveCount(3);
  await expect(result.locator(".highlights li")).not.toHaveCount(0);
  await expect(result.locator("pre code")).toContainText('<meta property="obs:summary:short"');
  await expect(result.getByRole("rowheader", { name: "Fingerprint" })).toBeVisible();
  expect(requests).toEqual([]);
});

test("one tag is enough: usable, with no modified time", async ({ page }) => {
  await page.goto("/check");
  await page.getByText("Or paste the page's source").click();
  await page.locator("#check-source").fill('<html><head><title>My post</title><meta property="obs:summary" content="A summary in my own words."></head><body><p>Text.</p></body></html>');
  await page.getByRole("button", { name: "Check the pasted source" }).click();
  const result = page.locator("#check-result");
  await expect(result.locator(".verdict")).toHaveText("Usable. Nothing to fix.");
  await expect(result.locator(".card-title")).toHaveText("My post");
  await expect(result).toContainText("None. A reader tells a change by comparing the text of the tags.");
});

test("check by address goes through the helper and shows the same result", async ({ page }) => {
  let asked = "";
  await page.route(HELPER, async (route) => {
    asked = new URL(route.request().url()).searchParams.get("url") ?? "";
    await route.fulfill({ json: { ok: true, url: asked, contentType: "text/html; charset=utf-8", text: fixture("valid-full.html") } });
  });
  await page.goto("/check");
  await page.locator("#check-url").fill("https://example.com/garden/");
  await page.getByRole("button", { name: "Check this page" }).click();
  await expect(page.locator("#check-result .verdict")).toHaveText("Usable. Nothing to fix.");
  await expect(page.locator("#check-result .checked-url")).toContainText("https://example.com/garden/");
  expect(asked).toBe("https://example.com/garden/");
  expect(new URL(page.url()).searchParams.get("url")).toBe("https://example.com/garden/");
});

test("an example page on this site is read directly, and the home page's form arrives checked", async ({ page }) => {
  let helperCalls = 0;
  await page.route(HELPER, (route) => {
    helperCalls++;
    return route.abort();
  });
  await page.goto("/check");
  await page.getByRole("button", { name: "every tag" }).click();
  await expect(page.locator("#check-result .verdict")).toContainText("Usable");
  await expect(page.locator("#check-result .highlights li")).toHaveCount(3);
  expect(helperCalls).toBe(0);
  await page.goto(`/check?url=${encodeURIComponent(new URL("/examples/verbatim.html", page.url()).href)}`);
  await expect(page.locator("#check-result")).toContainText("Use the words as written");
});

test("a private address is refused plainly, with no fetch", async ({ page }) => {
  let helperCalls = 0;
  await page.route(HELPER, (route) => {
    helperCalls++;
    return route.abort();
  });
  await page.goto("/check");
  for (const address of ["http://localhost/", "http://169.254.169.254/", "http://intranet/x"]) {
    await page.locator("#check-url").fill(address);
    await page.getByRole("button", { name: "Check this page" }).click();
    await expect(page.locator("#check-result .verdict")).toContainText(/not on the public web|Numeric addresses/u);
  }
  expect(helperCalls).toBe(0);
});

test("the helper's refusal and an unreachable helper are both said plainly", async ({ page }) => {
  await page.route(HELPER, (route) => route.fulfill({ status: 502, json: { ok: false, error: "The page answered 404." } }));
  await page.goto("/check");
  await page.locator("#check-url").fill("https://example.com/gone/");
  await page.getByRole("button", { name: "Check this page" }).click();
  await expect(page.locator("#check-result .verdict")).toHaveText("The page answered 404.");
  await page.unroute(HELPER);
  await page.route(HELPER, (route) => route.abort());
  await page.getByRole("button", { name: "Check this page" }).click();
  await expect(page.locator("#check-result .verdict")).toContainText("could not be reached");
  await expect(page.locator("#check-result")).toContainText("paste the page's source");
});

test("a page with no tags, broken tags, and a feed each get their own verdict", async ({ page }) => {
  await page.goto("/check");
  await page.getByText("Or paste the page's source").click();
  const paste = async (text: string) => {
    await page.locator("#check-source").fill(text);
    await page.getByRole("button", { name: "Check the pasted source" }).click();
  };
  await paste(fixture("no-tags.html"));
  await expect(page.locator("#check-result .verdict")).toContainText("no obs: tags yet");
  await paste(fixture("missing-summary.html"));
  await expect(page.locator("#check-result .verdict")).toHaveText("The tags are here, but a reader cannot use them.");
  await expect(page.locator("#check-result .msg-error")).toContainText("No summary");
  await paste(fixture("unescaped-quote.html"));
  await expect(page.locator("#check-result .msg-warning")).toContainText("&quot;");
  await paste(fixture("feed-rss.xml"));
  await expect(page.locator("#check-result .verdict")).toContainText("A feed with 2 items: 2 with usable tags");
  await expect(page.locator("#check-result .feed-item")).toHaveCount(2);
});

test("text from a page is shown as text, never run or rendered", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  await page.goto("/check");
  await page.getByText("Or paste the page's source").click();
  await page.locator("#check-source").fill(
    '<html><head><title>&lt;img src=x onerror=alert(1)&gt;</title><meta property="obs:summary" content="Plain. &lt;img src=x onerror=alert(2)&gt; &lt;script&gt;alert(3)&lt;/script&gt;"><meta property="obs:attribution" content="From &lt;b&gt;us&lt;/b&gt;"></head><body><p>x</p></body></html>',
  );
  await page.getByRole("button", { name: "Check the pasted source" }).click();
  await expect(page.locator("#check-result .verdict")).toContainText("Usable");
  await expect(page.locator("#check-result img")).toHaveCount(0);
  await expect(page.locator("#check-result script")).toHaveCount(0);
  await expect(page.locator("#check-result .card-title")).toHaveText("<img src=x onerror=alert(1)>");
  expect(dialogs).toBe(0);
});
