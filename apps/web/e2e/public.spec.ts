import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test.describe("public site", () => {
  test("redirects / to the browser language and renders Hebrew RTL", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/he$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("הסיפורים שלך ימשיכו לדבר");
  });

  test("language switcher: Arabic is RTL, Russian is LTR", async ({ page }) => {
    await page.goto("/he");
    await page.getByLabel("שפה").selectOption("ar");
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("قصصك ستواصل الكلام");
    await page.getByLabel("اللغة").selectOption("ru");
    await expect(page).toHaveURL(/\/ru$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    // The choice is remembered for the next visit to "/".
    await page.goto("/");
    await expect(page).toHaveURL(/\/ru$/);
  });

  test("security headers including a per-request CSP nonce", async ({ request }) => {
    const a = await request.get("/he");
    const b = await request.get("/he");
    const csp = a.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toEqual(b.headers()["content-security-policy"]);
    expect(a.headers()["x-frame-options"]).toBe("DENY");
    expect(a.headers()["x-content-type-options"]).toBe("nosniff");
    expect(a.headers()["x-powered-by"]).toBeUndefined();
  });

  test("keyboard: the first Tab reaches the skip link, which moves focus to main", async ({ page }) => {
    await page.goto("/he");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "דילוג לתוכן הראשי" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("unknown pages show a localized 404", async ({ page }) => {
    const res = await page.goto("/fr/nothing-here");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  });

  test("legal pages: Hebrew original, English fallback with notice", async ({ page }) => {
    await page.goto("/he/accessibility");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("הצהרת נגישות");
    await page.goto("/es/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
    await expect(page.getByText("Se muestra la versión en inglés", { exact: false })).toBeVisible();
  });

  test("cookie settings dialog: reject is as available as accept, keyboard-closable", async ({ page }) => {
    await page.goto("/he");
    await page.getByRole("button", { name: "הגדרות פרטיות ועוגיות" }).click();
    const dialog = page.getByRole("dialog", { name: "פרטיות ועוגיות" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "דחיית הכל" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "אישור הכל" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("accessibility menu applies and persists preferences", async ({ page }) => {
    await page.goto("/he");
    await page.getByRole("button", { name: "תפריט נגישות" }).click();
    await page.getByLabel("ניגודיות גבוהה").check();
    await expect(page.locator("html")).toHaveClass(/a11y-contrast/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/a11y-contrast/);
  });

  for (const path of ["/he", "/ar", "/en", "/he/login", "/he/register", "/he/forgot-password", "/he/privacy", "/he/accessibility"]) {
    test(`axe: no WCAG 2.1 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }
});
