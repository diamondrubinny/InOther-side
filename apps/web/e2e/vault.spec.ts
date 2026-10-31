import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectAccessible, registerAndLogin } from "./helpers";

test.describe.configure({ mode: "serial" });

test("legator journey: vault, answers, people, stories, media, settings", async ({ page }) => {
  await registerAndLogin(page, `e2e-${Date.now()}@example.com`);

  // Create the vault (consent required).
  const create = page.getByRole("button", { name: "פתיחת הכספת" });
  await expect(create).toBeDisabled();
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await create.click();
  await expect(page.getByRole("heading", { name: "התקדמות סיפור החיים" })).toBeVisible();
  await expectAccessible(page);

  // Answer a question.
  await page.getByRole("link", { name: "שאלות חיים" }).first().click();
  await page.getByText("ילדות", { exact: true }).click();
  const answer = page.getByLabel("תאר/י את הבית שגדלת בו. מה רואים, שומעים ומריחים שם?");
  await answer.fill("בית קטן בחיפה עם עץ לימון בחצר");
  await answer.locator("xpath=following-sibling::div").getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "נשמר" }).first()).toBeVisible();
  await expectAccessible(page);

  // Add a beneficiary and an executor.
  await page.getByRole("link", { name: "מוטבים ונאמנים" }).click();
  const benForm = page.getByRole("form", { name: "הוספת מוטב" });
  await benForm.getByLabel("שם").fill("נועה");
  await benForm.getByLabel("אימייל").fill("noa@example.com");
  await benForm.getByRole("button", { name: "הוספת מוטב" }).click();
  await expect(page.getByText("noa@example.com")).toBeVisible();
  const exForm = page.getByRole("form", { name: "הוספת נאמן" });
  await exForm.getByLabel("שם").fill("יוסי");
  await exForm.getByLabel("אימייל").fill("yossi@example.com");
  await exForm.getByLabel("קרבה").selectOption("friend");
  await exForm.getByRole("button", { name: "הוספת נאמן" }).click();
  await expect(page.getByText("yossi@example.com")).toBeVisible();
  await expectAccessible(page);

  // Seal a story for a specific beneficiary.
  await page.getByRole("link", { name: "סיפורים חתומים" }).click();
  await page.getByRole("link", { name: "סיפור חדש" }).click();
  await page.getByRole("textbox", { name: "כותרת", exact: true }).fill("הקיץ של 1974");
  await page.getByRole("textbox", { name: "הסיפור", exact: true }).fill("ליד הים, קרה משהו שאף אחד לא יודע…");
  await page.getByLabel("רק מוטבים מסוימים").check();
  await page.getByLabel(/נועה/).check();
  await page.getByLabel("שקלתי את ההשפעה של הסיפור על אחרים").check();
  await expectAccessible(page);
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("heading", { name: "הקיץ של 1974" })).toBeVisible();

  // Upload a photo: it goes through the worker and becomes "ready".
  await page.getByRole("link", { name: "תמונות והקלטות" }).click();
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "teal" } }).png().toBuffer();
  await page.getByLabel("בחירת קובץ").setInputFiles({ name: "grandpa.png", mimeType: "image/png", buffer: png });
  await page.getByLabel(/תיאור/).fill("סבא בחתונה");
  await page.getByRole("button", { name: "העלאה", exact: true }).click();
  await expect(page.getByText("מוכן")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "הצגה" }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "סבא בחתונה" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectAccessible(page);

  // Dashboard reflects progress.
  await page.getByRole("link", { name: "הכספת שלי" }).first().click();
  await expect(page.getByText("ענית על 1 מתוך")).toBeVisible();

  // Settings: switching language to English moves the whole UI to LTR.
  await page.getByRole("link", { name: "הגדרות" }).click();
  await expectAccessible(page);
  await page.getByLabel("שפה", { exact: true }).last().selectOption("en");
  await page.getByRole("form", { name: "פרופיל" }).getByRole("button", { name: "שמירה" }).click();
  await expect(page).toHaveURL(/\/en\/app\/settings$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/he/app/stories");
  await expect(page).toHaveURL(/\/he\/login$/);
});
