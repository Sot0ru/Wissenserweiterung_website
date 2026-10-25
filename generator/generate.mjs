// KI-Artikelgenerator für Wissenshappen.
//
// Holt aktuelle Meldungen aus Nachrichten- und Wissenschafts-Feeds (generator/sources.json),
// lässt eine KI daraus jugendgerechte Erklär-Artikel schreiben und legt sie dauerhaft in
// public/data/artikel/ ab (siehe store.mjs). Die Sammlung wächst mit jedem Lauf.
//
//   npm run generate                      – je Thema 1 neuer Artikel
//   npm run generate -- --per-category 2  – je Thema 2 neue Artikel
//   npm run generate -- --category politik
//   npm run generate:dry                  – zeigt nur, welche Meldungen verwendet würden
//
// Zwei KI-Anbieter:
//   ollama (Standard) – freies Open-Source-Modell, läuft kostenlos auf dem eigenen Rechner.
//                       Braucht Ollama (https://ollama.com) und z. B. `ollama pull gemma4:e4b`.
//                       Anderes Modell: --model qwen3.5:9b  oder  OLLAMA_MODEL in .env
//   claude            – --provider claude, braucht ANTHROPIC_API_KEY (kostenpflichtig).

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadArticles, saveArticle, rebuildIndex } from "./store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCES_PATH = join(ROOT, "generator", "sources.json");
const SEEN_PATH = join(ROOT, "generator", "seen.json");

const CLAUDE_MODEL = "claude-opus-5-5";
const CANDIDATES_PER_CATEGORY = 6;
const USER_AGENT = "Mozilla/5.0 (compatible; Wissenshappen-Generator/0.1)";

/* ---------- Argumente ---------- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY_RUN = flag("--dry-run");
const PER_CATEGORY = Math.max(1, Number(option("--per-category", 1)) || 1);
const ONLY_CATEGORY = option("--category", null);
const PROVIDER = option("--provider", process.env.KI_ANBIETER || "ollama");
const OLLAMA_MODEL = option("--model", process.env.OLLAMA_MODEL || "gemma4:e4b");
const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");

// Lokale Modelle lesen auf dem Prozessor langsam – dort bekommt die KI weniger Quelltext.
const MAX_SOURCE_CHARS = PROVIDER === "claude" ? 40_000 : 12_000;

/* ---------- Feeds lesen ---------- */

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  return decodeEntities(html)
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
}

/** Minimaler RSS-/Atom-Parser – reicht für die Feeds in sources.json. */
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const date = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    return {
      title: tag(b, "title"),
      link: (tag(b, "link") || atomLink || "").trim(),
      description: tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded"),
      date: date ? new Date(date) : new Date(0),
    };
  }).filter((i) => i.title && /^https?:\/\//.test(i.link));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} bei ${url}`);
  return res.text();
}

async function loadCandidates(category, feeds, usedLinks) {
  const items = [];
  for (const feed of feeds) {
    try {
      const parsed = parseFeed(await fetchText(feed.url));
      for (const item of parsed) items.push({ ...item, publisher: feed.publisher });
    } catch (err) {
      console.warn(`  ! Feed nicht erreichbar (${feed.publisher}): ${err.message}`);
    }
  }
  // Meinungsbeiträge auslassen: Ein Erklär-Artikel daraus würde eine Meinung als Tatsache wiedergeben.
  const OPINION = /^(kommentar|meinung|leitartikel|kolumne|essay|glosse|gastbeitrag)\b/i;
  return items
    .filter((i) => !usedLinks.has(i.link))
    .filter((i) => !OPINION.test(i.title))
    .sort((a, b) => b.date - a.date)
    .slice(0, CANDIDATES_PER_CATEGORY);
}

