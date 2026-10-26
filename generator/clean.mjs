// Aufräumen nach dem Schreiben: Kleine KI-Modelle halten sich nicht immer an das Format.
// Wird für jeden neuen Artikel aufgerufen und kann mit `npm run clean` auf alle angewendet werden.

/**
 * Abschnitte, die eigentlich eigene Bausteine sind. Größere Modelle hängen Glossar, Quiz,
 * Diskussion und sogar die Lösung zusätzlich als normale Abschnitte an – dann steht alles doppelt.
 * Nur die ganze Überschrift zählt, damit z. B. „Lösungen für den Alltag“ bleibt.
 */
const BUILDING_BLOCK_HEADING =
  /^(glossar|begriffe( erklärt)?|quiz|kurzes quiz|diskussion(sfragen)?|discussion|diskutier mit|antwort(en)?|lösung(en)?|richtige antwort|tl;?dr|das wichtigste( in kürze)?|warum ist das wichtig\??|why it matters|tags|stichworte)\s*:?$/i;

/**
 * Kleine Modelle beenden einen Text manchmal mitten im Satz mit einem geraden Anführungszeichen,
 * dann landet ein Satz zerstückelt in mehreren Absätzen. Bruchstücke wieder zusammenfügen.
 */
export function mergeFragments(paragraphs) {
  const out = [];
  for (const raw of paragraphs) {
    const p = raw.replace(/\s+/g, " ");
    const prev = out.at(-1);
    if (prev !== undefined && !/[.!?:)][“"»]?\s*$/.test(prev)) {
      const quoted = !/[.!?,;:]$/.test(p.trim()) && p.trim().split(" ").length <= 3;
      out[out.length - 1] = quoted
        ? `${prev.trimEnd()} „${p.trim()}“`
        : `${prev.trimEnd()}${/^[,;:]/.test(p.trim()) ? "" : " "}${p.trim()}`;
    } else {
      out.push(p.trim());
    }
  }
  return out.filter(Boolean);
}

/** 'so' und "so" werden zu „so“ – gerade Anführungszeichen sind im Deutschen falsch. */
export function germanQuotes(text) {
  return text.replace(/(^|[\s(–-])['"]([^'"\n]{1,80}?)['"](?=[\s.,;:!?)–-]|$)/g, "$1„$2“");
}

/** Antworten mischen, damit die richtige nicht immer an derselben Stelle steht. */
export function shuffleQuiz(quiz, random = Math.random) {
  const correct = quiz.options[quiz.answerIndex];
  const options = [...quiz.options];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { ...quiz, options, answerIndex: options.indexOf(correct) };
}

export function cleanArticle(article, { categoryName, shuffle = true } = {}) {
  const q = germanQuotes;
  const sections = article.sections
    .filter((s) => !BUILDING_BLOCK_HEADING.test(s.heading.trim()))
    .map((s) => ({ heading: q(s.heading.trim()), paragraphs: mergeFragments(s.paragraphs).map(q) }))
    .filter((s) => s.paragraphs.length);

  // Doppelte Stichworte und den Themennamen selbst entfernen.
  const tags = [...new Set(article.tags.map((t) => t.trim()).filter(Boolean))]
    .filter((t) => !categoryName || t.toLowerCase() !== categoryName.toLowerCase());

  // Antworttexte ohne Aufzählungszeichen wie „A)“ oder „1.“, keine doppelten Antworten.
  const options = article.quiz.options.map((o) => q(o.replace(/^\s*([A-Da-d]|[1-4])[).:]\s+/, "").trim()));
  let quiz = { ...article.quiz, question: q(article.quiz.question), options, explanation: q(article.quiz.explanation) };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) quiz = null;
  else if (shuffle) quiz = shuffleQuiz(quiz);

  return {
    ...article,
    title: q(article.title),
    teaser: q(article.teaser),
    tags,
    tldr: article.tldr.map(q),
    sections,
    whyItMatters: q(article.whyItMatters),
    glossary: article.glossary.map((g) => ({ term: q(g.term), definition: q(g.definition) })),
    quiz,
    discussion: article.discussion.map(q),
  };
}
