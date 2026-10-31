import { expect, test } from "@playwright/test";
import { expectAccessible, plantCancelToken, plantInvitation, registerAndLogin } from "./helpers";

test.describe.configure({ mode: "serial" });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".padEnd(800, " "));

test("executor accepts, reports a death; the living legator cancels it", async ({ browser }) => {
  const stamp = Date.now();
  const legatorEmail = `legator-${stamp}@example.com`;
  const execEmail = `exec-${stamp}@example.com`;

  // Legator sets up a vault with an executor and sends the invitation.
  const lctx = await browser.newContext({ locale: "he-IL" });
  const legator = await lctx.newPage();
  await registerAndLogin(legator, legatorEmail, "שרה");
  await legator.getByLabel(/אני מסכים\/ה לשמירה ולעיבוד/).check();
  await legator.getByRole("button", { name: "פתיחת הכספת" }).click();
  await legator.getByRole("link", { name: "מוטבים ונאמנים" }).click();
  const exForm = legator.getByRole("form", { name: "הוספת נאמן" });
  await exForm.getByLabel("שם").fill("יוסי");
  await exForm.getByLabel("אימייל").fill(execEmail);
  await exForm.getByRole("button", { name: "הוספת נאמן" }).click();
  await legator.getByRole("button", { name: /שליחת הזמנה\s*:\s*יוסי/ }).click();
  await expect(legator.getByRole("status").filter({ hasText: "ההזמנה נשלחה" })).toBeVisible();
  await expect(legator.getByText("הוזמן/ה")).toBeVisible();

  // Executor follows the (planted) invitation link, signs up, and accepts.
  const ectx = await browser.newContext({ locale: "he-IL" });
  const exec = await ectx.newPage();
  await registerAndLogin(exec, execEmail, "יוסי");
  const token = await plantInvitation(execEmail, "executor");
  await exec.goto(`/he/invitation#token=${token}`);
  await expectAccessible(exec);
  await exec.getByRole("button", { name: "אישור ההזמנה" }).click();
  await expect(exec.getByText("אישרת את תפקיד הנאמנות עבור שרה")).toBeVisible();

  // Executor reports the death with a certificate.
  await exec.goto("/he/app/executor");
  await expect(exec.getByRole("heading", { name: "נבחרת על ידי שרה" })).toBeVisible();
  await exec.getByText("דיווח על פטירה", { exact: true }).click();
  await exec.getByLabel("תאריך הפטירה").fill("2026-10-01");
  await exec.getByLabel(/תעודת פטירה/).setInputFiles({ name: "cert.pdf", mimeType: "application/pdf", buffer: PDF });
  await expectAccessible(exec);
  await exec.getByRole("button", { name: "שליחת הדיווח" }).click();
  await expect(exec.getByText("בבדיקת הצוות")).toBeVisible();

  // The living legator sees a prominent alert and cancels in-app.
  await legator.goto("/he/app");
  const alert = legator.getByRole("alert").filter({ hasText: "התקבל דיווח על פטירתך" });
  await expect(alert).toBeVisible();
  await expectAccessible(legator);
  await alert.getByRole("button", { name: "אני בחיים: ביטול הדיווח" }).click();
  await expect(alert).toBeHidden();

  // A second report, cancelled through the emailed link without signing in.
  await exec.goto("/he/app/executor");
  await exec.getByText("דיווח על פטירה", { exact: true }).click();
  await exec.getByLabel("תאריך הפטירה").fill("2026-10-02");
  await exec.getByLabel(/תעודת פטירה/).setInputFiles({ name: "cert.pdf", mimeType: "application/pdf", buffer: PDF });
  await exec.getByRole("button", { name: "שליחת הדיווח" }).click();
  await expect(exec.getByText("בבדיקת הצוות")).toBeVisible();
  const cancelToken = await plantCancelToken();
  const anon = await (await browser.newContext({ locale: "he-IL" })).newPage();
  await anon.goto(`/he/release/cancel#token=${cancelToken}`);
  await expectAccessible(anon);
  await anon.getByRole("button", { name: "אני בחיים: ביטול הדיווח" }).click();
  await expect(anon.getByText("הדיווח בוטל")).toBeVisible();
  // The token was removed from the address bar.
  expect(anon.url()).not.toContain("token=");
});
