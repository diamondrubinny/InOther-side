import type { Locale } from "@inother/shared";
import type { MailMessage } from "../../lib/mailer.js";

/**
 * Transactional email templates in every supported locale.
 * NOTE: Non-Hebrew/English copy is a draft and must be reviewed by native speakers before launch.
 */
type Template<A extends unknown[]> = Record<Locale, (...args: A) => { subject: string; lines: string[] }>;

const verifyEmail: Template<[link: string]> = {
  he: (link) => ({
    subject: "אימות כתובת האימייל שלך",
    lines: ["שלום,", "", "כדי להשלים את ההרשמה, יש לאמת את כתובת האימייל בקישור הבא (בתוקף ל-24 שעות):", link, "", "אם לא נרשמת, אפשר להתעלם מהודעה זו."],
  }),
  en: (link) => ({
    subject: "Verify your email address",
    lines: ["Hello,", "", "To finish signing up, please verify your email address using this link (valid for 24 hours):", link, "", "If you didn't sign up, you can ignore this message."],
  }),
  ar: (link) => ({
    subject: "تأكيد عنوان بريدك الإلكتروني",
    lines: ["مرحبًا،", "", "لإكمال التسجيل، يرجى تأكيد بريدك الإلكتروني عبر الرابط التالي (صالح لمدة 24 ساعة):", link, "", "إذا لم تقم بالتسجيل، يمكنك تجاهل هذه الرسالة."],
  }),
  ru: (link) => ({
    subject: "Подтвердите адрес электронной почты",
    lines: ["Здравствуйте!", "", "Чтобы завершить регистрацию, подтвердите адрес по ссылке (действует 24 часа):", link, "", "Если вы не регистрировались, просто проигнорируйте это письмо."],
  }),
  fr: (link) => ({
    subject: "Confirmez votre adresse e-mail",
    lines: ["Bonjour,", "", "Pour finaliser votre inscription, confirmez votre adresse via ce lien (valable 24 heures) :", link, "", "Si vous ne vous êtes pas inscrit, ignorez ce message."],
  }),
  es: (link) => ({
    subject: "Verifica tu dirección de correo",
    lines: ["Hola:", "", "Para completar el registro, verifica tu correo con este enlace (válido durante 24 horas):", link, "", "Si no te registraste, puedes ignorar este mensaje."],
  }),
};

const alreadyRegistered: Template<[loginLink: string, resetLink: string]> = {
  he: (login, reset) => ({
    subject: "ניסיון הרשמה עם האימייל שלך",
    lines: ["שלום,", "", "מישהו ניסה להירשם עם כתובת האימייל הזו, אבל כבר יש לך חשבון.", `להתחברות: ${login}`, `שכחת סיסמה? ${reset}`, "", "אם זה לא היית את/ה, אין צורך לעשות דבר."],
  }),
  en: (login, reset) => ({
    subject: "Sign-up attempt with your email",
    lines: ["Hello,", "", "Someone tried to sign up with this email address, but you already have an account.", `Sign in: ${login}`, `Forgot your password? ${reset}`, "", "If this wasn't you, no action is needed."],
  }),
  ar: (login, reset) => ({
    subject: "محاولة تسجيل باستخدام بريدك الإلكتروني",
    lines: ["مرحبًا،", "", "حاول شخص ما التسجيل بهذا البريد الإلكتروني، لكن لديك حساب بالفعل.", `لتسجيل الدخول: ${login}`, `نسيت كلمة المرور؟ ${reset}`, "", "إذا لم تكن أنت، فلا داعي لأي إجراء."],
  }),
  ru: (login, reset) => ({
    subject: "Попытка регистрации с вашим адресом",
    lines: ["Здравствуйте!", "", "Кто-то пытался зарегистрироваться с этим адресом, но у вас уже есть аккаунт.", `Войти: ${login}`, `Забыли пароль? ${reset}`, "", "Если это были не вы, ничего делать не нужно."],
  }),
  fr: (login, reset) => ({
    subject: "Tentative d'inscription avec votre e-mail",
    lines: ["Bonjour,", "", "Quelqu'un a tenté de s'inscrire avec cette adresse, mais vous avez déjà un compte.", `Se connecter : ${login}`, `Mot de passe oublié ? ${reset}`, "", "Si ce n'était pas vous, aucune action n'est nécessaire."],
  }),
  es: (login, reset) => ({
    subject: "Intento de registro con tu correo",
    lines: ["Hola:", "", "Alguien intentó registrarse con este correo, pero ya tienes una cuenta.", `Iniciar sesión: ${login}`, `¿Olvidaste tu contraseña? ${reset}`, "", "Si no fuiste tú, no necesitas hacer nada."],
  }),
};

