"use strict";

/* ============================================================
   Wissenshappen – Frontend (ohne Framework, ohne Build-Schritt)
   Likes und Lesefortschritt bleiben im Browser (localStorage).
   ============================================================ */

const CATEGORIES = {
  medizin:      { name: "Medizin",      desc: "Körper, Gesundheit, Forschung" },
  wissenschaft: { name: "Wissenschaft", desc: "Natur, Technik, Weltall" },
  politik:      { name: "Politik",      desc: "Demokratie, Gesellschaft, Welt" },
  geschichte:   { name: "Geschichte",   desc: "Wie wir wurden, was wir sind" },
};
const CAT_KEYS = Object.keys(CATEGORIES);

const icon = (name, cls = "icon") =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const giant = (cat) =>
  `<svg class="icon giant" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${cat}"/></svg>`;

let articles = []; // Index: alle Artikel ohne Text
const fullArticles = new Map(); // bereits geladene Volltexte
const app = document.getElementById("app");

const PAGE_SIZE = 20;
let visible = PAGE_SIZE; // wie viele Einträge lange Listen gerade zeigen

/** Lange Listen in Portionen zeigen, damit das Handy nicht Tausende Karten auf einmal baut. */
function paged(items, render) {
  const shown = items.slice(0, visible).map(render).join("");
  const rest = items.length - visible;
  return rest > 0
    ? `${shown}<button class="more" type="button" data-more>Mehr anzeigen (${rest})</button>`
    : shown;
}

