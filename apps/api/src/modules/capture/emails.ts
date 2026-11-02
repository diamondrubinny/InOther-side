import type { Locale } from "@inother/shared";
import type { MailMessage } from "../../lib/mailer.js";

/**
 * Capture emails go ONLY to the legator's own verified address (never to arbitrary recipients).
 * NOTE: non-Hebrew/English copy is a draft for native-speaker review.
 */
type Content = { subject: string; lines: string[] };

const questionLink: Record<Locale, (question: string, link: string, days: number, weekly: boolean) => Content> = {
  he: (q, l, d, w) => ({ subject: w ? "השאלה של השבוע" : "שאלה אחת בשבילך", lines: ["שלום,", "", w ? "הנה השאלה של השבוע:" : "הנה השאלה:", "", `„${q}”`, "", "אפשר לענות בהקלטה קולית או בכתב, בלי להתחבר — רק ללחוץ על הקישור:", l, "", `הקישור אישי ותקף ${d} ימים לתשובה אחת. אל תעבירו אותו לאחרים.`] }),
  en: (q, l, d, w) => ({ subject: w ? "This week's question" : "One question for you", lines: ["Hello,", "", w ? "Here is this week's question:" : "Here is the question:", "", `“${q}”`, "", "You can answer by voice or in writing, without signing in — just open the link:", l, "", `The link is personal and valid for ${d} days, for one answer. Please don't forward it.`] }),
  ar: (q, l, d, w) => ({ subject: w ? "سؤال هذا الأسبوع" : "سؤال واحد لك", lines: ["مرحبًا،", "", w ? "إليك سؤال هذا الأسبوع:" : "إليك السؤال:", "", `«${q}»`, "", "يمكنك الإجابة بتسجيل صوتي أو كتابةً، دون تسجيل الدخول — فقط افتح الرابط:", l, "", `الرابط شخصي وصالح ${d} أيام لإجابة واحدة. لا تُعِد توجيهه.`] }),
  ru: (q, l, d, w) => ({ subject: w ? "Вопрос недели" : "Один вопрос для вас", lines: ["Здравствуйте!", "", w ? "Вопрос этой недели:" : "Вот вопрос:", "", `«${q}»`, "", "Ответить можно голосом или текстом, без входа в аккаунт — просто откройте ссылку:", l, "", `Ссылка личная, действует ${d} дней и подходит для одного ответа. Не пересылайте её.`] }),
  fr: (q, l, d, w) => ({ subject: w ? "La question de la semaine" : "Une question pour vous", lines: ["Bonjour,", "", w ? "Voici la question de la semaine :" : "Voici la question :", "", `« ${q} »`, "", "Vous pouvez répondre à voix haute ou par écrit, sans vous connecter — ouvrez simplement le lien :", l, "", `Le lien est personnel et valable ${d} jours pour une réponse. Ne le transférez pas.`] }),
  es: (q, l, d, w) => ({ subject: w ? "La pregunta de la semana" : "Una pregunta para ti", lines: ["Hola:", "", w ? "Esta es la pregunta de la semana:" : "Esta es la pregunta:", "", `«${q}»`, "", "Puedes responder con tu voz o por escrito, sin iniciar sesión — solo abre el enlace:", l, "", `El enlace es personal y vale ${d} días para una respuesta. No lo reenvíes.`] }),
};

const suggestionReceived: Record<Locale, (from: string, link: string) => Content> = {
  he: (f, l) => ({ subject: `${f} הציע/ה לך שאלה`, lines: ["שלום,", "", `${f} היה/הייתה רוצה לשמוע ממך סיפור, והציע/ה לך שאלה.`, "אפשר לראות אותה, לאשר או לדחות:", l, "", "התשובה שלך לא תוצג ל-" + f + " עכשיו. היא תישמר בכספת לפי הכללים שקבעת."] }),
  en: (f, l) => ({ subject: `${f} suggested a question for you`, lines: ["Hello,", "", `${f} would love to hear a story from you, and suggested a question.`, "You can see it, accept it or decline it:", l, "", `Your answer will not be shown to ${f} now. It is kept in your vault under the rules you set.`] }),
  ar: (f, l) => ({ subject: `اقترح ${f} عليك سؤالًا`, lines: ["مرحبًا،", "", `يودّ ${f} أن يسمع منك قصة، واقترح عليك سؤالًا.`, "يمكنك رؤيته وقبوله أو رفضه:", l, "", `لن تُعرض إجابتك على ${f} الآن، بل تُحفظ في خزنتك وفق القواعد التي حددتها.`] }),
  ru: (f, l) => ({ subject: `${f} предложил(а) вам вопрос`, lines: ["Здравствуйте!", "", `${f} хотел(а) бы услышать от вас историю и предложил(а) вопрос.`, "Вы можете посмотреть его, принять или отклонить:", l, "", `Ваш ответ сейчас не будет показан ${f}. Он хранится в вашем хранилище по заданным вами правилам.`] }),
  fr: (f, l) => ({ subject: `${f} vous a suggéré une question`, lines: ["Bonjour,", "", `${f} aimerait entendre une histoire de votre part et vous a suggéré une question.`, "Vous pouvez la voir, l'accepter ou la refuser :", l, "", `Votre réponse ne sera pas montrée à ${f} maintenant. Elle reste dans votre coffre selon vos règles.`] }),
  es: (f, l) => ({ subject: `${f} te sugirió una pregunta`, lines: ["Hola:", "", `A ${f} le encantaría escuchar una historia tuya y te sugirió una pregunta.`, "Puedes verla, aceptarla o rechazarla:", l, "", `Tu respuesta no se mostrará a ${f} ahora. Se guarda en tu cofre según las reglas que fijaste.`] }),
};

const render = (to: string, c: Content): MailMessage => ({ to, subject: c.subject, text: c.lines.join("\n") });

export const captureEmails = {
  questionLink: (to: string, locale: Locale, question: string, link: string, days: number, weekly: boolean) => render(to, questionLink[locale](question, link, days, weekly)),
  suggestionReceived: (to: string, locale: Locale, from: string, link: string) => render(to, suggestionReceived[locale](from, link)),
};
