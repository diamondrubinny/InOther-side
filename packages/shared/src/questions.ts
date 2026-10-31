/**
 * Guided life-story question catalog for the Legacy track.
 * IDs are stable and stored with answers. Never rename an existing ID; add new ones instead.
 * Texts are Hebrew-first; English is provided for the secondary locale.
 * NOTE: Wording should be reviewed by a grief / reminiscence-therapy professional before launch.
 */
export interface GuidedQuestion {
  id: string;
  he: string;
  en: string;
  /** Marks emotionally heavy questions so the UI can add a gentle warning and "skip" option. */
  sensitive?: boolean;
}

export interface QuestionTopic {
  id: string;
  he: string;
  en: string;
  questions: GuidedQuestion[];
}

export const QUESTION_TOPICS: readonly QuestionTopic[] = [
  {
    id: "childhood",
    he: "ילדות",
    en: "Childhood",
    questions: [
      { id: "childhood.home", he: "תאר/י את הבית שגדלת בו. מה רואים, שומעים ומריחים שם?", en: "Describe the home you grew up in. What do you see, hear and smell there?" },
      { id: "childhood.parents", he: "איך היו ההורים שלך? מה למדת מכל אחד מהם?", en: "What were your parents like? What did you learn from each of them?" },
      { id: "childhood.memory", he: "מה הזיכרון הכי מוקדם שלך?", en: "What is your earliest memory?" },
      { id: "childhood.mischief", he: "ספר/י על שטות שעשית כילד/ה ומה קרה אחר כך.", en: "Tell about a mischief you did as a child and what happened next." },
    ],
  },
  {
    id: "youth",
    he: "נעורים",
    en: "Youth",
    questions: [
      { id: "youth.friends", he: "מי היו החברים הכי קרובים שלך בנעורים, ומה עשיתם יחד?", en: "Who were your closest friends as a teenager, and what did you do together?" },
      { id: "youth.dreams", he: "מה חלמת להיות כשתהיה/י גדול/ה?", en: "What did you dream of becoming?" },
      { id: "youth.service", he: "ספר/י על השירות הצבאי או הלאומי שלך, או על התקופה שאחרי בית הספר.", en: "Tell about your military / national service or the period after school." },
    ],
  },
  {
    id: "love",
    he: "אהבה ומשפחה",
    en: "Love & family",
    questions: [
      { id: "love.meeting", he: "איך הכרת את בן/בת הזוג שלך? מה משך אותך?", en: "How did you meet your partner? What drew you to them?" },
      { id: "love.children", he: "מה הרגשת כשנולד הילד הראשון שלך?", en: "How did you feel when your first child was born?" },
      { id: "love.family_traditions", he: "אילו מסורות משפחתיות חשובות לך ולמה?", en: "Which family traditions matter to you and why?" },
    ],
  },
  {
    id: "work",
    he: "עבודה ויצירה",
    en: "Work & creation",
    questions: [
      { id: "work.proud", he: "במה בעבודה או ביצירה שלך את/ה הכי גאה?", en: "What in your work or creative life are you most proud of?" },
      { id: "work.failure", he: "ספר/י על כישלון שלימד אותך משהו חשוב.", en: "Tell about a failure that taught you something important." },
    ],
  },
  {
    id: "values",
    he: "ערכים ואמונה",
    en: "Values & belief",
    questions: [
      { id: "values.core", he: "מה שלושת הדברים הכי חשובים לך בחיים?", en: "What are the three most important things in your life?" },
      { id: "values.belief", he: "במה את/ה מאמין/ה? איך זה השתנה עם השנים?", en: "What do you believe in? How has it changed over the years?" },
      { id: "values.happiness", he: "מה זה בשבילך אושר?", en: "What is happiness to you?" },
    ],
  },
  {
    id: "humor",
    he: "הומור וסגנון",
    en: "Humor & style",
    questions: [
      { id: "humor.laugh", he: "מה מצחיק אותך באמת? ספר/י בדיחה או סיפור שאת/ה אוהב/ת לספר.", en: "What really makes you laugh? Tell a joke or story you love telling." },
      { id: "humor.sayings", he: "אילו ביטויים או משפטים את/ה אומר/ת כל הזמן?", en: "Which phrases or sayings do you use all the time?" },
      { id: "humor.nicknames", he: "אילו כינויי חיבה יש לך לאנשים הקרובים אליך?", en: "What pet names do you have for the people close to you?" },
    ],
  },
  {
    id: "reactions",
    he: "איך הייתי מגיב/ה",
    en: "How I would react",
    questions: [
      { id: "reactions.sad_child", he: "הילד/ה או הנכד/ה שלך עצוב/ה ומאוכזב/ת מעצמו/ה. מה היית אומר/ת?", en: "Your child or grandchild is sad and disappointed in themselves. What would you say?" },
      { id: "reactions.good_news", he: "מישהו מהמשפחה מספר לך בשורה משמחת. איך היית מגיב/ה?", en: "Someone in the family shares great news. How would you react?" },
      { id: "reactions.argument", he: "שני אנשים במשפחה רבים. מה היית עושה?", en: "Two family members are fighting. What would you do?" },
      { id: "reactions.missing_me", he: "מישהו אומר לך שהוא מתגעגע אליך מאוד. מה היית רוצה שיידע?", en: "Someone tells you they miss you terribly. What would you want them to know?", sensitive: true },
    ],
  },
  {
    id: "legacy",
    he: "מה שחשוב לי שיידעו",
    en: "What I want them to know",
    questions: [
      { id: "legacy.advice", he: "איזו עצה היית רוצה להשאיר לדורות הבאים?", en: "What advice would you leave to the next generations?" },
      { id: "legacy.regret", he: "האם יש משהו שהיית עושה אחרת?", en: "Is there anything you would do differently?", sensitive: true },
      { id: "legacy.untold", he: "האם יש סיפור שמעולם לא סיפרת? (אפשר לשמור אותו כ\"סיפור חתום\")", en: "Is there a story you never told? (You can save it as a \"sealed story\")", sensitive: true },
      { id: "legacy.remember_me", he: "איך היית רוצה שיזכרו אותך?", en: "How would you like to be remembered?", sensitive: true },
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
