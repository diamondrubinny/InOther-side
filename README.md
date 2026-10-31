# InOther-side

פלטפורמה שבה אדם בונה בחייו "כספת מורשת": סיפורים, תשובות לשאלות חיים, ומוטבים ונאמנים. אחרי פטירתו, ורק אחרי אימות, בני המשפחה שבחר יוכלו לשוחח עם דמות AI שלו ולשמוע סיפורים שמעולם לא סיפר.

- אפיון מלא: [`docs/PLAN.md`](docs/PLAN.md)
- תוכנית בנייה וסטטוס: [`docs/BUILD.md`](docs/BUILD.md)

> **סטטוס:** שלב 1 (שרת API: אימות משתמשים וכספת מורשת) הושלם. אין עדיין ממשק Web.

## מבנה

```
apps/api/            Fastify + TypeScript API
  src/config/        ולידציית משתני סביבה (השרת לא עולה עם קונפיג לא בטוח)
  src/db/            סכמת Drizzle, חיבור, מיגרציות
  src/http/          אבטחה (headers, CORS, Origin/CSRF, rate limit), שגיאות, guards
  src/lib/           הצפנה, סיסמאות, TOTP, מיילים, audit
  src/modules/       auth, account, vault (routes → service → db)
  drizzle/           מיגרציות SQL
  test/              בדיקות אינטגרציה מול PostgreSQL אמיתי
packages/shared/     סכמות Zod וקטלוג שאלות, משותפים לשרת ולקליינט
```

## דרישות
- Node.js 22+, pnpm 10
- PostgreSQL 16 (מקומי, או `docker compose up -d`)

## התקנה והרצה

```bash
pnpm install
docker compose up -d                 # PostgreSQL + Mailpit (תופס מיילים: http://localhost:8025)
cp .env.example apps/api/.env
# מלא MASTER_KEY_BASE64 ו-HMAC_SECRET_BASE64:  openssl rand -base64 32
pnpm db:migrate
pnpm dev:api                         # http://localhost:4000/health
```

לקבלת מיילים אמיתיים ב-Mailpit בזמן פיתוח: `MAIL_TRANSPORT=smtp` ו-`SMTP_URL=smtp://localhost:1025`.

## בדיקות

```bash
pnpm test        # 43 בדיקות: יחידה + אינטגרציה (דורש DB בשם inother_test)
pnpm typecheck
pnpm audit       # סריקת חולשות בתלויות
```

הבדיקות מכסות: מניעת חשיפת משתמשים קיימים (enumeration), נעילת חשבון, rate limiting, תפוגת sessions, CSRF/Origin, איפוס סיסמה, MFA (כולל replay וקודי שחזור), **IDOR בין משתמשים**, הצפנה ב-DB, קשירת ciphertext לשורה (AAD), מגבלות, ייצוא ומחיקה.

## API (שלב 1)

🔒 = דורש התחברות ואימייל מאומת · 🔁 = דורש אימות מחדש מהדקות האחרונות (`POST /auth/reauth`)

| Method | Path | גישה |
|---|---|---|
| GET | `/health`, `/questions` | ציבורי |
| POST | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/login/mfa` | ציבורי + rate limit |
| POST | `/auth/password-reset/request`, `/auth/password-reset/confirm` | ציבורי + rate limit |
| POST | `/auth/logout`, `/auth/logout-all`, `/auth/resend-verification` | מחובר |
| POST | `/auth/password/change`, `/auth/reauth` | 🔒 |
| POST | `/auth/mfa/setup`, `/auth/mfa/confirm`, `/auth/mfa/disable` | 🔒🔁 |
| GET | `/me`, `/me/sessions`, `/me/consents` | מחובר |
| POST | `/me/consents` | 🔒 |
| GET / DELETE | `/me/export`, `/me` | 🔒🔁 |
| POST / GET / PATCH | `/vault` | 🔒 |
| DELETE, GET | `/vault`, `/vault/export` | 🔒🔁 |
| CRUD | `/vault/beneficiaries[/:id]`, `/vault/executors[/:id]` | 🔒 |
| CRUD | `/vault/stories[/:id]` | 🔒 |
| GET / PUT / DELETE | `/vault/answers[/:questionId]` | 🔒 |

כל בקשה שמשנה מצב (POST/PUT/PATCH/DELETE) חייבת לכלול `Origin` זהה ל-`WEB_ORIGIN`.
שגיאות מוחזרות בפורמט `{ "error": { "code", "requestId", "details?" } }` בלי פרטים פנימיים.

## אבטחה ופרטיות: מה מיושם
- **סיסמאות:** argon2id ‏(64MiB, t=3), חסימת סיסמאות חלשות, השוואת זמנים למניעת זיהוי משתמשים.
- **Sessions:** טוקן אקראי של 256 ביט. ב-DB נשמר רק ה-SHA-256 שלו. Cookie מסוג `__Host-` עם HttpOnly, Secure ו-SameSite=Lax. תפוגה לפי חוסר פעילות ותפוגה מוחלטת. ניתוק כל החיבורים בשינוי או איפוס סיסמה.
- **MFA:** ‏TOTP (RFC 6238) עם סוד מוצפן, הגנה מפני שימוש חוזר בקוד, 10 קודי שחזור חד-פעמיים, ונעילת challenge אחרי 5 ניסיונות.
- **הצפנה:** מפתח נפרד לכל כספת (AES-256-GCM), עטוף במפתח-על. שמות, אימיילים, סיפורים ותשובות מוצפנים, ו-AAD קושר כל ערך לשורה ולעמודה שלו. מחיקת כספת מוחקת גם את המפתח (crypto-shredding).
- **הרשאות:** אין מזהה כספת ב-URL. כל שאילתה מסוננת לפי המשתמש המחובר, ומשאב של משתמש אחר מחזיר 404.
- **HTTP:** ‏CSP `default-src 'none'`, HSTS, nosniff, no-store, CORS מוגבל, בדיקת Origin, הגבלת גודל בקשה, rate limit.
- **לוגים:** בלי סיסמאות, cookies, IP גולמי או query strings. יומן audit שאי אפשר לערוך (trigger ב-DB).
- **פרטיות:** הסכמות נפרדות לכל מטרה עם היסטוריה, ייצוא מלא בפורמט פתוח, ומחיקת חשבון מלאה.

## לפני פרודקשן (פתוח)
ראה [`docs/BUILD.md`](docs/BUILD.md#לפני-פרודקשן-פתוח). בין היתר: KMS מנוהל, Redis ל-rate limit, RLS, בדיקת חדירות וייעוץ משפטי.
