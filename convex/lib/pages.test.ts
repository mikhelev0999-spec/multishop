import { describe, expect, test } from "vitest";
import { messagePage, privacyPage } from "./pages";

describe("pages", () => {
  test("a message page is a full HTML page with the text escaped", () => {
    const html = messagePage("✅ Готово", "OLX <подключён> & всё");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("OLX &lt;подключён&gt; &amp; всё");
    expect(html).not.toContain("<подключён>");
  });
  test("the privacy policy says what is stored and how to delete it", () => {
    const html = privacyPage();
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("eBay");
    expect(html).toContain("OLX");
    expect(html).toMatch(/delet/i);
  });
});
