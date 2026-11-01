import { expect, test } from "@playwright/test";
import { expectAccessible, registerAndLogin } from "./helpers";

test("AI interviewer: answer, follow-up, saved entries", async ({ page }) => {
  await registerAndLogin(page, `iv-${Date.now()}@example.com`, "רחל");
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await page.getByRole("button", { name: "פתיחת הכספת" }).click();
  await page.getByRole("link", { name: "הגדרות" }).click();
  await page.getByLabel(/עיבוד בבינה מלאכותית/).check();
  await page.getByRole("link", { name: "ראיון עם AI" }).click();
  await page.getByLabel("נושא").selectOption("childhood");
  await page.getByRole("button", { name: "התחלת ראיון" }).click();
  await expect(page.getByText("תאר/י את הבית שגדלת בו")).toBeVisible();
  await page.getByLabel("התשובה שלך").fill("גדלתי בירושלים, בבית אבן עם גינה קטנה");
  await page.getByRole("button", { name: "שמירה ושאלה הבאה" }).click();
  await expect(page.getByText(/ספר\/י לי עוד על/)).toBeVisible();
  await expect(page.getByText("גדלתי בירושלים, בבית אבן עם גינה קטנה")).toBeVisible();
  await expectAccessible(page);
});