/** Holt den Haupttext der Originalseite, damit die KI mehr hat als den Feed-Anreißer. */
async function loadSourceText(item) {
  try {
    const html = await fetchText(item.link);
    // Viele Seiten haben mehrere <article>-Blöcke (Teaser-Kästen, Empfehlungen, Videoplayer).
    // Nimm den Block mit dem meisten Fließtext, gezählt nur in echten Absätzen und Zwischenüberschriften.
    const paragraphs = (block) =>
      [...block.matchAll(/<(p|h2|h3|li)[\s>][\s\S]*?<\/\1>/gi)]
        .map((m) => stripTags(m[0]))
        .filter((t) => t.length > 40)
        .join("\n\n");
    const containers = [
      ...[...html.matchAll(/<article[\s\S]*?<\/article>/gi)].map((m) => m[0]),
      html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html,
    ];
    let text = containers.map(paragraphs).sort((a, b) => b.length - a.length)[0] ?? "";
    if (text.length > MAX_SOURCE_CHARS) {
      console.warn(`  ! Quelltext gekürzt (${text.length} → ${MAX_SOURCE_CHARS} Zeichen): ${item.link}`);
      text = text.slice(0, MAX_SOURCE_CHARS);
    }
    return text;
  } catch (err) {
    console.warn(`  ! Originalseite nicht lesbar, nutze nur den Feed-Text: ${err.message}`);
    return "";
  }
}

/* ---------- Auftrag an die KI ---------- */

const CATEGORY_NAMES = {
  medizin: "Medizin",
  wissenschaft: "Wissenschaft",
  politik: "Politik",
  geschichte: "Geschichte",
};

