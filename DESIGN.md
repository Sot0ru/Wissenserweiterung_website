# Wissenshappen – Design

Gestaltungsgrundlage für alle UI-Arbeiten. Entstanden mit den Projekt-Skills `taste-skill`
(Richtung „Colour chapters“), `impeccable` (Craft-Floor) und Emil Kowalskis Skills
(`emil-design-eng`, `mobile-native`).

## Idee

Die sechs Themen sind sechs flache Farbflächen. Jeder Artikel ist ein Plakat in der Farbe seines
Themas; der Feed liest sich wie eine Reihe aufgehängter Plakate. Eine Schrift-Familie und ein
Raster halten alles zusammen.

| Thema        | Fläche    | Icon        |
| ------------ | --------- | ----------- |
| Medizin      | `#c3ead5` | Kreuz       |
| Wissenschaft | `#cbe4f2` | Atom        |
| Astronomie   | `#d5cbf6` | Mondsichel  |
| Psychologie  | `#ffc2ad` | Kopfprofil  |
| Politik      | `#ffc013` | Säulenbau   |
| Geschichte   | `#f1e3b5` | Sanduhr     |

Text auf Flächen ist immer `#0a0a0a`. Magenta (`#b0298f`) ist allein den Likes vorbehalten.
Das dunkle Schlusskapitel jedes Artikels ist „Diskutier mit“.

## Typografie

- Überschriften und Bedienelemente: **Libre Franklin** (variabel, lokal in `public/fonts/`)
- Lesetext: **Source Serif 4** (variabel, lokal)
- Fünf Stufen: `--step-small`, `--step-body`, `--step-lead`, `--step-head` plus Aufmacher-Größe
- Kein Text unter 13 px, Fließtext mindestens 17 px, Eingabefelder 16 px (sonst zoomt iOS)

Schriften werden selbst gehostet, nicht von Google geladen (DSGVO).

## Regeln

- Keine Emojis als Icons. Icons sind ein eigener SVG-Satz in `index.html` (`#i-*`), eine Strichstärke.
- Keine Schatten, keine Rahmen um Karten, keine Kicker/Eyebrows über Überschriften,
  keine Großbuchstaben-Labels, keine Verläufe, kein Glas-Effekt.
- Flächen eckig, Bedienelemente (Chips, Buttons, Like) voll gerundet.
- Hover nur hinter `@media (hover: hover) and (pointer: fine)`; Touch bekommt `:active`.

## Bewegung

- Ein Signatur-Moment: Die große Themenform im Artikelkopf setzt sich (700 ms, ease-out).
- Like-Herz: kurzer Pop (320 ms). Alle Bedienelemente: `scale(0.92–0.98)` beim Drücken, 160 ms.
- Kurven: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; nie `ease-in`.
- `prefers-reduced-motion` schaltet alles ab.
