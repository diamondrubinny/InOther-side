import type { Locale } from "@inother/shared";

/**
 * First-line crisis screening (always on, no network). Deliberately broad: a false positive
 * shows support resources once; a false negative can cost a life. Patterns must be reviewed
 * with mental-health professionals and native speakers before launch.
 */
const CRISIS_PATTERNS: RegExp[] = [
  // Hebrew
  /להתאבד|התאבדות|לשים קץ לחיי|לא רוצה לחיות|רוצה למות|אין לי בשביל מה לחיות|להצטרף אליך|לבוא אליך לשם|לפגוע בעצמי/u,
  // English
  /\b(kill myself|suicid\w*|end my life|want to die|don'?t want to live|join you (there|now)|hurt myself|no reason to live)\b/i,
  // Arabic
  /انتحار|أنتحر|أقتل نفسي|أريد أن أموت|لا أريد أن أعيش|ألحق بك|أؤذي نفسي/u,
  // Russian
  /покончить с собой|суицид|самоубийств|хочу умереть|не хочу жить|уйти к тебе|навредить себе/iu,
  // French
  /\b(me suicider|suicide|en finir|je veux mourir|ne veux plus vivre|te rejoindre|me faire du mal)\b/i,
  // Spanish
  /\b(suicidarme|suicidio|quitarme la vida|quiero morir|no quiero vivir|reunirme contigo|hacerme daño)\b/i,
];

export function screenForCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

/** Out-of-character message with help resources. Numbers must be verified before launch. */
export const CRISIS_MESSAGE: Record<Locale, string> = {
  he: "אני עוצר/ת כאן את השיחה עם הדמות, כי מה שכתבת חשוב יותר. אתה/את לא לבד. אפשר לדבר עכשיו עם אדם: ער\"ן 1201 (24/7), סה\"ר sahar.org.il, ובמצב חירום מד\"א 101.",
  en: "I'm pausing the persona because what you wrote matters more. You are not alone. Please talk to a person now: in Israel ERAN 1201 (24/7) or SAHAR sahar.org.il; in an emergency call your local emergency number.",
  ar: "أوقف المحادثة مع الشخصية لأن ما كتبته أهم. لست وحدك. تحدّث الآن مع إنسان: في إسرائيل عيران 1201 (على مدار الساعة)، وفي الطوارئ اتصل بنجمة داود الحمراء 101.",
  ru: "Я останавливаю разговор с персонажем, потому что ваши слова важнее. Вы не одни. Поговорите сейчас с живым человеком: в Израиле ЭРАН 1201 (круглосуточно), в экстренной ситуации — 101.",
  fr: "J'interromps la conversation avec le personnage, car ce que vous avez écrit compte davantage. Vous n'êtes pas seul(e). Parlez dès maintenant à quelqu'un : en Israël ERAN 1201 (24 h/24) ; en urgence, appelez les secours.",
  es: "Detengo la conversación con el personaje porque lo que escribiste importa más. No estás solo/a. Habla ahora con una persona: en Israel ERAN 1201 (24 h); en una emergencia, llama a los servicios de emergencia.",
};
