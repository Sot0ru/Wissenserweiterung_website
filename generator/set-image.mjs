// Bild eines Artikels von Hand setzen oder entfernen.
//
//   npm run bild -- <artikel-id> "<Commons-Dateiname>" "<Alternativtext>"
//   npm run bild -- <artikel-id> --entfernen
//   npm run bild -- --vorschau <ordner> "<Dateiname>" …   (lädt nur Vorschaubilder zum Ansehen)
//
// Es werden nur Bilder mit freier Lizenz akzeptiert; Bildnachweis wird aus Commons übernommen.
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { saveArticle, rebuildIndex } from "./store.mjs";
import { fileInfo, downloadTo } from "./images.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [first, ...rest] = process.argv.slice(2);

if (first === "--vorschau") {
  const [dir, ...titles] = rest;
  await mkdir(dir, { recursive: true });
  for (const [i, title] of titles.entries()) {
    const info = await fileInfo(title);
    await downloadTo(info, join(dir, `kandidat-${i + 1}.jpg`));
    console.log(`${i + 1}. ${info.title} | ${info.license} | ${info.author}`);
  }
} else {
  const id = first;
  const path = join(ROOT, "public", "data", "artikel", `${id}.json`);
  const article = JSON.parse(await readFile(path, "utf8"));
  if (article.image?.src) await rm(join(ROOT, "public", article.image.src), { force: true });

  if (rest[0] === "--entfernen") {
    article.image = null;
    console.log(`Bild entfernt: ${id}`);
  } else {
    const [title, alt] = rest;
    if (!title || !alt) throw new Error("Dateiname und Alternativtext angeben.");
    const info = await fileInfo(title);
    const file = `${id}.${info.mime === "image/png" ? "png" : "jpg"}`;
    await downloadTo(info, join(ROOT, "public", "data", "bilder", file));
    article.image = {
      src: `data/bilder/${file}`,
      width: info.thumbWidth,
      height: info.thumbHeight,
      alt,
      credit: { title: info.title, author: info.author, license: info.license, licenseUrl: info.licenseUrl, sourceUrl: info.sourceUrl },
    };
    console.log(`Bild gesetzt: ${id} ← ${info.title} (${info.license})`);
  }
  await saveArticle(article);
  await rebuildIndex();
}