async function loadArticle(id) {
  if (!fullArticles.has(id)) {
    const res = await fetch(`data/artikel/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error(res.status);
    fullArticles.set(id, await res.json());
  }
  return fullArticles.get(id);
}

/* ---------- Speicher (Likes, Gelesen) ---------- */

const store = {
  read(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ }
  },
};

let likes = new Set(store.read("wh.likes"));
let readIds = new Set(store.read("wh.read"));

function toggleLike(id) {
  if (likes.has(id)) likes.delete(id);
  else likes.add(id);
  store.write("wh.likes", [...likes]);
  return likes.has(id);
}

function markRead(id) {
  if (readIds.has(id)) return;
  readIds.add(id);
  store.write("wh.read", [...readIds]);
}

/* ---------- Interessenprofil aus Likes ---------- */

function buildProfile() {
  const cats = Object.fromEntries(CAT_KEYS.map((k) => [k, 0]));
  const tags = {};
  for (const a of articles) {
    if (!likes.has(a.id)) continue;
    cats[a.category] += 1;
    for (const t of a.tags) tags[t] = (tags[t] || 0) + 1;
  }
  const total = Object.values(cats).reduce((s, n) => s + n, 0);
  // Laplace-Glättung: ohne Likes sind alle Themen gleich gewichtet.
  const share = Object.fromEntries(
    CAT_KEYS.map((k) => [k, (cats[k] + 1) / (total + CAT_KEYS.length)])
  );
  return { cats, tags, total, share };
}

function scoreArticle(a, profile, now) {
  const ageDays = Math.max(0, (now - new Date(a.publishedAt)) / 864e5);
  const recency = Math.exp(-ageDays / 14);
  const catAffinity = profile.share[a.category] * CAT_KEYS.length; // 1 = neutral
  const maxTag = Math.max(1, ...Object.values(profile.tags));
  const tagHits = a.tags.reduce((s, t) => s + (profile.tags[t] || 0) / maxTag, 0);
  const tagAffinity = Math.min(1.5, tagHits);

  let score = 0.55 * catAffinity + 0.35 * tagAffinity + 0.4 * recency;
  if (readIds.has(a.id)) score *= 0.45;
  if (likes.has(a.id)) score *= 0.3;
  return { score, tagAffinity, catAffinity };
}

function reasonFor(a, s, profile) {
  if (profile.total === 0 || likes.has(a.id)) return "";
  const tag = a.tags.find((t) => profile.tags[t]);
  if (s.tagAffinity >= 0.5 && tag) return `Passt zu #${tag}`;
  if (s.catAffinity > 1.15) return `Weil dir ${CATEGORIES[a.category].name} gefällt`;
  return "";
}

/** Personalisierter Feed: nach Interesse sortiert, jede 4. Stelle bewusst ein anderes Thema. */
function personalizedFeed() {
  const profile = buildProfile();
  const now = Date.now();
  const scored = articles
    .map((a) => {
      const s = scoreArticle(a, profile, now);
      return { a, s, reason: reasonFor(a, s, profile) };
    })
    .sort((x, y) => y.s.score - x.s.score);

  if (profile.total === 0) return scored;

  // Über den Tellerrand: Artikel aus dem am wenigsten gelikten Thema einstreuen.
  const leastCat = [...CAT_KEYS].sort((x, y) => profile.cats[x] - profile.cats[y])[0];
  const explore = scored.filter((x) => x.a.category === leastCat && !readIds.has(x.a.id));
  const result = [];
  const used = new Set();
  for (const item of scored) {
    if (used.has(item.a.id)) continue;
    if (result.length % 4 === 3) {
      const idx = explore.findIndex((x) => !used.has(x.a.id));
      if (idx >= 0) {
        const [pick] = explore.splice(idx, 1);
        result.push({ ...pick, reason: "Mal was anderes" });
        used.add(pick.a.id);
      }
    }
    if (!used.has(item.a.id)) {
      result.push(item);
      used.add(item.a.id);
    }
  }
  return result;
}

/* ---------- Hilfsfunktionen ---------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function formatDate(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days <= 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function likeButton(a, { big = false } = {}) {
  const on = likes.has(a.id);
  const label = big ? `<span>${on ? "Gefällt dir" : "Gefällt mir"}</span>` : "";
  return `<button class="like-btn${big ? " big" : ""}" type="button" data-like="${esc(a.id)}" aria-pressed="${on}"
    aria-label="Gefällt mir: ${esc(a.title)}">${icon("heart")}${label}</button>`;
}

function story(item, { lead = false } = {}) {
  const { a, reason = "" } = item;
  return `
    <article class="story${lead ? " lead" : ""}" data-cat="${esc(a.category)}">
      ${lead ? giant(a.category) : ""}
      <a class="story-link" href="#/artikel/${encodeURIComponent(a.id)}">
        <h2 class="story-title">${esc(a.title)}</h2>
        <p class="story-teaser">${esc(a.teaser)}</p>
      </a>
      <div class="story-foot">
        <div class="meta">
          <span class="topic">${icon(a.category)}${esc(CATEGORIES[a.category].name)}</span>
          ${reason ? `<span class="reason">${esc(reason)}</span>` : ""}
          <span>${a.readingMinutes} Min.</span>
          ${readIds.has(a.id) ? "<span>Gelesen</span>" : `<span>${formatDate(a.publishedAt)}</span>`}
        </div>
        ${likeButton(a)}
      </div>
    </article>`;
}

function chips(active) {
  const all = [["", "Alle"], ...CAT_KEYS.map((k) => [k, CATEGORIES[k].name])];
  return `<div class="chips" role="toolbar" aria-label="Nach Thema filtern">
    ${all.map(([k, label]) =>
      `<button class="chip" type="button" data-filter="${k}" ${k ? `data-cat="${k}"` : ""}
        aria-pressed="${k === active}">${label}</button>`
    ).join("")}
  </div>`;
}

/* ---------- Seiten ---------- */

let feedFilter = "";

function renderFeed() {
  const profile = buildProfile();
  let items = personalizedFeed();
  if (feedFilter) items = items.filter((x) => x.a.category === feedFilter);

  const hint = profile.total === 0
    ? `<div class="hint">${icon("heart")}<div>
         <strong>Like, was dich interessiert</strong>
         <p>Tippe aufs Herz. Dann rücken deine Lieblingsthemen hier nach oben.</p>
       </div></div>`
    : "";

  app.innerHTML = `
    <div class="page-head">
      <h1>Für dich</h1>
      <p>${profile.total ? "Sortiert nach dem, was dir gefällt." : "Allgemeinwissen in kleinen Happen, jeden Tag neu."}</p>
    </div>
    ${chips(feedFilter)}
    <div class="feed">
      ${hint}
      ${items.length
        ? paged(items.map((x, i) => ({ ...x, lead: i === 0 })), (x) => story(x, { lead: x.lead }))
        : '<p class="empty">Noch keine Artikel in diesem Thema.</p>'}
    </div>`;
}

function renderTopics(query = "") {
  const counts = Object.fromEntries(CAT_KEYS.map((k) => [k, articles.filter((a) => a.category === k).length]));
  const q = query.trim().toLowerCase();
  const results = q
    ? articles.filter((a) => [a.title, a.teaser, ...a.tags].some((s) => s.toLowerCase().includes(q)))
    : [];

  app.innerHTML = `
    <div class="page-head"><h1>Themen</h1><p>Such dir ein Gebiet aus oder suche nach einem Begriff.</p></div>
    <input class="search" type="search" placeholder="Suchen, z. B. Impfung oder EU" value="${esc(query)}"
      aria-label="Artikel durchsuchen" enterkeyhint="search" autocomplete="off">
    ${q
      ? `<div class="feed">${results.length
          ? paged(results, (a) => story({ a }))
          : '<p class="empty">Nichts gefunden. Versuch es mit einem anderen Wort.</p>'}</div>`
      : `<div class="tiles">
          ${CAT_KEYS.map((k) => `
            <a class="tile" data-cat="${k}" href="#/thema/${k}">
              ${giant(k)}
              <strong>${CATEGORIES[k].name}</strong>
              <span>${counts[k]} Artikel · ${CATEGORIES[k].desc}</span>
            </a>`).join("")}
        </div>`}`;

  const input = app.querySelector(".search");
  input.addEventListener("input", () => {
    const pos = input.selectionStart;
    renderTopics(input.value);
    const next = app.querySelector(".search");
    next.focus();
    next.setSelectionRange(pos, pos);
  });
}

function renderCategory(cat) {
  const meta = CATEGORIES[cat];
  if (!meta) return renderNotFound();
  const list = articles
    .filter((a) => a.category === cat)
    .sort((x, y) => new Date(y.publishedAt) - new Date(x.publishedAt));
  app.innerHTML = `
    <header class="chapter-head" data-cat="${cat}">
      ${giant(cat)}
      <button class="back" type="button" data-back>${icon("back")}Zurück</button>
      <div>
        <h1>${meta.name}</h1>
        <p>${meta.desc}. ${list.length} Artikel.</p>
      </div>
    </header>
    <div class="feed">${paged(list, (a) => story({ a })) || '<p class="empty">Noch keine Artikel.</p>'}</div>`;
}

async function renderArticle(id) {
  if (!articles.some((x) => x.id === id)) return renderNotFound();
  if (!fullArticles.has(id)) app.innerHTML = '<p class="loading">Lädt …</p>';
  let a;
  try {
    a = await loadArticle(id);
  } catch {
    app.innerHTML = `<p class="empty">Der Artikel konnte nicht geladen werden. <a href="#/">Zur Startseite</a></p>`;
    return;
  }
  if (location.hash !== `#/artikel/${encodeURIComponent(id)}`) return; // inzwischen weiternavigiert
  markRead(a.id);
  const cat = CATEGORIES[a.category];

  const related = articles
    .filter((x) => x.id !== a.id)
    .map((x) => ({
      x,
      s: (x.category === a.category ? 1 : 0) + x.tags.filter((t) => a.tags.includes(t)).length * 2,
    }))
    .filter((r) => r.s > 0)
    .sort((p, q) => q.s - p.s)
    .slice(0, 2);

  app.innerHTML = `
    <article class="article">
      <header class="article-head" data-cat="${esc(a.category)}">
        ${giant(a.category)}
        <div class="head-row">
          <button class="back" type="button" data-back>${icon("back")}Zurück</button>
          <a class="topic-link" href="#/thema/${esc(a.category)}">${icon(a.category)}${esc(cat.name)}</a>
        </div>
        <h1>${esc(a.title)}</h1>
        <p class="lead">${esc(a.teaser)}</p>
        <div class="meta">
          <span>${a.readingMinutes} Min. Lesezeit</span>
          <span>${formatDate(a.publishedAt)}</span>
          ${a.aiGenerated ? "<span>Mit KI erstellt</span>" : ""}
        </div>
        <section class="tldr">
          <h2>Das Wichtigste in Kürze</h2>
          <ul>${a.tldr.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        </section>
      </header>

      <div class="article-body">
        ${a.sections.map((s) => `
          <section class="article-section">
            <h2>${esc(s.heading)}</h2>
            ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
          </section>`).join("")}
      </div>

      <section class="why">
        <h2>Warum ist das wichtig?</h2>
        <p>${esc(a.whyItMatters)}</p>
      </section>

      ${a.glossary.length ? `
        <section class="glossary">
          <h2 class="heading">Begriffe erklärt</h2>
          ${a.glossary.map((g) => `
            <details><summary>${esc(g.term)}${icon("plus")}</summary><p>${esc(g.definition)}</p></details>`).join("")}
        </section>` : ""}

      ${a.quiz ? `
        <section class="quiz" data-answer="${a.quiz.answerIndex}">
          <h2 class="heading">Kurzes Quiz</h2>
          <p class="quiz-q">${esc(a.quiz.question)}</p>
          <div class="quiz-options">
            ${a.quiz.options.map((o, i) =>
              `<button class="quiz-option" type="button" data-option="${i}"><span>${esc(o)}</span></button>`).join("")}
          </div>
          <p class="quiz-explain" hidden></p>
        </section>` : ""}

      <section class="discuss">
        <h2>Diskutier mit</h2>
        <ol>${a.discussion.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
        <button class="btn" type="button" data-share>${icon("share")}Mit Freunden teilen</button>
      </section>

      <div class="like-bar">
        <div><strong>Hat dir das gefallen?</strong><span class="sub">Dann zeigen wir dir mehr davon.</span></div>
        ${likeButton(a, { big: true })}
      </div>

      ${related.length ? `
        <h2 class="heading">Mehr davon</h2>
        <div class="feed">${related.map((r) => story({ a: r.x })).join("")}</div>` : ""}

      <section class="sources">
        <h2 class="heading">Quellen</h2>
        <ul>${a.sources.map((s) =>
          `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>, ${esc(s.publisher)}</li>`
        ).join("")}</ul>
        ${a.aiGenerated ? `<p class="disclaimer">Dieser Artikel wurde mit KI auf Grundlage der genannten Quellen geschrieben. KI kann Fehler machen. Prüf wichtige Fakten in den Originalquellen.</p>` : ""}
      </section>
    </article>`;

  const quiz = app.querySelector(".quiz");
  if (quiz) quiz.dataset.explanation = a.quiz.explanation;
}

function renderLikes() {
  const profile = buildProfile();
  const liked = articles.filter((a) => likes.has(a.id));
  const maxCount = Math.max(...CAT_KEYS.map((k) => profile.cats[k]), 1);
  const topTags = Object.entries(profile.tags).sort((x, y) => y[1] - x[1]).slice(0, 10);

  app.innerHTML = `
    <div class="page-head"><h1>Deine Likes</h1>
      <p>${liked.length ? `${liked.length} ${liked.length === 1 ? "Artikel gefällt" : "Artikel gefallen"} dir.` : "Du hast noch nichts geliked."}</p></div>

    ${liked.length ? `
      <h2 class="heading">Deine Interessen</h2>
      <div class="interests">
        ${CAT_KEYS.map((k) => {
          const pct = Math.round((profile.cats[k] / profile.total) * 100);
          return `<div class="interest" data-cat="${k}">
            <span class="label">${icon(k)}${CATEGORIES[k].name}</span>
            <span class="pct">${pct} %</span>
            <div class="track" role="img" aria-label="${CATEGORIES[k].name}: ${pct} Prozent deiner Likes">
              <div class="fill" style="width:${(profile.cats[k] / maxCount) * 100}%"></div>
            </div>
          </div>`;
        }).join("")}
      </div>
      ${topTags.length ? `
        <h2 class="heading">Deine Stichworte</h2>
        <div class="tag-cloud">${topTags.map(([t]) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>` : ""}
      <h2 class="heading">Gelikte Artikel</h2>
      <div class="feed">${paged(liked, (a) => story({ a }))}</div>
      <button class="text-btn" type="button" data-reset>Likes und Verlauf zurücksetzen</button>
    ` : `
      <div class="hint">${icon("heart")}<div>
        <strong>So funktioniert's</strong>
        <p>Tippe bei Artikeln aufs Herz. Aus deinen Likes lernt die Seite, welche Themen dich interessieren, und sortiert „Für dich“ danach.</p>
      </div></div>
      <p style="margin-top:20px"><a class="btn" href="#/">Artikel entdecken</a></p>
    `}`;
}

function renderNotFound() {
  app.innerHTML = `<p class="empty">Diese Seite gibt es nicht. <a href="#/">Zur Startseite</a></p>`;
}

/* ---------- Router ---------- */

function route() {
  const [, page = "", param = ""] = location.hash.replace(/^#/, "").split("/");
  const id = decodeURIComponent(param);
  const tab = page === "" ? "feed" : page === "likes" ? "likes" : page === "artikel" ? null : "themen";
  document.querySelectorAll(".tabbar a").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
    if (el.dataset.tab === tab) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });

  visible = PAGE_SIZE;
  if (page === "") renderFeed();
  else if (page === "themen") renderTopics();
  else if (page === "thema") renderCategory(id);
  else if (page === "artikel") renderArticle(id);
  else if (page === "likes") renderLikes();
  else renderNotFound();

  window.scrollTo(0, 0);
}

/* ---------- Interaktionen ---------- */

app.addEventListener("click", async (e) => {
  const likeEl = e.target.closest("[data-like]");
  if (likeEl) {
    const id = likeEl.dataset.like;
    const on = toggleLike(id);
    document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", on);
      const label = btn.querySelector("span");
      if (label) label.textContent = on ? "Gefällt dir" : "Gefällt mir";
      btn.classList.remove("pop");
      if (on) {
        void btn.offsetWidth; // Animation neu starten
        btn.classList.add("pop");
      }
    });
    const a = articles.find((x) => x.id === id);
    if (on && a) toast(`Gemerkt. Du siehst jetzt mehr zu ${CATEGORIES[a.category].name}.`);
    if (location.hash === "#/likes" && !on) renderLikes();
    return;
  }

  const filterEl = e.target.closest("[data-filter]");
  if (filterEl) {
    feedFilter = filterEl.dataset.filter;
    visible = PAGE_SIZE;
    renderFeed();
    return;
  }

  if (e.target.closest("[data-more]")) {
    const y = window.scrollY;
    visible += PAGE_SIZE;
    const [, page = "", param = ""] = location.hash.replace(/^#/, "").split("/");
    if (page === "") renderFeed();
    else if (page === "thema") renderCategory(decodeURIComponent(param));
    else if (page === "likes") renderLikes();
    else if (page === "themen") renderTopics(app.querySelector(".search")?.value ?? "");
    window.scrollTo(0, y);
    return;
  }

  if (e.target.closest("[data-back]")) {
    if (history.length > 1) history.back();
    else location.hash = "#/";
    return;
  }

  const optionEl = e.target.closest("[data-option]");
  if (optionEl && !optionEl.disabled) {
    const quiz = optionEl.closest(".quiz");
    const answer = Number(quiz.dataset.answer);
    const chosen = Number(optionEl.dataset.option);
    quiz.querySelectorAll(".quiz-option").forEach((btn, i) => {
      btn.disabled = true;
      if (i === answer) {
        btn.classList.add("correct");
        btn.insertAdjacentHTML("beforeend", `<span class="verdict">Richtig</span>`);
      } else if (i === chosen) {
        btn.classList.add("wrong");
        btn.insertAdjacentHTML("beforeend", `<span class="verdict">Deine Wahl</span>`);
      } else {
        btn.classList.add("dim");
      }
    });
    const explain = quiz.querySelector(".quiz-explain");
    explain.textContent = `${chosen === answer ? "Genau." : "Nicht ganz."} ${quiz.dataset.explanation}`;
    explain.hidden = false;
    return;
  }

  if (e.target.closest("[data-share]")) {
    const title = app.querySelector("h1")?.textContent || "Wissenshappen";
    const data = { title, text: `Lass uns darüber reden: ${title}`, url: location.href };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* abgebrochen */ }
    } else {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Link kopiert");
      } catch {
        toast("Teilen klappt in diesem Browser leider nicht");
      }
    }
    return;
  }

  if (e.target.closest("[data-reset]")) {
    if (!confirm("Alle Likes und den Leseverlauf löschen?")) return;
    likes = new Set();
    readIds = new Set();
    store.write("wh.likes", []);
    store.write("wh.read", []);
    renderLikes();
  }
});

window.addEventListener("hashchange", route);

/* ---------- Start ---------- */

fetch("data/index.json", { cache: "no-cache" })
  .then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  })
  .then((data) => {
    articles = data.articles.filter((a) => CATEGORIES[a.category]);
    // Likes zu gelöschten Artikeln aufräumen
    const ids = new Set(articles.map((a) => a.id));
    likes = new Set([...likes].filter((id) => ids.has(id)));
    route();
  })
  .catch(() => {
    app.innerHTML = '<p class="empty">Die Artikel konnten nicht geladen werden. Lade die Seite bitte neu.</p>';
  });
