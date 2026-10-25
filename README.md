# Wissenshappen

Allgemeinwissen in kleinen Happen – für Jugendliche und junge Erwachsene, gemacht fürs Handy.

- **Sechs Themen:** Medizin, Wissenschaft, Astronomie, Psychologie, Politik, Geschichte
- **Quellen:** Nachrichten (tagesschau.de, Deutschlandfunk, Ärzteblatt) und Wissenschaft
  (Spektrum, ScienceDaily)
- **KI-Artikel:** Ein freies Open-Source-Modell (lokal über Ollama) oder optional Claude schreibt aus jeder Meldung einen Erklär-Artikel mit „Das Wichtigste in
  Kürze“, Begriffserklärungen, Quiz und Diskussionsfragen
- **Likes:** Herz antippen → der Feed „Für dich“ sortiert nach Lieblingsthemen und Stichworten,
  streut aber regelmäßig ein anderes Thema ein („Mal was anderes“), damit der Horizont wächst

## Starten

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen. Fürs Handy im selben WLAN: `http://<IP-des-Rechners>:3000`.

## Neue Artikel erzeugen

Standardmäßig schreibt ein **freies Open-Source-Modell auf deinem eigenen Rechner** die Artikel,
über [Ollama](https://ollama.com). Das kostet nichts und braucht kein Konto. Einmalig einrichten:

```bash
winget install Ollama.Ollama
ollama pull gemma4:e4b
```

Auf einem Laptop ohne eigene Grafikkarte dauert ein Artikel einige Minuten. Kleine lokale Modelle
machen öfter Fehler als große; lies die Artikel vor dem Veröffentlichen gegen. Ein anderes Modell
wählst du mit `--model qwen3.5:9b` oder `OLLAMA_MODEL` in der `.env`.

Optional geht auch Claude (kostenpflichtig, bessere Texte): `.env.example` nach `.env` kopieren,
`ANTHROPIC_API_KEY` eintragen und `KI_ANBIETER=claude` setzen oder `--provider claude` anhängen.

```bash
npm run generate:dry                 # zeigt nur, welche Meldungen verwendet würden
npm run generate                     # je Thema 1 neuer Artikel
npm run generate -- --per-category 3
npm run generate -- --category politik
```

Die Feeds stehen in `generator/sources.json`. Bereits verarbeitete Links merkt sich
`generator/seen.json`. Täglich automatisch laufen lassen geht z. B. per Windows-Aufgabenplanung,
Cron oder GitHub Actions.

## Online stellen und täglich neue Artikel (GitHub)

Der Ablauf in `.github/workflows/taeglich.yml` schreibt jeden Morgen (Start 3:17 Uhr, fertig gegen 5–6 Uhr) mit gemma4:12b je Thema zwei
neue Artikel (mit Ollama auf einem GitHub-Rechner, kostenlos) und veröffentlicht die Website auf
GitHub Pages. Einmalig einrichten:

1. Auf github.com ein **öffentliches** Repository anlegen, z. B. `wissenshappen` (ohne README).
2. Projekt hochladen (im Projektordner):
   ```bash
   git remote add origin https://github.com/DEIN-NAME/wissenshappen.git
   git push -u origin main
   ```
3. Im Repository: **Settings → Pages → Source: „GitHub Actions“** auswählen.
4. **Actions → „Täglich neue Artikel“ → „Run workflow“** einmal von Hand starten (dauert ca. 30–60 Min.).

Danach ist die Seite unter `https://DEIN-NAME.github.io/wissenshappen/` erreichbar.
Artikel lokal schreiben geht weiterhin; vor dem eigenen `git push` dann `git pull`, weil der
tägliche Lauf selbst Artikel hochlädt.

## Aufbau

```
public/            die Website (statisch, kann auf jeden Hoster)
  index.html       Gerüst, Icon-Satz
  styles.css       Gestaltung (siehe DESIGN.md)
  app.js           Feed, Personalisierung, Artikelansicht, Likes
  data/index.json  Liste aller Artikel (für Startseite, Suche, Likes)
  data/artikel/    ein JSON pro Artikel – die Sammlung wächst täglich, nichts wird gelöscht
  fonts/           Libre Franklin, Source Serif 4 (SIL Open Font License)
generator/         KI-Artikelgenerator
server.mjs         kleiner Server für die lokale Entwicklung
.claude/skills/    Design-Skills: impeccable, taste-skill, Emil Kowalski
```

Likes und Leseverlauf liegen nur im Browser (localStorage) – es gibt keine Konten und keine
Datenübertragung.

## Skills von Dritten

| Skill | Quelle | Lizenz |
| --- | --- | --- |
| impeccable | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ 9368675 | Apache 2.0 |
| taste-skill | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) @ 6010f91 | MIT |
| emil-design-eng u. a. | [emilkowalski/skills](https://github.com/emilkowalski/skills) @ 2d22863 | MIT |
