// Bilder für Artikel aus Wikimedia Commons – nur frei lizenzierte Bilder, mit vollständigem Bildnachweis.
//
// Ablauf: Suchbegriff → Kandidaten von Commons (nur freie Lizenzen) → die KI wählt das passende Bild
// oder keines → das Vorschaubild wird in public/data/bilder/ gespeichert. Die Website lädt Bilder
// also nie von Wikimedia nach; Besucherdaten gehen nicht an Dritte.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMAGE_DIR = join(ROOT, "public", "data", "bilder");
const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia verlangt einen aussagekräftigen User-Agent mit Kontaktmöglichkeit.
const USER_AGENT = "Wissenshappen/0.1 (https://github.com/Sot0ru/Wissenserweiterung_website)";
const THUMB_WIDTH = 960;

// Lizenzen, unter denen wir Bilder mit Namensnennung zeigen dürfen.
const FREE_LICENSE = /^(public domain|pd\b|cc0|cc[ -]by(-sa)?([ -][\d.]+)?)/i;

const stripHtml = (s = "") =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function commonsJson(params) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: "json", ...params })}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  return res.json();
}

const IMAGE_INFO = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(THUMB_WIDTH) };

function toCandidate(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  return info && {
    title: page.title.replace(/^File:/, ""),
    sourceUrl: info.descriptionurl,
    thumbUrl: info.thumburl,
    thumbWidth: info.thumbwidth,
    thumbHeight: info.thumbheight,
    width: info.width,
    height: info.height,
    mime: info.mime,
    license: stripHtml(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value ?? "",
    author: stripHtml(meta.Artist?.value).slice(0, 120) || "unbekannt",
    description: stripHtml(meta.ImageDescription?.value).slice(0, 220),
    categories: stripHtml(meta.Categories?.value).replace(/\|/g, ", ").slice(0, 160),
  };
}

/** Angaben zu einer bestimmten Commons-Datei; wirft einen Fehler, wenn die Lizenz nicht frei ist. */
export async function fileInfo(title) {
  const data = await commonsJson({ action: "query", titles: `File:${title.replace(/^File:/, "")}`, ...IMAGE_INFO });
  const page = Object.values(data.query?.pages ?? {})[0];
  const info = page && toCandidate(page);
  if (!info) throw new Error(`Datei nicht gefunden: ${title}`);
  if (!FREE_LICENSE.test(info.license)) throw new Error(`Keine freie Lizenz (${info.license}): ${title}`);
  return info;
}

/** Lädt das Vorschaubild (960 px breit) herunter. */
export async function downloadTo(info, path) {
  const res = await fetch(info.thumbUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bild-Download ${res.status}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

/** Sucht frei lizenzierte Fotos zu einem Suchbegriff und gibt sie mit Lizenzangaben zurück. */
export async function searchCommons(query, limit = 10) {
  const data = await commonsJson({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    ...IMAGE_INFO,
  });
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  return pages
    .map(toCandidate)
    .filter(Boolean)
    // Nur JPEG: Fotos sind klein genug für das 1-GB-Limit von GitHub Pages; PNGs sind meist Grafiken.
    .filter((c) => c.mime === "image/jpeg")
    .filter((c) => FREE_LICENSE.test(c.license))
    .filter((c) => c.width >= 800 && c.width / c.height > 0.6 && c.width / c.height < 2.4);
}

const QUERY_SYSTEM = `Du suchst ein Foto für einen Erklär-Artikel in der Bilddatenbank Wikimedia Commons.
Gib einen englischen Suchbegriff aus zwei bis vier Wörtern zurück, der das konkrete, fotografierbare Hauptmotiv benennt (z. B. "solar eclipse corona", "Leipzig Völkerschlachtdenkmal", "Belgrade protest students").
Gibt es kein sinnvolles Motiv (z. B. ein reines Rechenrätsel oder eine abstrakte Idee), gib einen leeren Suchbegriff zurück.`;

const PICK_SYSTEM = `Du wählst ein Foto für einen Erklär-Artikel aus Kandidaten von Wikimedia Commons.
Regeln:
- Das Bild muss das Thema des Artikels direkt zeigen oder eindeutig illustrieren. Ein nur entfernt verwandtes Bild ist schlechter als keines.
- Keine Bilder, die etwas anderes zeigen, als der Artikel behauptet (z. B. eine andere Person, einen anderen Ort, ein anderes Ereignis).
- Geht es um ein bestimmtes Ereignis (ein Sturm, eine Demonstration, eine Entdeckung, ein Planet), dann kein Foto eines anderen Ereignisses derselben Art. Ein Foto von einem anderen Sturm ist falsch, auch wenn es ähnlich aussieht.
- Bei Personen: Prüfe, ob wirklich dieselbe Person gemeint ist und nicht jemand mit gleichem Namen.
- Keine Grafiken oder Schaubilder, die etwas anderes erklären als der Artikel (z. B. ein ähnliches, aber anderes Verfahren).
- Keine Logos, Diagramme mit viel Text, Briefmarken, Buchseiten oder Screenshots, außer genau das ist das Thema.
- Keine Fotos, auf denen erkennbare Privatpersonen in einer unangenehmen Lage zu sehen sind.
Gib den Index des besten Kandidaten zurück oder -1, wenn keiner passt. Schreib außerdem einen kurzen deutschen Alternativtext, der beschreibt, was auf dem Bild zu sehen ist (höchstens 120 Zeichen).`;

/**
 * Findet ein passendes Bild für einen Artikel, speichert es und gibt die Bildangaben zurück –
 * oder null, wenn nichts passt. `ask(system, user, schema)` ist die KI-Anfrage des Generators.
 */
export async function findImage(article, ask, { query, log = console.log } = {}) {
  const summary = `Titel: ${article.title}\nTeaser: ${article.teaser}\nStichworte: ${(article.tags ?? []).join(", ")}`;
  if (query === undefined) {
    const res = await ask(QUERY_SYSTEM, summary, {
      type: "object", additionalProperties: false, required: ["query"],
      properties: { query: { type: "string" } },
    });
    query = res?.query?.trim() ?? "";
  }
  if (!query) {
    log("    Bild: kein passendes Motiv");
    return null;
  }

  let candidates = await searchCommons(query);
  if (!candidates.length && query.split(" ").length > 2) {
    candidates = await searchCommons(query.split(" ").slice(0, 2).join(" "));
  }
  if (!candidates.length) {
    log(`    Bild: nichts Freies gefunden zu „${query}“`);
    return null;
  }

  const list = candidates
    .map((c, i) => `[${i}] ${c.title}\n    Beschreibung: ${c.description || "–"}\n    Kategorien: ${c.categories || "–"}`)
    .join("\n");
  const pick = await ask(PICK_SYSTEM, `${summary}\n\nKandidaten:\n${list}`, {
    type: "object", additionalProperties: false, required: ["index", "alt"],
    properties: { index: { type: "integer" }, alt: { type: "string" } },
  });
  const chosen = candidates[pick?.index];
  if (!chosen) {
    log(`    Bild: keiner der ${candidates.length} Kandidaten passt („${query}“)`);
    return null;
  }

  const file = `${article.id}.${chosen.mime === "image/png" ? "png" : "jpg"}`;
  await downloadTo(chosen, join(IMAGE_DIR, file));
  log(`    Bild: ${chosen.title} (${chosen.license})`);

  return {
    src: `data/bilder/${file}`,
    width: chosen.thumbWidth,
    height: chosen.thumbHeight,
    alt: (pick.alt || article.title).slice(0, 160),
    credit: {
      title: chosen.title,
      author: chosen.author,
      license: chosen.license,
      licenseUrl: chosen.licenseUrl,
      sourceUrl: chosen.sourceUrl,
    },
  };
}
