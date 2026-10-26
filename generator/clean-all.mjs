// Wendet die Aufräum-Stufe (clean.mjs) auf alle gespeicherten Artikel an und baut den Index neu.
// Gedacht für einmalige Korrekturen, wenn die Aufräum-Regeln erweitert wurden: npm run clean
import { loadArticles, saveArticle, rebuildIndex } from "./store.mjs";
import { cleanArticle } from "./clean.mjs";

const NAMES = {
  medizin: "Medizin", wissenschaft: "Wissenschaft", astronomie: "Astronomie",
  psychologie: "Psychologie", politik: "Politik", geschichte: "Geschichte",
};

let changed = 0;
for (const article of await loadArticles()) {
  const cleaned = cleanArticle(article, { categoryName: NAMES[article.category] });
  if (JSON.stringify(cleaned) !== JSON.stringify(article)) {
    await saveArticle(cleaned);
    changed++;
  }
}
const index = await rebuildIndex();
console.log(`${changed} von ${index.count} Artikeln bereinigt.`);