const SYSTEM_PROMPT = `Du schreibst für „Wissenshappen“, eine Website, auf der Jugendliche und junge Erwachsene (etwa 14 bis 25 Jahre) Allgemeinwissen aufbauen. Viele Leserinnen und Leser lesen auf dem Handy, nebenbei, und haben wenig Vorwissen. Die Artikel sollen ihnen helfen, ein Thema zu verstehen und darüber mitreden zu können.

Du bekommst eine Meldung aus einer Nachrichten- oder Wissenschaftsquelle. Schreib daraus einen eigenständigen Erklär-Artikel auf Deutsch.

Inhalt und Genauigkeit:
- Stütze dich auf die Fakten der Quelle. Hintergrundwissen, das gut gesichert und allgemein bekannt ist, darfst du ergänzen, damit das Thema verständlich wird. Erfinde keine Zahlen, Zitate, Namen oder Studienergebnisse.
- Mach klar, was gesichert ist und was nicht: „laut einer Studie“, „Forschende vermuten“, „noch nicht abschließend geklärt“. Einzelne Studien sind kein Beweis; sag das, wenn es wichtig ist.
- Ist die Quelle englisch, übersetze sinngemäß und erkläre Fachbegriffe.
- Bei Politik: neutral und ausgewogen. Stell die wichtigsten Positionen fair dar, ohne selbst Partei zu ergreifen und ohne Wahlempfehlungen. Bei Geschichte: ordne ein, warum das Ereignis heute noch eine Rolle spielt.

Stil:
- Sprich die Lesenden mit „du“ an, aber nicht anbiedernd. Keine Jugendsprache, kein Marketing-Ton.
- Kurze Sätze, aktive Verben, ein Gedanke pro Absatz. Erkläre jeden Fachbegriff beim ersten Auftreten oder im Glossar.
- Der Haupttext (alle Abschnitte zusammen) hat etwa 300 bis 550 Wörter, verteilt auf zwei bis vier Abschnitte mit sprechenden Zwischenüberschriften.
- Für Zitate und Hervorhebungen nur deutsche Anführungszeichen „so“, nie gerade Anführungszeichen.
- Titel: höchstens etwa zehn Wörter, konkret statt reißerisch. Teaser: ein bis zwei Sätze, die neugierig machen.

Bausteine:
- tldr: genau drei Sätze mit dem Wichtigsten.
- whyItMatters: zwei bis drei Sätze, warum das Thema für junge Menschen relevant ist.
- glossary: zwei bis vier Begriffe aus dem Text mit einfacher Erklärung.
- quiz: eine Frage mit drei Antwortmöglichkeiten; die richtige Antwort steht eindeutig im Artikel, die beiden anderen sind eindeutig falsch (keine Antwort, die ebenfalls stimmen könnte). answerIndex zählt ab 0.
- discussion: zwei offene Fragen, über die man in der Schule, Uni oder mit Freunden diskutieren kann. Keine Suggestivfragen.
- tags: drei bis fünf verschiedene kurze Stichworte (z. B. „Klima“, „EU“, „Genetik“), damit verwandte Artikel gefunden werden. Verwende bevorzugt allgemeine, wiederverwendbare Begriffe, aber nicht den Namen des Themas selbst.
- readingMinutes: geschätzte Lesezeit in Minuten.

Themenprüfung (Feld category):
Der Feed hat die Meldung einem Thema zugeordnet, das stimmt aber nicht immer. Entscheide selbst, wohin der Artikel gehört:
- medizin: Gesundheit, Krankheiten, Körper, Ernährung, psychische Gesundheit, Medikamente, Gesundheitssystem.
- wissenschaft: Naturwissenschaften, Technik, Umwelt und Klima, Wetter und Naturphänomene mit Erklärung, Mathematik, Weltall, Forschung über menschliches Verhalten.
- politik: Regierung, Parlamente, Wahlen, Gesetze, internationale Beziehungen, Konflikte, Wirtschafts- und Sozialpolitik, gesellschaftliche Debatten.
- geschichte: historische Ereignisse, Personen und Epochen, Jahrestage.
- keins: passt in keines der vier Themen.
Wähle das Thema, um das es im Kern geht, nicht das, in dem die Meldung erschienen ist. Eine Unwetterwarnung ist zum Beispiel keine Politik; erklärt der Artikel, wie Stürme entstehen, gehört er zu wissenschaft.

Nicht geeignet sind: Kommentare und andere Meinungsbeiträge, Liveticker, Sportergebnisse, Promi-Meldungen, reine Kriminalfälle oder Unfälle ohne gesellschaftliche Bedeutung, reine Wetterberichte, Werbung und Meldungen mit zu wenig Inhalt. Setze dann suitable auf false, begründe kurz in reason und fülle die übrigen Felder mit leeren Werten.`;

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "suitable", "reason", "category", "title", "teaser", "tags", "readingMinutes", "tldr",
    "sections", "whyItMatters", "glossary", "quiz", "discussion",
  ],
  properties: {
    suitable: { type: "boolean" },
    category: { type: "string", enum: ["medizin", "wissenschaft", "politik", "geschichte", "keins"] },
    reason: { type: "string" },
    title: { type: "string" },
    teaser: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    readingMinutes: { type: "integer" },
    tldr: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "paragraphs"],
        properties: {
          heading: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
        },
      },
    },
    whyItMatters: { type: "string" },
    glossary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition"],
        properties: { term: { type: "string" }, definition: { type: "string" } },
      },
    },
    quiz: {
      type: "object",
      additionalProperties: false,
      required: ["question", "options", "answerIndex", "explanation"],
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        answerIndex: { type: "integer" },
        explanation: { type: "string" },
      },
    },
    discussion: { type: "array", items: { type: "string" } },
  },
};

function buildPrompt(category, item, sourceText) {
  return `Der Feed ordnet diese Meldung dem Thema „${CATEGORY_NAMES[category]}“ zu. Prüfe, ob das stimmt.

<quelle>
<herausgeber>${item.publisher}</herausgeber>
<titel>${item.title}</titel>
<datum>${item.date.toISOString().slice(0, 10)}</datum>
<anreisser>${item.description}</anreisser>
<volltext>
${sourceText || "(nicht verfügbar – nutze den Anreißer)"}
</volltext>
</quelle>

Schreib daraus den Artikel.`;
}

/* ---------- Anbieter: Ollama (lokal, Open Source) ---------- */

class OllamaError extends Error {}

