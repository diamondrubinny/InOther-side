import type { Locale } from "@inother/shared";
import type { MailMessage } from "../../lib/mailer.js";

/**
 * Emails for invitations and the release-after-death flow.
 * Tone matters: recipients may be grieving. NOTE: non-Hebrew/English copy is a draft
 * and must be reviewed by native speakers (ideally with grief-care sensitivity).
 */
type Content = { subject: string; lines: string[] };
type Template<A extends unknown[]> = Record<Locale, (...args: A) => Content>;

const executorInvite: Template<[name: string, link: string]> = {
  he: (n, l) => ({ subject: `${n} בחר/ה בך כנאמן/ה`, lines: ["שלום,", "", `${n} בחר/ה בך כאיש/אשת אמון בשירות InOther-side. התפקיד: אם יום אחד ${n} ילך/תלך לעולמו/ה, לדווח על כך כדי שהמורשת שהשאיר/ה תגיע ליקיריו/ה.`, "אין לך גישה לתוכן עצמו.", "", "לאישור התפקיד (יש ליצור חשבון או להתחבר עם כתובת המייל הזו):", l, "", "אם אינך מכיר/ה את השולח/ת, אפשר להתעלם מהודעה זו."] }),
  en: (n, l) => ({ subject: `${n} chose you as an executor`, lines: ["Hello,", "", `${n} chose you as a trusted person on InOther-side. Your role: if ${n} passes away one day, report it so the legacy they left reaches their loved ones.`, "You have no access to the content itself.", "", "To accept (sign up or sign in with this email address):", l, "", "If you don't know the sender, you can ignore this message."] }),
  ar: (n, l) => ({ subject: `اختارك ${n} أمينًا`, lines: ["مرحبًا،", "", `اختارك ${n} شخصًا موثوقًا في InOther-side. دورك: إذا توفّي ${n} يومًا ما، أن تبلّغ عن ذلك كي يصل الإرث إلى أحبّائه.`, "ليس لديك وصول إلى المحتوى نفسه.", "", "لقبول الدور (أنشئ حسابًا أو سجّل الدخول بهذا البريد):", l, "", "إذا كنت لا تعرف المرسل، يمكنك تجاهل هذه الرسالة."] }),
  ru: (n, l) => ({ subject: `${n} выбрал(а) вас доверенным лицом`, lines: ["Здравствуйте!", "", `${n} выбрал(а) вас доверенным лицом в InOther-side. Ваша роль: если однажды ${n} уйдёт из жизни, сообщить об этом, чтобы наследие дошло до близких.`, "Доступа к самому содержимому у вас нет.", "", "Чтобы принять роль (зарегистрируйтесь или войдите с этим адресом):", l, "", "Если вы не знаете отправителя, просто проигнорируйте письмо."] }),
  fr: (n, l) => ({ subject: `${n} vous a choisi comme exécuteur`, lines: ["Bonjour,", "", `${n} vous a choisi comme personne de confiance sur InOther-side. Votre rôle : si ${n} venait à décéder, le signaler pour que son héritage parvienne à ses proches.`, "Vous n'avez pas accès au contenu lui-même.", "", "Pour accepter (inscrivez-vous ou connectez-vous avec cette adresse) :", l, "", "Si vous ne connaissez pas l'expéditeur, ignorez ce message."] }),
  es: (n, l) => ({ subject: `${n} te eligió como albacea`, lines: ["Hola:", "", `${n} te eligió como persona de confianza en InOther-side. Tu papel: si ${n} fallece algún día, comunicarlo para que su legado llegue a sus seres queridos.`, "No tienes acceso al contenido en sí.", "", "Para aceptar (regístrate o inicia sesión con este correo):", l, "", "Si no conoces al remitente, puedes ignorar este mensaje."] }),
};

