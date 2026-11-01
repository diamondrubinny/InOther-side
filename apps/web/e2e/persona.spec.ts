import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectAccessible, registerAndLogin } from "./helpers";

test("legator sets up the animated persona and has a preview call", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndLogin(page, `persona-${Date.now()}@example.com`, "אברהם כהן");
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await page.getByRole("button", { name: "פתיחת הכספת" }).click();
  await expect(page.getByRole("heading", { name: "התקדמות סיפור החיים" })).toBeVisible();

  // An answer for the persona to draw on.
  await page.getByRole("link", { name: "שאלות חיים" }).first().click();
  await page.getByText("הומור וסגנון", { exact: true }).click();
  const answer = page.getByLabel("אילו ביטויים או משפטים את/ה אומר/ת כל הזמן?");
  await answer.fill("תמיד אמרתי: יהיה בסדר, העיקר הבריאות");
  await answer.locator("xpath=following-sibling::div").getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" }).first()).toBeVisible();

  // Consents for AI processing, avatar and voice (separate, explicit).
  await page.getByRole("link", { name: "הגדרות" }).click();
  await page.getByLabel(/עיבוד בבינה מלאכותית/).check();
  await page.getByLabel(/יצירת אווטאר/).check();
  await page.getByLabel(/שיבוט קול/).check();

  // Portrait photo and a voice recording.
  await page.getByRole("link", { name: "תמונות והקלטות" }).click();
  const png = await sharp({ create: { width: 300, height: 360, channels: 3, background: { r: 180, g: 150, b: 130 } } }).png().toBuffer();
  await page.getByLabel("בחירת קובץ").setInputFiles({ name: "face.png", mimeType: "image/png", buffer: png });
  await page.getByLabel(/תיאור/).fill("הפנים שלי");
  await page.getByRole("button", { name: "העלאה", exact: true }).click();
  await expect(page.getByText("מוכן").first()).toBeVisible({ timeout: 20_000 });
  const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(3000, 1)]);
  await page.getByLabel("בחירת קובץ").setInputFiles({ name: "voice.mp3", mimeType: "audio/mpeg", buffer: mp3 });
  await page.getByLabel(/תיאור/).fill("הקול שלי");
  await page.getByRole("button", { name: "העלאה", exact: true }).click();
  await expect(page.getByText("מוכן")).toHaveCount(2, { timeout: 20_000 });

  // Persona settings: portrait, mouth position, cloned voice.
  await page.getByRole("link", { name: "הדמות שלי (AI)" }).click();
  await page.getByLabel("בחירת תמונה").selectOption({ label: "הפנים שלי" });
  await page.getByLabel("מיקום אנכי (0–1000)").fill("720");
  await page.getByRole("button", { name: "יצירת הקול מההקלטות שלי" }).click();
  await expect(page.getByText("מוכן", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" })).toBeVisible();

  // Personality card: generated from the legator's words, reviewed and approved.
  await page.getByRole("button", { name: "יצירת כרטיס מהחומרים שלי" }).click();
  await expect(page.getByText("טיוטה, טרם אושר")).toBeVisible();
  await expect(page.getByLabel(/ביטויים שאני אומר/)).toHaveValue(/יהיה בסדר/);
  await page.getByLabel(/תכונות אופי/).fill("אופטימי\nחם");
  await page.getByRole("button", { name: "אישור הכרטיס" }).click();
  await expect(page.getByText("מאושר", { exact: true })).toBeVisible();
  await expectAccessible(page);

  // Preview call.
  await page.getByRole("link", { name: "שיחת ניסיון עם הדמות שלי" }).click();
  await expect(page.getByRole("heading", { name: "שיחה עם אברהם כהן" })).toBeVisible();
  await expect(page.getByLabel("לזכור את השיחות שלנו")).not.toBeChecked(); // memory is opt-in
  await page.getByRole("button", { name: "התחלת שיחה" }).click();
  await expect(page.getByRole("img", { name: "דיוקן מונפש של אברהם כהן (הדמיית AI)" })).toBeVisible();
  await expect(page.getByText("הדמיית AI")).toBeVisible();
  await expectAccessible(page);

  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  const audioRequests: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/segments/") && r.status() === 200) audioRequests.push(r.url()); });
  await page.getByLabel("מה תרצה/י להגיד?").fill("מה היית תמיד אומר?");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByRole("log")).toContainText("יהיה בסדר");
  await expect.poll(() => audioRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Proximity test: "that's not me" + correction.
  await page.getByRole("button", { name: "זה לא אני" }).first().click();
  await page.getByLabel("איך הייתי אומר/ת את זה באמת?").fill("הייתי אומר את זה עם חיוך ובלי מילים גבוהות");
  await page.getByRole("button", { name: "שמירת התיקון" }).click();
  await expect(page.getByText("התיקון נשמר ויחייב את הדמות מעכשיו.")).toBeVisible();

  // Crisis: the persona steps aside and help is shown.
  await page.getByLabel("מה תרצה/י להגיד?").fill("אני לא רוצה לחיות יותר");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByRole("log")).toContainText("1201");
  await expect(page.getByRole("status").filter({ hasText: "ער\"ן 1201" })).toBeVisible();

  expect(consoleErrors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  await page.getByRole("button", { name: "סיום השיחה" }).click();
  await expect(page.getByRole("button", { name: "התחלת שיחה" })).toBeVisible();
});