async function writeWithOllama(prompt) {
  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        think: false,
        format: ARTICLE_SCHEMA, // Ollama erzwingt damit gültiges JSON nach Schema
        options: { temperature: 0.5, num_ctx: 16384, num_predict: 4096 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch {
    throw new OllamaError(`Ollama ist nicht erreichbar (${OLLAMA_HOST}). Läuft die Ollama-App?`);
  }
  if (res.status === 404) {
    throw new OllamaError(`Modell „${OLLAMA_MODEL}“ fehlt. Lade es mit: ollama pull ${OLLAMA_MODEL}`);
  }
  if (!res.ok) throw new OllamaError(`Ollama-Fehler ${res.status}: ${await res.text()}`);

  // Antwort kommt Stück für Stück (NDJSON); so sieht man den Fortschritt und es gibt keine Timeouts.
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let doneReason = "";
  let chunks = 0;
  process.stdout.write("    schreibt ");
  for await (const part of res.body) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new OllamaError(`Ollama-Fehler: ${msg.error}`);
      text += msg.message?.content ?? "";
      if (msg.done) doneReason = msg.done_reason;
      if (++chunks % 40 === 0) process.stdout.write(".");
    }
  }
  process.stdout.write("\n");

  if (doneReason === "length") {
    console.warn("  ! Antwort abgeschnitten (zu lang) – übersprungen");
    return null;
  }
  return JSON.parse(text);
}

/* ---------- Anbieter: Claude (kostenpflichtig) ---------- */

let client; // erst im echten Lauf anlegen, damit der Probelauf ohne API-Schlüssel klappt
const KEY_HINT =
  "Kopiere .env.example nach .env und trage ANTHROPIC_API_KEY ein (oder melde dich mit `ant auth login` an).";

async function writeWithClaude(prompt) {
  // Server-seitige Fallbacks: lehnt das Modell eine Anfrage aus Sicherheitsgründen ab,
  // springt automatisch ein passendes Ersatzmodell ein.
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ARTICLE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`  ! Abgelehnt (${response.stop_details?.category ?? "ohne Kategorie"})`);
    return null;
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("  ! Antwort abgeschnitten (max_tokens) – übersprungen");
    return null;
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const MODEL_LABEL = PROVIDER === "claude" ? CLAUDE_MODEL : OLLAMA_MODEL;

function writeArticle(category, item, sourceText) {
  const prompt = buildPrompt(category, item, sourceText);
  return PROVIDER === "claude" ? writeWithClaude(prompt) : writeWithOllama(prompt);
}

/**
 * Kleine Modelle beenden einen Text manchmal mitten im Satz mit einem geraden Anführungszeichen,
 * dann landet ein Satz zerstückelt in mehreren Absätzen. Bruchstücke wieder zusammenfügen.
 */
