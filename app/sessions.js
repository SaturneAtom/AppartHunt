// Sessions : le journal complet de l'agent, relu depuis les fichiers que Claude Code écrit au fil de l'eau
// (~/.claude/projects/<dossier>/<session>.jsonl) : chaque message, chaque commande et son résultat entier, à la seconde.
// Claude Code les efface au bout d'un moment : on en garde une copie dans <recherche>/logs/sessions/.
// Module sans Electron (testable seul : node app/sessions.js [session]) ; main.js s'en sert pour l'onglet Activité.
const fs = require("fs"), os = require("os"), path = require("path");

const SANS_INTERET = new Set(["turn_duration", "local_command", "away_summary"]);
const nomOutil = n => n.replace(/^mcp__([a-z0-9-]+)__/, "$1 · ");
const jourDe = ms => new Date(ms).toLocaleDateString("sv-SE");

function creer(repo, workspace) {
  const racine = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const vivant = path.join(racine, "projects", repo.replace(/[^a-zA-Z0-9]/g, "-")), archive = path.join(workspace, "logs", "sessions");
  const cache = new Map();                // fichier → { taille, mtime, s }

  // Une copie à nous de tout ce qui a changé
  function archiver() {
    fs.mkdirSync(archive, { recursive: true });
    for (const f of fichiers(vivant)) {
      const a = path.join(archive, path.basename(f));
      let dejaLa = -1; try { dejaLa = fs.statSync(a).size; } catch { /* pas encore copiée */ }
      if (dejaLa !== fs.statSync(f).size) fs.copyFileSync(f, a);
    }
  }
  function fichiers(d) { try { return fs.readdirSync(d).filter(f => f.endsWith(".jsonl")).map(f => path.join(d, f)); } catch { return []; } }
  function toutes() {
    const parId = new Map();
    for (const f of [...fichiers(archive), ...fichiers(vivant)]) parId.set(path.basename(f, ".jsonl"), f);   // le fichier vivant d'abord
    const out = [];
    for (const f of parId.values()) { const s = lue(f); if (s.etapes.length) out.push(s); }
    // Une session reprise en « fork » recopie toute la précédente : on ne garde que la plus longue de la lignée
    const lignee = new Map();
    for (const s of out) { const k = s.origine || s.id, l = lignee.get(k); if (!l || s.fin > l.fin) lignee.set(k, s); }
    return [...lignee.values()];
  }
  function lue(f) {
    const st = fs.statSync(f), c = cache.get(f);
    if (c && c.taille === st.size && c.mtime === st.mtimeMs) return c.s;
    const s = lire(f); cache.set(f, { taille: st.size, mtime: st.mtimeMs, s });
    return s;
  }

  // Une ligne par jour et par session, pour la liste de l'onglet
  function liste(chats = [], actif = null) {
    try { archiver(); } catch (err) { console.error("[sessions] copie :", err.message); }
    const parSession = new Map(chats.filter(c => c.sessionId).map(c => [c.sessionId, c]));
    const lignes = [];
    for (const s of toutes()) {
      const chat = parSession.get(s.id), jours = new Map();
      for (const e of s.etapes) {
        const j = jourDe(e.ts);
        const l = jours.get(j) || jours.set(j, { id: s.id, jour: j, debut: e.ts, fin: e.ts, at: e.i, tours: new Set(), actions: 0, erreurs: 0, resume: "", pages: new Set() }).get(j);
        l.fin = e.ts; l.tours.add(e.tour);
        if (e.k === "outil") { l.actions++; if (e.err) l.erreurs++; const u = e.entree?.url; if (u) l.pages.add(u); }
        if (e.k === "erreur") l.erreurs++;
        if (e.k === "texte") l.resume = e.txt;
      }
      for (const l of jours.values()) lignes.push({ ...l, tours: l.tours.size, pages: l.pages.size, resume: l.resume.slice(0, 280),
        titre: chat?.titre && chat.titre !== "Nouveau chat" ? chat.titre : s.titre, chat: chat?.id || null, actif: s.id === actif });
    }
    return lignes;
  }

  function session(id, chats = [], actif = null) {
    if (!/^[\w-]+$/.test(String(id))) return null;
    const s = toutes().find(x => x.id === id); if (!s) return null;
    const chat = chats.find(c => c.sessionId === id);
    return { ...s, titre: chat?.titre && chat.titre !== "Nouveau chat" ? chat.titre : s.titre, chat: chat?.id || null, actif: id === actif };
  }
  // Où ce texte apparaît, dans tous les logs : par session et par jour
  function cherche(q) {
    q = String(q || "").toLowerCase().trim(); if (q.length < 2) return [];
    const hits = [];
    for (const s of toutes()) for (const e of s.etapes) {
      if (!etapeContient(e, q)) continue;
      const j = jourDe(e.ts), h = hits.find(x => x.id === s.id && x.jour === j);
      if (h) h.n++; else hits.push({ id: s.id, jour: j, n: 1 });
    }
    return hits;
  }
  const fichierDe = id => { const a = path.join(vivant, id + ".jsonl"), b = path.join(archive, id + ".jsonl"); return /^[\w-]+$/.test(String(id)) ? (fs.existsSync(a) ? a : fs.existsSync(b) ? b : null) : null; };
  return { liste, session, cherche, fichierDe, archiver };
}

const etapeContient = (e, q) => [e.txt, e.nom, e.court, e.res, e.ecran, e.entree && JSON.stringify(e.entree)].some(x => x && String(x).toLowerCase().includes(q));

