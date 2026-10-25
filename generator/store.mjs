// Artikel-Datenbank: eine JSON-Datei pro Artikel plus ein schlanker Index für die Startseite.
//
//   public/data/index.json          – Liste aller Artikel (ohne Text), neueste zuerst
//   public/data/artikel/<id>.json   – der vollständige Artikel
//
// So bleibt die Startseite schnell, auch wenn sich über die Jahre Tausende Artikel ansammeln.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = join(ROOT, "public", "data");
const ARTICLE_DIR = join(DATA_DIR, "artikel");
const INDEX_PATH = join(DATA_DIR, "index.json");

const INDEX_FIELDS = ["id", "category", "title", "teaser", "tags", "readingMinutes", "publishedAt", "aiGenerated"];

export async function loadArticles() {
  let files = [];
  try {
    files = (await readdir(ARTICLE_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(ARTICLE_DIR, f), "utf8"))));
}

export async function saveArticle(article) {
  await mkdir(ARTICLE_DIR, { recursive: true });
  await writeFile(join(ARTICLE_DIR, `${article.id}.json`), JSON.stringify(article, null, 2) + "\n", "utf8");
}

export async function rebuildIndex() {
  const articles = (await loadArticles()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const index = {
    updatedAt: new Date().toISOString(),
    count: articles.length,
    articles: articles.map((a) => Object.fromEntries(INDEX_FIELDS.map((k) => [k, a[k]]))),
  };
  await writeFile(INDEX_PATH, JSON.stringify(index) + "\n", "utf8");
  return index;
}