function mergeFragments(paragraphs) {
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

function isValid(a) {
  return Boolean(
    a.title && a.teaser && a.sections?.length >= 1 && a.tldr?.length >= 1 &&
    a.sections.every((s) => s.heading && s.paragraphs?.length) &&
    a.discussion?.length >= 1 && a.quiz?.options?.length >= 2 &&
    a.quiz.answerIndex >= 0 && a.quiz.answerIndex < a.quiz.options.length
  );
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/* ---------- Ablauf ---------- */

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function main() {
  const sources = await readJson(SOURCES_PATH, {});
  const existing = await loadArticles();
  const seen = new Set(await readJson(SEEN_PATH, []));
  const usedLinks = new Set([...seen, ...existing.flatMap((a) => a.sources.map((s) => s.url))]);
  const existingIds = new Set(existing.map((a) => a.id));
  const created = [];

  if (!["ollama", "claude"].includes(PROVIDER)) throw new Error(`Unbekannter Anbieter: ${PROVIDER}`);
  if (!DRY_RUN) console.log(`KI: ${PROVIDER} (${MODEL_LABEL})`);

  if (!DRY_RUN && PROVIDER === "claude") {
    // Das SDK merkt fehlende Zugangsdaten erst beim ersten Aufruf; vorher prüfen spart Feed-Abrufe.
    const hasEnv = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"].some((k) => process.env[k]);
    const hasProfile = existsSync(join(homedir(), ".config", "anthropic"));
    if (!hasEnv && !hasProfile) throw new Error(`Kein API-Schlüssel gefunden. ${KEY_HINT}`);
    client = new Anthropic();
  }

  const categories = Object.keys(sources).filter((c) => !ONLY_CATEGORY || c === ONLY_CATEGORY);
  if (!categories.length) throw new Error(`Unbekanntes Thema: ${ONLY_CATEGORY}`);

  for (const category of categories) {
    console.log(`\n${CATEGORY_NAMES[category] ?? category}`);
    const candidates = await loadCandidates(category, sources[category], usedLinks);
    if (!candidates.length) {
      console.log("  keine neuen Meldungen");
      continue;
    }

    let made = 0;
    for (const item of candidates) {
      if (made >= PER_CATEGORY) break;
      console.log(`  → ${item.title} (${item.publisher})`);
      if (DRY_RUN) { made++; continue; }

      const sourceText = await loadSourceText(item);
      let result;
      try {
        result = await writeArticle(category, item, sourceText);
      } catch (err) {
        if (err instanceof OllamaError) {
          throw err;
        } else if (err instanceof Anthropic.AuthenticationError) {
          throw new Error(`Der API-Schlüssel wurde abgelehnt. ${KEY_HINT}`);
        } else if (err instanceof Anthropic.RateLimitError) {
          console.warn("  ! Rate-Limit erreicht – breche dieses Thema ab");
          break;
        } else if (err instanceof Anthropic.APIError) {
          console.warn(`  ! API-Fehler ${err.status}: ${err.message}`);
          continue;
        } else if (err instanceof SyntaxError) {
          console.warn("  ! Antwort war kein gültiges JSON – übersprungen");
          continue;
        }
        throw err;
      }

      seen.add(item.link);
      if (!result) continue;
      if (!result.suitable) {
        console.log(`    übersprungen: ${result.reason}`);
        continue;
      }
      // Themenprüfung: Die KI entscheidet, wohin der Artikel wirklich gehört.
      const topic = result.category;
      if (!CATEGORY_NAMES[topic]) {
        console.log("    übersprungen: passt zu keinem der vier Themen");
        continue;
      }
      if (topic !== category) {
        console.log(`    umsortiert: ${CATEGORY_NAMES[category]} → ${CATEGORY_NAMES[topic]}`);
      }
      if (!isValid(result)) {
        console.warn("    ! unvollständiger Artikel – übersprungen");
        continue;
      }

      let id = slugify(result.title) || `artikel-${Date.now()}`;
      while (existingIds.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
      existingIds.add(id);

      const { suitable, reason, category: _, ...article } = result;
      const finished = {
        id,
        category: topic,
        ...article,
        sections: article.sections.map((s) => ({ ...s, paragraphs: mergeFragments(s.paragraphs) })),
        // Doppelte Stichworte und den Themennamen selbst entfernen (kleine Modelle wiederholen sich gern).
        tags: [...new Set(article.tags.map((t) => t.trim()).filter(Boolean))]
          .filter((t) => t.toLowerCase() !== CATEGORY_NAMES[topic].toLowerCase()),
        readingMinutes: Math.max(1, article.readingMinutes),
        publishedAt: new Date().toISOString(),
        sources: [{ title: item.title, url: item.link, publisher: item.publisher }],
        aiGenerated: true,
        aiModel: MODEL_LABEL,
      };
      // Sofort speichern: bricht ein langer Lauf ab, sind die fertigen Artikel nicht verloren.
      await saveArticle(finished);
      created.push(finished);
      made++;
      console.log(`    ✓ „${result.title}“`);
    }
  }

  if (DRY_RUN) {
    console.log("\nProbelauf – nichts gespeichert.");
    return;
  }

  const index = await rebuildIndex();
  await writeFile(SEEN_PATH, JSON.stringify([...seen].slice(-2000), null, 2) + "\n", "utf8");
  console.log(`\n${created.length} neue Artikel gespeichert, insgesamt ${index.count}.`);
}

main().catch((err) => {
  console.error(`\nFehler: ${err.message}`);
  process.exitCode = 1;
});
