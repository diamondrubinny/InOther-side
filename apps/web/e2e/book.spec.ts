import { expect, test } from "@playwright/test";
import { expectAccessible, registerAndLogin } from "./helpers";

test("legacy book: chapters, QR for a recording, print layout", async ({ page }) => {
  await registerAndLogin(page, `book-${Date.now()}@example.com`, "סבתא מרים");
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await page.getByRole("button", { name: "פתיחת הכספת" }).click();

  await page.getByRole("link", { name: "ספר המורשת" }).click();
  await expect(page.getByText("עדיין אין תוכן לספר.")).toBeVisible();

  // An answer and a recording.
  await page.getByRole("link", { name: "שאלות חיים" }).first().click();
  await page.getByText("ילדות", { exact: true }).click();
  const answer = page.getByLabel("תאר/י את הבית שגדלת בו. מה רואים, שומעים ומריחים שם?");
  await answer.fill("גדלתי בצפת, בבית אבן עם חצר.");
  await answer.locator("xpath=following-sibling::div").getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" }).first()).toBeVisible();
  await page.getByRole("link", { name: "תמונות והקלטות" }).click();
  const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(3000, 1)]);
  await page.getByLabel("בחירת קובץ").setInputFiles({ name: "song.mp3", mimeType: "audio/mpeg", buffer: mp3 });
  await page.getByLabel(/תיאור/).fill("שיר ערש");
  await page.getByRole("button", { name: "העלאה", exact: true }).click();
  await expect(page.getByText("מוכן").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "ספר המורשת" }).click();
  const book = page.getByRole("article", { name: /ספר מורשת: סבתא מרים/ });
  await expect(book.getByText("גדלתי בצפת, בבית אבן עם חצר.")).toBeVisible();
  await expect(book.getByRole("heading", { name: "הקלטות" })).toBeVisible();
  await expect(book.getByRole("img", { name: /סרקו כדי לשמוע.*שיר ערש/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "הדפסה / שמירה כ-PDF" })).toBeVisible();
  await expectAccessible(page);

  // Print layout: site chrome and controls are hidden, the book remains.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "הדפסה / שמירה כ-PDF" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "ניווט באזור האישי" })).toBeHidden();
  await expect(book.getByText("גדלתי בצפת, בבית אבן עם חצר.")).toBeVisible();
});
