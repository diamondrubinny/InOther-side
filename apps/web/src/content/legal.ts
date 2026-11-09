/**
 * Legal documents, Hebrew and English. TECHNICAL DRAFTS: they must be reviewed by a lawyer
 * (privacy/tech + inheritance), a privacy officer and an accessibility consultant before launch.
 * Items in [square brackets] must be filled in by the operator.
 */
export type LegalDoc = "privacy" | "terms" | "cookies" | "accessibility" | "promises";

export interface LegalContent {
  title: string;
  updated: string;
  sections: { heading: string; paragraphs: string[] }[];
}

const UPDATED = "2026-10-31";

export const LEGAL: Record<LegalDoc, { he: LegalContent; en: LegalContent }> = {
  /** Public commitments. DRAFT: each line is a public undertaking and needs business + legal sign-off. */
  promises: {
    he: {
      title: "ההבטחות שלנו",
      updated: "2026-11-09",
      sections: [
        { heading: "אין פרסומות, ולא מוכרים מידע", paragraphs: ["אין באתר פרסומות, פיקסלים או כלי מעקב שיווקיים. איננו מוכרים, משכירים או מוסרים מידע אישי לצורכי שיווק, ואיננו מאמנים מודלים של בינה מלאכותית על התוכן שלכם."] },
        { heading: "לא מוכרים לאנשים באבל", paragraphs: ["מי שמקבל מורשת לא יראה הצעות לשדרוג, מבצעים או לחץ לרכוש. מה שהמוריש השאיר — נמסר."] },
        { heading: "הדמות לעולם לא פונה ראשונה", paragraphs: ["דמות הבינה המלאכותית לא שולחת הודעות ביוזמתה, לא \"מתגעגעת\" ולא מבקשת שתחזרו. מספר השיחות מוגבל, ויש שיחת פרידה. היא תמיד מסומנת כהדמיה, ולא כאדם עצמו."] },
        { heading: "המידע שלכם נשאר שלכם", paragraphs: ["אפשר לייצא את כל התוכן בכל עת בפורמט פתוח, ולהפיק ספר מורשת להדפסה.", "מחיקה היא מחיקה: מחיקת כספת משמידה את מפתח ההצפנה שלה, כך שהתוכן אינו ניתן לשחזור."] },
        { heading: "רק מה שהמוריש החליט", paragraphs: ["הדמות והמסרים נבנים רק מחומר שהאדם עצמו השאיר ובהסכמתו. הוא קובע מי יקבל מה ומתי, ויכול לבחור שהכספת לא תיפתח לעולם."] },
        { heading: "אם השירות ייסגר", paragraphs: ["[תוכנית ההמשכיות טרם נקבעה — החלטה עסקית פתוחה. הכוונה: הודעה מוקדמת של [X] חודשים, ייצוא מלא לכל משתמש, ומסירת המורשות שכבר נפתחו.]"] },
      ],
    },
    en: {
      title: "Our promises",
      updated: "2026-11-09",
      sections: [
        { heading: "No ads, and we don't sell data", paragraphs: ["There are no ads, pixels or marketing trackers on this site. We do not sell, rent or hand over personal data for marketing, and we do not train AI models on your content."] },
        { heading: "We don't sell to people in grief", paragraphs: ["Someone receiving a legacy will not see upgrade offers, promotions or pressure to buy. What the legator left is delivered."] },
        { heading: "The persona never reaches out first", paragraphs: ["The AI persona does not send messages on its own initiative, does not \"miss you\" and does not ask you to come back. The number of conversations is limited, and there is a farewell conversation. It is always labelled as a simulation, not the person."] },
        { heading: "Your data stays yours", paragraphs: ["You can export everything at any time in an open format, and produce a printable legacy book.", "Deletion means deletion: deleting a vault destroys its encryption key, so the content cannot be recovered."] },
        { heading: "Only what the legator decided", paragraphs: ["The persona and the letters are built only from material the person themselves left, with their consent. They decide who receives what and when, and may choose that the vault is never released."] },
        { heading: "If the service closes", paragraphs: ["[The continuity plan is not yet decided — an open business decision. Intent: [X] months' advance notice, a full export for every user, and delivery of legacies already released.]"] },
      ],
    },
  },
  privacy: {
    he: {
      title: "מדיניות פרטיות",
      updated: UPDATED,
      sections: [
        { heading: "מי אנחנו", paragraphs: ["השירות מופעל על ידי [שם החברה, ח.פ., כתובת]. לפניות פרטיות: [privacy@example.com]. ממונה הגנת הפרטיות: [שם ופרטי קשר]."] },
        { heading: "איזה מידע אנחנו אוספים", paragraphs: [
          "פרטי חשבון: אימייל, שם לתצוגה, שפה מועדפת, סיסמה (נשמרת רק כגיבוב argon2id) ואישור גיל 18+.",
          "תוכן הכספת: תשובות לשאלות, סיפורים, תמונות, הקלטות וסרטונים שאתם מעלים, ופרטי מוטבים ונאמנים (שם, קרבה ואימייל, ובאופן אופציונלי תאריך הלידה של מוטב). מסרים מתוזמנים שאתם כותבים נשמרים מוצפנים יחד עם מועד המסירה שבחרתם.",
          "מידע טכני מינימלי: מזהה מוצפן (HMAC) של כתובת ה-IP לצורכי אבטחה ומניעת שימוש לרעה, וסוג הדפדפן לרשימת החיבורים הפעילים. אנחנו לא שומרים את כתובת ה-IP עצמה.",
        ] },
        { heading: "למה ועל איזה בסיס", paragraphs: [
          "מתן השירות (חוזה): ניהול החשבון ושמירת הכספת.",
          "הסכמה מפורשת: עיבוד תוכן הכספת, ובעתיד (רק אם תאשרו) שיבוט קול, יצירת אווטאר ועיבוד בבינה מלאכותית. אפשר למשוך כל הסכמה בכל עת בהגדרות.",
          "אינטרס לגיטימי ואבטחה: יומן אבטחה, מניעת הונאות והגבלת ניסיונות.",
        ] },
        { heading: "מידע רגיש ואנשים אחרים", paragraphs: [
          "קול ופנים עשויים להיחשב מידע ביומטרי, ותוכן הסיפורים עשוי לכלול מידע רגיש עליכם ועל אחרים. אנא שתפו מידע על אנשים אחרים רק כשיש לכך הצדקה, ושקלו את השפעתו עליהם.",
          "פרטי המוטבים והנאמנים נשמרים מוצפנים, ומשמשים רק לתהליך פתיחת הכספת. אם בחרתם בכך, הם משמשים גם להודעה מראש.",
        ] },
        { heading: "אבטחה", paragraphs: [
          "כל תוכן הכספת מוצפן ב-AES-256-GCM עם מפתח ייחודי לכל כספת. קבצים נסרקים לאיתור נוזקות, ומתמונות מוסר מידע מזהה כגון מיקום GPS. התקשורת מוצפנת (HTTPS). יש אימות דו-שלבי, נעילת חשבון ויומן אבטחה.",
        ] },
        { heading: "ספקים חיצוניים", paragraphs: [
          "אחסון ושרתים: [ספק ענן ואזור, למשל AWS eu-central-1]. דיוור: [ספק SMTP]. המידע הנשלח לספקים מוצפן ככל האפשר, ונחתמים מולם הסכמי עיבוד נתונים (DPA). כרגע לא נשלח תוכן לשירותי בינה מלאכותית.",
        ] },
        { heading: "שמירה ומחיקה", paragraphs: [
          "התוכן נשמר עד שתמחקו אותו, את הכספת או את החשבון. מחיקת כספת מוחקת גם את מפתח ההצפנה שלה, ולכן גם עותקים בגיבויים אינם ניתנים לקריאה. הזמנות העלאה שלא הושלמו נמחקות אחרי 24 שעות. יומן האבטחה נשמר [תקופה] ואינו כולל תוכן.",
        ] },
        { heading: "הזכויות שלכם", paragraphs: [
          "עיון וייצוא (בהגדרות, בקובץ JSON פתוח), תיקון, מחיקה, משיכת הסכמה, והגבלה או התנגדות לעיבוד. אפשר גם להגיש תלונה לרשות להגנת הפרטיות או לרשות פיקוח באיחוד האירופי.",
        ] },
        { heading: "קטינים", paragraphs: ["פתיחת חשבון מיועדת לבני 18 ומעלה בלבד.", "מוריש יכול לייעד מוטב קטין ולכתוב לו מסרים. תאריך הלידה (אם הוזן) משמש רק לתזמון מסרים ולהגנה: מוטב מתחת לגיל 18 לא יכול לשוחח עם דמות ה-AI. [מדיניות גישה של הורה/אפוטרופוס — טרם נקבעה, דורשת בדיקה משפטית.]"] },
      ],
    },
    en: {
      title: "Privacy Policy",
      updated: UPDATED,
      sections: [
        { heading: "Who we are", paragraphs: ["The service is operated by [company name, registration no., address]. Privacy contact: [privacy@example.com]. Data protection officer: [name and contact]."] },
        { heading: "What we collect", paragraphs: [
          "Account data: email, display name, preferred language, password (stored only as an argon2id hash) and confirmation that you are 18+.",
          "Vault content: answers, stories, photos, recordings and videos you upload, and beneficiary/executor details (name, relationship, email, and optionally a beneficiary's date of birth). Scheduled letters you write are stored encrypted together with the delivery moment you chose.",
          "Minimal technical data: a keyed hash (HMAC) of your IP address for security and abuse prevention, and your browser type for the active-sessions list. We do not store the IP address itself.",
        ] },
        { heading: "Why, and on what basis", paragraphs: [
          "Providing the service (contract): managing your account and storing your vault.",
          "Explicit consent: processing vault content and, in the future and only if you agree, voice cloning, avatar creation and AI processing. You can withdraw any consent at any time in Settings.",
          "Legitimate interest and security: security logging, fraud prevention and rate limiting.",
        ] },
        { heading: "Sensitive data and other people", paragraphs: [
          "Voice and face may be biometric data, and stories may contain sensitive information about you and others. Please share information about other people only where justified, and consider its effect on them.",
          "Beneficiary and executor details are stored encrypted and used only for the vault-release process. If you choose, they are also used for advance notification.",
        ] },
        { heading: "Security", paragraphs: [
          "All vault content is encrypted with AES-256-GCM using a key unique to each vault. Files are scanned for malware, and photos are stripped of identifying data such as GPS location. Traffic is encrypted (HTTPS). We use two-factor authentication, account lockout and a security log.",
        ] },
        { heading: "Third-party providers", paragraphs: [
          "Hosting: [cloud provider and region, e.g. AWS eu-central-1]. Email: [SMTP provider]. Data sent to providers is encrypted wherever possible, and data processing agreements (DPAs) are signed with them. No content is currently sent to AI services.",
        ] },
        { heading: "Retention and deletion", paragraphs: [
          "Content is kept until you delete it, your vault or your account. Deleting a vault also deletes its encryption key, so even backup copies become unreadable. Unfinished upload reservations are deleted after 24 hours. Security logs are kept for [period] and contain no content.",
        ] },
        { heading: "Your rights", paragraphs: [
          "Access and export (in Settings, as an open JSON file), rectification, erasure, withdrawal of consent, and restriction of or objection to processing. You may also complain to the Israeli Privacy Protection Authority or an EU supervisory authority.",
        ] },
        { heading: "Minors", paragraphs: ["Accounts are for people aged 18 and over only.", "A legator may designate a minor beneficiary and write letters for them. The date of birth (if entered) is used only to schedule letters and for protection: a beneficiary under 18 cannot talk with the AI persona. [Parent/guardian access policy — not yet decided; requires legal review.]"] },
      ],
    },
  },
  terms: {
    he: {
      title: "תנאי שימוש",
      updated: UPDATED,
      sections: [
        { heading: "השירות", paragraphs: ["השירות מאפשר לבנות כספת מורשת אישית. בעתיד יהיה אפשר להפוך אותה לדמות בינה מלאכותית שיקיריכם יוכלו לשוחח איתה אחרי פטירתכם, לפי הכללים שתקבעו."] },
        { heading: "מה השירות אינו", paragraphs: [
          "הדמות היא הדמיה של בינה מלאכותית ולא האדם עצמו. היא עלולה לטעות.",
          "השירות אינו טיפול פסיכולוגי ואינו תחליף לו, ואינו צוואה או מסמך משפטי מחייב. במצוקה: ער\"ן 1201, סה\"ר sahar.org.il, או מד\"א 101.",
        ] },
        { heading: "האחריות שלכם", paragraphs: [
          "להעלות רק תוכן שיש לכם זכות להעלות, לא להעלות תוכן בלתי חוקי או פוגעני, ולשקול את השפעת התוכן על צדדים שלישיים. אסור לנסות לגשת למידע של אחרים או לפגוע באבטחת השירות.",
        ] },
        { heading: "פתיחת הכספת", paragraphs: ["הכספת נפתחת רק אחרי אימות פטירה, תקופת המתנה ואישור הנאמנים, לפי ההגדרות שלכם. כל עוד אתם בחיים, אפשר לבטל, לשנות או למחוק הכול."] },
        { heading: "המשכיות", paragraphs: ["אפשר לייצא את כל המידע בכל עת בפורמט פתוח. [תוכנית ההמשכיות למקרה של הפסקת השירות תפורט כאן.]"] },
        { heading: "הגבלת אחריות ודין", paragraphs: ["[סעיפי הגבלת אחריות, סמכות שיפוט ודין חל: יוגדרו ע\"י עורך דין.]"] },
      ],
    },
    en: {
      title: "Terms of Use",
      updated: UPDATED,
      sections: [
        { heading: "The service", paragraphs: ["The service lets you build a personal legacy vault. In the future it may become an AI persona that your loved ones can talk with after your passing, under the rules you set."] },
        { heading: "What the service is not", paragraphs: [
          "The persona is an AI simulation, not the person. It may make mistakes.",
          "The service is not psychological therapy or a substitute for it, and it is not a will or a legally binding document. In distress (Israel): ERAN 1201, SAHAR sahar.org.il, or emergency 101.",
        ] },
        { heading: "Your responsibilities", paragraphs: [
          "Upload only content you have the right to upload, never unlawful or abusive content, and consider the effect on third parties. Do not attempt to access others' data or compromise the service's security.",
        ] },
        { heading: "Opening the vault", paragraphs: ["The vault opens only after a verified passing, a waiting period and executor confirmation, according to your settings. While you are alive you can cancel, change or delete everything."] },
        { heading: "Continuity", paragraphs: ["You can export all your data at any time in an open format. [The continuity plan in case the service ends will be described here.]"] },
        { heading: "Liability and governing law", paragraphs: ["[Limitation of liability, jurisdiction and governing law: to be drafted by counsel.]"] },
      ],
    },
  },
  cookies: {
    he: {
      title: "מדיניות עוגיות",
      updated: UPDATED,
      sections: [
        { heading: "בקצרה", paragraphs: ["אנחנו משתמשים רק בעוגיות חיוניות. אין עוגיות פרסום, אין פיקסלים, ואין כלי אנליטיקה או מעקב של צד שלישי."] },
        { heading: "רשימת העוגיות ואחסון בדפדפן", paragraphs: [
          "__Host-inother_sid: עוגיית התחברות חיונית (HttpOnly, Secure, SameSite=Lax). נמחקת בהתנתקות, אחרי 24 שעות ללא פעילות, או לכל היותר אחרי 30 יום.",
          "inother_locale: העדפת שפה (פונקציונלית). נשמרת עד שנה.",
          "inother_a11y ו-inother_cookie_consent: העדפות נגישות ופרטיות. נשמרות ב-localStorage בדפדפן שלכם ואינן נשלחות אלינו.",
        ] },
        { heading: "שינוי העדפות", paragraphs: ["אפשר לפתוח את \"הגדרות פרטיות ועוגיות\" בתחתית כל עמוד. אם נוסיף בעתיד כלים לא חיוניים, הם ייטענו רק אחרי הסכמה מפורשת."] },
      ],
    },
    en: {
      title: "Cookie Policy",
      updated: UPDATED,
      sections: [
        { heading: "In short", paragraphs: ["We use only essential cookies. No advertising cookies, no pixels, and no third-party analytics or tracking tools."] },
        { heading: "Cookies and browser storage", paragraphs: [
          "__Host-inother_sid: essential sign-in cookie (HttpOnly, Secure, SameSite=Lax). Deleted on sign-out, after 24 hours of inactivity, or after 30 days at most.",
          "inother_locale: language preference (functional). Kept for up to one year.",
          "inother_a11y and inother_cookie_consent: accessibility and privacy preferences. Stored in your browser's localStorage and never sent to us.",
        ] },
        { heading: "Changing preferences", paragraphs: ["Open \"Privacy & cookie settings\" at the bottom of any page. If we ever add non-essential tools, they will load only after explicit consent."] },
      ],
    },
  },
  accessibility: {
    he: {
      title: "הצהרת נגישות",
      updated: UPDATED,
      sections: [
        { heading: "המחויבות שלנו", paragraphs: ["אנחנו רואים בנגישות חלק בסיסי מהשירות, במיוחד לאוכלוסייה מבוגרת ולאנשים בתקופת אבל."] },
        { heading: "רמת הנגישות", paragraphs: ["האתר מתוכנן לעמוד ב-WCAG 2.1 ברמה AA ובתקן הישראלי ת\"י 5568. [מצב התאימות יעודכן אחרי בדיקת מומחה.]"] },
        { heading: "התאמות שבוצעו", paragraphs: [
          "מבנה סמנטי וכותרות היררכיות, ניווט מלא במקלדת עם פוקוס בולט, וקישור \"דילוג לתוכן\".",
          "תמיכה מלאה בעברית ובערבית מימין לשמאל, ובארבע שפות נוספות.",
          "תוויות והודעות שגיאה נגישות לטפסים, הודעות סטטוס לקוראי מסך, וחלונות דו-שיח נגישים.",
          "ניגודיות צבעים מספקת, תמיכה במצב כהה ובהגדלה עד 200%, וכיבוד העדפת הפחתת תנועה.",
          "תפריט נגישות: הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים, גופן קריא ועצירת אנימציות.",
        ] },
        { heading: "מגבלות ידועות", paragraphs: ["תמלול אוטומטי להקלטות קול ווידאו טרם זמין. [מגבלות נוספות יפורטו אחרי בדיקה.]"] },
        { heading: "פניות נגישות", paragraphs: ["רכז/ת הנגישות: [שם], [טלפון], [accessibility@example.com]. נשתדל להשיב תוך [5] ימי עבודה."] },
      ],
    },
    en: {
      title: "Accessibility Statement",
      updated: UPDATED,
      sections: [
        { heading: "Our commitment", paragraphs: ["We see accessibility as a core part of the service, especially for older people and people who are grieving."] },
        { heading: "Conformance target", paragraphs: ["The site is designed to meet WCAG 2.1 Level AA and Israeli Standard IS 5568. [Conformance status will be updated after an expert audit.]"] },
        { heading: "Measures taken", paragraphs: [
          "Semantic structure and heading hierarchy, full keyboard navigation with visible focus, and a \"skip to content\" link.",
          "Full right-to-left support for Hebrew and Arabic, plus four more languages.",
          "Accessible form labels and error messages, screen-reader status announcements, and accessible dialogs.",
          "Sufficient color contrast, dark mode, zoom up to 200%, and respect for reduced-motion preferences.",
          "Accessibility menu: larger text, high contrast, highlighted links, readable font and stopping animations.",
        ] },
        { heading: "Known limitations", paragraphs: ["Automatic captions for voice and video recordings are not yet available. [More limitations will be listed after the audit.]"] },
        { heading: "Accessibility contact", paragraphs: ["Accessibility coordinator: [name], [phone], [accessibility@example.com]. We aim to respond within [5] business days."] },
      ],
    },
  },
};
