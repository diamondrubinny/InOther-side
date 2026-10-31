import type { MailMessage } from "../../lib/mailer.js";

/** Transactional email templates. Hebrew first, short English line for non-Hebrew readers. */

export function verifyEmailMessage(to: string, link: string): MailMessage {
  return {
    to,
    subject: "אימות כתובת האימייל שלך | Verify your email",
    text: [
      "שלום,",
      "",
      "כדי להשלים את ההרשמה, יש לאמת את כתובת האימייל בקישור הבא (בתוקף ל-24 שעות):",
      link,
      "",
      "אם לא נרשמת, אפשר להתעלם מהודעה זו.",
      "",
      "To finish signing up, open the link above (valid for 24 hours).",
    ].join("\n"),
  };
}

export function alreadyRegisteredMessage(to: string, loginLink: string, resetLink: string): MailMessage {
  return {
    to,
    subject: "ניסיון הרשמה עם האימייל שלך | Sign-up attempt",
    text: [
      "שלום,",
      "",
      "מישהו ניסה להירשם עם כתובת האימייל הזו, אבל כבר יש לך חשבון.",
      `להתחברות: ${loginLink}`,
      `שכחת סיסמה? ${resetLink}`,
      "",
      "אם זה לא היית את/ה, אין צורך לעשות דבר.",
    ].join("\n"),
  };
}

export function passwordResetMessage(to: string, link: string): MailMessage {
  return {
    to,
    subject: "איפוס סיסמה | Password reset",
    text: [
      "שלום,",
      "",
      "התקבלה בקשה לאיפוס הסיסמה. הקישור בתוקף ל-30 דקות ולשימוש חד-פעמי:",
      link,
      "",
      "אם לא ביקשת איפוס, התעלם/י מהודעה זו. הסיסמה שלך לא שונתה.",
      "",
      "Use the link above within 30 minutes to reset your password.",
    ].join("\n"),
  };
}

export function securityNoticeMessage(to: string, what: string): MailMessage {
  return {
    to,
    subject: "התראת אבטחה בחשבון | Security notice",
    text: [
      "שלום,",
      "",
      `רצינו לעדכן: ${what}`,
      "",
      "אם זה לא היית את/ה, אפס/י סיסמה מיד ופנה/י אלינו.",
    ].join("\n"),
  };
}
