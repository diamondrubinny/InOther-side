import { expect, test } from "@playwright/test";
import { expectAccessible, plantInvitation, registerAndLogin } from "./helpers";

test("password-free capture link, and a question suggested by the family", async ({ browser }) => {
  const stamp = Date.now();
  const heirEmail = `heir-c-${stamp}@example.com`;

  // The legator creates a vault and a capture link for their own question.
  const lctx = await browser.newContext({ locale: "he-IL" });
  const legator = await lctx.newPage();
  await registerAndLogin(legator, `legator-c-${stamp}@example.com`, "סבתא רחל");
  await legator.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await legator.getByRole("button", { name: "פתיחת הכספת" }).click();
  await legator.getByRole("link", { name: "מוטבים ונאמנים" }).click();
  const bForm = legator.getByRole("form", { name: "הוספת מוטב" });
  await bForm.getByLabel("שם").fill("יונתן");
  await bForm.getByLabel("אימייל").fill(heirEmail);
  await bForm.getByRole("button", { name: "הוספת מוטב" }).click();
  await expect(legator.getByRole("strong").filter({ hasText: "יונתן" })).toBeVisible();

  await legator.getByRole("link", { name: "הקלטה בלי סיסמה" }).click();
  await expect(legator.getByRole("heading", { name: "הקלטה בלי סיסמה", level: 1 })).toBeVisible();
  await legator.getByLabel("שאלה משלי").check();
  await legator.getByLabel("השאלה שלך").fill("מה השיר שהכי אהבת לשיר לילדים?");
  await legator.getByRole("button", { name: "יצירת קישור" }).click();
  const linkField = legator.getByLabel("הקישור", { exact: true });
  await expect(linkField).toHaveValue(/\/he\/capture#token=/);
  const url = await linkField.inputValue();
  await expectAccessible(legator);

  // Whoever opens the link answers without any account.
  const actx = await browser.newContext({ locale: "he-IL" });
  const anon = await actx.newPage();
  await anon.goto(url);
  await expect(anon.getByText("מה השיר שהכי אהבת לשיר לילדים?")).toBeVisible();
  await expect(anon.getByText("שלום סבתא רחל,")).toBeVisible();
  expect(anon.url()).not.toContain("token="); // removed from the address bar
  await expectAccessible(anon);
  await anon.getByLabel("התשובה שלך").fill("נומי נומי ילדתי, בכל ערב לפני השינה.");
  await anon.getByRole("button", { name: "שליחת התשובה" }).click();
  await expect(anon.getByText("תודה! התשובה נשמרה.")).toBeVisible();
  // Single use.
  const again = await actx.newPage();
  await again.goto(url);
  await expect(again.getByText(/הקישור כבר לא בתוקף/)).toBeVisible();

  await legator.reload();
  const links = legator.getByRole("region", { name: "קישורים אחרונים" });
  await expect(links.getByRole("listitem").filter({ hasText: "מה השיר שהכי אהבת" }).getByText("נענה")).toBeVisible();

  // A grandchild (accepted beneficiary) suggests a question.
  const hctx = await browser.newContext({ locale: "he-IL" });
  const heir = await hctx.newPage();
  await registerAndLogin(heir, heirEmail, "יונתן");
  const token = await plantInvitation(heirEmail, "beneficiary");
  await heir.goto(`/he/invitation#token=${token}`);
  await heir.getByRole("button", { name: "אישור ההזמנה" }).click();
  await heir.goto("/he/app/inheritances");
  await heir.locator("summary", { hasText: "להציע שאלה" }).click();
  await heir.getByLabel("השאלה שלך").fill("סבתא, איך הכרת את סבא?");
  await heir.getByRole("button", { name: "שליחת השאלה" }).click();
  await expect(heir.getByText("השאלה נשלחה.")).toBeVisible();
  await expect(heir.getByText("ממתינה")).toBeVisible();
  await expectAccessible(heir);

  // The legator sees it and gets a link to answer now.
  await legator.reload();
  const sugg = legator.getByRole("region", { name: "שאלות מהמשפחה" });
  await expect(sugg.getByText("„סבתא, איך הכרת את סבא?”")).toBeVisible();
  await expect(sugg.getByText(/מאת יונתן/)).toBeVisible();
  await sugg.getByRole("button", { name: /קישור לתשובה עכשיו/ }).click();
  const suggLink = await sugg.getByLabel("הקישור", { exact: true }).inputValue();
  await expectAccessible(legator);
  await anon.goto(suggLink);
  await expect(anon.getByText("סבתא, איך הכרת את סבא?")).toBeVisible();
  await anon.getByLabel("התשובה שלך").fill("בחתונה של חברה, בחיפה, 1958.");
  await anon.getByRole("button", { name: "שליחת התשובה" }).click();
  await expect(anon.getByText("תודה! התשובה נשמרה.")).toBeVisible();

  // The suggester learns it was answered — never the answer itself.
  await heir.reload();
  await heir.locator("summary", { hasText: "להציע שאלה" }).click();
  await expect(heir.getByText("נענתה — התשובה תחכה לך")).toBeVisible();
  await expect(heir.getByText(/1958/)).toHaveCount(0);
});