const beneficiaryInvite: Template<[name: string, link: string]> = {
  he: (n, l) => ({ subject: `${n} השאיר/ה לך מורשת`, lines: ["שלום,", "", `${n} בנה/בנתה ב-InOther-side מורשת אישית: סיפורים, זיכרונות והקלטות, ובחר/ה שתהיה/י בין מי שיקבלו אותה.`, "התוכן ייפתח רק אחרי פטירה מאומתת. עד אז הוא נשאר פרטי.", "", "לחיבור החשבון שלך (הרשמה או התחברות עם כתובת המייל הזו):", l] }),
  en: (n, l) => ({ subject: `${n} has left you a legacy`, lines: ["Hello,", "", `${n} built a personal legacy on InOther-side (stories, memories and recordings) and chose you as one of the people who will receive it.`, "It opens only after a verified passing. Until then it stays private.", "", "To link your account (sign up or sign in with this email address):", l] }),
  ar: (n, l) => ({ subject: `ترك لك ${n} إرثًا`, lines: ["مرحبًا،", "", `بنى ${n} في InOther-side إرثًا شخصيًا من قصص وذكريات وتسجيلات، واختارك ضمن من سيتلقّونه.`, "لن يُفتح إلا بعد وفاة موثّقة، ويبقى خاصًا حتى ذلك الحين.", "", "لربط حسابك (أنشئ حسابًا أو سجّل الدخول بهذا البريد):", l] }),
  ru: (n, l) => ({ subject: `${n} оставил(а) вам наследие`, lines: ["Здравствуйте!", "", `${n} создал(а) в InOther-side личное наследие (истории, воспоминания, записи) и выбрал(а) вас среди тех, кто его получит.`, "Оно откроется только после подтверждённой смерти. До тех пор оно остаётся личным.", "", "Чтобы привязать аккаунт (зарегистрируйтесь или войдите с этим адресом):", l] }),
  fr: (n, l) => ({ subject: `${n} vous a laissé un héritage`, lines: ["Bonjour,", "", `${n} a constitué sur InOther-side un héritage personnel (histoires, souvenirs, enregistrements) et vous a choisi parmi ceux qui le recevront.`, "Il ne s'ouvrira qu'après un décès vérifié. D'ici là, il reste privé.", "", "Pour associer votre compte (inscrivez-vous ou connectez-vous avec cette adresse) :", l] }),
  es: (n, l) => ({ subject: `${n} te ha dejado un legado`, lines: ["Hola:", "", `${n} creó en InOther-side un legado personal (historias, recuerdos y grabaciones) y te eligió entre quienes lo recibirán.`, "Solo se abrirá tras un fallecimiento verificado. Hasta entonces, es privado.", "", "Para vincular tu cuenta (regístrate o inicia sesión con este correo):", l] }),
};

const legacyReleased: Template<[name: string, link: string]> = {
  he: (n, l) => ({ subject: `המורשת של ${n} מחכה לך`, lines: ["שלום,", "", `אנחנו משתתפים בצערך. ${n} השאיר/ה עבורך מורשת: סיפורים, זיכרונות והקלטות, והיא נפתחה עכשיו.`, "אין צורך למהר. אפשר לחזור אליה בכל זמן ובקצב שלך.", "", l, "", "אם קשה לך, אפשר לפנות לער\"ן בטלפון 1201 או לסה\"ר (sahar.org.il)."] }),
  en: (n, l) => ({ subject: `${n}'s legacy is waiting for you`, lines: ["Hello,", "", `We are sorry for your loss. ${n} left a legacy for you (stories, memories and recordings), and it is now open.`, "There is no rush. You can return to it at any time, at your own pace.", "", l, "", "If you are struggling, please reach out to someone you trust or a local support line (in Israel: ERAN 1201)."] }),
  ar: (n, l) => ({ subject: `إرث ${n} بانتظارك`, lines: ["مرحبًا،", "", `نشاطرك الأحزان. ترك لك ${n} إرثًا من قصص وذكريات وتسجيلات، وقد فُتح الآن.`, "لا داعي للعجلة. يمكنك العودة إليه في أي وقت وبالوتيرة التي تناسبك.", "", l, "", "إذا كنت تمرّ بوقت صعب، تواصل مع شخص تثق به أو مع خط دعم (في إسرائيل: عيران 1201)."] }),
  ru: (n, l) => ({ subject: `Наследие ${n} ждёт вас`, lines: ["Здравствуйте!", "", `Примите наши соболезнования. ${n} оставил(а) для вас наследие (истории, воспоминания, записи), и сейчас оно открыто.`, "Торопиться не нужно. Возвращайтесь к нему когда угодно, в своём темпе.", "", l, "", "Если вам тяжело, обратитесь к близкому человеку или на линию поддержки (в Израиле: ЭРАН 1201)."] }),
  fr: (n, l) => ({ subject: `L'héritage de ${n} vous attend`, lines: ["Bonjour,", "", `Nous partageons votre peine. ${n} vous a laissé un héritage (histoires, souvenirs, enregistrements), désormais ouvert.`, "Rien ne presse. Vous pouvez y revenir à tout moment, à votre rythme.", "", l, "", "Si c'est difficile, parlez-en à une personne de confiance ou à une ligne d'écoute (en Israël : ERAN 1201)."] }),
  es: (n, l) => ({ subject: `El legado de ${n} te espera`, lines: ["Hola:", "", `Lamentamos tu pérdida. ${n} te dejó un legado (historias, recuerdos y grabaciones) y ya está abierto.`, "No hay prisa. Puedes volver a él cuando quieras, a tu ritmo.", "", l, "", "Si lo estás pasando mal, habla con alguien de confianza o con una línea de apoyo (en Israel: ERAN 1201)."] }),
};

