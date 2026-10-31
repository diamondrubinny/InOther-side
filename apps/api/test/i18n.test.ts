import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema.js";
import { STRONG_PASSWORD, createHarness, nextIp, registerBody, signUpAndLogin, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("locales", () => {
  it("lists supported languages with direction", async () => {
    const res = await h.request({ method: "GET", url: "/locales" });
    const codes = res.json().locales.map((l: { code: string }) => l.code);
    expect(codes).toEqual(["he", "en", "ar", "ru", "fr", "es"]);
    expect(res.json().locales.find((l: { code: string }) => l.code === "ar").dir).toBe("rtl");
  });

  it("serves the question catalog in the negotiated language", async () => {
    const he = await h.request({ method: "GET", url: "/questions" });
    expect(he.json()).toMatchObject({ locale: "he", dir: "rtl" });
    expect(he.json().topics[0].title).toBe("ילדות");

    const ru = await h.app.inject({ method: "GET", url: "/questions", headers: { "accept-language": "ru-RU,ru;q=0.9,en;q=0.8" } });
    expect(ru.json()).toMatchObject({ locale: "ru", dir: "ltr" });
    expect(ru.json().topics[0].title).toBe("Детство");
    expect(ru.headers["content-language"]).toBe("ru");

    const ar = await h.request({ method: "GET", url: "/questions?locale=ar" });
    expect(ar.json()).toMatchObject({ locale: "ar", dir: "rtl" });
    expect(ar.json().topics[0].title).toBe("الطفولة");

    // Unsupported value falls back safely.
    const bogus = await h.request({ method: "GET", url: "/questions?locale=xx" });
    expect(bogus.json().locale).toBe("he");
  });
});

describe("user language", () => {
  it("sends the verification email in the browser's language when none is chosen", async () => {
    const email = "french@example.com";
    await h.request({ method: "POST", url: "/auth/register", body: registerBody(email), headers: { "accept-language": "fr-FR" }, ip: nextIp() });
    expect(h.mailer.lastTo(email)?.subject).toBe("Confirmez votre adresse e-mail");
    const [row] = await h.db.db.select({ locale: users.locale }).from(users).where(eq(users.email, email));
    expect(row?.locale).toBe("fr");
  });

  it("an explicit locale wins over Accept-Language", async () => {
    const email = "arabic@example.com";
    await h.request({ method: "POST", url: "/auth/register", body: { ...registerBody(email), locale: "ar" }, headers: { "accept-language": "en" }, ip: nextIp() });
    expect(h.mailer.lastTo(email)?.subject).toBe("تأكيد عنوان بريدك الإلكتروني");
  });

  it("rejects unsupported locales", async () => {
    const res = await h.request({ method: "POST", url: "/auth/register", body: { ...registerBody("de@example.com"), locale: "de" }, ip: nextIp() });
    expect(res.statusCode).toBe(400);
  });

  it("profile language drives later emails and content", async () => {
    const email = "switch@example.com";
    const cookie = await signUpAndLogin(h, email);
    const patch = await h.request({ method: "PATCH", url: "/me", cookie, body: { locale: "es" } });
    expect(patch.json()).toMatchObject({ locale: "es", dir: "ltr" });

    // Signed-in requests use the saved preference.
    const q = await h.request({ method: "GET", url: "/questions", cookie });
    expect(q.json().locale).toBe("es");

    await h.request({ method: "POST", url: "/auth/password-reset/request", body: { email }, ip: nextIp() });
    expect(h.mailer.lastTo(email)?.subject).toBe("Restablecer contraseña");

    // Export uses the user's language for question texts.
    await h.request({ method: "POST", url: "/vault", cookie, body: { consentToProcessing: true } });
    await h.request({ method: "PUT", url: "/vault/answers/values.happiness", cookie, body: { text: "La familia" } });
    await h.request({ method: "POST", url: "/auth/reauth", cookie, body: { password: STRONG_PASSWORD }, ip: nextIp() });
    const exp = await h.request({ method: "GET", url: "/vault/export", cookie });
    expect(exp.json().locale).toBe("es");
    expect(exp.json().answers[0].question).toBe("¿Qué es para ti la felicidad?");
  });

  it("security notices follow the user's language", async () => {
    const email = "russian@example.com";
    await signUpAndLogin(h, email);
    const cookie = await signUpAndLogin(h, "russian2@example.com");
    await h.request({ method: "PATCH", url: "/me", cookie, body: { locale: "ru" } });
    for (let i = 0; i < 5; i++) {
      await h.request({ method: "POST", url: "/auth/login", body: { email: "russian2@example.com", password: "wrong password here" }, ip: nextIp() });
    }
    expect(h.mailer.lastTo("russian2@example.com")?.subject).toBe("Уведомление безопасности");
  });
});
