import { DEFAULT_LOCALE, type Locale, type LocalizedText } from "./i18n.js";

/**
 * Guided life-story question catalog for the Legacy track.
 * IDs are stable and stored with answers. Never rename an existing ID; add new ones instead.
 * Every text must exist in every supported locale (enforced by the LocalizedText type).
 * NOTE: Wording must be reviewed by native speakers and a grief / reminiscence-therapy
 * professional before launch. Only the Hebrew and English texts were written as primary copy.
 */
export interface GuidedQuestion {
  id: string;
  text: LocalizedText;
  /** Marks emotionally heavy questions so the UI can add a gentle warning and "skip" option. */
  sensitive?: boolean;
}

export interface QuestionTopic {
  id: string;
  title: LocalizedText;
  questions: GuidedQuestion[];
}

export const QUESTION_TOPICS: readonly QuestionTopic[] = [
  {
    id: "childhood",
    title: { he: "ילדות", en: "Childhood", ar: "الطفولة", ru: "Детство", fr: "Enfance", es: "Infancia" },
    questions: [
      {
        id: "childhood.home",
        text: {
          he: "תאר/י את הבית שגדלת בו. מה רואים, שומעים ומריחים שם?",
          en: "Describe the home you grew up in. What do you see, hear and smell there?",
          ar: "صِف البيت الذي نشأت فيه. ماذا ترى وتسمع وتشمّ هناك؟",
          ru: "Опишите дом, в котором вы выросли. Что вы там видите, слышите, чувствуете?",
          fr: "Décrivez la maison où vous avez grandi. Que voyez-vous, qu'entendez-vous, que sentez-vous ?",
          es: "Describe la casa donde creciste. ¿Qué ves, oyes y hueles allí?",
        },
      },
      {
        id: "childhood.parents",
        text: {
          he: "איך היו ההורים שלך? מה למדת מכל אחד מהם?",
          en: "What were your parents like? What did you learn from each of them?",
          ar: "كيف كان والداك؟ ماذا تعلّمت من كلٍّ منهما؟",
          ru: "Какими были ваши родители? Чему вы научились у каждого из них?",
          fr: "Comment étaient vos parents ? Qu'avez-vous appris de chacun d'eux ?",
          es: "¿Cómo eran tus padres? ¿Qué aprendiste de cada uno?",
        },
      },
      {
        id: "childhood.memory",
        text: {
          he: "מה הזיכרון הכי מוקדם שלך?",
          en: "What is your earliest memory?",
          ar: "ما هي أقدم ذكرى لديك؟",
          ru: "Какое ваше самое раннее воспоминание?",
          fr: "Quel est votre plus ancien souvenir ?",
          es: "¿Cuál es tu recuerdo más temprano?",
        },
      },
      {
        id: "childhood.mischief",
        text: {
          he: "ספר/י על שטות שעשית כילד/ה ומה קרה אחר כך.",
          en: "Tell about a mischief you did as a child and what happened next.",
          ar: "احكِ عن شقاوة قمت بها في طفولتك وماذا حدث بعدها.",
          ru: "Расскажите о шалости из детства и о том, что было потом.",
          fr: "Racontez une bêtise faite enfant et ce qui s'est passé ensuite.",
          es: "Cuenta una travesura de tu infancia y qué pasó después.",
        },
      },
    ],
  },
  {
    id: "youth",
    title: { he: "נעורים", en: "Youth", ar: "الشباب", ru: "Юность", fr: "Jeunesse", es: "Juventud" },
    questions: [
      {
        id: "youth.friends",
        text: {
          he: "מי היו החברים הכי קרובים שלך בנעורים, ומה עשיתם יחד?",
          en: "Who were your closest friends as a teenager, and what did you do together?",
          ar: "من كان أقرب أصدقائك في شبابك، وماذا كنتم تفعلون معًا؟",
          ru: "Кто был вашими самыми близкими друзьями в юности и чем вы занимались вместе?",
          fr: "Qui étaient vos amis les plus proches à l'adolescence, et que faisiez-vous ensemble ?",
          es: "¿Quiénes eran tus amigos más cercanos en la adolescencia y qué hacían juntos?",
        },
      },
      {
        id: "youth.dreams",
        text: {
          he: "מה חלמת להיות כשתהיה/י גדול/ה?",
          en: "What did you dream of becoming?",
          ar: "ماذا كنت تحلم أن تصبح عندما تكبر؟",
          ru: "Кем вы мечтали стать?",
          fr: "Que rêviez-vous de devenir ?",
          es: "¿Qué soñabas ser de mayor?",
        },
      },
      {
        id: "youth.service",
        text: {
          he: "ספר/י על השירות הצבאי או הלאומי שלך, או על התקופה שאחרי בית הספר.",
          en: "Tell about your military / national service or the period after school.",
          ar: "احكِ عن الخدمة العسكرية أو الوطنية، أو عن الفترة التي تلت المدرسة.",
          ru: "Расскажите об армейской или гражданской службе либо о времени после школы.",
          fr: "Parlez de votre service militaire ou civique, ou de la période après l'école.",
          es: "Habla de tu servicio militar o civil, o de la etapa después de la escuela.",
        },
      },
    ],
  },
  {
    id: "love",
    title: { he: "אהבה ומשפחה", en: "Love & family", ar: "الحب والعائلة", ru: "Любовь и семья", fr: "Amour et famille", es: "Amor y familia" },
    questions: [
      {
        id: "love.meeting",
        text: {
          he: "איך הכרת את בן/בת הזוג שלך? מה משך אותך?",
          en: "How did you meet your partner? What drew you to them?",
          ar: "كيف تعرّفت على شريك حياتك؟ ما الذي جذبك إليه؟",
          ru: "Как вы познакомились со своим спутником жизни? Что вас привлекло?",
          fr: "Comment avez-vous rencontré votre partenaire ? Qu'est-ce qui vous a attiré ?",
          es: "¿Cómo conociste a tu pareja? ¿Qué te atrajo?",
        },
      },
      {
        id: "love.children",
        text: {
          he: "מה הרגשת כשנולד הילד הראשון שלך?",
          en: "How did you feel when your first child was born?",
          ar: "بماذا شعرت عندما وُلد طفلك الأول؟",
          ru: "Что вы чувствовали, когда родился ваш первый ребёнок?",
          fr: "Qu'avez-vous ressenti à la naissance de votre premier enfant ?",
          es: "¿Qué sentiste cuando nació tu primer hijo o hija?",
        },
      },
      {
        id: "love.family_traditions",
        text: {
          he: "אילו מסורות משפחתיות חשובות לך ולמה?",
          en: "Which family traditions matter to you and why?",
          ar: "ما التقاليد العائلية المهمة لك ولماذا؟",
          ru: "Какие семейные традиции важны для вас и почему?",
          fr: "Quelles traditions familiales comptent pour vous, et pourquoi ?",
          es: "¿Qué tradiciones familiares son importantes para ti y por qué?",
        },
      },
    ],
  },
  {
    id: "work",
    title: { he: "עבודה ויצירה", en: "Work & creation", ar: "العمل والإبداع", ru: "Работа и творчество", fr: "Travail et création", es: "Trabajo y creación" },
    questions: [
      {
        id: "work.proud",
        text: {
          he: "במה בעבודה או ביצירה שלך את/ה הכי גאה?",
          en: "What in your work or creative life are you most proud of?",
          ar: "ما أكثر ما تفخر به في عملك أو إبداعك؟",
          ru: "Чем в своей работе или творчестве вы гордитесь больше всего?",
          fr: "De quoi êtes-vous le plus fier dans votre travail ou vos créations ?",
          es: "¿De qué te sientes más orgulloso/a en tu trabajo o tu obra?",
        },
      },
      {
        id: "work.failure",
        text: {
          he: "ספר/י על כישלון שלימד אותך משהו חשוב.",
          en: "Tell about a failure that taught you something important.",
          ar: "احكِ عن فشل علّمك شيئًا مهمًا.",
          ru: "Расскажите о неудаче, которая научила вас чему-то важному.",
          fr: "Racontez un échec qui vous a appris quelque chose d'important.",
          es: "Cuenta un fracaso que te enseñó algo importante.",
        },
      },
    ],
  },
  {
    id: "values",
    title: { he: "ערכים ואמונה", en: "Values & belief", ar: "القيم والإيمان", ru: "Ценности и вера", fr: "Valeurs et croyances", es: "Valores y creencias" },
    questions: [
      {
        id: "values.core",
        text: {
          he: "מה שלושת הדברים הכי חשובים לך בחיים?",
          en: "What are the three most important things in your life?",
          ar: "ما هي أهم ثلاثة أشياء في حياتك؟",
          ru: "Какие три вещи самые важные в вашей жизни?",
          fr: "Quelles sont les trois choses les plus importantes de votre vie ?",
          es: "¿Cuáles son las tres cosas más importantes de tu vida?",
        },
      },
      {
        id: "values.belief",
        text: {
          he: "במה את/ה מאמין/ה? איך זה השתנה עם השנים?",
          en: "What do you believe in? How has it changed over the years?",
          ar: "بماذا تؤمن؟ وكيف تغيّر ذلك مع السنين؟",
          ru: "Во что вы верите? Как это менялось с годами?",
          fr: "En quoi croyez-vous ? Comment cela a-t-il évolué au fil des ans ?",
          es: "¿En qué crees? ¿Cómo ha cambiado con los años?",
        },
      },
      {
        id: "values.happiness",
        text: {
          he: "מה זה בשבילך אושר?",
          en: "What is happiness to you?",
          ar: "ما هي السعادة بالنسبة لك؟",
          ru: "Что для вас счастье?",
          fr: "Qu'est-ce que le bonheur pour vous ?",
          es: "¿Qué es para ti la felicidad?",
        },
      },
    ],
  },
  {
    id: "humor",
    title: { he: "הומור וסגנון", en: "Humor & style", ar: "الفكاهة والأسلوب", ru: "Юмор и стиль", fr: "Humour et style", es: "Humor y estilo" },
    questions: [
      {
        id: "humor.laugh",
        text: {
          he: "מה מצחיק אותך באמת? ספר/י בדיחה או סיפור שאת/ה אוהב/ת לספר.",
          en: "What really makes you laugh? Tell a joke or story you love telling.",
          ar: "ما الذي يضحكك حقًا؟ احكِ نكتة أو قصة تحب أن ترويها.",
          ru: "Что вас по-настоящему смешит? Расскажите любимую шутку или историю.",
          fr: "Qu'est-ce qui vous fait vraiment rire ? Racontez une blague ou une histoire que vous aimez raconter.",
          es: "¿Qué te hace reír de verdad? Cuenta un chiste o una historia que te guste contar.",
        },
      },
      {
        id: "humor.sayings",
        text: {
          he: "אילו ביטויים או משפטים את/ה אומר/ת כל הזמן?",
          en: "Which phrases or sayings do you use all the time?",
          ar: "ما العبارات أو الأقوال التي تردّدها دائمًا؟",
          ru: "Какие выражения или поговорки вы постоянно используете?",
          fr: "Quelles expressions ou phrases dites-vous tout le temps ?",
          es: "¿Qué frases o dichos usas todo el tiempo?",
        },
      },
      {
        id: "humor.nicknames",
        text: {
          he: "אילו כינויי חיבה יש לך לאנשים הקרובים אליך?",
          en: "What pet names do you have for the people close to you?",
          ar: "ما أسماء التدليل التي تنادي بها المقرّبين منك؟",
          ru: "Как ласково вы называете близких людей?",
          fr: "Quels petits noms donnez-vous à vos proches ?",
          es: "¿Qué apodos cariñosos tienes para tus seres queridos?",
        },
      },
    ],
  },
  {
    id: "reactions",
    title: { he: "איך הייתי מגיב/ה", en: "How I would react", ar: "كيف كنت سأتصرّف", ru: "Как бы я отреагировал(а)", fr: "Comment je réagirais", es: "Cómo reaccionaría" },
    questions: [
      {
        id: "reactions.sad_child",
        text: {
          he: "הילד/ה או הנכד/ה שלך עצוב/ה ומאוכזב/ת מעצמו/ה. מה היית אומר/ת?",
          en: "Your child or grandchild is sad and disappointed in themselves. What would you say?",
          ar: "ابنك أو حفيدك حزين وخائب الأمل من نفسه. ماذا كنت ستقول له؟",
          ru: "Ваш ребёнок или внук расстроен и разочарован в себе. Что бы вы сказали?",
          fr: "Votre enfant ou petit-enfant est triste et déçu de lui-même. Que lui diriez-vous ?",
          es: "Tu hijo/a o nieto/a está triste y decepcionado/a consigo mismo/a. ¿Qué le dirías?",
        },
      },
      {
        id: "reactions.good_news",
        text: {
          he: "מישהו מהמשפחה מספר לך בשורה משמחת. איך היית מגיב/ה?",
          en: "Someone in the family shares great news. How would you react?",
          ar: "أحد أفراد العائلة يخبرك بخبر سعيد. كيف كانت ستكون ردّة فعلك؟",
          ru: "Кто-то из семьи делится радостной новостью. Как бы вы отреагировали?",
          fr: "Un membre de la famille vous annonce une bonne nouvelle. Comment réagiriez-vous ?",
          es: "Alguien de la familia te da una gran noticia. ¿Cómo reaccionarías?",
        },
      },
      {
        id: "reactions.argument",
        text: {
          he: "שני אנשים במשפחה רבים. מה היית עושה?",
          en: "Two family members are fighting. What would you do?",
          ar: "اثنان من العائلة يتشاجران. ماذا كنت ستفعل؟",
          ru: "Двое членов семьи ссорятся. Что бы вы сделали?",
          fr: "Deux membres de la famille se disputent. Que feriez-vous ?",
          es: "Dos familiares están peleando. ¿Qué harías?",
        },
      },
      {
        id: "reactions.missing_me",
        sensitive: true,
        text: {
          he: "מישהו אומר לך שהוא מתגעגע אליך מאוד. מה היית רוצה שיידע?",
          en: "Someone tells you they miss you terribly. What would you want them to know?",
          ar: "شخص يقول لك إنه يشتاق إليك كثيرًا. ماذا تريده أن يعرف؟",
          ru: "Кто-то говорит, что очень по вам скучает. Что бы вы хотели, чтобы он знал?",
          fr: "Quelqu'un vous dit que vous lui manquez terriblement. Que voudriez-vous qu'il sache ?",
          es: "Alguien te dice que te extraña muchísimo. ¿Qué te gustaría que supiera?",
        },
      },
    ],
  },
  {
    id: "legacy",
    title: {
      he: "מה שחשוב לי שיידעו",
      en: "What I want them to know",
      ar: "ما أريدهم أن يعرفوه",
      ru: "Что я хочу, чтобы они знали",
      fr: "Ce que je veux qu'ils sachent",
      es: "Lo que quiero que sepan",
    },
    questions: [
      {
        id: "legacy.advice",
        text: {
          he: "איזו עצה היית רוצה להשאיר לדורות הבאים?",
          en: "What advice would you leave to the next generations?",
          ar: "ما النصيحة التي تودّ أن تتركها للأجيال القادمة؟",
          ru: "Какой совет вы хотели бы оставить следующим поколениям?",
          fr: "Quel conseil aimeriez-vous laisser aux générations futures ?",
          es: "¿Qué consejo te gustaría dejar a las próximas generaciones?",
        },
      },
      {
        id: "legacy.regret",
        sensitive: true,
        text: {
          he: "האם יש משהו שהיית עושה אחרת?",
          en: "Is there anything you would do differently?",
          ar: "هل هناك شيء كنت ستفعله بشكل مختلف؟",
          ru: "Есть ли что-то, что вы сделали бы иначе?",
          fr: "Y a-t-il quelque chose que vous feriez différemment ?",
          es: "¿Hay algo que harías de otra manera?",
        },
      },
      {
        id: "legacy.untold",
        sensitive: true,
        text: {
          he: "האם יש סיפור שמעולם לא סיפרת? (אפשר לשמור אותו כ\"סיפור חתום\")",
          en: "Is there a story you never told? (You can save it as a \"sealed story\")",
          ar: "هل هناك قصة لم تروِها أبدًا؟ (يمكنك حفظها كـ\"قصة مختومة\")",
          ru: "Есть ли история, которую вы никогда не рассказывали? (Её можно сохранить как «запечатанную историю»)",
          fr: "Y a-t-il une histoire que vous n'avez jamais racontée ? (Vous pouvez l'enregistrer comme « histoire scellée »)",
          es: "¿Hay alguna historia que nunca contaste? (Puedes guardarla como «historia sellada»)",
        },
      },
      {
        id: "legacy.remember_me",
        sensitive: true,
        text: {
          he: "איך היית רוצה שיזכרו אותך?",
          en: "How would you like to be remembered?",
          ar: "كيف تحبّ أن يتذكّرك الناس؟",
          ru: "Какими вы хотели бы остаться в памяти?",
          fr: "Comment aimeriez-vous qu'on se souvienne de vous ?",
          es: "¿Cómo te gustaría ser recordado/a?",
        },
      },
    ],
  },
];

const QUESTION_INDEX: ReadonlyMap<string, GuidedQuestion> = new Map(
  QUESTION_TOPICS.flatMap((t) => t.questions.map((q) => [q.id, q] as const)),
);

export function findQuestion(id: string): GuidedQuestion | undefined {
  return QUESTION_INDEX.get(id);
}

export const TOTAL_QUESTIONS = QUESTION_INDEX.size;

/** Catalog flattened to a single locale (what the API serves). */
export function localizedCatalog(locale: Locale = DEFAULT_LOCALE) {
  return QUESTION_TOPICS.map((t) => ({
    id: t.id,
    title: t.title[locale],
    questions: t.questions.map((q) => ({ id: q.id, text: q.text[locale], sensitive: q.sensitive ?? false })),
  }));
}
