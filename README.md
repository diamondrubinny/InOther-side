# InOther-side

פלטפורמה שבה אדם בונה בחייו "כספת מורשת": סיפורים, תשובות לשאלות חיים, ומוטבים ונאמנים. אחרי פטירתו, ורק אחרי אימות, בני המשפחה שבחר יוכלו לשוחח עם דמות AI שלו ולשמוע סיפורים שמעולם לא סיפר.

- אפיון מלא: [`docs/PLAN.md`](docs/PLAN.md)
- תוכנית בנייה וסטטוס: [`docs/BUILD.md`](docs/BUILD.md)

> **סטטוס:** שלבים 1–3 הושלמו: שרת API (אימות משתמשים, כספת מורשת, העלאת קבצים מאובטחת) ואתר Web מלא ב-6 שפות, עם תמיכה ב-RTL ובנגישות.

## שפות
עברית (ברירת מחדל), English, العربية, Русский, Français, Español. עברית וערבית מוגדרות RTL.
סדר העדיפויות לבחירת שפה: `?locale=` ← השפה שנשמרה בפרופיל ← כותרת `Accept-Language` של הדפדפן.
מיילים, קטלוג השאלות וייצוא הנתונים מתורגמים. ממשק ה-API מחזיר קודי שגיאה (באנגלית) שהקליינט מתרגם.
> ⚠️ התרגומים לערבית, רוסית, צרפתית וספרדית הם טיוטה, ודורשים בדיקה של דוברי שפת אם לפני השקה.

## מבנה

```
apps/web/            Next.js 15 (App Router): אתר ציבורי ואזור אישי, 6 שפות, RTL ונגישות
  src/app/[locale]/  עמודים (ציבוריים, התחברות, משפטיים, /app = אזור אישי)
  src/i18n/          מילונים (he = מקור; הקומפיילר מוודא שאין חוסרים) + Provider
  src/components/    רכיבי UI נגישים, דיאלוגים, תפריט נגישות, הגדרות עוגיות
  src/middleware.ts  הפניה לפי שפה + CSP עם nonce לכל בקשה
  e2e/               בדיקות Playwright + axe (נגישות) מקצה לקצה
apps/api/            Fastify + TypeScript API
  src/config/        ולידציית משתני סביבה (השרת לא עולה עם קונפיג לא בטוח)
  src/db/            סכמת Drizzle, חיבור, מיגרציות
  src/http/          אבטחה (headers, CORS, Origin/CSRF, rate limit), שגיאות, guards
  src/lib/           הצפנה, סיסמאות, TOTP, מיילים, audit
  src/modules/       auth, account, vault, media (routes → service → db)
  src/worker.ts      תהליך רקע: בדיקת קבצים, סריקת וירוסים, הצפנה, ניקוי
  drizzle/           מיגרציות SQL
  test/              בדיקות אינטגרציה מול PostgreSQL אמיתי
packages/shared/     סכמות Zod וקטלוג שאלות, משותפים לשרת ולקליינט
```

## דרישות
- Node.js 22+, pnpm 10
- PostgreSQL 16, Redis 7, ClamAV (מקומי, או `docker compose up -d`)

## התקנה והרצה

```bash
pnpm install
docker compose up -d                 # PostgreSQL, Redis, ClamAV, Mailpit (מיילים: http://localhost:8025)
cp .env.example apps/api/.env
# מלא MASTER_KEY_BASE64 ו-HMAC_SECRET_BASE64:  openssl rand -base64 32
pnpm db:migrate
pnpm dev:api                         # http://localhost:4000/health
pnpm dev:worker                      # בטרמינל נוסף: עיבוד קבצים
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web                         # http://localhost:3000
```

לקבלת מיילים אמיתיים ב-Mailpit בזמן פיתוח: `MAIL_TRANSPORT=smtp` ו-`SMTP_URL=smtp://localhost:1025`.

## בדיקות

```bash
pnpm test        # 91 בדיקות: יחידה + אינטגרציה (דורש DB בשם inother_test ו-Redis)
pnpm e2e         # 18 בדיקות דפדפן: מסע משתמש מלא + axe לנגישות (דורש DB בשם inother_e2e)
pnpm typecheck
pnpm audit       # סריקת חולשות בתלויות
```

