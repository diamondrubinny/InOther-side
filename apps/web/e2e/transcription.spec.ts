import { expect, test } from "@playwright/test";
import { expectAccessible, registerAndLogin } from "./helpers";

const SHOTS = process.env.SHOTS_DIR;

test("recordings are transcribed, corrected by the legator, and played by the persona", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, `tr-${Date.now()}@example.com`, "משה לוי");
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await page.getByRole("button", { name: "פתיחת הכספת" }).click();
  await page.getByRole("link", { name: "הגדרות" }).click();
  await page.getByLabel(/עיבוד בבינה מלאכותית/).check();

  await page.getByRole("link", { name: "תמונות והקלטות" }).click();
  const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(400), Buffer.from("TRANSCRIPT:כשהייתי בן עשר עלינו לארץ באונייה קטנה, ואבא שר כל הלילה:END"), Buffer.alloc(2000, 1)]);
  await page.getByLabel("בחירת קובץ").setInputFiles({ name: "aliyah.mp3", mimeType: "audio/mpeg", buffer: mp3 });
  await page.getByLabel(/תיאור/).fill("העלייה לארץ");
  await page.getByRole("button", { name: "העלאה", exact: true }).click();
  await expect(page.getByText("תומלל")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /תמלול\s*:\s*העלייה לארץ/ }).click();
  const dialog = page.getByRole("dialog", { name: "תמלול ההקלטה" });
  await expect(dialog.getByRole("textbox")).toHaveValue(/באונייה קטנה/);
  await dialog.getByRole("textbox").fill("כשהייתי בן עשר עלינו לארץ באוניית מעפילים קטנה, ואבא שר כל הלילה");
  await dialog.getByRole("button", { name: "שמירת התמלול" }).click();
  await expect(dialog.getByText("תוקן על ידך")).toBeVisible();
  await expectAccessible(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-transcript.png` });
  await page.keyboard.press("Escape");

  await page.goto(page.url().replace("/media", "/persona-settings"));
  await page.getByRole("link", { name: "שיחת ניסיון עם הדמות שלי" }).click();
  await page.getByRole("button", { name: "התחלת שיחה" }).click();
  await page.getByLabel(/מה תרצה\/י להגיד/).fill("ספר לי איך עליתם לארץ באונייה");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByRole("log")).toContainText("הקלטה מקורית: העלייה לארץ");
  await expect(page.getByRole("log")).not.toContainText("PLAY_");
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-call-original-recording.png` });
});