// Le fichier d'une session → ses étapes dans l'ordre
function lire(fichier) {
  const s = { id: path.basename(fichier, ".jsonl"), titre: "", debut: 0, fin: 0, modele: "", version: "", dossier: "", cout: null, tours: 0, etapes: [] };
  let lignes = []; try { lignes = fs.readFileSync(fichier, "utf8").split("\n"); } catch { return s; }
  const parOutil = new Map(), couts = new Map(), jetons = new Map();
  const entrees = [];
  for (const l of lignes) { if (!l) continue; try { entrees.push(JSON.parse(l)); } catch { /* ligne en cours d'écriture */ } }
  const pousse = (e, ts) => { e.i = s.etapes.length; e.ts = ts; e.tour = s.tours; s.etapes.push(e); return e; };
  let enAttente = 0;
  for (const e of entrees) {
    if (e.type === "cost-state" && e.totalCostUSD != null) couts.set(e.startTime, e.totalCostUSD);
    if (!["user", "assistant", "system"].includes(e.type) || e.isSidechain) continue;
    const ts = Date.parse(e.timestamp) || s.fin; s.version = e.version || s.version; s.dossier = e.cwd || s.dossier;
    if (e.type === "system") {
      if (!SANS_INTERET.has(e.subtype) && e.content) pousse({ k: "systeme", txt: String(e.content), nom: e.subtype || "système" }, ts);
    } else if (e.type === "assistant") {
      const m = e.message || {};
      if (m.model && m.model !== "<synthetic>") s.modele = m.model;
      if (m.usage && m.id) jetons.set(m.id, (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0) + (m.usage.output_tokens || 0));
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (e.isApiErrorMessage && b.type === "text") pousse({ k: "erreur", txt: b.text, nom: "erreur de l'API" }, ts);
        else if (b.type === "text" && b.text?.trim()) pousse({ k: "texte", txt: b.text }, ts);
        else if (b.type === "thinking") pousse({ k: "pensee", txt: b.thinking || "", ms: e.thinkingDurationMs || null }, ts);
        else if (b.type === "tool_use") {
          const o = pousse({ k: "outil", id: b.id, nom: nomOutil(b.name), court: courtDe(b.input), entree: b.input || {} }, ts);
          parOutil.set(b.id, o); enAttente++;
        }
      }
    } else {
      const c = e.message?.content;
      if (typeof c === "string" || c?.some?.(b => b.type === "text")) {
        if (e.isMeta) continue;
        const brut = typeof c === "string" ? c : c.filter(b => b.type === "text").map(b => b.text).join("\n");
        if (/^\[Request interrupted/.test(brut)) { pousse({ k: "systeme", nom: "interrompu", txt: "Tour arrêté." }, ts); enAttente = 0; continue; }
        const m = brut.match(/^\[Écran actuel\]\n([\s\S]*?)\n\n\[L'utilisateur dit\]\n([\s\S]*)$/);
        const txt = m ? m[2] : brut, recadrage = enAttente > 0;
        if (!recadrage) s.tours++;
        if (!s.origine) s.origine = e.uuid;
        if (!s.titre) s.titre = txt.split("\n")[0].slice(0, 70);
        pousse({ k: recadrage ? "toi" : "demande", txt, ecran: m ? m[1] : "", auto: /^\[Veille automatique\]/.test(txt) }, ts);
      }
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type !== "tool_result") continue;
        const o = parOutil.get(b.tool_use_id); if (!o) continue;
        const parts = Array.isArray(b.content) ? b.content : [{ type: "text", text: String(b.content ?? "") }];
        o.res = parts.map(x => x.type === "text" ? x.text : x.type === "tool_reference" ? x.tool_name : "").filter(Boolean).join("\n");
        const imgs = parts.filter(x => x.type === "image" && x.source?.data).map(x => `data:${x.source.media_type};base64,${x.source.data}`);
        if (imgs.length) o.images = imgs;
        o.err = !!b.is_error; o.ms = ts - o.ts; enAttente = Math.max(0, enAttente - 1);
      }
    }
  }
  // Fork : les lignes recopiées ont leur date d'origine, tout reste dans l'ordre
  if (s.etapes.length) { s.debut = s.etapes[0].ts; s.fin = s.etapes[s.etapes.length - 1].ts; }
  if (couts.size) s.cout = [...couts.values()].reduce((a, b) => a + b, 0);
  s.jetons = [...jetons.values()].reduce((a, b) => a + b, 0);
  return s;
}

function courtDe(i = {}) {
  const t = i.description || i.command || i.url || i.file_path || i.path || i.query || i.pattern || i.question || i.titre || i.prompt;
  if (t) return String(t).split("\n")[0].slice(0, 200);
  const j = JSON.stringify(i); return j === "{}" ? "" : j.slice(0, 200);
}

module.exports = { creer, lire };

if (require.main === module) {
  const repo = process.env.REPO || path.resolve(__dirname, ".."), w = creer(repo, path.join(os.tmpdir(), "sessions-essai"));
  if (process.argv[2]) { const s = w.session(process.argv[2]); console.log(JSON.stringify({ ...s, etapes: s?.etapes.length }, null, 1)); for (const e of s?.etapes.slice(0, 14) || []) console.log(e.i, e.tour, new Date(e.ts).toLocaleTimeString("fr-FR"), e.k, e.nom || "", (e.court || e.txt || "").slice(0, 90).replace(/\n/g, " "), e.ms ?? "", e.err ? "ERR" : ""); }
  else console.log(w.liste().map(l => [l.jour, new Date(l.fin).toLocaleTimeString("fr-FR"), l.id.slice(0, 8), l.titre, `${l.tours} tours`, `${l.actions} actions`, `${l.erreurs} err`, `${l.pages} pages`].join(" | ")).join("\n"));
}