הבדיקות מכסות: העלאת קבצים (קובץ הרצה שמתחזה לתמונה, HTML שמתחזה לאודיו, וירוס EICAR, נפילת סורק, הסרת מטא-דאטה מתמונות), תרגומים, מניעת חשיפת משתמשים קיימים (enumeration), נעילת חשבון, rate limiting, תפוגת sessions, CSRF/Origin, איפוס סיסמה, MFA (כולל replay וקודי שחזור), **IDOR בין משתמשים**, הצפנה ב-DB, קשירת ciphertext לשורה (AAD), מגבלות, ייצוא ומחיקה.

## API (שלב 1)

🔒 = דורש התחברות ואימייל מאומת · 🔁 = דורש אימות מחדש מהדקות האחרונות (`POST /auth/reauth`)

| Method | Path | גישה |
|---|---|---|
| GET | `/health`, `/locales`, `/questions` | ציבורי |
| POST | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/login/mfa` | ציבורי + rate limit |
| POST | `/auth/password-reset/request`, `/auth/password-reset/confirm` | ציבורי + rate limit |
| POST | `/auth/logout`, `/auth/logout-all`, `/auth/resend-verification` | מחובר |
| POST | `/auth/password/change`, `/auth/reauth` | 🔒 |
| POST | `/auth/mfa/setup`, `/auth/mfa/confirm`, `/auth/mfa/disable` | 🔒🔁 |
| GET / PATCH | `/me` (כולל שינוי שפה) | מחובר |
| GET | `/me/sessions`, `/me/consents` | מחובר |
| POST | `/me/consents` | 🔒 |
| GET / DELETE | `/me/export`, `/me` | 🔒🔁 |
| POST / GET / PATCH | `/vault` | 🔒 |
| DELETE, GET | `/vault`, `/vault/export` | 🔒🔁 |
| CRUD | `/vault/beneficiaries[/:id]`, `/vault/executors[/:id]` | 🔒 |
| CRUD | `/vault/stories[/:id]` | 🔒 |
| GET / PUT / DELETE | `/vault/answers[/:questionId]` | 🔒 |
| GET / POST | `/vault/media` (רשימה / שמירת מקום להעלאה) | 🔒 |
| PUT | `/vault/media/:id/content` (העלאת הקובץ עצמו) | 🔒 |
| GET / PATCH / DELETE | `/vault/media/:id` | 🔒 |
| GET | `/vault/media/:id/content` (הורדה, רק לקבצים נקיים) | 🔒 |
| CRUD | `/vault/messages[/:id]` — מסרים מתוזמנים (לוח עברי, חגים, אירועי חיים) | 🔒 |
| GET / PUT | `/inheritances/:vaultId/messages`, `/inheritances/:vaultId/messages/pause` | 🔒 מוטב, כספת פתוחה |
| GET / POST | `/inheritances/:vaultId/messages/:id`, `.../:id/open`, `.../:id/stop` | 🔒 מוטב (רק שלו) |

### העלאת קובץ
1. `POST /vault/media` עם `{kind, contentType, sizeBytes, label?, storyId?}`. נבדקים סוג, גודל ומכסה.
2. `PUT` של הקובץ ל-`uploadUrl` עם `Content-Type` ו-`Content-Length` זהים למה שהוצהר.
3. הקובץ מוצפן כבר בזמן הקבלה ונכנס להסגר. ה-worker בודק את הסוג האמיתי לפי הבייטים, סורק ב-ClamAV, ובתמונות מקודד מחדש ומסיר מטא-דאטה (כולל מיקום GPS). רק אז הסטטוס משתנה ל-`clean` ואפשר להוריד את הקובץ.

כל בקשה שמשנה מצב (POST/PUT/PATCH/DELETE) חייבת לכלול `Origin` זהה ל-`WEB_ORIGIN`.
שגיאות מוחזרות בפורמט `{ "error": { "code", "requestId", "details?" } }` בלי פרטים פנימיים.

## האתר
- **עמודים ציבוריים:** דף בית, התחברות, הרשמה, אימות אימייל, שכחתי סיסמה ואיפוס, ו-4 מסמכים משפטיים (טיוטות בעברית ובאנגלית).
- **אזור אישי:** לוח הכספת, שאלות חיים, סיפורים חתומים, תמונות והקלטות (כולל הקלטת קול בדפדפן), מוטבים ונאמנים, והגדרות (פרופיל ושפה, הכספת, אימות דו-שלבי עם QR, סיסמה, חיבורים, הסכמות, ייצוא ומחיקה).
- **נגישות:** HTML סמנטי, קישור "דילוג לתוכן", ניווט מלא במקלדת, תוויות ושגיאות מקושרות, הודעות למקריאי מסך, דיאלוגים נגישים (`<dialog>`), ניגודיות AA, מצב כהה, `prefers-reduced-motion`, ותפריט נגישות (גודל טקסט, ניגודיות, הדגשת קישורים, גופן קריא, עצירת אנימציות).
- **פרטיות:** בלי פונטים חיצוניים, בלי אנליטיקה ובלי פיקסלים. רק עוגיית התחברות חיונית ועוגיית שפה. "הגדרות פרטיות ועוגיות" זמין מכל עמוד, ודחייה זמינה בדיוק כמו אישור.
- **אבטחה:** CSP עם nonce ייחודי לכל בקשה ו-`strict-dynamic`, `frame-ancestors 'none'`, HSTS. טוקנים מקישורי מייל נקראים מה-fragment ונמחקים מההיסטוריה. מידע אישי לא מרונדר בשרת ולא נשמר במטמון.

## אבטחה ופרטיות: מה מיושם
- **סיסמאות:** argon2id ‏(64MiB, t=3), חסימת סיסמאות חלשות, השוואת זמנים למניעת זיהוי משתמשים.
- **Sessions:** טוקן אקראי של 256 ביט. ב-DB נשמר רק ה-SHA-256 שלו. Cookie מסוג `__Host-` עם HttpOnly, Secure ו-SameSite=Lax. תפוגה לפי חוסר פעילות ותפוגה מוחלטת. ניתוק כל החיבורים בשינוי או איפוס סיסמה.
- **MFA:** ‏TOTP (RFC 6238) עם סוד מוצפן, הגנה מפני שימוש חוזר בקוד, 10 קודי שחזור חד-פעמיים, ונעילת challenge אחרי 5 ניסיונות.
- **הצפנה:** מפתח נפרד לכל כספת (AES-256-GCM), עטוף במפתח-על. שמות, אימיילים, סיפורים ותשובות מוצפנים, ו-AAD קושר כל ערך לשורה ולעמודה שלו. מחיקת כספת מוחקת גם את המפתח (crypto-shredding).
- **הרשאות:** אין מזהה כספת ב-URL. כל שאילתה מסוננת לפי המשתמש המחובר, ומשאב של משתמש אחר מחזיר 404.
- **HTTP:** ‏CSP `default-src 'none'`, HSTS, nosniff, no-store, CORS מוגבל, בדיקת Origin, הגבלת גודל בקשה, rate limit.
- **לוגים:** בלי סיסמאות, cookies, IP גולמי או query strings. יומן audit שאי אפשר לערוך (trigger ב-DB).
- **פרטיות:** הסכמות נפרדות לכל מטרה עם היסטוריה, ייצוא מלא בפורמט פתוח, ומחיקת חשבון מלאה.
- **קבצים:** רשימת סוגים מותרים, אימות הסוג האמיתי לפי הבייטים, מגבלות גודל ומכסה, הסגר, סריקת ClamAV שנכשלת בצורה סגורה (בלי סריקה הקובץ לא יוגש), שמות אקראיים בלי שם הקובץ המקורי, הצפנת זרם (STREAM / AES-256-GCM) עם מפתח הכספת, והורדה תמיד כ-attachment.

## לפני פרודקשן (פתוח)
ראה [`docs/BUILD.md`](docs/BUILD.md#לפני-פרודקשן-פתוח). בין היתר: KMS מנוהל, Redis ל-rate limit, RLS, בדיקת חדירות וייעוץ משפטי.
