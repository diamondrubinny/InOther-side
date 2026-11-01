import type { Locale } from "@inother/shared";
import type { MailMessage } from "../../lib/mailer.js";

/**
 * "A message is waiting" — deliberately WITHOUT the content (privacy, and so the recipient chooses
 * when and where to read it). NOTE: non-Hebrew/English copy is a draft for native-speaker review.
 */
type Content = { subject: string; lines: string[] };

const messageArrived: Record<Locale, (name: string, link: string) => Content> = {
  he: (n, l) => ({ subject: `${n} השאיר/ה לך מסר להיום`, lines: ["שלום,", "", `${n} כתב/ה לך מסר וביקש/ה שיגיע אליך היום.`, "אפשר לקרוא אותו כשתרגיש/י מוכן/ה:", l, "", "אם קשה לך כרגע, אפשר להשהות את המסרים בכל עת מתוך עמוד המורשת."] }),
  en: (n, l) => ({ subject: `${n} left you a message for today`, lines: ["Hello,", "", `${n} wrote you a message and asked that it reach you today.`, "You can read it whenever you feel ready:", l, "", "If this is a hard time, you can pause these messages at any time from the legacy page."] }),
  ar: (n, l) => ({ subject: `ترك لك ${n} رسالة لهذا اليوم`, lines: ["مرحبًا،", "", `كتب لك ${n} رسالة وطلب أن تصلك اليوم.`, "يمكنك قراءتها حين تشعر أنك مستعد:", l, "", "إذا كان الوقت صعبًا، يمكنك إيقاف هذه الرسائل مؤقتًا في أي وقت من صفحة الإرث."] }),
  ru: (n, l) => ({ subject: `${n} оставил(а) вам послание на сегодня`, lines: ["Здравствуйте!", "", `${n} написал(а) вам послание и попросил(а), чтобы оно пришло сегодня.`, "Прочитайте его, когда будете готовы:", l, "", "Если сейчас тяжело, вы можете в любой момент приостановить послания на странице наследия."] }),
  fr: (n, l) => ({ subject: `${n} vous a laissé un message pour aujourd'hui`, lines: ["Bonjour,", "", `${n} vous a écrit un message et a souhaité qu'il vous parvienne aujourd'hui.`, "Vous pouvez le lire quand vous vous sentirez prêt(e) :", l, "", "Si c'est un moment difficile, vous pouvez suspendre ces messages à tout moment depuis la page de l'héritage."] }),
  es: (n, l) => ({ subject: `${n} te dejó un mensaje para hoy`, lines: ["Hola:", "", `${n} te escribió un mensaje y pidió que te llegara hoy.`, "Puedes leerlo cuando te sientas preparado/a:", l, "", "Si es un momento difícil, puedes pausar estos mensajes en cualquier momento desde la página del legado."] }),
};

export const messageEmails = {
  messageArrived: (to: string, locale: Locale, name: string, link: string): MailMessage => {
    const c = messageArrived[locale](name, link);
    return { to, subject: c.subject, text: c.lines.join("\n") };
  },
};