const passwordReset: Template<[link: string]> = {
  he: (link) => ({
    subject: "איפוס סיסמה",
    lines: ["שלום,", "", "התקבלה בקשה לאיפוס הסיסמה. הקישור בתוקף ל-30 דקות ולשימוש חד-פעמי:", link, "", "אם לא ביקשת איפוס, התעלם/י מהודעה זו. הסיסמה שלך לא שונתה."],
  }),
  en: (link) => ({
    subject: "Reset your password",
    lines: ["Hello,", "", "We received a request to reset your password. This one-time link is valid for 30 minutes:", link, "", "If you didn't request this, ignore this message. Your password has not changed."],
  }),
  ar: (link) => ({
    subject: "إعادة تعيين كلمة المرور",
    lines: ["مرحبًا،", "", "تلقّينا طلبًا لإعادة تعيين كلمة المرور. هذا الرابط صالح لمرة واحدة ولمدة 30 دقيقة:", link, "", "إذا لم تطلب ذلك، تجاهل هذه الرسالة. لم تتغيّر كلمة المرور."],
  }),
  ru: (link) => ({
    subject: "Сброс пароля",
    lines: ["Здравствуйте!", "", "Мы получили запрос на сброс пароля. Одноразовая ссылка действует 30 минут:", link, "", "Если вы этого не запрашивали, проигнорируйте письмо. Пароль не изменён."],
  }),
  fr: (link) => ({
    subject: "Réinitialisation du mot de passe",
    lines: ["Bonjour,", "", "Nous avons reçu une demande de réinitialisation. Ce lien à usage unique est valable 30 minutes :", link, "", "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message. Votre mot de passe n'a pas changé."],
  }),
  es: (link) => ({
    subject: "Restablecer contraseña",
    lines: ["Hola:", "", "Recibimos una solicitud para restablecer tu contraseña. Este enlace de un solo uso es válido durante 30 minutos:", link, "", "Si no lo solicitaste, ignora este mensaje. Tu contraseña no ha cambiado."],
  }),
};

export type SecurityEvent = "account_locked" | "password_reset" | "password_changed";

const securityEventText: Record<SecurityEvent, Record<Locale, string>> = {
  account_locked: {
    he: "זוהו מספר ניסיונות התחברות כושלים לחשבון שלך, וההתחברות נחסמה זמנית.",
    en: "Several failed sign-in attempts were detected on your account, and sign-in was temporarily blocked.",
    ar: "تم رصد عدة محاولات فاشلة لتسجيل الدخول إلى حسابك، وتم حظر تسجيل الدخول مؤقتًا.",
    ru: "Обнаружено несколько неудачных попыток входа в ваш аккаунт, вход временно заблокирован.",
    fr: "Plusieurs tentatives de connexion échouées ont été détectées ; la connexion est temporairement bloquée.",
    es: "Se detectaron varios intentos fallidos de inicio de sesión y el acceso se bloqueó temporalmente.",
  },
  password_reset: {
    he: "הסיסמה לחשבון שלך שונתה, וכל החיבורים הפעילים נותקו.",
    en: "Your password was changed and all active sessions were signed out.",
    ar: "تم تغيير كلمة مرور حسابك وتسجيل الخروج من جميع الجلسات النشطة.",
    ru: "Пароль вашего аккаунта изменён, все активные сеансы завершены.",
    fr: "Votre mot de passe a été modifié et toutes les sessions actives ont été fermées.",
    es: "Tu contraseña se cambió y se cerraron todas las sesiones activas.",
  },
  password_changed: {
    he: "הסיסמה לחשבון שלך שונתה.",
    en: "Your account password was changed.",
    ar: "تم تغيير كلمة مرور حسابك.",
    ru: "Пароль вашего аккаунта был изменён.",
    fr: "Le mot de passe de votre compte a été modifié.",
    es: "Se cambió la contraseña de tu cuenta.",
  },
};

const securityNotice: Template<[event: SecurityEvent]> = {
  he: (e) => ({ subject: "התראת אבטחה בחשבון", lines: ["שלום,", "", securityEventText[e].he, "", "אם זה לא היית את/ה, אפס/י סיסמה מיד ופנה/י אלינו."] }),
  en: (e) => ({ subject: "Security notice", lines: ["Hello,", "", securityEventText[e].en, "", "If this wasn't you, reset your password immediately and contact us."] }),
  ar: (e) => ({ subject: "تنبيه أمني", lines: ["مرحبًا،", "", securityEventText[e].ar, "", "إذا لم تكن أنت، أعد تعيين كلمة المرور فورًا وتواصل معنا."] }),
  ru: (e) => ({ subject: "Уведомление безопасности", lines: ["Здравствуйте!", "", securityEventText[e].ru, "", "Если это были не вы, немедленно смените пароль и свяжитесь с нами."] }),
  fr: (e) => ({ subject: "Alerte de sécurité", lines: ["Bonjour,", "", securityEventText[e].fr, "", "Si ce n'était pas vous, réinitialisez immédiatement votre mot de passe et contactez-nous."] }),
  es: (e) => ({ subject: "Aviso de seguridad", lines: ["Hola:", "", securityEventText[e].es, "", "Si no fuiste tú, restablece tu contraseña de inmediato y contáctanos."] }),
};

function render(to: string, locale: Locale, content: { subject: string; lines: string[] }): MailMessage {
  return { to, subject: content.subject, text: content.lines.join("\n") };
}

export const emails = {
  verifyEmail: (to: string, locale: Locale, link: string) => render(to, locale, verifyEmail[locale](link)),
  alreadyRegistered: (to: string, locale: Locale, loginLink: string, resetLink: string) =>
    render(to, locale, alreadyRegistered[locale](loginLink, resetLink)),
  passwordReset: (to: string, locale: Locale, link: string) => render(to, locale, passwordReset[locale](link)),
  securityNotice: (to: string, locale: Locale, event: SecurityEvent) => render(to, locale, securityNotice[locale](event)),
};
