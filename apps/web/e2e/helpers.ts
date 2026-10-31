import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export const PASSWORD = "quiet harbor lantern 58";

const sql = () => postgres(process.env.E2E_DATABASE_URL ?? "postgres://inother:inother_dev@localhost:5432/inother_e2e", { onnotice: () => {} });

/** Email delivery is out of scope for E2E: mark the address verified directly in the database. */
export async function markVerified(email: string): Promise<void> {
  const db = sql();
  try {
    await db`UPDATE users SET email_verified_at = now() WHERE email = ${email}`;
  } finally {
    await db.end();
  }
}

export async function registerAndLogin(page: Page, email: string, name = "דנה בדיקה"): Promise<void> {
  await page.goto("/he/register");
  await page.getByLabel("שם לתצוגה").fill(name);
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה").fill(PASSWORD);
  await page.getByLabel("אני מאשר/ת שאני בן/בת 18 ומעלה").check();
  await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await expect(page.getByRole("heading", { name: "בדקו את תיבת המייל" })).toBeVisible();
  await markVerified(email);
  await page.goto("/he/login");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה").fill(PASSWORD);
  await page.getByRole("button", { name: "התחברות" }).last().click();
  await expect(page).toHaveURL(/\/he\/app$/);
}

/** Runs axe-core against WCAG 2.0/2.1 A and AA rules and fails on any violation. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, summary.join("\n")).toEqual([]);
}
