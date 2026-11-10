import { expect, test } from "@playwright/test";
import { expectAccessible, registerAndLogin } from "./helpers";

test("life timeline: partial dates, chronological order, shown in the book", async ({ page }) => {
  await registerAndLogin(page, `tl-${Date.now()}@example.com`, "סבא יעקב");
  await page.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await page.getByRole("button", { name: "פתיחת הכספת" }).click();
  await page.getByRole("link", { name: "ציר הזמן" }).click();
  await expect(page.getByText("עדיין אין אירועים בציר הזמן.")).toBeVisible();

  const add = async (title: string, year: string, month?: string, day?: string) => {
    await page.getByRole("button", { name: "הוספת אירוע" }).click();
    await page.getByLabel("מה קרה").fill(title);
    await page.getByLabel("שנה").fill(year);
    if (month) await page.getByLabel("חודש (אופציונלי)").selectOption(month);
    if (day) await page.getByLabel("יום (אופציונלי)").fill(day);
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("האירוע נשמר.")).toBeVisible();
  };
  // Added out of order, with different precision.
  await add("החתונה שלנו", "1961", "3", "7");
  await add("נולדתי בירושלים", "1938");
  await add("עלינו לקיבוץ", "1949", "5");

  // A date in the future is refused with a clear message.
  await page.getByRole("button", { name: "הוספת אירוע" }).click();
  await page.getByLabel("מה קרה").fill("מהעתיד");
  await page.getByLabel("שנה").fill(String(new Date().getFullYear() + 1));
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "התאריך בעתיד." })).toBeVisible();
  await page.getByRole("button", { name: "ביטול" }).click();

  const region = page.getByRole("region", { name: "ציר הזמן" });
  await expect(region.getByRole("listitem").locator("strong")).toHaveText(["נולדתי בירושלים", "עלינו לקיבוץ", "החתונה שלנו"]);
  await expect(region.getByRole("heading", { name: "שנות ה-1930" })).toBeVisible();
  await expect(region.getByText("מאי 1949")).toBeVisible();
  await expect(region.getByText("7 במרץ 1961")).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "ספר המורשת" }).click();
  const book = page.getByRole("article", { name: /ספר מורשת: סבא יעקב/ });
  await expect(book.getByRole("heading", { name: "ציר הזמן" })).toBeVisible();
  await expect(book.getByText("עלינו לקיבוץ")).toBeVisible();
  await expectAccessible(page);
});