const deathReported: Template<[cancelLink: string, waitDays: number]> = {
  he: (l, d) => ({ subject: "חשוב: התקבל דיווח על פטירתך", lines: ["שלום,", "", "אחד הנאמנים שבחרת דיווח לנו על פטירתך. אם קיבלת הודעה זו ואת/ה בחיים, זו טעות או ניסיון לרעה.", "", "לביטול מיידי של הדיווח:", l, "", `אם לא יבוטל, הכספת תיפתח למוטבים רק אחרי אימות ותקופת המתנה של ${d} ימים.`] }),
  en: (l, d) => ({ subject: "Important: a report of your passing was filed", lines: ["Hello,", "", "One of your executors reported your passing to us. If you are reading this and you are alive, this is a mistake or an abuse.", "", "Cancel the report immediately:", l, "", `If not cancelled, the vault opens to your beneficiaries only after verification and a ${d}-day waiting period.`] }),
  ar: (l, d) => ({ subject: "هام: تم الإبلاغ عن وفاتك", lines: ["مرحبًا،", "", "أبلغنا أحد الأمناء الذين اخترتهم بوفاتك. إذا كنت تقرأ هذه الرسالة وأنت على قيد الحياة، فهذا خطأ أو إساءة.", "", "لإلغاء البلاغ فورًا:", l, "", `إن لم يُلغَ، لن تُفتح الخزنة للمستفيدين إلا بعد التحقق وفترة انتظار مدتها ${d} يومًا.`] }),
  ru: (l, d) => ({ subject: "Важно: поступило сообщение о вашей смерти", lines: ["Здравствуйте!", "", "Одно из ваших доверенных лиц сообщило нам о вашей смерти. Если вы читаете это и живы, это ошибка или злоупотребление.", "", "Немедленно отменить сообщение:", l, "", `Если его не отменить, хранилище откроется наследникам только после проверки и ${d} дней ожидания.`] }),
  fr: (l, d) => ({ subject: "Important : votre décès a été signalé", lines: ["Bonjour,", "", "L'un de vos exécuteurs nous a signalé votre décès. Si vous lisez ceci et êtes en vie, il s'agit d'une erreur ou d'un abus.", "", "Annuler immédiatement le signalement :", l, "", `Sans annulation, le coffre ne s'ouvrira à vos bénéficiaires qu'après vérification et un délai de ${d} jours.`] }),
  es: (l, d) => ({ subject: "Importante: se ha notificado tu fallecimiento", lines: ["Hola:", "", "Uno de tus albaceas nos notificó tu fallecimiento. Si estás leyendo esto y sigues con vida, es un error o un abuso.", "", "Cancela la notificación de inmediato:", l, "", `Si no se cancela, el cofre solo se abrirá a tus beneficiarios tras una verificación y un periodo de espera de ${d} días.`] }),
};

const reportCancelled: Template<[name: string]> = {
  he: (n) => ({ subject: "הדיווח בוטל", lines: ["שלום,", "", `הדיווח על פטירתו/ה של ${n} בוטל על ידי ${n} עצמו/ה. לא נדרשת פעולה נוספת.`] }),
  en: (n) => ({ subject: "The report was cancelled", lines: ["Hello,", "", `The report of ${n}'s passing was cancelled by ${n}. No further action is needed.`] }),
  ar: (n) => ({ subject: "تم إلغاء البلاغ", lines: ["مرحبًا،", "", `ألغى ${n} بنفسه البلاغ عن وفاته. لا حاجة لأي إجراء آخر.`] }),
  ru: (n) => ({ subject: "Сообщение отменено", lines: ["Здравствуйте!", "", `Сообщение о смерти ${n} отменено самим(-ой) ${n}. Больше ничего делать не нужно.`] }),
  fr: (n) => ({ subject: "Le signalement a été annulé", lines: ["Bonjour,", "", `Le signalement du décès de ${n} a été annulé par ${n}. Aucune autre action n'est nécessaire.`] }),
  es: (n) => ({ subject: "La notificación fue cancelada", lines: ["Hola:", "", `${n} canceló la notificación de su fallecimiento. No hace falta hacer nada más.`] }),
};

const render = (to: string, c: Content): MailMessage => ({ to, subject: c.subject, text: c.lines.join("\n") });

export const releaseEmails = {
  executorInvite: (to: string, locale: Locale, name: string, link: string) => render(to, executorInvite[locale](name, link)),
  beneficiaryInvite: (to: string, locale: Locale, name: string, link: string) => render(to, beneficiaryInvite[locale](name, link)),
  legacyReleased: (to: string, locale: Locale, name: string, link: string) => render(to, legacyReleased[locale](name, link)),
  deathReported: (to: string, locale: Locale, cancelLink: string, waitDays: number) => render(to, deathReported[locale](cancelLink, waitDays)),
  reportCancelled: (to: string, locale: Locale, name: string) => render(to, reportCancelled[locale](name)),
};
