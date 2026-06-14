// A curated English study deck for the "Английский язык" notes extension.
//
// Why embedded (not fetched from an API): the app is a Telegram Mini App / PWA
// that must work offline, the VPS has restricted outbound network, and — most
// importantly — no free dictionary API returns a *Russian-phonetic* reading
// ("Эк-чу-а-ли"), which is the whole point here. So the deck lives in code.
//
// Order = usefulness for everyday communication first (linking adverbs and
// connectors, then common verbs, adjectives, nouns), so a learner meets the
// highest-leverage words at the start. Add more to the end over time.
//
// `pronunciation` is a Russian phonetic reading: syllables split by "-", the
// stressed vowel capitalised (single-syllable words stay lowercase). The five
// seed words match the examples the deck was designed around exactly.

export interface EnglishWord {
  /** The English word — also the note #tag (kept lowercase). */
  word: string;
  /** Russian translation(s), separated by " / ". */
  translation: string;
  /** Russian-phonetic reading, stressed vowel capitalised. */
  pronunciation: string;
}

export const ENGLISH_WORDS: EnglishWord[] = [
  // --- linking adverbs & connectors (the "glue" of speech) -----------------
  { word: 'actually', translation: 'на самом деле / вообще-то', pronunciation: 'Эк-чу-а-ли' },
  { word: 'maybe', translation: 'может быть / возможно', pronunciation: 'мЭй-би' },
  { word: 'really', translation: 'действительно / очень', pronunciation: 'рИ-ли' },
  { word: 'probably', translation: 'наверное / вероятно', pronunciation: 'прОб-аб-ли' },
  { word: 'usually', translation: 'обычно', pronunciation: 'Ю-жу-а-ли' },
  { word: 'always', translation: 'всегда', pronunciation: 'Ол-уэйз' },
  { word: 'never', translation: 'никогда', pronunciation: 'нЭ-вэр' },
  { word: 'sometimes', translation: 'иногда', pronunciation: 'сАм-таймз' },
  { word: 'often', translation: 'часто', pronunciation: 'О-фэн' },
  { word: 'already', translation: 'уже', pronunciation: 'ол-рЭ-ди' },
  { word: 'almost', translation: 'почти', pronunciation: 'Ол-моуст' },
  { word: 'enough', translation: 'достаточно', pronunciation: 'и-нАф' },
  { word: 'instead', translation: 'вместо этого', pronunciation: 'ин-стЭд' },
  { word: 'though', translation: 'хотя / всё же', pronunciation: 'зоу' },
  { word: 'although', translation: 'хотя', pronunciation: 'ол-зОу' },
  { word: 'however', translation: 'однако / тем не менее', pronunciation: 'хау-Э-вэр' },
  { word: 'because', translation: 'потому что', pronunciation: 'би-кОз' },
  { word: 'anyway', translation: 'в любом случае / всё равно', pronunciation: 'Э-ни-уэй' },
  { word: 'besides', translation: 'кроме того', pronunciation: 'би-сАйдз' },
  { word: 'especially', translation: 'особенно', pronunciation: 'ис-пЭ-шэ-ли' },
  { word: 'exactly', translation: 'точно / именно', pronunciation: 'иг-зЭкт-ли' },
  { word: 'perhaps', translation: 'возможно / может быть', pronunciation: 'пэр-хЭпс' },
  { word: 'quite', translation: 'довольно / вполне', pronunciation: 'куайт' },
  { word: 'rather', translation: 'скорее / довольно', pronunciation: 'рА-зэр' },
  { word: 'still', translation: 'всё ещё / тем не менее', pronunciation: 'стил' },
  { word: 'since', translation: 'с тех пор / так как', pronunciation: 'синс' },
  { word: 'until', translation: 'до / пока не', pronunciation: 'ан-тИл' },
  { word: 'while', translation: 'пока / в то время как', pronunciation: 'уайл' },
  { word: 'whether', translation: 'ли / будь то', pronunciation: 'уЭ-зэр' },
  { word: 'therefore', translation: 'поэтому', pronunciation: 'зЭр-фор' },
  { word: 'otherwise', translation: 'иначе / в противном случае', pronunciation: 'А-зэр-уайз' },
  { word: 'somehow', translation: 'как-то / каким-то образом', pronunciation: 'сАм-хау' },
  { word: 'finally', translation: 'наконец', pronunciation: 'фАй-на-ли' },
  { word: 'suddenly', translation: 'внезапно / вдруг', pronunciation: 'сАд-эн-ли' },
  { word: 'immediately', translation: 'немедленно / сразу', pronunciation: 'и-мИ-ди-эт-ли' },

  // --- common verbs --------------------------------------------------------
  { word: 'need', translation: 'нуждаться / надо', pronunciation: 'нид' },
  { word: 'want', translation: 'хотеть', pronunciation: 'уонт' },
  { word: 'try', translation: 'пытаться / пробовать', pronunciation: 'трай' },
  { word: 'keep', translation: 'держать / продолжать', pronunciation: 'кип' },
  { word: 'become', translation: 'становиться', pronunciation: 'би-кАм' },
  { word: 'seem', translation: 'казаться', pronunciation: 'сим' },
  { word: 'mean', translation: 'значить / иметь в виду', pronunciation: 'мин' },
  { word: 'happen', translation: 'случаться / происходить', pronunciation: 'хЭ-пэн' },
  { word: 'allow', translation: 'разрешать / позволять', pronunciation: 'э-лАу' },
  { word: 'decide', translation: 'решать', pronunciation: 'ди-сАйд' },
  { word: 'remember', translation: 'помнить', pronunciation: 'ри-мЭм-бэр' },
  { word: 'forget', translation: 'забывать', pronunciation: 'фор-гЭт' },
  { word: 'explain', translation: 'объяснять', pronunciation: 'икс-плЭйн' },
  { word: 'understand', translation: 'понимать', pronunciation: 'ан-дэр-стЭнд' },
  { word: 'believe', translation: 'верить / считать', pronunciation: 'би-лИв' },
  { word: 'improve', translation: 'улучшать', pronunciation: 'им-прУв' },
  { word: 'suggest', translation: 'предлагать', pronunciation: 'са-джЭст' },
  { word: 'mention', translation: 'упоминать', pronunciation: 'мЭн-шэн' },
  { word: 'prefer', translation: 'предпочитать', pronunciation: 'при-фЁр' },
  { word: 'realize', translation: 'осознавать / понимать', pronunciation: 'рИ-э-лайз' },
  { word: 'expect', translation: 'ожидать', pronunciation: 'икс-пЭкт' },
  { word: 'consider', translation: 'рассматривать / считать', pronunciation: 'кэн-сИ-дэр' },
  { word: 'provide', translation: 'предоставлять', pronunciation: 'про-вАйд' },
  { word: 'require', translation: 'требовать', pronunciation: 'ри-куАйр' },
  { word: 'receive', translation: 'получать', pronunciation: 'ри-сИв' },
  { word: 'achieve', translation: 'достигать', pronunciation: 'э-чИв' },
  { word: 'avoid', translation: 'избегать', pronunciation: 'э-вОйд' },
  { word: 'admit', translation: 'признавать', pronunciation: 'эд-мИт' },
  { word: 'depend', translation: 'зависеть', pronunciation: 'ди-пЭнд' },
  { word: 'manage', translation: 'справляться / удаваться', pronunciation: 'мЭ-нидж' },
  { word: 'afford', translation: 'позволить себе', pronunciation: 'э-фОрд' },
  { word: 'share', translation: 'делиться', pronunciation: 'шэр' },
  { word: 'spend', translation: 'тратить / проводить', pronunciation: 'спэнд' },
  { word: 'choose', translation: 'выбирать', pronunciation: 'чуз' },
  { word: 'offer', translation: 'предлагать', pronunciation: 'О-фэр' },
  { word: 'refuse', translation: 'отказываться', pronunciation: 'ри-фьЮз' },
  { word: 'complain', translation: 'жаловаться', pronunciation: 'кэм-плЭйн' },
  { word: 'describe', translation: 'описывать', pronunciation: 'дис-крАйб' },
  { word: 'discuss', translation: 'обсуждать', pronunciation: 'дис-кАс' },
  { word: 'enjoy', translation: 'наслаждаться', pronunciation: 'ин-джОй' },
  { word: 'introduce', translation: 'представлять / знакомить', pronunciation: 'ин-тро-дьЮс' },
  { word: 'recognize', translation: 'узнавать / признавать', pronunciation: 'рЭ-кэг-найз' },
  { word: 'apologize', translation: 'извиняться', pronunciation: 'э-пО-ло-джайз' },

  // --- common adjectives ---------------------------------------------------
  { word: 'important', translation: 'важный', pronunciation: 'им-пОр-тэнт' },
  { word: 'difficult', translation: 'трудный / сложный', pronunciation: 'дИ-фи-култ' },
  { word: 'easy', translation: 'лёгкий / простой', pronunciation: 'И-зи' },
  { word: 'available', translation: 'доступный / в наличии', pronunciation: 'э-вЭй-ла-бл' },
  { word: 'several', translation: 'несколько', pronunciation: 'сЭ-вэ-рал' },
  { word: 'different', translation: 'другой / разный', pronunciation: 'дИ-фрэнт' },
  { word: 'similar', translation: 'похожий', pronunciation: 'сИ-ми-лар' },
  { word: 'common', translation: 'общий / распространённый', pronunciation: 'кО-мэн' },
  { word: 'possible', translation: 'возможный', pronunciation: 'пО-си-бл' },
  { word: 'necessary', translation: 'необходимый', pronunciation: 'нЭ-сэ-сэ-ри' },
  { word: 'useful', translation: 'полезный', pronunciation: 'йУс-фул' },
  { word: 'careful', translation: 'осторожный / внимательный', pronunciation: 'кЭр-фул' },
  { word: 'afraid', translation: 'испуганный / боящийся', pronunciation: 'э-фрЭйд' },
  { word: 'sure', translation: 'уверенный', pronunciation: 'шур' },
  { word: 'ready', translation: 'готовый', pronunciation: 'рЭ-ди' },
  { word: 'busy', translation: 'занятый', pronunciation: 'бИ-зи' },
  { word: 'free', translation: 'свободный / бесплатный', pronunciation: 'фри' },
  { word: 'whole', translation: 'целый / весь', pronunciation: 'хоул' },
  { word: 'worth', translation: 'стоящий / стоит', pronunciation: 'уэрс' },
  { word: 'glad', translation: 'рад', pronunciation: 'глэд' },
  { word: 'tired', translation: 'уставший', pronunciation: 'тАй-эрд' },
  { word: 'famous', translation: 'знаменитый', pronunciation: 'фЭй-мэс' },
  { word: 'strange', translation: 'странный', pronunciation: 'стрэйндж' },
  { word: 'huge', translation: 'огромный', pronunciation: 'хьюдж' },
  { word: 'main', translation: 'главный', pronunciation: 'мэйн' },
  { word: 'alone', translation: 'один / в одиночестве', pronunciation: 'э-лОун' },

  // --- common nouns --------------------------------------------------------
  { word: 'thing', translation: 'вещь / штука', pronunciation: 'синг' },
  { word: 'way', translation: 'путь / способ', pronunciation: 'уэй' },
  { word: 'reason', translation: 'причина', pronunciation: 'рИ-зэн' },
  { word: 'example', translation: 'пример', pronunciation: 'иг-зАм-пл' },
  { word: 'mistake', translation: 'ошибка', pronunciation: 'мис-тЭйк' },
  { word: 'advice', translation: 'совет', pronunciation: 'эд-вАйс' },
  { word: 'opinion', translation: 'мнение', pronunciation: 'э-пИ-ни-эн' },
  { word: 'experience', translation: 'опыт', pronunciation: 'икс-пИ-ри-энс' },
  { word: 'knowledge', translation: 'знание', pronunciation: 'нО-лидж' },
  { word: 'goal', translation: 'цель', pronunciation: 'гоул' },
  { word: 'chance', translation: 'шанс / возможность', pronunciation: 'чанс' },
  { word: 'choice', translation: 'выбор', pronunciation: 'чойс' },
  { word: 'purpose', translation: 'цель / назначение', pronunciation: 'пЁр-пэс' },
  { word: 'result', translation: 'результат', pronunciation: 'ри-зАлт' },
  { word: 'issue', translation: 'вопрос / проблема', pronunciation: 'И-шу' },
  { word: 'trouble', translation: 'проблема / беда', pronunciation: 'трА-бл' },
  { word: 'solution', translation: 'решение', pronunciation: 'со-лЮ-шэн' },
  { word: 'decision', translation: 'решение', pronunciation: 'ди-сИ-жэн' },
  { word: 'difference', translation: 'разница', pronunciation: 'дИ-фрэнс' },
  { word: 'amount', translation: 'количество / сумма', pronunciation: 'э-мАунт' },
  { word: 'journey', translation: 'путешествие / поездка / путь', pronunciation: 'джЁр-ни' },
  { word: 'trip', translation: 'поездка', pronunciation: 'трип' },
  { word: 'health', translation: 'здоровье', pronunciation: 'хэлс' },
  { word: 'weather', translation: 'погода', pronunciation: 'уЭ-зэр' },
  { word: 'future', translation: 'будущее', pronunciation: 'фьЮ-чэр' },
];

/** Lookup by word (lowercase). The graph tooltip and the deck resolver both
 *  read it; see english-deck.ts for the cache-aware tooltip used by the graph. */
export const ENGLISH_BY_WORD: ReadonlyMap<string, EnglishWord> = new Map(
  ENGLISH_WORDS.map((w) => [w.word, w]),
);
