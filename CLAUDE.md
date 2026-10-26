# Wissenshappen

Mobile-first Wissens-Website für Jugendliche und junge Erwachsene: KI-erstellte Erklär-Artikel zu
Medizin, Wissenschaft, Astronomie, Psychologie, Politik und Geschichte, personalisiert über Likes. Siehe README.md.

## Design-Skills (in `.claude/skills/`)

Bei jeder Arbeit an der Oberfläche (`public/`) diese Skills nutzen und `DESIGN.md` einhalten:

- `impeccable` – Design-Regeln, Audit, Polish (`/impeccable audit`, `/impeccable polish` …)
- `taste-skill` (design-taste-frontend) – Art Direction und Anti-„AI-Slop“-Regeln
- Emil Kowalski: `emil-design-eng`, `mobile-native`, `animate`, `review-animations`,
  `improve-animations`, `animation-performance`, `animation-vocabulary`,
  `find-animation-opportunities`, `break-ui`, `apple-design`

Hinweis: Der Launcher von `impeccable` (`scripts/impeccable`) lädt beim ersten Start ein Binary
aus dem Netz nach. Vorher den Nutzer fragen.

## Artikel-Generator

`generator/generate.mjs` nutzt lokal standardmäßig Ollama mit `gemma4:e4b` (kostenlos, ca.
2–6 Min. pro Artikel auf diesem Laptop ohne Grafikkarte). Der tägliche GitHub-Lauf nutzt
ebenfalls `gemma4:e4b` (eingestellt in `.github/workflows/taeglich.yml`); `gemma4:12b` wurde getestet und
lieferte mehr Format- und Sachfehler. `--provider claude` für die Claude-API.
Kleine lokale Modelle machen sachliche Fehler: neue Artikel vor dem Veröffentlichen gegenlesen.

## Konventionen

- Kein Framework, kein Build-Schritt: `public/index.html`, `styles.css`, `app.js`.
- UI-Texte auf Deutsch, Leser werden geduzt.
- Artikel-Inhalte (`public/data/artikel/*.json`) immer über `esc()` ausgeben (KI-Inhalte nie als HTML).
- Artikel-Datenbank: `generator/store.mjs`. Der Index wird aus den Einzeldateien neu gebaut.
- Täglicher Lauf und Veröffentlichung: `.github/workflows/taeglich.yml` (GitHub Pages).
