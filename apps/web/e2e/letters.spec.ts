import { expect, test } from "@playwright/test";
import { expectAccessible, plantInvitation, registerAndLogin, releaseNewestVaultWithLetters } from "./helpers";

test("scheduled letters: Hebrew-calendar preview, delivery, open-when, pause", async ({ browser }) => {
  const stamp = Date.now();
  const heirEmail = `heir-l-${stamp}@example.com`;

  // The legator adds a grandchild with a date of birth and schedules letters.
  const lctx = await browser.newContext({ locale: "he-IL" });
  const legator = await lctx.newPage();
  await registerAndLogin(legator, `legator-l-${stamp}@example.com`, "סבא משה");
  await legator.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await legator.getByRole("button", { name: "פתיחת הכספת" }).click();
  await legator.getByRole("link", { name: "מוטבים ונאמנים" }).click();
  const bForm = legator.getByRole("form", { name: "הוספת מוטב" });
  await bForm.getByLabel("שם").fill("נועה");
  await bForm.getByLabel("אימייל").fill(heirEmail);
  await bForm.getByLabel("קרבה").selectOption("grandchild");
  await bForm.getByLabel(/תאריך לידה/).fill("2015-02-20");
  await bForm.getByRole("button", { name: "הוספת מוטב" }).click();
  await expect(legator.getByText(/תאריך לידה.*אדר/)).toBeVisible();

  await legator.getByRole("link", { name: "מסרים מתוזמנים" }).click();
  await expect(legator.getByText("עדיין אין מסרים מתוזמנים.")).toBeVisible();
  await legator.getByRole("button", { name: "מסר חדש" }).click();
  await legator.getByLabel("כותרת").fill("יום הולדת שמח, נועה");
  await legator.getByLabel("המכתב").fill("נועה שלי, בכל שנה ביום ההולדת העברי שלך אני איתך.");
  await legator.getByLabel(/נועה · נכד\/ה/).check();
  await legator.getByLabel("מתי המסר יגיע").selectOption("birthday");
  await legator.getByLabel("לוח שנה").selectOption("hebrew");
  // Preview, computed with the same engine as the server: 1 Adar → Adar (or Adar II in a leap year).
  const preview = legator.getByRole("region", { name: /אם הכספת הייתה נפתחת היום/ });
  await expect(preview.getByText(/נועה:.*אדר/)).toBeVisible();
  await expectAccessible(legator);
  await legator.getByRole("button", { name: "שמירה" }).click();
  await expect(legator.getByText("המסר נשמר.")).toBeVisible();
  await expect(legator.getByText(/ביום ההולדת · עברי · כל שנה/)).toBeVisible();

  // A farewell letter on release, and an "open when you marry" letter.
  for (const [title, kind] of [
    ["מכתב פרידה", "on_release"],
    ["ביום החתונה שלך", "life_event"],
  ] as const) {
    await legator.getByRole("button", { name: "מסר חדש" }).click();
    await legator.getByLabel("כותרת").fill(title);
    await legator.getByLabel("המכתב").fill(`${title}: אוהב אותך תמיד.`);
    await legator.getByLabel(/נועה · נכד\/ה/).check();
    await legator.getByLabel("מתי המסר יגיע").selectOption(kind);
    await legator.getByRole("button", { name: "שמירה" }).click();
    await expect(legator.getByText("המסר נשמר.")).toBeVisible();
  }
  await expectAccessible(legator);

  // The grandchild accepts; later the vault is released.
  const hctx = await browser.newContext({ locale: "he-IL" });
  const heir = await hctx.newPage();
  await registerAndLogin(heir, heirEmail, "נועה");
  const token = await plantInvitation(heirEmail, "beneficiary");
  await heir.goto(`/he/invitation#token=${token}`);
  await heir.getByRole("button", { name: "אישור ההזמנה" }).click();
  await releaseNewestVaultWithLetters();

  await heir.goto("/he/app/inheritances");
  await heir.getByRole("link", { name: /סבא משה/ }).first().click();
  const letters = heir.getByRole("region", { name: "מכתבים ממנו/ממנה" });
  const farewell = letters.getByRole("listitem").filter({ hasText: "מכתב פרידה" });
  await expect(farewell).toBeVisible();
  await expect(farewell.getByText("חדש", { exact: true })).toBeVisible();
  // The "open when" letter shows only the event, never its title.
  await expect(heir.getByText("ביום החתונה שלך")).toHaveCount(0);
  await expect(letters.getByRole("listitem").filter({ hasText: "החתונה שלך" })).toBeVisible();
  await expect(letters.getByText(/עוד 1 מכתבים יגיעו בעתיד/)).toBeVisible();
  await expectAccessible(heir);

  await letters.getByRole("button", { name: /לקריאה\s*:\s*מכתב פרידה/ }).click();
  const dialog = heir.getByRole("dialog", { name: "מכתב פרידה" });
  await expect(dialog.getByText("מכתב פרידה: אוהב אותך תמיד.")).toBeVisible();
  await expectAccessible(heir);
  await dialog.getByRole("button", { name: "סגירה" }).click();

  await letters.getByRole("button", { name: /לפתוח\s*:\s*החתונה שלך/ }).click();
  await heir.getByRole("dialog").getByRole("button", { name: "לפתוח" }).click();
  await expect(heir.getByRole("dialog", { name: "ביום החתונה שלך" }).getByText("ביום החתונה שלך: אוהב אותך תמיד.")).toBeVisible();
  await heir.getByRole("dialog", { name: "ביום החתונה שלך" }).getByRole("button", { name: "סגירה" }).click();

  await letters.getByRole("button", { name: "להשהות את המכתבים" }).click();
  await expect(letters.getByText(/המכתבים מושהים/)).toBeVisible();
  await letters.getByRole("button", { name: "לחדש את המכתבים" }).click();
  await expect(letters.getByText(/המכתבים מושהים/)).toHaveCount(0);

  // Minor protection: the persona call is not offered to a beneficiary under 18.
  await heir.goto(heir.url().replace("/inheritances/", "/persona/"));
  await expect(heir.getByText(/אינה זמינה למוטבים מתחת לגיל 18/)).toBeVisible();
});
