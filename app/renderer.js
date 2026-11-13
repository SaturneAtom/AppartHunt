// Fenêtre : la voix (ou le clavier) parle à Claude Code ; l'écran montre la conversation et les annonces qui valent le coup.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let data = { listings: [], profil: {}, choix: { oui: [], non: [] }, resumes: {} };
// Candidature et historique d'une annonce (choix.json, tenus par main.js et tools/suivi.py)
const CAND = { preparee: "Candidature prête", envoyee: "Postulé", relancee: "Relancé", visite: "Visite", retenue: "Retenu !", refusee: "Refusé", abandonnee: "Abandonnée" };
const SENT = ["envoyee", "relancee", "visite", "retenue", "refusee"];
const candOf = u => (data.choix.candidatures || {})[u];
const dateFr = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const candTag = u => { const c = candOf(u); return c ? `<span class="cand c-${esc(c.etat)}">${esc(CAND[c.etat] || c.etat)}${c.envoyee_le ? ` le ${esc(dateFr(c.envoyee_le))}` : ""}</span>` : ""; };
const ETAT = { oui: "gardée", non: "écartée", null: "sans choix" };
function historyOf(u) {
  const h = (data.choix.historique || []).filter(x => x.url === u).slice().reverse();
  if (!h.length) return "";
  const line = x => x.quoi === "choix" ? `${ETAT[x.avant]} → ${ETAT[x.apres]}` : `candidature : ${CAND[x.avant] || "aucune"} → ${CAND[x.apres] || x.apres}`;
  return `<details class="hist"><summary>Suivi (${h.length})</summary><ul>${h.map(x => `<li><time>${esc(new Date(x.date).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</time> ${esc(line(x))}${x.par === "agent" ? " · par l'agent" : ""}${x.note ? ` — ${esc(x.note)}` : ""}</li>`).join("")}</ul></details>`;
}
let shown = [], nLive = 0;   // annonces affichées, dans l'ordre (envoyées à l'agent comme contexte)
let busy = false;
let prof = null, profTimer, liveRun = null;   // onglet Profil : données, rafraîchissement, recherche lancée par le bouton

/* ---------- Verdict de secours (quand l'agent n'a pas encore écrit de résumé) ---------- */
const has = (list, txt) => (list || []).find(q => txt.toLowerCase().includes(q.toLowerCase()));
function judge(a) {
  const P = data.profil, w = a.w || "", pour = [], contre = [];
  const dpe = (a.f.match(/DPE ([A-G])/) || [])[1];
  let blocked = false, serious = false;
  if (has(P.quartiers_non, w)) { contre.push("secteur que tu évites"); blocked = true; }
  else if (has(P.quartiers_preferes, w)) pour.push("ton quartier préféré");
  else if (!has(P.quartiers_ok, w)) { contre.push("hors de tes zones"); serious = true; }
  const d = a.p - (P.budget_cible || 800);
  if (d <= -40) pour.push(`${-d} € sous ton budget`); else if (d <= 20) pour.push("pile ton budget"); else contre.push(`+${d} € sur ton budget`);
  if (a.type === "studio") { contre.push("studio, sans vraie chambre"); serious = true; }
  else if (a.type === "maison") contre.push("maison, peut-être de plain-pied");
  else if (a.m2 >= 45) pour.push(`${String(a.m2).replace(".", ",")} m²`);
  if (a.parking) pour.push("parking"); else if (P.important?.parking) contre.push("pas de parking");
  if (a.furnished === false) pour.push("vide");
  if (a.outdoor) pour.push("balcon ou terrasse");
  if (dpe === "F") contre.push("DPE F");
  let note = a.s != null ? Math.round(a.s / 10) : null;
  if (blocked && note != null) note = Math.min(note, 3);
  if (serious && note != null) note = Math.min(note, 6);
  return { verdict: verdictDe(note), note, pour, contre, resume: null };
}

function judgeLine(pour, contre) {
  const t = [pour.slice(0, 2).join(", "), contre[0] ? "mais " + contre[0] : ""].filter(Boolean).join(", ");
  if (!t) return "Pas encore lue par l'agent : note d'après ton barème.";
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

// Note sur 10 : celle que l'agent a donnée en lisant l'annonce, sinon le barème (/100) ramené sur 10.
// Les groupes de la liste en découlent : 8 et plus, 5 à 7, 4 et moins (écartées).
const verdictDe = n => n == null ? "peut" : n >= 8 ? "oui" : n >= 5 ? "peut" : "non";
function noteFiche(r, s) {
  if (typeof r.note === "number") return Math.max(0, Math.min(10, Math.round(r.note)));
  if (r.verdict === "non") return Math.min(s != null ? Math.round(s / 10) : 3, 4);
  if (s != null) return Math.round(s / 10);
  return { oui: 8, peut: 6 }[r.verdict] ?? null;
}
function ficheView(r, s) {
  const note = noteFiche(r, s);
  return { verdict: typeof r.note === "number" ? verdictDe(note) : r.verdict || verdictDe(note), note, pour: r.pour || [], contre: r.contre || [], resume: r.resume };
}
function view(a) {
  const r = data.resumes[a.u];
  return r ? ficheView(r, a.s) : judge(a);
}
const noteHtml = (n, big) => n == null ? `<span class="nt nq${big ? " ntbig" : ""}" title="Pas encore notée">–</span>`
  : `<span class="nt ${n >= 8 ? "hi" : n >= 5 ? "mid" : "lo"}${big ? " ntbig" : ""}" title="Note pour toi">${n}<small>/10</small></span>`;

// Ordre de priorité : celui que tu as donné (choix.json, clé "ordre") passe devant, le reste suit gardées → oui → note
const rankOf = u => { const i = (data.choix.ordre || []).indexOf(u); return i < 0 ? Infinity : i; };

/* ---------- Filtres de la liste (gardés d'une session à l'autre) ---------- */
const FILT0 = { statut: "tout", tri: "recent", prix: null, m2: null, depuis: null, types: [], communes: [], sites: [], opts: [], dpe: false };
let F = { ...FILT0 }, flOpen = false, flAll = false;   // flAll : le panneau « Filtres » est ouvert
try { F = { ...FILT0, ...JSON.parse(localStorage.getItem("ah_filtres2") || "{}") }; } catch { /* stockage indisponible */ }
const saveF = () => { try { localStorage.setItem("ah_filtres2", JSON.stringify(F)); } catch { /* idem */ } };
// Les communes de la zone (zone.json) : pour retrouver la commune d'une annonce qui n'en donne pas
const communesRe = () => { const l = (data.zone?.communes || []).map(c => c.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length); return l.length ? new RegExp(l.join("|"), "i") : /$^/; };
const communeOf = a => a.city || ((a.w || "").match(communesRe()) || [])[0] || (a.w || "").split(" — ")[0].replace(/\s*\(.*/, "") || "?";
const dpeOf = a => ((a.f || "").match(/DPE ([A-G])/) || [])[1];
const typeOf = a => a.type || (/studio/i.test(a.w + a.f) ? "studio" : /T3|3 p\./.test(a.w + a.f) ? "T3" : "T2");
const OPTS = { vide: ["Non meublé", a => a.furnished === false], meuble: ["Meublé", a => a.furnished === true],
  parking: ["Parking", a => !!a.parking], ext: ["Balcon / terrasse", a => !!a.outdoor],
  quartiers: ["Mes quartiers", a => (data.profil.quartiers_preferes || []).some(q => (a.w || "").toLowerCase().includes(q.toLowerCase()))],
  sansalerte: ["Sans alerte", a => !data.resumes[a.u]?.alerte],
  ascenseur: ["Ascenseur", a => (data.resumes[a.u]?.details || {}).Ascenseur === "Oui" || /avec ascenseur/i.test(a.f || "")] };
const DEPUIS = [[1, "24 h"], [3, "3 jours"], [7, "7 jours"]];
// Périodes du tri « Plus récentes » : dans chacune, les annonces sont classées par priorité
const PERIODE = a => { const t = datePub(a).t; if (!t) return 4; const j = (new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5; return j <= 0 ? 0 : j <= 1 ? 1 : j < 7 ? 2 : j < 31 ? 3 : 4; };
const PERIODES = ["Aujourd'hui", "Hier", "Cette semaine", "Ce mois-ci", "Plus ancien"];
const TRIS = { recent: "Plus récentes", prio: "Priorité", prix: "Moins chères", m2: "Plus grandes", pm2: "Prix au m²" };
const PRIX = [500, 1200, 25], SURF = [0, 80, 5];          // bornes et pas des curseurs

/* ---------- Date de publication : celle de la fiche si l'agent l'a lue ; sinon, sur Leboncoin, estimée d'après le
   numéro d'annonce (il croît avec le temps), calé sur les annonces dont on connaît la date ; sinon la date d'ajout ---------- */
const lbcId = u => +((String(u).match(/leboncoin\.fr\/ad\/[a-z_]+\/(\d{6,})/) || [])[1] || 0);
const pubDate = u => { const d = (data.resumes[u]?.details || {})["Publiée le"]; return d && !isNaN(Date.parse(d)) ? Date.parse(d) : null; };
let calage = { n: -1, pts: [] };
function datePub(a) {
  const known = pubDate(a.u);
  if (known) return { t: known, approx: false };
  const id = lbcId(a.u);
  if (id) {
    if (calage.n !== data.listings.length) calage = { n: data.listings.length, pts: data.listings.map(x => [lbcId(x.u), pubDate(x.u)]).filter(([i, t]) => i && t).sort((p, q) => p[0] - q[0]) };
    const P = calage.pts;
    if (P.length >= 2) {
      let k = P.findIndex(p => p[0] >= id); if (k <= 0) k = k === 0 ? 1 : P.length - 1;
      const [i0, t0] = P[k - 1], [i1, t1] = P[k];
      const t = i1 === i0 ? t0 : t0 + (t1 - t0) * (id - i0) / (i1 - i0);
      return { t: Math.min(t, Date.now()), approx: true };
    }
  }
  return a.added ? { t: Date.parse(a.added), approx: true } : { t: 0, approx: true };
}
function ageLabel(a) {
  const { t, approx } = datePub(a); if (!t) return "";
  const j = Math.floor((Date.now() - t) / 864e5), d = new Date(t);
  const txt = j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : j < 7 ? `il y a ${j} jours` : "le " + d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return (approx ? "≈ " : "") + "en ligne " + txt;
}
const activeF = () => [F.prix, F.m2, F.dpe, F.depuis].filter(Boolean).length + F.types.length + F.communes.length + F.sites.length + F.opts.length;
function passes(a) {
  if (F.prix && !(a.p <= F.prix)) return false;
  if (F.m2 && !(a.m2 >= F.m2)) return false;
  if (F.types.length && !F.types.includes(typeOf(a))) return false;
  if (F.communes.length && !F.communes.includes(communeOf(a))) return false;
  if (F.sites.length && !F.sites.includes(a.site || siteOf(a.u))) return false;
  if (F.depuis && !(Date.now() - datePub(a).t <= F.depuis * 864e5)) return false;
  if (F.opts.some(k => !OPTS[k][1](a))) return false;
  if (F.dpe && !/[A-D]/.test(dpeOf(a) || "")) return false;
  return true;
}
const SORT = {
  prix: (x, y) => x.a.p - y.a.p,
  m2: (x, y) => (y.a.m2 || 0) - (x.a.m2 || 0),
  pm2: (x, y) => (x.a.m2 ? x.a.p / x.a.m2 : 1e9) - (y.a.m2 ? y.a.p / y.a.m2 : 1e9),
  recent: (x, y) => PERIODE(x.a) - PERIODE(y.a),    // à période égale, la priorité départage (voir render)
};

function renderFilters(pool, counts) {
  const chip = (grp, val, label, on, n) => `<button type="button" class="chip" data-g="${grp}" data-v="${esc(val)}" aria-pressed="${on}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
  const communes = [...new Set(pool.map(x => communeOf(x.a)))].sort((a, b) => pool.filter(x => communeOf(x.a) === b).length - pool.filter(x => communeOf(x.a) === a).length);
  const types = ["T2", "T3", "studio", "maison"].filter(t => pool.some(x => typeOf(x.a) === t));
  const n = activeF();
  const focus = document.activeElement?.closest?.("#filters [data-g]");
  const fk = focus && focus.dataset.g + "|" + focus.dataset.v;
  // ce qui est actif, en étiquettes qu'on retire d'un clic
  const TYPEL = t => t === "studio" ? "Studio" : t === "maison" ? "Maison" : t;
  const sites = [...new Set(pool.map(x => x.a.site || siteOf(x.a.u)))].sort((a, b) => pool.filter(x => (x.a.site || siteOf(x.a.u)) === b).length - pool.filter(x => (x.a.site || siteOf(x.a.u)) === a).length);
  const tags = [F.depuis && ["depuis", F.depuis, "en ligne depuis " + DEPUIS.find(d => d[0] === F.depuis)[1]], F.prix && ["prix", F.prix, `≤ ${F.prix} €`], F.m2 && ["m2", F.m2, `≥ ${F.m2} m²`],
    ...F.types.map(t => ["types", t, TYPEL(t)]), ...F.communes.map(c => ["communes", c, c]), ...F.sites.map(s => ["sites", s, s]),
    ...F.opts.map(k => ["opts", k, OPTS[k][0]]), F.dpe && ["dpe", "1", "DPE A à D"]].filter(Boolean);
  const range = (id, [lo, hi, st], val, label) => `<label class="rg"><span class="rgl">${label}</span>
    <input type="range" id="${id}" min="${lo}" max="${hi}" step="${st}" value="${val}"><output id="${id}o">${rgText(id, val)}</output></label>`;
  $("filters").innerHTML = `
    <div class="sorts" role="radiogroup" aria-label="Trier">${Object.entries(TRIS).map(([v, l]) => `<button type="button" role="radio" class="sort" data-g="tri" data-v="${v}" aria-checked="${F.tri === v}">${l}</button>`).join("")}</div>
    <div class="fl1">
      ${[["tout", "Toutes"], ["garde", "Gardées"], ["oui", "8 et plus"], ["peut", "5 à 7"], ["bas", "4 et moins"], ["ecartees", "Écartées"]].map(([v, l]) => chip("statut", v, l, F.statut === v, counts[v])).join("")}
      <span class="sp"></span>
      <button type="button" class="chip fbtn" data-g="carte" data-v="" aria-pressed="${carteOn}">Carte</button>
      <button type="button" class="chip fbtn" data-g="all" data-v="" aria-expanded="${flAll}" aria-pressed="${n > 0}">Filtres${n ? ` · ${n}` : ""} <span aria-hidden="true">${flAll ? "▴" : "▾"}</span></button>
    </div>
    <div class="flpanel"${flAll ? "" : " hidden"}>
    <div class="fl1"><span class="fll">En ligne depuis</span>${DEPUIS.map(([v, l]) => chip("depuis", v, l, F.depuis === v, pool.filter(x => Date.now() - datePub(x.a).t <= v * 864e5).length)).join("")}</div>
    <div class="fl2">
      ${range("rgprix", PRIX, F.prix || PRIX[1], "Loyer")}
      ${range("rgm2", SURF, F.m2 || SURF[0], "Surface")}
    </div>
    <div class="fl3">
      ${types.map(t => chip("types", t, TYPEL(t), F.types.includes(t))).join("")}
      <span class="sep"></span>
      ${Object.entries(OPTS).map(([k, [l]]) => chip("opts", k, l, F.opts.includes(k))).join("")}${chip("dpe", "1", "DPE A à D", F.dpe)}
      <button type="button" class="chip more" data-g="more" data-v="" aria-expanded="${flOpen}">Communes et sites${F.communes.length + F.sites.length ? ` · ${F.communes.length + F.sites.length}` : ""} <span aria-hidden="true">${flOpen ? "▴" : "▾"}</span></button>
    </div>
    <div class="flmore" ${flOpen ? "" : "hidden"}>
      <span class="fll">Communes</span><div>${communes.map(c => chip("communes", c, c, F.communes.includes(c), pool.filter(x => communeOf(x.a) === c).length)).join("")}</div>
      <span class="fll">Sites</span><div>${sites.map(s => chip("sites", s, s, F.sites.includes(s), pool.filter(x => (x.a.site || siteOf(x.a.u)) === s).length)).join("")}</div>
    </div>
    </div>
    ${tags.length ? `<div class="tags">${tags.map(([g, v, l]) => `<button type="button" class="tag" data-g="${g}" data-v="${esc(v)}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)} <span aria-hidden="true">×</span></button>`).join("")}<button type="button" class="flclear" id="flclear">Tout effacer</button></div>` : ""}`;
  if (fk) $("filters").querySelector(`[data-g="${fk.split("|")[0]}"][data-v="${CSS.escape(fk.split("|")[1])}"]`)?.focus();
}
function rgText(id, v) {
  v = +v;
  if (id === "rgprix") return v >= PRIX[1] ? "tous les loyers" : `jusqu'à ${v} €`;
  return v <= SURF[0] ? "toutes surfaces" : `${v} m² et plus`;
}
// Curseurs : la liste suit pendant qu'on glisse, la barre se redessine au lâcher
$("filters").addEventListener("input", e => {
  if (e.target.id !== "rgprix" && e.target.id !== "rgm2") return;
  const v = +e.target.value;
  if (e.target.id === "rgprix") F.prix = v >= PRIX[1] ? null : v; else F.m2 = v <= SURF[0] ? null : v;
  $(e.target.id + "o").textContent = rgText(e.target.id, v);
  render(true);
});
$("filters").addEventListener("change", e => { if (e.target.type === "range") { saveF(); render(); } });
$("filters").addEventListener("click", e => {
  if (e.target.id === "flclear") { F = { ...FILT0, statut: F.statut, tri: F.tri }; saveF(); return render(); }
  const b = e.target.closest("[data-g]"); if (!b) return;
  const g = b.dataset.g, v = b.dataset.v;
  if (b.classList.contains("tag")) {                      // retirer un filtre actif
    if (g === "prix" || g === "m2" || g === "depuis") F[g] = null; else if (g === "dpe") F.dpe = false; else F[g] = F[g].filter(x => x !== v);
    saveF(); return render();
  }
  if (g === "carte") { carteOn = !carteOn; try { localStorage.setItem("ah_carte", carteOn ? "1" : "0"); } catch { /* stockage indisponible */ } }
  else if (g === "all") flAll = !flAll;
  else if (g === "more") flOpen = !flOpen;
  else if (g === "tri") F.tri = v;
  else if (g === "statut") F.statut = v;
  else if (g === "prix" || g === "m2" || g === "depuis") F[g] = F[g] === +v ? null : +v;
  else if (g === "dpe") F.dpe = !F.dpe;
  else F[g] = F[g].includes(v) ? F[g].filter(x => x !== v) : [...F[g], v];
  saveF(); render();
});

function render(keepFilters) {
  const kept = new Set(data.choix.oui || []), out = new Set(data.choix.non || []);
  const all = data.listings.map(a => ({ a, ...view(a), kept: kept.has(a.u), out: out.has(a.u) }));
  // On reste large : tout reste dans la liste. Seuls sortent ce que TU as écarté et ce qui n'est pas un appartement (demande de logement).
  const live = all.filter(x => !x.out && !data.resumes[x.a.u]?.pasUneOffre);
  const gone = all.filter(x => !live.includes(x));
  const byStatut = { tout: live, garde: live.filter(x => x.kept), oui: live.filter(x => !x.kept && x.note >= 8),
    peut: live.filter(x => !x.kept && !(x.note >= 8) && !(x.note <= 4)), bas: live.filter(x => !x.kept && x.note <= 4), ecartees: gone };
  const counts = Object.fromEntries(Object.entries(byStatut).map(([k, v]) => [k, v.filter(x => passes(x.a)).length]));
  const maListe = F.statut === "garde";
  $("filters").hidden = maListe;                 // Ma liste : pas de filtres, juste tes annonces dans ton ordre
  if (!keepFilters && !maListe) renderFilters(F.statut === "ecartees" ? gone : live, counts);
  const prio = (x, y) => (rankOf(x.a.u) - rankOf(y.a.u)) || (y.kept - x.kept) || ((x.verdict === "oui" ? 0 : 1) - (y.verdict === "oui" ? 0 : 1)) || (y.a.s - x.a.s);
  if (!byStatut[F.statut]) F.statut = "tout";
  const items = maListe ? byStatut.garde.slice().sort(prio) : byStatut[F.statut].filter(x => passes(x.a)).sort((x, y) => (SORT[F.tri] ? SORT[F.tri](x, y) : 0) || prio(x, y));
  shown = items;
  nLive = byStatut.tout.length;
  $("feedtitle").textContent = F.statut === "garde" ? "Ma liste" : "C'est bien pour toi ?";
  const nOui = byStatut.oui.length, nAlerte = live.filter(x => data.resumes[x.a.u]?.alerte).length;
  $("summary").textContent = maListe
    ? (items.length ? `${items.length} annonce${items.length > 1 ? "s" : ""} que tu as gardée${items.length > 1 ? "s" : ""}, dans ton ordre de priorité. Pour le changer, dis à l'agent « mets celle-là en premier ».` : "Tu n'as encore rien gardé. Sur une annonce qui te plaît, clique « Je garde ».")
    : `${kept.size ? kept.size + " gardée" + (kept.size > 1 ? "s" : "") + " · " : ""}${nOui} à 8/10 ou plus · ${byStatut.peut.length} entre 5 et 7 · ${byStatut.bas.length} à 4 ou moins${nAlerte ? ` · ${nAlerte} avec une alerte à vérifier` : ""}. Rien n'est caché : tu tries.`
    + (items.length !== byStatut.tout.length || F.statut !== "tout" ? ` ${items.length} affichée${items.length > 1 ? "s" : ""}.` : "");
  // Une seule ligne d'infos clés : prix, surface, étage
  const floorOf = f => { const m = f.match(/(\d+)(?:er|e)\s*ét|ét\.\s*(\d+)|(\d+)e et dernier/); const n = m && (m[1] || m[2] || m[3]); return n ? (n === "0" ? "rez-de-chaussée" : n === "1" ? "1er étage" : n + "e étage") : null; };
  const keys = a => [a.p ? `${a.p} €` : "prix non indiqué", a.m2 ? `${String(a.m2).replace(".", ",")} m²` : null, floorOf(a.f || "")].filter(Boolean);
  // Tri « Plus récentes » : un titre par période (aujourd'hui, hier…), et dans chacune la priorité numérotée
  const groups = F.tri === "recent" && !maListe, per = items.map(x => groups ? PERIODE(x.a) : 0);
  const rankIn = i => { let k = i; while (k > 0 && per[k - 1] === per[i]) k--; return i - k + 1; };
  const place = a => (a.w || "").split(" — ").slice(0, 2).join(" · ") || "Annonce";
  const photo = a => `<div class="ph" style="${a.img ? `background-image:url('${esc(a.img)}')` : ""}"></div>`;
  const ligne = (x, n) => { const a = x.a, age = ageLabel(a);
    return `<article class="ad arow" data-u="${esc(a.u)}">
      <span class="num">${n ?? ""}</span>${photo(a)}
      <div class="b"><div class="t"><b>${esc(place(a))}</b><span>${esc(keys(a).join(" · "))}</span></div>
        <div class="s">${data.resumes[a.u]?.alerte ? `<span class="alerte">À vérifier : ${esc(data.resumes[a.u].alerte)}</span>` : esc(x.resume || judgeLine(x.pour, x.contre))}</div></div>
      <div class="r">${noteHtml(x.note)}${x.kept ? '<span class="tagk">Gardée</span>' : x.out ? '<span class="tagk off">Écartée par toi</span>' : ""}${age ? `<span class="age">${esc(age.replace(/^(≈ )?en ligne /, "$1"))}</span>` : ""}</div>
    </article>`; };
  $("list").innerHTML = maListe ? maListeHtml(items, place, photo, keys)
    : items.map((x, i) => `${groups && (i === 0 || per[i] !== per[i - 1]) ? `<h3 class="period">${PERIODES[per[i]]}<span>${per.filter(p => p === per[i]).length}</span></h3>` : ""}${ligne(x, F.tri === "prio" || groups ? (groups ? rankIn(i) : i + 1) : null)}`).join("")
    || (activeF() || F.statut !== "tout" ? '<p class="none">Aucune annonce avec ces filtres.</p>' : '<p class="none">Rien qui te corresponde pour l\'instant. Dis « lance une recherche ».</p>');
  majCarte(items, !maListe);
  renderFiche();
  renderRail();
  if (webOpen) { verdictBar(); badgeCards(Object.values(seenCards)); }
}
/* ---------- Carte : où sont les annonces, sur la liste et sur chaque fiche. Positions approchées (Leaflet, app/vendor) ---------- */
function fondDeCarte(el) {
  const m = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  m.attributionControl.setPrefix(false);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Fond de carte © Esri" }).addTo(m);   // sans clé, et accepté depuis une page locale (pas OpenStreetMap ni CARTO)
  // La molette fait défiler la page tant qu'on n'a pas cliqué dans la carte
  m.on("focus", () => m.scrollWheelZoom.enable()); m.on("blur", () => m.scrollWheelZoom.disable());
  new ResizeObserver(() => m.invalidateSize()).observe(el);
  return m;
}
// La position donnée par l'annonce si l'agent l'a lue, sinon le centre de son quartier ou de sa commune
const posOf = a => { const r = data.resumes[a.u] || {};
  if (r.lat != null && r.lng != null) return { lat: +r.lat, lng: +r.lng, site: true };
  return a.lat != null && a.city !== "Autre" ? { lat: a.lat, lng: a.lng, site: false } : null; };
const noteClasse = n => n == null ? "lo" : n >= 8 ? "hi" : n >= 5 ? "mid" : "lo";

let carteOn = true, carte = null, carteCouche = null, carteSig = "", carteTouchee = false;
try { carteOn = localStorage.getItem("ah_carte") !== "0"; } catch { /* stockage indisponible */ }
function majCarte(items, visible) {
  const box = $("carte"), voir = visible && carteOn && typeof L !== "undefined";
  box.hidden = !voir; $("cartenote").hidden = !voir;
  if (!voir) return;
  if (!carte) {
    carte = fondDeCarte(box); carteCouche = L.layerGroup().addTo(carte);
    box.addEventListener("pointerdown", () => { carteTouchee = true; });
    box.addEventListener("click", e => { const u = e.target.closest("[data-carte-u]")?.dataset.carteU; if (u) setFiches([u]); });
  }
  carteCouche.clearLayers();
  const pts = items.map(x => ({ x, p: posOf(x.a) })).filter(o => o.p).sort((o, q) => (o.x.note ?? -1) - (q.x.note ?? -1));   // les mieux notées au-dessus
  for (const { x, p } of pts) {
    const a = x.a;
    L.circleMarker([p.lat, p.lng], { radius: 7, weight: 1.5, fillOpacity: .95, className: "pt " + noteClasse(x.note) }).addTo(carteCouche)
      .bindPopup(`<button type="button" class="popad" data-carte-u="${esc(a.u)}">${a.img ? `<span class="popph" style="background-image:url('${esc(a.img)}')"></span>` : ""}<b>${esc((a.w || "Annonce").split(" — ").slice(0, 2).join(" · "))}</b><span>${[a.p && a.p + " €", a.m2 && String(a.m2).replace(".", ",") + " m²", x.note != null && x.note + "/10"].filter(Boolean).join(" · ")}</span><i>Voir la fiche ›</i></button>`, { closeButton: false, minWidth: 200 });
  }
  const sig = pts.map(o => o.x.a.u).sort().join("|");
  if (pts.length && sig !== carteSig && (!carteSig || !carteTouchee)) carte.fitBounds(pts.map(o => [o.p.lat, o.p.lng]), { padding: [24, 24], maxZoom: 14 });
  else if (!carteSig) carte.setView(data.zone?.centre || [46.6, 2.4], data.zone?.centre ? 11 : 5);   // le centre de la zone, sinon la France
  carteSig = sig || carteSig;
  const manque = items.length - pts.length;
  $("cartenote").textContent = `${pts.length} annonce${pts.length > 1 ? "s" : ""} sur la carte${manque ? `, ${manque} sans position connue` : ""}. Vert : 8 et plus, noir : 5 à 7, gris : 4 et moins. Positions approchées, pas les adresses. Clique sur un point pour voir l'annonce.`;
}
// La carte d'une fiche : recréée à chaque dessin de la fiche
let cartesFiche = [];
function cartesDesFiches() {
  cartesFiche.forEach(m => m.remove()); cartesFiche = [];
  if (typeof L === "undefined") return;
  for (const el of $("fiche").querySelectorAll(".fmap")) {
    const a = data.listings.find(x => x.u === el.dataset.u), p = a && posOf(a); if (!p) continue;
    const m = fondDeCarte(el).setView([p.lat, p.lng], 13);
    L.circle([p.lat, p.lng], { radius: 500, weight: 1.5, className: "zone" }).addTo(m);
    cartesFiche.push(m);
  }
}
/* ---------- Ma liste : un suivi par étapes, comme une liste de candidatures ---------- */
// À faire (rien d'envoyé) → postulé, en attente → visite → terminé. Chaque ligne dit où on en est et propose le geste suivant.
function maListeHtml(items, place, photo, keys) {
  if (!items.length) return '<p class="none">Tu n\'as encore rien gardé. Sur une annonce qui te plaît, clique « Je garde » (ou dis-le à l\'agent).</p>';
  const et = x => candOf(x.a.u)?.etat || null, jours = d => d ? Math.floor((Date.now() - Date.parse(d)) / 864e5) : 0;
  const aFaire = items.filter(x => !et(x) || et(x) === "preparee"), attente = items.filter(x => ["envoyee", "relancee"].includes(et(x)));
  const visites = items.filter(x => et(x) === "visite"), finies = items.filter(x => ["retenue", "refusee", "abandonnee"].includes(et(x)));
  const btn = (act, lab, cls = "") => `<button type="button" class="btn sm ${cls}" data-act="${act}">${lab}</button>`;
  const row = (x, statut, actions) => `<article class="ad arow ml" data-u="${esc(x.a.u)}">${photo(x.a)}
      <div class="b"><div class="t"><b>${esc(place(x.a))}</b><span>${esc(keys(x.a).join(" · "))}</span></div><div class="s">${statut}</div></div>
      <div class="acts">${actions}</div></article>`;
  const sec = (titre, list, f) => list.length ? `<section class="mls"><h2>${titre}<span>${list.length}</span></h2>${list.map(f).join("")}</section>` : "";
  return sec("À faire", aFaire, x => et(x) === "preparee"
      ? row(x, "Candidature prête, pas encore envoyée", btn("voir", "Voir le message") + btn("postule", "J'ai postulé", "ink"))
      : row(x, esc(x.resume || "Pas encore de candidature."), btn("prepare", "Préparer la candidature", "ink") + btn("postule", "J'ai postulé", "g")))
    + sec("Postulé, en attente de réponse", attente, x => { const c = candOf(x.a.u), j = jours(c.envoyee_le);
        return row(x, `Postulé le ${esc(dateFr(c.envoyee_le))}${c.canal ? " · " + esc(c.canal) : ""}${j >= 3 ? ` · <b class="warn">pas de réponse depuis ${j} jours</b>` : ""}`,
          (j >= 3 ? btn("relance", "Relancer", "ink") : "") + btn("visite", "Visite prévue", "g")); })
    + sec("Visites", visites, x => row(x, "Visite prévue", btn("retenue", "Retenu !", "ink") + btn("refusee", "Refusé", "g")))
    + (finies.length ? `<details class="mls fin"><summary><h2>Terminées<span>${finies.length}</span></h2></summary>${finies.map(x => row(x, esc(CAND[et(x)] || et(x)), "")).join("")}</details>` : "");
}
// Un clic sur une annonce ouvre la vraie page du site, dans l'onglet Navigateur
$("list").addEventListener("click", async e => {
  const ad = e.target.closest(".ad"); if (!ad) return;
  const u = ad.dataset.u, act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return setFiches([u]);                // la fiche dans l'appli ; le site seulement si on le demande, depuis la fiche
  if (act === "prepare") return send(`Prépare la candidature pour ${u}. Montre-moi le message avant tout envoi.`);
  if (act === "voir") return send(`Montre-moi la candidature préparée pour ${u}.`);
  if (act === "relance") return send(`Prépare une relance pour ma candidature ${u}. Montre-la-moi avant d'envoyer.`);
  if (act === "postule" && !confirm("Tu as bien envoyé ta candidature pour cette annonce ? Elle sera marquée « Postulé » avec la date d'aujourd'hui.")) return;
  const etat = { postule: "envoyee", visite: "visite", retenue: "retenue", refusee: "refusee" }[act]; if (!etat) return;
  const r = await window.apparthunt.candidature(u, etat);
  if (r.refus) alert(r.refus);
  delete r.refus; data.choix = r; render();
});
function openWeb(u) {
  $("weburl").textContent = u.replace(/^https?:\/\/(www\.)?/, "");
  setBack(false);
  webUrl = u;
  setTab("web");
  window.apparthunt.openInBrowser(u);
}

/* ---------- Fiches d'annonces : photos et détails, plusieurs côte à côte ; ouvertes au clic, par ta phrase ou par l'agent (ecran.json) ---------- */
let fiches = [];                 // URL des annonces de la vue en cours, dans l'ordre
let mode = "fiches";             // vue en cours : "fiches", "compare" ou "widget"
let extra = {};                  // titre, conclusion de l'agent, html de la vue libre
const photoAt = {};              // photo affichée pour chaque fiche
const siteOf = u => ({ leboncoin: "Leboncoin", seloger: "SeLoger", bienici: "Bien'ici", locservice: "Locservice", lefigaro: "Figaro Immo", orpi: "Orpi", pap: "PAP" }[(u.match(/(leboncoin|seloger|bienici|locservice|lefigaro|orpi|pap)\./) || [])[1]] || "le site");

/* ---------- Onglets : Annonces / Navigateur / Profil (l'onglet Navigateur est une vraie page Chromium, posée sur la colonne de droite) ---------- */
let webOpen = false, tab = "annonces";
function placeWeb() {
  if (!webOpen) return window.apparthunt.placeBrowser(null);
  const r = $("webview").getBoundingClientRect();
  window.apparthunt.placeBrowser({ x: r.left, y: r.top, width: r.width, height: r.height });
}
function setTab(t) {
  tab = t;
  webOpen = t === "web";
  $("web").hidden = !webOpen;
  $("prof").hidden = t !== "profil";
  $("activ").hidden = t !== "activite";
  if (t === "profil") loadProfil();
  if (t === "activite") loadActivite();
  renderRail();
  placeWeb();
  if (webOpen) verdictBar(); else $("webverdict").hidden = true;
}

function setView(m, list, more = {}) {
  if (tab !== "annonces") setTab("annonces");   // une fiche ou une comparaison demandée : on revient sur les annonces
  mode = m;
  fiches = [...new Set((list || []).filter(Boolean))];
  extra = more;
  renderFiche();
  $("fiche").scrollLeft = 0; $("fiche").scrollTop = 0;
}
const setFiches = list => setView("fiches", list);
const openFiche = u => setFiches(u ? (fiches.includes(u) ? fiches : [...fiches, u]) : []);
const closeFiche = u => setFiches(fiches.filter(x => x !== u));
const photosOf = u => { const r = data.resumes[u] || {}, a = data.listings.find(x => x.u === u) || {}; return (r.photos && r.photos.length ? r.photos : [a.img]).filter(Boolean); };

function panel(u) {
  const a = data.listings.find(x => x.u === u) || { u, w: "", f: "", p: null };
  const r = data.resumes[u] || {};
  const v = data.listings.includes(a) ? view(a) : ficheView(r, null);
  const kept = (data.choix.oui || []).includes(u), out = (data.choix.non || []).includes(u);
  const photos = photosOf(u);
  const i = photoAt[u] = Math.min(photoAt[u] || 0, Math.max(photos.length - 1, 0));
  const details = Object.entries(r.details || {});
  return `<article class="panel" data-u="${esc(u)}">
    <div class="fbar"><span></span><button type="button" class="x" data-act="close" aria-label="Fermer cette fiche">×</button></div>
    <div class="gal">
      ${photos.length ? `<img class="big" src="${esc(photos[i])}" alt="Photo ${i + 1} sur ${photos.length}">` : `<div class="big empty">${busy ? "Je vais chercher les photos…" : "Pas encore de photos. Dis « montre-moi les photos »."}</div>`}
      ${photos.length > 1 ? `<button type="button" class="nav prev" data-act="prev" aria-label="Photo précédente">‹</button><button type="button" class="nav next" data-act="next" aria-label="Photo suivante">›</button><span class="count">${i + 1} / ${photos.length}</span>` : ""}
    </div>
    ${photos.length > 1 ? `<div class="thumbs">${photos.map((p, k) => `<button type="button" data-act="ph" data-i="${k}" class="${k === i ? "on" : ""}" style="background-image:url('${esc(p)}')" aria-label="Photo ${k + 1}"></button>`).join("")}</div>` : ""}
    <div class="fbody">
      <div class="row1">
        <h2 class="place">${esc(a.w || "Annonce")}</h2>
        ${noteHtml(v.note, true)}
      </div>
      <p class="keys">${a.p ? `<span>${a.p} €</span>` : ""}<span class="f">${esc(a.f)}</span>${ageLabel(a) ? `<span class="f">${esc(ageLabel(a))}</span>` : ""}</p>
      ${candTag(u)}
      <div class="fdo">
        <button type="button" class="btn${kept ? " ink" : ""}" data-act="garde">${kept ? "Gardée ✓" : "Je garde"}</button>
        <button type="button" class="btn${out ? " on" : ""}" data-act="nope">${out ? "Écartée" : "Pas pour moi"}</button>
        ${SENT.includes(candOf(u)?.etat) ? "" : `<button type="button" class="btn g" data-act="postule">J'ai postulé</button>`}
        <span class="sp"></span>
        <button type="button" class="btn g" data-act="talk" title="Ouvre une conversation rien que pour cette annonce">En parler à l'agent</button>
      </div>
      ${kept || out ? `<p class="tagline">${kept ? '<span class="tagk">Gardée</span>' : '<span class="tagk off">Écartée par toi</span>'}</p>` : ""}
      ${r.alerte ? `<p class="alertebox"><b>À vérifier :</b> ${esc(r.alerte)}. Détecté par mots-clés dans l'annonce, ça peut être faux : regarde la description.</p>` : ""}
      ${data.listings.includes(a) && posOf(a) ? `<section class="fwhy"><h3>Où c'est</h3><div class="fmap" data-u="${esc(u)}"></div><p class="fmapn">${posOf(a).site ? "Position indiquée par l'annonce, souvent approchée : pas l'adresse exacte." : "Position approchée : le centre du quartier ou de la commune, pas l'adresse."}</p></section>` : ""}
      <section class="fwhy"><h3>Pourquoi ${v.note != null ? v.note + "/10" : "cette note"}</h3>
        ${v.resume ? `<p class="resume">${esc(v.resume)}</p>` : ""}
        ${v.pour.length ? `<ul class="pc full">${v.pour.map(t => `<li class="p">${esc(t)}</li>`).join("")}</ul>` : ""}</section>
      ${v.contre.length ? `<section class="fwhy"><h3>Ce qui fait baisser la note</h3><ul class="pc full">${v.contre.map(t => `<li class="c">${esc(t)}</li>`).join("")}</ul></section>` : ""}
      ${!details.length && !r.description ? `<div class="fread"><p>L'agent n'a pas encore lu cette annonce en entier (photos, charges, dépôt, étage, disponibilité…).</p><button type="button" class="btn ink sm" data-act="lire">La faire lire</button></div>` : ""}
      ${details.length ? `<section class="fwhy"><h3>Les détails</h3><dl class="det">${details.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join("")}</dl></section>` : ""}
      ${r.description ? `<section class="fwhy"><h3>L'annonce</h3><p class="desc">${esc(r.description)}</p></section>` : ""}
      ${historyOf(u)}
      <a class="ext" href="${esc(u)}" target="_blank" rel="noopener">Voir l'annonce sur ${esc(siteOf(u))} ↗</a>
    </div>
  </article>`;
}

function renderFiche() {
  const el = $("fiche");
  if (!fiches.length && mode !== "widget") { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.dataset.mode = mode;
  el.dataset.n = String(Math.min(fiches.length, 3));
  const head = label => `<div class="fhead"><button type="button" class="back" data-act="closeall">← Toutes les annonces</button>${label ? `<span class="fn">${esc(label)}</span>` : ""}</div>`;
  if (mode === "compare") el.innerHTML = head(extra.titre || `Comparaison de ${fiches.length} annonces`) + compareTable(fiches);
  else if (mode === "widget") {
    el.innerHTML = head(extra.titre || "") + `<iframe class="widget" sandbox title="${esc(extra.titre || "Vue de l'agent")}"></iframe>`;
    el.querySelector("iframe").srcdoc = WIDGET_BASE + (extra.html || "<p>Vue vide.</p>");
  }
  else el.innerHTML = head(fiches.length > 1 ? `${fiches.length} fiches` : "") + `<div class="panels">${fiches.map(panel).join("")}</div>`;
  cartesDesFiches();
}

/* ---------- Comparaison : une colonne par annonce, une ligne par critère, la meilleure valeur en gras ---------- */
const floorTxt = f => { const m = (f || "").match(/(\d+)(?:er|e)\s*ét|ét\.\s*(\d+)|(\d+)e et dernier/); const n = m && (m[1] || m[2] || m[3]); return n ? (n === "1" ? "1er" : n + "e") : ""; };
const detailOf = (r, re) => { const k = Object.keys(r.details || {}).find(k => re.test(k)); return k ? r.details[k] : ""; };
function compareTable(urls) {
  const cols = urls.map(u => {
    const a = data.listings.find(x => x.u === u) || { u, w: "", f: "", p: null }, r = data.resumes[u] || {};
    const v = data.listings.includes(a) ? view(a) : ficheView(r, null);
    return { u, a, r, v, img: photosOf(u)[0], dpe: ((a.f || "").match(/DPE ([A-G])/) || [])[1] || detailOf(r, /classe.*(énergie|energie)|dpe/i).slice(0, 1) };
  });
  const yes = b => b ? "oui" : "non";
  const rows = [
    ["Loyer", c => c.a.p ? c.a.p + " €" : "", c => c.a.p ? -c.a.p : null],
    ["Surface", c => c.a.m2 ? String(c.a.m2).replace(".", ",") + " m²" : "", c => c.a.m2 || null],
    ["Prix au m²", c => c.a.p && c.a.m2 ? (c.a.p / c.a.m2).toFixed(1).replace(".", ",") + " €" : "", c => c.a.p && c.a.m2 ? -c.a.p / c.a.m2 : null],
    ["Quartier", c => (c.a.w || "").split(" — ").slice(0, 2).join(", ")],
    ["Étage", c => floorTxt(c.a.f) || detailOf(c.r, /étage/i)],
    ["Meublé", c => c.a.furnished === false ? "non" : c.a.furnished ? "oui" : "", c => c.a.furnished === false ? 1 : c.a.furnished ? 0 : null],
    ["Parking", c => yes(c.a.parking), c => c.a.parking ? 1 : 0],
    ["Balcon ou terrasse", c => yes(c.a.outdoor), c => c.a.outdoor ? 1 : 0],
    ["DPE", c => c.dpe || "", c => c.dpe ? -"ABCDEFG".indexOf(c.dpe) : null],
    ["Charges", c => detailOf(c.r, /charges/i)],
    ["Dépôt de garantie", c => detailOf(c.r, /dépôt|depot|garantie/i)],
    ["Honoraires", c => detailOf(c.r, /honoraires|frais d'agence/i)],
    ["Disponible", c => detailOf(c.r, /dispon/i)],
  ];
  const cell = (row, c, best) => { const t = row[1](c); return `<td class="${best ? "best" : ""}">${esc(t || "—")}</td>`; };
  const body = rows.filter(row => cols.some(c => row[1](c))).map(row => {
    const scores = row[2] ? cols.map(row[2]) : [];
    const top = scores.length ? Math.max(...scores.filter(x => x != null)) : null;
    const tied = scores.filter(x => x === top).length === cols.length;
    return `<tr><th>${esc(row[0])}</th>${cols.map((c, i) => cell(row, c, top != null && !tied && scores[i] === top)).join("")}</tr>`;
  }).join("");
  const verdict = c => { const k = (data.choix.oui || []).includes(c.u); return noteHtml(c.v.note) + (k ? ' <span class="tagk">Gardée</span>' : ""); };
  return `<div class="cmp-wrap">
    ${extra.conclusion ? `<p class="conclusion">${esc(extra.conclusion)}</p>` : `<p class="conclusion wait">${busy ? "L'agent prépare sa conclusion…" : ""}</p>`}
    <table class="cmp">
      <thead><tr><th></th>${cols.map(c => `<th><div class="cph" style="${c.img ? `background-image:url('${esc(c.img)}')` : ""}"></div><div class="cname">${esc((c.a.w || "").split(" — ").slice(0, 2).join(", "))}</div>${verdict(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}
        <tr><th>En bref</th>${cols.map(c => `<td class="txtc">${esc(c.v.resume || "")}</td>`).join("")}</tr>
        <tr><th>Pour</th>${cols.map(c => `<td class="txtc">${c.v.pour.map(t => `<div class="p">${esc(t)}</div>`).join("")}</td>`).join("")}</tr>
        <tr><th>Contre</th>${cols.map(c => `<td class="txtc">${c.v.contre.map(t => `<div class="c">${esc(t)}</div>`).join("")}</td>`).join("")}</tr>
        <tr><th></th>${cols.map(c => `<td><a class="ext" href="${esc(c.u)}" target="_blank" rel="noopener">Voir sur ${esc(siteOf(c.u))}</a></td>`).join("")}</tr>
      </tbody>
    </table>
  </div>`;
}

// Vue libre écrite par l'agent : affichée dans un cadre isolé (aucun script), avec le style de l'appli
const WIDGET_BASE = `<style>body{margin:0;font:15px/1.55 "Geist",system-ui,-apple-system,sans-serif;color:#161616;background:#fff}
h1,h2,h3{font-weight:500;margin:0 0 8px}table{border-collapse:collapse;width:100%}td,th{padding:8px 10px;border-bottom:1px solid #ececec;text-align:left;vertical-align:top}
th{font-weight:500;color:#71717a}img{max-width:100%;border-radius:6px}.muted{color:#71717a}.ok{color:#16a34a}.ko{color:#d97706}
@media (prefers-color-scheme:dark){body{background:#0f0f10;color:#ededed}td,th{border-color:#232326}th,.muted{color:#a1a1aa}}</style>`;

$("fiche").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.dataset.act === "closeall") return setView("fiches", []);
  const u = b.closest(".panel")?.dataset.u; if (!u) return;
  const n = photosOf(u).length || 1;
  if (b.dataset.act === "close") return closeFiche(u);
  if (b.dataset.act === "talk") return talkAbout(u);
  if (b.dataset.act === "lire") return send(`Lis cette annonce en entier et note-la d'après mes critères : ${u}`);
  if (b.dataset.act === "garde" || b.dataset.act === "nope") {
    const val = b.dataset.act === "garde" ? "oui" : "non", on = (data.choix[val] || []).includes(u);
    return window.apparthunt.choose(u, on ? null : val).then(r => { delete r.refus; data.choix = r; render(); });
  }
  if (b.dataset.act === "postule") {
    if (!confirm("Tu as bien envoyé ta candidature pour cette annonce ? Elle sera marquée « Postulé » avec la date d'aujourd'hui.")) return;
    return window.apparthunt.candidature(u, "envoyee").then(r => { if (r.refus) alert(r.refus); delete r.refus; data.choix = r; render(); });
  }
  if (b.dataset.act === "prev") photoAt[u] = ((photoAt[u] || 0) - 1 + n) % n;
  if (b.dataset.act === "next") photoAt[u] = ((photoAt[u] || 0) + 1) % n;
  if (b.dataset.act === "ph") photoAt[u] = +b.dataset.i;
  renderFiche();
});
addEventListener("keydown", e => {
  if (!fiches.length && mode !== "widget") return;
  if (e.key === "Escape") setView("fiches", []);
  else if (mode === "fiches" && fiches.length === 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !$("type").value) {
    const u = fiches[0], n = photosOf(u).length || 1;
    photoAt[u] = ((photoAt[u] || 0) + (e.key === "ArrowRight" ? 1 : n - 1)) % n; renderFiche();
  }
});

/* ---------- Ce que tu dis → l'écran réagit tout de suite (avant même la réponse de l'agent) ---------- */
const norm = t => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ORD = [["premier|premiere|1er|1re|1ere|le un|la une", 1], ["deuxieme|second|seconde|2e|2eme", 2], ["troisieme|3e|3eme", 3], ["quatrieme|4e|4eme", 4], ["cinquieme|5e|5eme", 5], ["sixieme|6e", 6]];
function mentioned(text) {
  const t = norm(text), idx = new Set();
  let m;
  if ((m = t.match(/les (deux|trois|quatre|2|3|4) premi/))) { const n = { deux: 2, trois: 3, quatre: 4 }[m[1]] || +m[1]; for (let i = 1; i <= n; i++) idx.add(i); }
  for (const [re, n] of ORD) if (new RegExp(`\\b(${re})\\b`).test(t)) idx.add(n);
  for (const mm of t.matchAll(/\b(?:le|la|n°|numero|annonce) ?(\d{1,2})\b/g)) idx.add(+mm[1]);
  const urls = [...idx].sort((a, b) => a - b).map(i => shown[i - 1]?.a.u).filter(Boolean);
  // Quartier ou commune affichés : « celle des Chartrons », « Talence »
  for (const { a } of shown) {
    const place = norm((a.w || "").split(" — ").slice(1, 2).join("") || (a.w || "").split(" — ")[0]).split(/[()/,]/)[0].trim();
    if (place.length > 3 && t.includes(place) && !urls.includes(a.u)) { urls.push(a.u); break; }
  }
  return urls;
}
function localIntent(text) {
  const t = norm(text), urls = mentioned(text);
  if (/\bprofil\b/.test(t)) return setTab("profil");
  // sur une page du navigateur, « la deuxième », « compare les deux »… parlent de la page : c'est l'agent qui décide
  if (webOpen && !/navigateur/.test(t)) return;
  if (/navigateur/.test(t)) {
    setTab(/\b(ferme|fermes|fermer|cache|quitte)\b/.test(t) ? "annonces" : "web");
  } else if (/\b(ferme|fermes|fermer|enleve|cache|retire|vire)\b/.test(t)) {
    setView(mode === "widget" ? "fiches" : mode, urls.length ? fiches.filter(u => !urls.includes(u)) : []);
  } else if (/compar/.test(t)) {
    // « compare les deux » : celles qu'on vient de citer, sinon celles déjà ouvertes, sinon les deux premières
    const pick = urls.length >= 2 ? urls : urls.length === 1 && fiches.length ? [...fiches, ...urls] : fiches.length >= 2 ? fiches : shown.slice(0, /trois|3/.test(t) ? 3 : 2).map(x => x.a.u);
    setView("compare", pick);
  } else if (urls.length && /pas mal|bien|interess|montre|ouvre|voir|regarde|sympa|cool|top|plait|aime|detail|photo/.test(t)) {
    setView("fiches", /\b(aussi|et)\b/.test(t) && mode === "fiches" ? [...fiches, ...urls] : urls);
  }
}

function screenContext() {
  const vue = webOpen ? browserContext()
    : tab === "profil" ? "Vue actuelle : onglet Profil (son texte recherche.md, ta mémoire, le registre journal.json, l'archive des recherches).\n"
    : mode === "compare" && fiches.length ? `Vue actuelle : comparaison de ${fiches.join(" ; ")}\n`
    : mode === "widget" ? `Vue actuelle : vue libre « ${extra.titre || ""} »\n`
    : fiches.length ? `Vue actuelle : fiches ouvertes ${fiches.join(" ; ")}\n` : "Vue actuelle : la liste\n";
  return vue + (webOpen ? "\nSa liste (onglet Annonces, caché pour l'instant) :\n" : "") + shown.slice(0, 25).map(({ a, note, kept }, i) =>
    `${i + 1}. ${kept ? "gardée, " : ""}${note ?? "?"}/10 · ${a.p} € · ${a.w} · ${a.f} · ${a.u}`).join("\n")
    + (shown.length > 25 ? `\n(+ ${shown.length - 25} autres)` : "");
}

// Onglet Navigateur ouvert : ce que l'utilisateur a sous les yeux, pour que « cet appart » ou « la deuxième en bas » aient un sens
function browserContext() {
  const lines = [`Vue actuelle : onglet Navigateur. L'utilisateur regarde cette page : ${webUrl}${$("weburl").title ? ` (« ${$("weburl").title} »)` : ""}.`];
  if (isAdPage(webUrl)) {
    const k = adKey(webUrl), a = data.listings.find(x => adKey(x.u) === k) || quick[k];
    lines.push(`C'est la page d'une annonce${k.startsWith("lbc:") ? ` (Leboncoin n° ${k.slice(4)})` : ""} : « cet appart », « celle-ci », « elle » désignent cette annonce.`);
    if (a) { const v = verdictOf(a); lines.push(`${data.listings.includes(a) ? "Elle est déjà dans sa liste" : "Elle n'est pas encore dans sa liste"} : ${v.note ?? "?"}/10${v.rapide ? " (note rapide)" : ""}, « ${v.resume || judgeLine(v.pour, v.contre)} ».`); }
    else lines.push("Elle n'est pas encore dans sa liste.");
    lines.push("La page est déjà ouverte dans le navigateur de l'appli : lis-la avec mcp__navigateur__extraire_annonce ou mcp__navigateur__lire_page, sans la rouvrir.");
  }
  const cards = Object.values(seenCards).slice(0, 20);
  if (cards.length) {
    lines.push(`Annonces affichées sur la page, avec la pastille que l'appli leur a mise (dans l'ordre de la page) :`);
    cards.forEach((r, i) => {
      const k = "lbc:" + r.id, a = data.listings.find(x => adKey(x.u) === k) || quick[k] || fromSearch(r), v = verdictOf(a);
      lines.push(`  ${i + 1}. ${v.note ?? "?"}/10${data.listings.includes(a) ? "" : " (nouvelle)"} · ${a.p} € · ${a.w || "?"} · ${a.f || ""} · ${a.u}`);
    });
  }
  return lines.join("\n") + "\n";
}

window.apparthunt.snapshot().then(s => { data = s; render(); });
window.apparthunt.onData(s => { data = s; render(); if (tab === "profil") loadProfil(); });
window.apparthunt.onEcran((e, s) => {
  data = s; render();
  const list = x => x == null ? [] : Array.isArray(x) ? x : [x];
  if (e.vue === "navigateur" && /^https?:\/\//.test(e.url || "")) return openWeb(e.url);
  if (e.vue === "profil") return setTab("profil");
  if (e.vue) setView({ comparaison: "compare", compare: "compare", widget: "widget", libre: "widget", fiches: "fiches", liste: "fiches" }[e.vue] || "fiches",
    e.vue === "liste" ? [] : list(e.annonces), { titre: e.titre, conclusion: e.conclusion, html: e.html });
  else if ("ouvrir" in e) setFiches(list(e.ouvrir));
});

/* ---------- Chats : plusieurs conversations, une affichée ; l'agent travaille dans un seul chat à la fois ---------- */
let chats = [], activeChat = null, runChat = null;
const logs = {};                 // un fil de conversation par chat (enregistré par main.js dans chats/<id>.html)
const HINT = `<p class="hint"><strong>Demande-lui ce que tu veux.</strong>Il cherche, lit les annonces, compare, prépare tes candidatures. Tu le vois travailler ici, et tu peux le reprendre à tout moment.<br><br>Par exemple : « trouve-moi mieux que la deuxième », « compare les deux premières », « je veux un parking finalement », « prépare la candidature pour celle-là ».</p>`;
function logOf(id) {
  if (!logs[id]) {
    const el = logs[id] = document.createElement("div");
    el.className = "log"; el.hidden = true; el.setAttribute("aria-live", "polite");
    $("talk").insertBefore(el, $("talk").querySelector(".typer"));
  }
  return logs[id];
}
const LOG = () => logOf(activeChat);
const chatById = id => chats.find(c => c.id === id);
const saveLog = id => { if (id && logs[id]) window.apparthunt.saveChat(id, logs[id].innerHTML); };
const setChats = s => { chats = s.liste; renderRail(); renderPanelHead(); return s; };
async function chargeLog(id) {
  if (logs[id]) return;
  const el = logOf(id);
  el.innerHTML = (await window.apparthunt.chatLog(id)) || HINT;
  el.querySelectorAll(".turn").forEach(t => t.classList.add("old"));
  el.querySelectorAll("p.hint").forEach(p => { if (/^Appli mise à jour/.test(p.textContent)) p.remove(); });   // anciens avis de mise à jour
  // un tour coupé par la fermeture de l'appli : il ne tourne plus
  el.querySelectorAll(".work:not(.end)").forEach(w => { w.classList.add("end"); w.open = false; w.querySelector(".now").textContent = "Coupé avant la fin"; });
}
async function showChat(id) {
  await chargeLog(id);
  if (cible && id !== cible) poseCible(null);     // ouvrir une autre conversation met fin à la réponse
  if (activeChat && activeChat !== id) saveLog(activeChat);
  activeChat = id;
  for (const k in logs) logs[k].hidden = k !== id;
  setChats(await window.apparthunt.openChat(id));
  setOrb(); scroll(); renderPanelHead();
  box.focus();
}
// « + Nouveau » : un chat vide reste celui qu'on vient d'ouvrir, inutile d'en empiler
async function newChat(titre) {
  const cur = chatById(activeChat);
  if (!titre && cur && cur.auto && !LOG().querySelector(".you")) return box.focus();
  const s = setChats(await window.apparthunt.newChat(titre || null));
  await showChat(s.actif);
}
async function talkAbout(u) {
  const a = data.listings.find(x => x.u === u);
  await newChat(a ? (a.w || "").split(" — ").slice(0, 2).join(", ") + (a.p ? ` · ${a.p} €` : "") : "À propos d'une annonce");
  draft(`À propos de cette annonce (${u}) : `);
}
// Le premier message donne son nom au chat (renommable ensuite)
function autoTitle(id, text) {
  const c = chatById(id); if (!c || !c.auto) return;
  c.auto = false;
  let t = text.replace(/\s+/g, " ").trim();
  if (t.length > 42) t = t.slice(0, 42).replace(/\s+\S*$/, "") + "…";
  window.apparthunt.renameChat(id, t.charAt(0).toUpperCase() + t.slice(1)).then(setChats);
}
function note(id, text) { const p = document.createElement("p"); p.className = "hint"; p.textContent = text; logOf(id).appendChild(p); if (id === activeChat) scroll(); }

const when = ts => {
  const d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toDateString() === y.toDateString() ? "hier" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
function renderRail() {
  const nav = tab === "annonces" ? (F.statut === "garde" ? "liste" : "annonces") : tab;
  const item = (k, label, n, title) => `<button type="button" data-nav="${k}" aria-current="${nav === k ? "page" : "false"}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span>${n ? `<span class="n">${n}</span>` : ""}</button>`;
  $("menu").innerHTML = item("annonces", "Annonces", nLive, "Toutes les annonces qui valent le coup")
    + item("liste", "Ma liste", (data.choix.oui || []).length, "Les annonces que tu as gardées, avec tes candidatures")
    + item("web", "Navigateur", 0, "Le navigateur de l'appli : connecte-toi aux sites, regarde ce que fait l'agent")
    + item("activite", "Activité", 0, "Ce que la veille et l'agent ont fait : sites lus, annonces écartées et pourquoi, pages ouvertes, conclusions")
    + item("profil", "Profil", 0, "Ce que tu cherches, ce que l'agent a retenu, l'historique des recherches");
  if ($("chats").querySelector(".cren")) return;   // un renommage en cours : on ne casse pas le champ
  $("chats").innerHTML = [...chats].sort((a, b) => b.maj - a.maj).map(c => `
    <li data-id="${esc(c.id)}" class="${c.id === activeChat ? "on" : ""}${c.id === runChat ? " run" : ""}">
      <button type="button" class="cname" title="${esc(c.titre)}"${c.id === activeChat ? ' aria-current="true"' : ""}>${esc(c.titre)}</button>
      <time>${esc(when(c.maj))}</time>
      <span class="cact"><button type="button" data-c="ren" aria-label="Renommer « ${esc(c.titre)} »" title="Renommer">✎</button><button type="button" data-c="del" aria-label="Supprimer « ${esc(c.titre)} »" title="Supprimer">×</button></span>
    </li>`).join("");
}
function renameInline(li) {
  const c = chatById(li.dataset.id); if (!c) return;
  const inp = document.createElement("input");
  inp.className = "cren"; inp.value = c.titre; inp.setAttribute("aria-label", "Nom du chat");
  li.innerHTML = ""; li.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const end = async ok => {
    if (done) return; done = true;
    const t = inp.value.trim();
    inp.remove();
    if (ok && t && t !== c.titre) setChats(await window.apparthunt.renameChat(c.id, t)); else renderRail();
  };
  inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") end(true); else if (e.key === "Escape") end(false); });
  inp.addEventListener("blur", () => end(true));
}
$("menu").addEventListener("click", e => {
  const nb = e.target.closest("[data-nav]");
  if (nb) {
    const k = nb.dataset.nav;
    if (k === "annonces" || k === "liste") {
      F.statut = k === "liste" ? "garde" : F.statut === "garde" ? "tout" : F.statut; saveF();
      if (fiches.length || mode === "widget") setView("fiches", []); else setTab("annonces");
      return render();
    }
    return setTab(k);
  }
});
$("rail").addEventListener("click", async e => {
  if (e.target.closest("#newchat")) return newChat();
  const li = e.target.closest("li[data-id]"); if (!li || li.querySelector(".cren")) return;
  const id = li.dataset.id, act = e.target.closest("[data-c]")?.dataset.c;
  if (act === "ren") return renameInline(li);
  if (act === "del") {
    if (!confirm(`Supprimer le chat « ${chatById(id)?.titre} » ? Ce qu'il a enregistré (annonces, choix, critères) reste ; seule la conversation disparaît.`)) return;
    const r = await window.apparthunt.deleteChat(id);
    if (r.refus) return alert(r.refus);
    logs[id]?.remove(); delete logs[id];
    if (cible === id) poseCible(null);
    if (activeChat === id) activeChat = null;
    setChats(r);
    if (!activeChat) await showChat(r.actif);
    return;
  }
  if (id !== activeChat) showChat(id);
});
$("chats").addEventListener("dblclick", e => { const li = e.target.closest("li[data-id]"); if (li && e.target.closest(".cname")) renameInline(li); });

/* ---------- Conversation ---------- */
let turn = null;                 // tour en cours, dans le chat où l'agent travaille
function newTurn(text, id) {
  const log = logOf(id);
  log.querySelector(".hint")?.remove();
  log.querySelectorAll(".turn").forEach(t => t.classList.add("old"));
  log.querySelectorAll(".work[open]").forEach(d => (d.open = false));
  if (text) { const you = document.createElement("div"); you.className = "you"; you.textContent = text; log.appendChild(you); }
  turn = document.createElement("div"); turn.className = "turn"; turn.dataset.t0 = Date.now();
  // ce que fait l'agent : une ligne qui suit l'étape en cours, dépliable pour tout voir
  turn.innerHTML = '<details class="work" open><summary><span class="spin"></span><span class="now"></span><span class="cnt"></span><span class="chev">›</span></summary><div class="steps"></div></details>';
  log.appendChild(turn);
  scroll();
}
const stepOf = {};                // id de l'appel d'outil → sa ligne (pour y accrocher le résultat)
function addStep(text, cls = "", detail = "", id = null) {
  if (!turn) return;
  const w = turn.querySelector(".work");
  const court = text.split("\n")[0].slice(0, 140);
  if (w) w.querySelector(".now").textContent = court;
  if (text !== "Je réfléchis…") {
    const d = document.createElement("div"); d.className = cls;
    d.innerHTML = `<span class="lbl">${esc(text)}</span>${detail ? `<code class="cmd">${esc(detail)}</code>` : ""}`;
    if (id) stepOf[id] = d;
    turn.querySelector(".steps").appendChild(d);
    if (w) { const n = w.querySelectorAll(".steps div").length; w.querySelector(".cnt").textContent = `· ${n} étape${n > 1 ? "s" : ""}`; }
  }
  scroll();
  if (runChat === activeChat) $("stateS").textContent = court;
}
function addAnswer(text, err) {
  if (!turn) return;
  const d = document.createElement("div"); d.className = "answer" + (err ? " err" : ""); d.innerHTML = md(text);
  turn.appendChild(d); scroll();
}
// Fin du tour : la ligne d'activité devient un résumé (« 12 étapes · 1 min 40 s »), ou disparaît s'il n'y a rien eu
function closeWork() {
  const w = turn?.querySelector(".work"); if (!w || w.classList.contains("end")) return;
  const n = w.querySelectorAll(".steps div").length;
  if (!n) return w.remove();
  const s = Math.round((Date.now() - +turn.dataset.t0) / 1000);
  w.classList.add("end"); w.open = false;
  w.querySelector(".now").textContent = `${n} étape${n > 1 ? "s" : ""}`;
  w.querySelector(".cnt").textContent = "· " + (s < 60 ? s + " s" : Math.floor(s / 60) + " min" + (s % 60 ? " " + (s % 60) + " s" : ""));
}
// Un peu de mise en forme dans les réponses : paragraphes, listes, **gras**, `code`
function md(t) {
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  return String(t).trim().split(/\n{2,}/).map(b => {
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-•*] /.test(l))) return "<ul>" + lines.map(l => "<li>" + inl(l.replace(/^\s*[-•*] /, "")) + "</li>").join("") + "</ul>";
    return "<p>" + lines.map(inl).join("<br>") + "</p>";
  }).join("");
}
const scroll = () => { if (!activeChat) return; const l = LOG(); l.scrollTop = l.scrollHeight; };

const STEP = {
  recall: "Je relis ma mémoire", search_listings: "Je cherche de nouvelles annonces", save_listings: "J'enregistre les annonces",
  read_listing: "Je lis une annonce", score_listing: "Je la note", decide: "Je décide", like_listing: "Je la mets en favori",
  propose_application: "Je prépare une candidature", remember: "Je retiens ça",
};
// Le détail exact d'une action : la commande, l'adresse, le fichier, le texte cliqué
function actionDetail(b) {
  const i = b.input || {};
  if (b.name === "Bash") return i.command || "";
  if (i.url) return i.url;
  if (i.file_path) return i.file_path.replace(/^.*\/(ma-recherche|AppartHunt)\//, "");
  if (i.texte) return "« " + i.texte + " »";
  if (i.pattern) return i.pattern;
  if (i.action) return [i.action, i.text, i.coordinate && i.coordinate.join(",")].filter(Boolean).join(" ");
  const s = JSON.stringify(i); return s === "{}" ? "" : s.slice(0, 200);
}
function addResult(id, content, isErr) {
  const d = stepOf[id]; if (!d) return;
  delete stepOf[id];
  const txt = (Array.isArray(content) ? content.map(c => c.type === "text" ? c.text : c.type === "image" ? "[capture d'écran]" : "").join("\n") : String(content || "")).trim();
  if (isErr) d.classList.add("err");
  if (!txt) return;
  const r = document.createElement("details"); r.className = "res";
  r.innerHTML = `<summary>${isErr ? "erreur" : "résultat"}</summary><pre>${esc(txt.length > 2500 ? txt.slice(0, 2500) + "\n…" : txt)}</pre>`;
  d.appendChild(r);
}
function step(b) {
  const i = b.input || {};
  if (b.name === "Bash") {
    const m = (i.command || "").match(/\.\/al (?:tool (\w+)|log \S+ pensee "([^"]*)")/);
    if (m) return m[1] ? [STEP[m[1]] || m[1]] : ["💭 " + m[2], "thought"];
    return [i.description || "Je lance une commande"];
  }
  if (b.name.includes("claude-in-chrome")) {
    if (i.url) return ["J'ouvre " + i.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)];
    if (i.action_summary) return [i.action_summary];
    if (b.name.endsWith("get_page_text") || b.name.endsWith("read_page")) return ["Je lis la page"];
    if (b.name.endsWith("browser_batch")) return [`J'enchaîne ${i.actions?.length || ""} actions dans Chrome`];
    return ["Je regarde la page"];
  }
  if (b.name.startsWith("mcp__navigateur__")) {
    const t = b.name.slice(17);
    if (t === "ouvrir_page") return ["J'ouvre " + String(i.url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)];
    return [{ lire_page: "Je lis la page", annonces_page: "Je relève les annonces de la page", extraire_annonce: "Je récupère toute l'annonce",
      cliquer: "Je clique sur « " + (i.texte || "") + " »", capture: "Je regarde la page", afficher_navigateur: "Je t'affiche le navigateur" }[t] || "Je travaille"];
  }
  if (b.name === "Edit" || b.name === "Write") return ["Je mets à jour " + (i.file_path || "").split("/").pop()];
  if (b.name === "Read") return ["Je lis " + (i.file_path || "").split("/").pop()];
  if (b.name === "Skill") return ["Je suis la méthode " + (i.skill || "")];
  if (b.name === "Grep" || b.name === "Glob") return ["Je cherche dans les fichiers"];
  return ["Je travaille"];
}

window.apparthunt.onAgent((ev, chat) => {
  if (tab === "profil") { clearTimeout(profTimer); profTimer = setTimeout(loadProfil, ev.type === "turn_end" ? 0 : 1500); }   // l'archive suit le passage en cours
  if (ev.type === "tour_debut") {                 // lancée ou reprise, ici ou après avoir attendu son tour
    newTurn(ev.textes.join("\n\n"), chat);
    busy = true; runChat = chat;
    const c = chatById(chat); if (c) c.maj = Date.now();
    setOrb(); renderRail();
    addStep("Je réfléchis…");
    window.apparthunt.chats().then(setChats);
    saveLog(chat);                                // ton message est gardé même si l'appli tombe avant la fin
    return;
  }
  if (ev.type === "rendu") return rendreTexte(ev.textes.join("\n\n"), ev.raison);
  if (ev.type === "assistant") for (const b of ev.message.content) {
    if (b.type === "tool_use" && CONV.test(b.name)) continue;   // question, plan, proposition : affichés à part
    if (b.type === "thinking" && b.thinking?.trim()) addStep("💭 " + b.thinking.trim().split("\n")[0].slice(0, 160), "thought");
    if (b.type === "tool_use") { const [t, c = ""] = step(b); addStep(t, c, actionDetail(b), b.id); }
    else if (b.type === "text" && b.text.trim() && ev.message.stop_reason !== "end_turn") addStep(b.text.trim(), "thought dit");   // ce qu'il dit entre deux actions : en entier, comme dans Claude Code
  }
  if (ev.type === "user" && Array.isArray(ev.message?.content)) for (const b of ev.message.content) if (b.type === "tool_result") addResult(b.tool_use_id, b.content, b.is_error);
  if (ev.type === "result") {
    const text = (ev.result || "").trim() || (ev.is_error ? "Je n'ai pas réussi, réessaie." : "C'est fait.");
    // le début de la réponse a pu s'afficher comme pensée pendant qu'elle s'écrivait : on ne la montre qu'une fois
    const thoughts = turn ? turn.querySelectorAll(".steps .thought") : [], last = thoughts[thoughts.length - 1];
    if (last && text.startsWith(last.textContent.slice(0, 80))) last.remove();
    addAnswer(text, ev.is_error);
    saveLog(chat);
  }
  if (ev.type === "turn_end") {
    busy = false;
    closeWork();
    if (asking) { asking.card.classList.add("done"); asking = null; }
    if (ev.error) addAnswer("Je n'ai pas pu continuer : " + ev.error, true);
    saveLog(chat || runChat);
    runChat = null;
    window.apparthunt.chats().then(setChats);   // le chat remonte en tête de liste
    if (!ev.suite) liveRun = null;
    setOrb();
  }
});

/* ---------- Ce que l'agent montre en plus : son plan, ses questions, ses propositions ---------- */
const CONV = /^mcp__navigateur__(poser_question|plan|proposer)$/;
window.apparthunt.onPlan((chat, etapes) => {
  if (!turn || chat !== runChat) return;
  let el = turn.querySelector(".plan");
  if (!el) { el = document.createElement("div"); el.className = "plan"; turn.prepend(el); }
  const done = etapes.filter(e => e.etat === "fait").length;
  el.innerHTML = `<div class="ph">Plan <b>${done} / ${etapes.length}</b></div><div class="bar"><i style="width:${etapes.length ? 100 * done / etapes.length : 0}%"></i></div>
    <ol>${etapes.map(e => `<li class="${esc(e.etat)}"><span>${e.etat === "fait" ? "✓" : ""}</span>${esc(e.texte)}</li>`).join("")}</ol>`;
  const now = etapes.find(e => e.etat === "en_cours");
  if (now && runChat === activeChat) $("stateS").textContent = now.texte;
  scroll();
});
let asking = null;   // question en attente : la prochaine chose que tu écris y répond
window.apparthunt.onQuestion(q => {
  if (!turn) return window.apparthunt.answer(q.id, "(pas de réponse : la conversation n'est pas ouverte)");
  const card = document.createElement("div"); card.className = "ask";
  card.innerHTML = `<p>${esc(q.question)}</p><div class="btns">${q.reponses.map(r => `<button type="button">${esc(r)}</button>`).join("")}</div><p class="hint2">Ou écris ta réponse.</p>`;
  turn.appendChild(card);
  asking = { id: q.id, card };
  $("stateS").textContent = "Il te pose une question, réponds en bas.";
  if (runChat === activeChat) $("stateS").textContent = "J'attends ta réponse";
  scroll(); box.focus();
});
function reply(text) {
  const { id, card } = asking; asking = null;
  card.classList.add("done");
  card.querySelector(".hint2").textContent = "Ta réponse : " + text;
  window.apparthunt.answer(id, text);
}
window.apparthunt.onProposition((chat, p) => {
  if (!turn || chat !== runChat) return;
  const card = document.createElement("div"); card.className = "prop";
  card.innerHTML = `<p>${esc(p.texte)}</p><div class="btns">${(p.boutons || []).slice(0, 3).map(b => `<button type="button" data-send="${esc(b.message)}">${esc(b.label)}</button>`).join("")}</div>`;
  turn.appendChild(card); scroll();
});
// délégué sur la conversation : marche aussi pour les cartes d'une conversation rouverte
$("talk").addEventListener("click", e => {
  const b = e.target.closest(".ask:not(.done) .btns button, .prop:not(.done) button[data-send]"); if (!b) return;
  if (b.closest(".ask")) return asking && reply(b.textContent);
  b.closest(".prop").classList.add("done"); b.classList.add("on");
  send(b.dataset.send);
});

/* ---------- Veille : son interrupteur en haut de la colonne de l'agent ; ce qu'elle trouve part dans le chat « Veille » ---------- */
function showVeille(e) {
  $("veilleOn").setAttribute("aria-pressed", String(e.active));
  const t = e.prochaine ? new Date(e.prochaine).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  $("veilleT").textContent = e.active ? (t ? "prochaine à " + t : "active") : "arrêtée";
  $("veilleM").textContent = e.message ? (e.derniere ? new Date(e.derniere).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + " · " : "") + e.message : "";
  $("dveille").textContent = "Voir ce qu'elle a fait";
  $("dveille").title = (e.message || "Veille") + " — clique pour voir ce qu'elle a fait";
}
window.apparthunt.onVeille(showVeille);
window.apparthunt.veille("etat").then(showVeille);
$("veilleOn").addEventListener("click", async () => showVeille(await window.apparthunt.veille("basculer")));
$("veilleGo").addEventListener("click", async () => { $("veilleM").textContent = "Je regarde…"; showVeille(await window.apparthunt.veille("maintenant")); });
window.apparthunt.onVeilleDemande(async texte => {
  let c = chats.find(x => x.titre === "Veille");
  if (!c) { setChats(await window.apparthunt.newChat("Veille")); c = chats.find(x => x.titre === "Veille"); if (activeChat) await window.apparthunt.openChat(activeChat).then(setChats); }
  if (c) send(texte, c.id, { auto: true });
});

// Un message part dans le chat ouvert : c'est app/taches.js qui décide (lu à la prochaine étape, repris, ou en attente de son tour).
// S'il attend la réponse à une question, ce que tu écris y répond. Si l'envoi échoue, ton texte revient dans le champ.
async function send(text, chat = activeChat, opts = {}) {
  text = text.trim(); if (!text || !chat) return;
  if (asking && chat === runChat) return reply(text);
  let r;
  try { r = await window.apparthunt.ask(text, screenContext(), chat, { ...opts, reponse: chat === cible }); }
  catch (err) { r = { error: "L'envoi a échoué : " + err.message }; }
  if (!r || r.error) {
    if (opts.auto) return note(chat, r?.error || "La veille n'a pas pu réveiller l'agent.");
    return rendreTexte(text, r?.error || "L'envoi a échoué, réessaie.");
  }
  if (chat === activeChat) localIntent(text);
  autoTitle(chat, text);
  if (r.mode === "lu" || r.mode === "question") steer(text);
  else if (r.mode === "file") { note(chat, `Noté : « ${text} ». Je m'en occupe dès que j'ai fini dans « ${chatById(runChat)?.titre || "l'autre chat"} ».`); saveLog(chat); }
}
// Recadrer pendant qu'il travaille : ton message s'affiche dans le tour en cours et lui arrive à sa prochaine étape
function steer(text) {
  if (!turn) return;
  const you = document.createElement("div"); you.className = "you steer"; you.textContent = text;
  turn.insertBefore(you, turn.querySelector(".answer, .ask, .prop")); scroll();
  addStep("Message reçu, il en tient compte", "thought");
  saveLog(runChat);
}
function rendreTexte(text, erreur) {
  box.value = box.value.trim() ? text + "\n" + box.value : text;
  box.dispatchEvent(new Event("input"));
  const e = $("envoiErr"); e.textContent = erreur; e.hidden = false;
  box.focus();
}
/* Répondre à une tâche : pas de nouvelle page, le champ indique à qui tu parles. ✕ ou Échap ramènent à la conversation d'où tu viens. */
var cible = null, retourDe = null;
function poseCible(id) {
  cible = id;
  const c = chatById(id);
  $("cible").hidden = !id;
  $("cibleNom").textContent = c?.titre || "";
  box.placeholder = id ? `Tu réponds à ${c?.titre || "cette tâche"}` : "Écris à l'agent (ou dicte), puis Entrée";
}
async function ouvreReponse(id) {
  const depuis = cible ? retourDe : activeChat;
  if (document.body.classList.contains("folded")) setTalk(talkW, false);
  if (document.body.classList.contains("chatoff")) setChatW(+(pref("chat-w-last") || CHAT_W0));
  await showChat(id);
  retourDe = depuis; poseCible(id);
  box.focus();
}
async function fermeReponse() {
  const r = retourDe; retourDe = null; poseCible(null);
  if (r && r !== activeChat && chatById(r)) await showChat(r);
  box.focus();
}
const box = $("type");
const grow = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 220) + "px"; };
box.addEventListener("input", grow);
box.addEventListener("input", () => { $("envoiErr").hidden = true; });
$("cibleX").addEventListener("click", fermeReponse);
// Échap : d'abord fermer la réponse en cours ; ailleurs (recherche, renommage), la touche garde son rôle
addEventListener("keydown", e => {
  if (e.key !== "Escape" || !cible || (e.target !== box && e.target.matches?.("input,textarea,select"))) return;
  e.preventDefault(); e.stopImmediatePropagation(); fermeReponse();
}, true);
box.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(box.value); box.value = ""; grow(); box.dispatchEvent(new Event("input")); }
});
// Échap dans le champ : interrompt l'agent, comme dans Claude Code
box.addEventListener("keydown", e => { if (e.key === "Escape" && busy) { window.apparthunt.stop(); addStep("Interrompu."); } });
// Le champ reste prêt à recevoir la dictée (Superwhisper écrit là où est le curseur)
addEventListener("focus", () => { if (!document.body.classList.contains("folded")) box.focus(); });
box.focus();

/* ---------- Largeur de la conversation : glisser la bordure, replier ou rouvrir (retenu d'une fois sur l'autre) ---------- */
const TALK_MIN = 260, TALK_MAX = 720, RAIL = () => $("rail").offsetWidth;
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
function setTalk(w, folded) {
  document.body.style.setProperty("--talk-w", Math.round(w) + "px");
  document.body.classList.toggle("folded", folded);
  $("fold").textContent = folded ? "›" : "‹";
  $("fold").setAttribute("aria-expanded", String(!folded));
  $("fold").setAttribute("aria-label", folded ? "Rouvrir la conversation" : "Replier la conversation");
  pref("talk-w", String(Math.round(w))); pref("talk-folded", folded ? "1" : "0");
  if (!folded) box.focus();
}
let talkW = Math.min(Math.max(+pref("talk-w") || 360, TALK_MIN), TALK_MAX);
setTalk(talkW, pref("talk-folded") === "1");
// La liste des conversations (à gauche) se ferme et se rouvre ; l'appli s'en souvient
function setRail(off) { document.body.classList.toggle("railoff", off); pref("rail-off", off ? "1" : "0"); }
setRail(pref("rail-off") === "1");
$("railclose").addEventListener("click", () => setRail(true));
$("railopen").addEventListener("click", () => setRail(false));
$("fold").addEventListener("click", () => setTalk(talkW, !document.body.classList.contains("folded")));
$("grip").addEventListener("pointerdown", e => {
  if (e.target.closest(".fold") || document.body.classList.contains("folded")) return;
  e.preventDefault();
  $("grip").setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
  const move = ev => {
    if (ev.clientX - RAIL() < TALK_MIN / 2) { document.body.classList.add("folded"); return; }   // tiré presque au bord : on replie
    document.body.classList.remove("folded");
    talkW = Math.min(Math.max(ev.clientX - RAIL(), TALK_MIN), Math.min(TALK_MAX, innerWidth - RAIL() - 360));
    document.body.style.setProperty("--talk-w", talkW + "px");
  };
  const up = () => {
    document.body.classList.remove("dragging");
    $("grip").removeEventListener("pointermove", move);
    setTalk(talkW, document.body.classList.contains("folded"));
  };
  $("grip").addEventListener("pointermove", move);
  $("grip").addEventListener("pointerup", up, { once: true });
});
$("grip").addEventListener("dblclick", e => { if (!e.target.closest(".fold")) { talkW = 360; setTalk(talkW, false); } });

/* ---------- État ---------- */
function setOrb() {
  const here = busy && runChat === activeChat;
  $("orb").className = "orb" + (here ? " think" : "");
  $("stateT").textContent = here ? "Je travaille" : chatById(activeChat)?.titre || "Prêt";
  const go = document.querySelector('[data-p="lancer"]');
  if (go) { go.disabled = !!liveRun; go.textContent = liveRun ? "Recherche en cours…" : "Lancer une recherche"; }
  if (!here) $("stateS").textContent = busy ? `L'agent travaille dans « ${chatById(runChat)?.titre || "un autre chat"} »` : "";
  if (fiches.length) renderFiche();
}
setOrb();

// « ‹ » recule dans le site ; sur la première page ouverte, il ramène aux annonces
let webCanBack = false;
const setBack = b => { webCanBack = b; $("webback").textContent = b ? "‹" : "‹ Annonces"; $("webback").setAttribute("aria-label", b ? "Page précédente" : "Retour aux annonces"); };
$("webback").addEventListener("click", () => webCanBack ? window.apparthunt.browserBack() : setTab("annonces"));
new ResizeObserver(placeWeb).observe($("webview"));
addEventListener("resize", placeWeb);
window.apparthunt.onBrowserShow(() => setTab("web"));
/* ---------- Sur la page d'une annonce : le verdict en haut de l'onglet, avec « Je garde » / « Pas pour moi » ---------- */
// même annonce, quelle que soit la forme du lien (Leboncoin : son numéro)
const adKey = u => { const m = String(u || "").match(/leboncoin\.fr\/(?:ad\/)?[a-z_]+\/(\d{6,})/); return m ? "lbc:" + m[1] : String(u || "").split(/[?#]/)[0].replace(/\/$/, ""); };
const isAdPage = u => /leboncoin\.fr\/(ad\/)?[a-z_]+\/\d{6,}|seloger\.com\/annonces\/|bienici\.com\/annonce\//.test(u);
const quick = {};          // annonces vues sur les pages de résultats, notées à la volée (clé adKey)
let webUrl = "";

// Verdict d'une annonce : celui de l'agent s'il l'a lue, sinon la note rapide (score.js) et les filtres éliminatoires
function verdictOf(a) {
  if (data.resumes[a.u] || a.s != null && !a.rapide) return view(a);
  if (!(a.p >= 200)) return { verdict: "peut", pour: [], contre: ["prix non indiqué"], resume: `Prix non indiqué (${a.p ?? "?"} €) : à lire.`, rapide: true };
  const why = eliminatoire(a, data.profil);
  if (why) return { verdict: "non", pour: [], contre: [why], resume: `Écartée : ${why}.`, rapide: true };
  const v = judge({ ...a, s: quickScore(a, data.profil, data.zone) });
  if (a.m2 && a.m2 < 35) v.contre.unshift(`${String(a.m2).replace(".", ",")} m² seulement`);
  return { ...v, rapide: true };
}

function verdictBar() {
  const el = $("webverdict");
  const k = adKey(webUrl), a = data.listings.find(x => adKey(x.u) === k) || quick[k];
  if (!webOpen || (!a && !isAdPage(webUrl))) { el.hidden = true; return; }
  const u = a ? a.u : webUrl.split(/[?#]/)[0];
  const kept = (data.choix.oui || []).includes(u), out = (data.choix.non || []).includes(u);
  const v = a ? verdictOf(a) : null;
  const label = v?.note != null ? `${v.note}/10` : "Pas encore notée";
  const cls = kept ? "v-garde" : out || !v ? "v-non" : "v-" + v.verdict;
  const line = v ? (v.resume || judgeLine(v.pour, v.contre)) : "L'agent ne l'a pas encore lue.";
  el.innerHTML = `
    ${v ? noteHtml(v.note, true) : `<span class="nt nq ntbig">–</span>`}${kept ? '<span class="tagk">Gardée</span>' : out ? '<span class="tagk off">Écartée</span>' : ""}
    <div class="vb-txt"><p>${esc(line)}${v?.rapide ? ' <span class="vb-note">note rapide</span>' : ""}</p>
      ${v ? `<ul class="pc">${v.pour.slice(0, 2).map(t => `<li class="p">${esc(t)}</li>`).join("")}${v.contre.slice(0, 1).map(t => `<li class="c">${esc(t)}</li>`).join("")}</ul>` : ""}</div>
    <div class="vb-act">
      ${candTag(u)}
      ${!data.resumes[u] ? `<button type="button" data-vb="ask">Faire lire par l'agent</button>` : ""}
      ${SENT.includes(candOf(u)?.etat) ? "" : `<button type="button" data-vb="postule">J'ai postulé</button>`}
      <button type="button" data-vb="oui" aria-pressed="${kept}">${kept ? "Gardée ✓" : "Je garde"}</button>
      <button type="button" data-vb="non" aria-pressed="${out}">${out ? "Écartée" : "Pas pour moi"}</button>
    </div>`;
  el.dataset.u = u;
  el.hidden = false;
}
$("webverdict").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const u = $("webverdict").dataset.u;
  if (b.dataset.vb === "ask") return send(`Lis cette annonce en entier et note-la d'après mes critères : ${u}`);
  if (b.dataset.vb === "postule") {
    if (!confirm("Tu as bien envoyé ta candidature pour cette annonce ? Elle sera marquée « Postulé » avec la date d'aujourd'hui.")) return;
    const r = await window.apparthunt.candidature(u, "envoyee");
    if (r.refus) alert(r.refus);
    delete r.refus; data.choix = r;
    return render();
  }
  data.choix = await window.apparthunt.choose(u, b.getAttribute("aria-pressed") === "true" ? null : b.dataset.vb);
  render();
});

/* ---------- Pages de résultats Leboncoin : une pastille sur chaque annonce ---------- */
function fromSearch(r) {
  const A = k => r.attrs[k] || {}, L = k => A(k).l || A(k).v || "";
  // r.attrs vient des données de la page ; r.m2 / r.rooms / r.subject du texte de la carte quand elle n'en a pas
  const m2 = parseFloat(A("square").v) || parseFloat(L("square")) || r.m2 || null, rooms = +A("rooms").v || r.rooms || null;
  const floor = A("floor_number").v, dpe = String(A("energy_rate").v || "").toUpperCase();
  const furn = L("furnished"), furnished = /non meubl/i.test(furn) ? false : /meubl/i.test(furn) ? true : A("furnished").v === "2" ? false : A("furnished").v === "1" ? true : null;
  const txt = [r.subject, r.body, ...Object.values(r.attrs).map(x => x.l || x.v)].join(" ");
  const type = /maison/i.test(L("real_estate_type")) ? "maison" : rooms === 1 ? "studio" : rooms >= 3 ? "T3" : "T2";
  const f = [m2 && `${m2} m²`, rooms && `${rooms} p.`, floor === "0" ? "rez-de-chaussée" : floor ? `${floor}${floor === "1" ? "er" : "e"} ét.` : null,
    furnished === false ? "non meublé" : furnished ? "meublé" : null, /^[A-G]$/.test(dpe) ? `DPE ${dpe}` : null].filter(Boolean).join(" · ");
  return { u: "https://www.leboncoin.fr/ad/locations/" + r.id, p: r.p, w: [r.city, r.district].filter(Boolean).join(" — "), f, m2, type, furnished,
    parking: /parking|garage|\bbox\b|stationnement/i.test(txt), outdoor: /balcon|terrasse|jardin/i.test(txt), txt: txt.slice(0, 900), rapide: true };
}
const COLOR = { oui: "#16a34a", peut: "#d97706", non: "#a1a1aa", garde: "#161616" };
const couleurNote = n => n == null ? "#a1a1aa" : n >= 8 ? "#16a34a" : n >= 5 ? "#d97706" : "#a1a1aa";
const seenCards = {};       // cartes relevées sur la page en cours (pour remettre les pastilles à jour après un choix)
function badgeCards(ads) {
  const kept = new Set(data.choix.oui || []), out = new Set(data.choix.non || []), map = {};
  for (const r of ads) {
    if (r.p == null) continue;
    const k = "lbc:" + r.id, known = data.listings.find(x => adKey(x.u) === k);
    const a = known || (quick[k] = fromSearch(r)), v = verdictOf(a);
    const st = kept.has(a.u) ? "garde" : out.has(a.u) ? "non" : v.verdict;
    const nt = v.note != null ? `${v.note}/10` : "?/10";
    const c = candOf(a.u), l = SENT.includes(c?.etat) ? `${CAND[c.etat]} le ${dateFr(c.envoyee_le)}` : st === "garde" ? `Gardée · ${nt}` : out.has(a.u) ? `Écartée · ${nt}` : nt;
    map[r.id] = { v: st, c: st === "garde" ? COLOR.garde : out.has(a.u) ? COLOR.non : couleurNote(v.note), l, n: known ? "" : "nouvelle", t: v.resume || judgeLine(v.pour, v.contre), k: st + l };
  }
  if (Object.keys(map).length) window.apparthunt.setBadges(map);
}
window.apparthunt.onBrowserAds(ads => { for (const r of ads) seenCards[r.id] = r; badgeCards(ads); });

window.apparthunt.onBrowserUrl(({ url, titre, retour, nouvellePage }) => {
  if (nouvellePage) for (const k in seenCards) delete seenCards[k];
  webUrl = url || "";
  verdictBar();
  $("weburl").textContent = url ? url.replace(/^https?:\/\/(www\.)?/, "") : "";
  $("weburl").title = titre || "";
  setBack(retour);
});

/* ---------- Profil : ce que tu cherches (recherche.md), ce que l'agent a retenu, ce qui a changé, l'archive des recherches ---------- */
const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const day = d => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const hour = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

// recherche.md → une carte par section « ## … », chacune avec son bouton « Changer »
function sections(md) {
  const out = [];
  let cur = null;
  for (const line of md.split("\n")) {
    if (/^# /.test(line)) continue;
    const h = line.match(/^##\s+(.*)/);
    if (h) { cur = { titre: h[1].trim(), lignes: [] }; out.push(cur); }
    else if (cur) cur.lignes.push(line);
  }
  return out.map(sec => {
    let html = "", list = [];
    const flush = () => { if (list.length) html += `<ul>${list.map(l => `<li>${inline(l)}</li>`).join("")}</ul>`; list = []; };
    for (const l of sec.lignes) {
      if (/^\s*[-*]\s+/.test(l)) list.push(l.replace(/^\s*[-*]\s+/, ""));
      else { flush(); if (l.trim()) html += `<p>${inline(l)}</p>`; }
    }
    flush();
    return { ...sec, html };
  });
}

function poidsBars() {
  const P = data.profil.poids || {};
  const keys = Object.keys(P).sort((a, b) => P[b] - P[a]);
  if (!keys.length) return "";
  const max = Math.max(...keys.map(k => P[k]));
  return `<div class="poids">${keys.map(k => `<span>${esc(k.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()))}</span><span class="bar"><i style="width:${(P[k] / max) * 100}%"></i></span><b>${P[k]} %</b>`).join("")}</div>`;
}

/* ---------- Activité : chaque session de l'agent et chaque passage de la veille, et leur log complet ---------- */
const act = { vue: null, filtre: "tout", q: "", hits: null, scroll: 0, S: null, ouverts: new Set(), lf: "tout", lq: "" };
const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const hms = ms => new Date(ms).toLocaleTimeString("fr-FR");
const duree = ms => ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 6e4 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.floor(ms / 6e4)} min ${String(Math.round(ms % 6e4 / 1000)).padStart(2, "0")}`;
const plur = (n, s, p = s + "s") => `${n} ${n > 1 ? p : s}`;
const jourLabel = ms => { const t = new Date(ms), n = new Date(), h = new Date(n); h.setDate(n.getDate() - 1);
  return t.toDateString() === n.toDateString() ? "Aujourd'hui" : t.toDateString() === h.toDateString() ? "Hier" : t.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); };
const lien = (u, t) => `<a href="${esc(u)}" data-open="${esc(u)}">${esc(t || u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70))}</a>`;
const annonceLi = x => `<li>${lien(x.url, [x.titre || "(sans titre)", x.prix != null && x.prix + " €", x.m2 && x.m2 + " m²", x.ville].filter(Boolean).join(" · "))}${x.source ? ` <span class="m">${esc(x.source)}</span>` : ""}${x.motif ? ` <span class="m">— ${esc(x.motif)}</span>` : ""}</li>`;
// Surligne ce qu'on cherche dans un texte déjà sûr une fois échappé
const hl = (s, q) => { const t = esc(s); if (!q) return t; const e = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return t.replace(new RegExp(e, "gi"), m => `<mark>${m}</mark>`); };

async function loadActivite() {
  if (act.vue?.id) return ouvreSession(act.vue.id, act.vue);
  if (act.vue?.passage) return ouvrePassage(act.vue.passage);
  await afficheListe();
}
let actTimer;
function actRafraichir() {      // l'agent travaille : la page suit, sans se recharger à chaque événement
  if (tab !== "activite" || actTimer) return;
  actTimer = setTimeout(async () => {
    actTimer = null;
    if (tab !== "activite") return;
    if (act.vue?.id) await majSession(); else if (!act.vue) await listeActivite();
  }, 1200);
}
window.apparthunt.onActivite(actRafraichir);
window.apparthunt.onAgent(actRafraichir);

/* La liste */
async function afficheListe() {
  act.vue = null; act.S = null;
  $("activ").innerHTML = `<h1>Activité</h1><p class="sub" id="asub"></p>
    <div class="abar"><input type="search" id="aq" placeholder="Chercher dans tous les logs : un numéro d'annonce, un site, une erreur…" value="${esc(act.q)}">
    <div class="pills">${[["tout", "Tout"], ["agent", "Agent"], ["veille", "Veille"], ["erreurs", "Erreurs"]].map(([k, l]) => `<button type="button" data-af="${k}"${act.filtre === k ? ' class="on"' : ""}>${l}</button>`).join("")}</div></div>
    <div id="alist"></div>`;
  await listeActivite();
  $("activ").scrollTop = act.scroll;
}
async function listeActivite() {
  const [veille, sessions] = await Promise.all([window.apparthunt.activite(), window.apparthunt.sessions()]);
  const box = $("alist"); if (!box) return;
  const passages = (veille || []).filter(e => e.type === "veille"), L = sessions || [];
  const auj = new Date().toLocaleDateString("sv-SE"), S = L.filter(l => l.jour === auj);
  const nV = passages.filter(e => new Date(e.date).toLocaleDateString("sv-SE") === auj).length;
  $("asub").textContent = `Aujourd'hui : ${plur(S.length, "session")} de l'agent, ${plur(S.reduce((n, l) => n + l.actions, 0), "action")}, ${plur(nV, "passage")} de veille. Ouvre une ligne pour remonter tout son log.`;
  let lignes = [...L.map(l => ({ t: l.fin, agent: l, err: l.erreurs > 0 })), ...passages.map(e => ({ t: Date.parse(e.date), veille: e, err: !!e.detail?.soucis?.length }))];
  const hits = act.hits;
  if (hits) lignes = lignes.filter(x => x.agent ? hits.sessions.some(h => h.id === x.agent.id && h.jour === x.agent.jour) : hits.veille.includes(x.veille.id));
  if (act.filtre === "agent") lignes = lignes.filter(x => x.agent);
  if (act.filtre === "veille") lignes = lignes.filter(x => x.veille);
  if (act.filtre === "erreurs") lignes = lignes.filter(x => x.err);
  lignes.sort((a, b) => b.t - a.t);
  let html = "", last = "", calmes = [];
  const videCalmes = () => {
    if (calmes.length === 1) html += ligneVeille(calmes[0]);
    else if (calmes.length) html += `<details class="agrp"><summary class="ar"><time>${hm(Date.parse(calmes[calmes.length - 1].date))}<br>${hm(Date.parse(calmes[0].date))}</time><span class="kind">Veille</span><span class="at"><span class="tt">${calmes.length} passages, rien de nouveau</span></span><span class="chev">⌄</span></summary>${calmes.map(ligneVeille).join("")}</details>`;
    calmes = [];
  };
  for (const x of lignes) {
    const j = jourLabel(x.t);
    if (j !== last) { videCalmes(); html += `<h2>${esc(j)}</h2>`; last = j; }
    if (x.veille && !x.veille.detail?.nouvelles && !x.err && !hits) { calmes.push(x.veille); continue; }
    videCalmes();
    html += x.agent ? ligneAgent(x.agent) : ligneVeille(x.veille);
  }
  videCalmes();
  const n = hits ? hits.sessions.reduce((a, h) => a + h.n, 0) + hits.veille.length : 0;
  if (hits) html = `<p class="sub">${n ? `Trouvé dans ${plur(lignes.length, "ligne")} (${plur(n, "occurrence")}).` : `Rien trouvé pour « ${esc(act.q)} ».`}</p>` + html;
  else if (!lignes.length) html += `<p class="sub">Rien ici pour l'instant.</p>`;
  const opened = new Set([...box.querySelectorAll(".agrp[open] time")].map(t => t.innerHTML));
  box.innerHTML = html;
  box.querySelectorAll(".agrp").forEach(d => { if (opened.has(d.querySelector("time").innerHTML)) d.open = true; });
}
const resumeDe = t => String(t || "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
function ligneAgent(l) {
  const bits = [plur(l.tours, "tour"), plur(l.actions, "action"), l.pages && plur(l.pages, "page lue", "pages lues"), l.erreurs && `<span class="ko">${plur(l.erreurs, "erreur")}</span>`].filter(Boolean).join(" · ");
  const h = (act.hits?.sessions || []).find(x => x.id === l.id && x.jour === l.jour);
  const rep = chatById(l.chat)?.repondable ? `<button type="button" class="arep" data-repondre="${esc(l.chat)}" aria-label="Répondre à « ${esc(l.titre)} »">Répondre</button>` : "";
  return `<div class="arw${rep ? " avec" : ""}">${rep}<button type="button" class="ar" data-session="${esc(l.id)}" data-at="${l.at}"><time>${hm(l.fin)}</time><span class="kind agent">Agent</span><span class="at"><span class="tt">${l.actif ? '<i class="live"></i>' : ""}${esc(l.titre)}</span><span class="mt">${bits} · depuis ${hm(l.debut)}${h ? ` · <b>${plur(h.n, "occurrence")}</b>` : ""}</span>${l.resume ? `<span class="rs">${esc(resumeDe(l.resume))}</span>` : ""}</span><span class="chev">›</span></button></div>`;
}
function ligneVeille(e) {
  const d = e.detail || {}, n = Object.values(d.sources || {}).reduce((a, b) => a + b, 0), nl = d.aLire?.length || 0, no = d.office?.length || 0;
  const titre = d.recherches ? (d.nouvelles ? `<b>${plur(d.nouvelles, "nouvelle")}</b> · ${nl} à voir${no ? `, ${no} à vérifier` : ""}` : `Rien de nouveau · ${n} annonces regardées`) : esc(e.titre);
  return `<button type="button" class="ar" data-passage="${e.id}"><time>${hm(Date.parse(e.date))}</time><span class="kind${d.soucis?.length ? " err" : ""}">Veille</span><span class="at"><span class="tt">${titre}</span>${d.soucis?.length ? `<span class="mt ko">${esc(d.soucis.join(" · "))}</span>` : ""}</span><span class="chev">›</span></button>`;
}

/* Le log d'une session */
async function ouvreSession(id, o = {}) {
  const S = await window.apparthunt.session(id);
  if (!S) { act.vue = null; return afficheListe(); }
  if (act.S?.id !== id) { act.ouverts = new Set(); act.lf = "tout"; act.lq = o.q || ""; }
  act.vue = { id }; act.S = S;
  $("activ").innerHTML = `<button type="button" class="aback" data-back>‹ Activité</button><div class="shead" id="shead"></div>
    <div class="lbar"><input type="search" id="lq" placeholder="Chercher dans ce log…" value="${esc(act.lq)}">
    <div class="pills">${[["tout", "Tout"], ["actions", "Actions"], ["ecrits", "Ce qu'il dit"], ["erreurs", "Erreurs"]].map(([k, l]) => `<button type="button" data-lf="${k}"${act.lf === k ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
    <span class="lact"><button type="button" data-la="deplier">Tout déplier</button><button type="button" data-la="copier">Copier</button><button type="button" data-la="fichier">Fichier brut</button><button type="button" data-la="fin">Fin ↓</button></span></div>
    <div id="slog"></div>`;
  enteteSession(S); dessineLog();
  let at = o.at != null ? S.etapes[+o.at] : null;
  if (o.apres) at = S.etapes.find(e => e.k === "demande" && e.ts >= o.apres - 6e4) || at;
  if (at) { const el = $("slog").querySelector(`[data-tour="${at.tour}"]`); if (el) { $("activ").scrollTop = 0; el.scrollIntoView({ block: "start" }); } } else if (o.at == null && !o.apres) $("activ").scrollTop = 0;
}
function enteteSession(S) {
  const outils = S.etapes.filter(e => e.k === "outil"), err = S.etapes.filter(e => e.err || e.k === "erreur").length;
  const jetons = S.jetons ? ` · ${(S.jetons / 1e6).toFixed(1).replace(".", ",")} M de jetons` : "";
  $("shead").innerHTML = `<h1>${S.actif ? '<i class="live"></i>' : ""}${esc(S.titre)}</h1>
    <p class="sub">${S.actif ? "<b>En cours</b> · " : ""}Ouverte ${esc(jourLabel(S.debut).toLowerCase())} à ${hms(S.debut)}, dernière activité ${esc(jourLabel(S.fin).toLowerCase())} à ${hms(S.fin)}<br>
    ${plur(S.tours, "tour")} · ${plur(outils.length, "action")}${err ? ` · <span class="ko">${plur(err, "erreur")}</span>` : ""}${S.cout != null ? ` · ${S.cout.toFixed(2).replace(".", ",")} $` : ""}${jetons}${S.modele ? ` · ${esc(S.modele)}` : ""}${S.version ? ` · Claude Code ${esc(S.version)}` : ""}</p>
    <p class="sid">Session <code>${esc(S.id)}</code>${S.chat ? ` <button type="button" data-chat="${esc(S.chat)}">Voir la conversation</button>` : ""}${chatById(S.chat)?.repondable ? ` <button type="button" data-repondre="${esc(S.chat)}">Répondre</button>` : ""}</p>`;
}
const garde = (e, f) => f === "tout" ? true
  : f === "actions" ? ["outil", "demande", "toi"].includes(e.k)
  : f === "ecrits" ? ["texte", "demande", "toi"].includes(e.k)
  : e.err || e.k === "erreur" || e.k === "systeme" || (e.k === "outil" && e.res == null);
const trouve = (e, q) => !q || [e.txt, e.nom, e.court, e.res, e.ecran, e.entree && JSON.stringify(e.entree)].some(x => x && String(x).toLowerCase().includes(q));
function dessineLog() {
  const S = act.S, box = $("slog"), q = act.lq.toLowerCase().trim(); if (!S || !box) return;
  const tours = new Map();
  for (const e of S.etapes) { if (!tours.has(e.tour)) tours.set(e.tour, []); tours.get(e.tour).push(e); }
  let html = "", vus = 0;
  for (const [n, E] of tours) {
    const rows = E.filter(e => garde(e, act.lf) && trouve(e, q));
    if (!rows.length) continue;
    vus += rows.length;
    const debut = E[0].ts, fin = E[E.length - 1], finMs = fin.ts + (fin.ms && fin.k === "outil" ? fin.ms : 0);
    const nb = E.filter(e => e.k === "outil").length;
    html += `<section class="tour" data-tour="${n}"><h3><span>${n ? `Tour ${n}` : "Avant le premier message"}</span> · ${esc(jourLabel(debut))} à ${hms(debut)} · ${plur(nb, "action")} · ${duree(finMs - debut) || "0 s"}</h3>${rows.map(e => ligneLog(e, q)).join("")}</section>`;
  }
  box.innerHTML = html || `<p class="sub">Rien à afficher avec ce filtre.</p>`;
  box.querySelectorAll("details.lg[open]").forEach(remplirLog);
  box.dataset.n = vus;
}
function ligneLog(e, q) {
  const t = `<time>${hms(e.ts)}</time>`;
  if (e.k === "outil") {
    const etat = e.res == null ? '<span class="st ko">sans résultat</span>' : e.err ? `<span class="st ko">erreur · ${duree(e.ms)}</span>` : `<span class="st">${duree(e.ms)}</span>`;
    const open = act.ouverts.has(e.i) || (q && [e.res, e.entree && JSON.stringify(e.entree)].some(x => x && String(x).toLowerCase().includes(q)));
    return `<details class="lg o${e.err || e.res == null ? " err" : ""}" data-i="${e.i}"${open ? " open" : ""}><summary>${t}<span class="nm">${hl(e.nom, q)}</span><span class="ct">${hl(e.court, q)}</span>${etat}</summary><div class="lb"></div></details>`;
  }
  if (e.k === "demande" || e.k === "toi") {
    const lab = e.auto ? "Veille automatique" : e.k === "toi" ? "Toi, en cours de route" : "Toi";
    const long = e.txt.length > 1200 && !q;
    return `<div class="lg dem">${t}<div><span class="nm">${lab}</span><div class="tx${long ? " court" : ""}">${hl(e.txt, q)}</div>${e.ecran ? `<details class="ecr"><summary>Ce qui était affiché à ce moment</summary><pre>${hl(e.ecran, q)}</pre></details>` : ""}</div></div>`;
  }
  if (e.k === "texte") return `<div class="lg dit">${t}<div class="tx">${md(e.txt)}</div></div>`;
  if (e.k === "pensee") return `<div class="lg pen">${t}<span>${e.txt ? hl(e.txt, q) : `réfléchit${e.ms ? " " + duree(e.ms) : ""}`}</span></div>`;
  return `<div class="lg sys${e.k === "erreur" ? " err" : ""}">${t}<span class="nm">${esc(e.nom || e.k)}</span><span class="ct">${hl(e.txt, q)}</span></div>`;
}
const entreeDe = e => { const i = e.entree || {};
  if (i.command) return (i.description ? `# ${i.description}\n` : "") + i.command;
  return Object.entries(i).map(([k, v]) => `${k} : ${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`).join("\n") || "(aucune)"; };
function remplirLog(d) {
  const b = d.querySelector(".lb"); if (!b || b.childElementCount) return;
  const e = act.S?.etapes[+d.dataset.i]; if (!e) return;
  const q = act.lq.toLowerCase().trim();
  b.innerHTML = `<h5>Entrée</h5><pre>${hl(entreeDe(e), q)}</pre>`
    + (e.res != null ? `<h5>${e.err ? "Erreur" : "Résultat"} · ${e.res.length.toLocaleString("fr-FR")} caractères</h5><pre class="${e.err ? "ko" : ""}">${hl(e.res, q) || "(vide)"}</pre>` : `<h5 class="ko">Pas de résultat : action interrompue, ou encore en cours</h5>`)
    + (e.images || []).map(src => `<img src="${src}" alt="Capture d'écran renvoyée par l'outil">`).join("");
}
async function majSession() {
  const S = await window.apparthunt.session(act.vue.id); if (!S || act.vue?.id !== S.id) return;
  const el = $("activ"), enBas = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const pareil = act.S && act.S.etapes.length === S.etapes.length && act.S.actif === S.actif && act.S.etapes.filter(e => e.res != null).length === S.etapes.filter(e => e.res != null).length;
  if (pareil) return;
  const y = el.scrollTop;
  act.S = S; enteteSession(S); dessineLog();
  el.scrollTop = enBas && S.actif ? el.scrollHeight : y;
}
function texteDuLog(S) {
  const L = [`Session ${S.id} — ${S.titre}`];
  for (const e of S.etapes) {
    const h = new Date(e.ts).toLocaleString("sv-SE");
    if (e.k === "outil") L.push(`\n${h}  ${e.nom}${e.err ? "  [ERREUR]" : ""}${e.ms != null ? `  (${duree(e.ms)})` : ""}\n${entreeDe(e)}\n--- résultat ---\n${e.res ?? "(aucun)"}`);
    else if (e.k === "pensee") { if (e.txt) L.push(`\n${h}  [pense] ${e.txt}`); }
    else L.push(`\n${h}  [${{ demande: "demande", toi: "toi", texte: "agent" }[e.k] || e.nom || e.k}] ${e.txt}`);
  }
  return L.join("\n");
}

/* Le log d'un passage de la veille */
async function ouvrePassage(id) {
  const r = await window.apparthunt.activiteDetail(id), d = r?.detail || {};
  if (!r) { act.vue = null; return afficheListe(); }
  act.vue = { passage: id };
  const n = Object.values(d.sources || {}).reduce((a, b) => a + b, 0), no = d.office?.length || 0, nl = d.aLire?.length || 0;
  const motifs = [...new Set((d.office || []).map(x => x.motif))];
  const phrase = d.recherches ? `J'ai regardé ${n} annonces. ` + (d.nouvelles ? `${d.nouvelles} n'étaient pas encore dans ta liste : ${[nl && `${nl} pour que tu les regardes`, no && `${no} avec une alerte (${motifs.join(", ")})`].filter(Boolean).join(", ")}.` : "Toutes étaient déjà dans ta liste.") + (d.aTrier != null ? ` ${plur(d.aTrier, "annonce")} de ta liste ${d.aTrier > 1 ? "attendent" : "attend"} ton avis.` : "") : r.titre;
  const lui = nl ? (await window.apparthunt.sessions() || []).find(l => l.titre === "Veille") : null;
  $("activ").innerHTML = `<button type="button" class="aback" data-back>‹ Activité</button>
    <div class="shead"><h1>Passage de la veille</h1><p class="sub">${esc(jourLabel(Date.parse(r.date)))} à ${hms(Date.parse(r.date))}</p></div>
    <div class="vbody">
    ${d.soucis?.length ? `<p class="ko">${d.soucis.map(esc).join("<br>")}</p>` : ""}
    <p class="resume">${esc(phrase)}</p>
    ${lui ? `<p><button type="button" class="pill" data-session="${esc(lui.id)}" data-apres="${Date.parse(r.date)}">Voir ce que l'agent en a fait ›</button></p>` : ""}
    ${nl ? `<div><h4>Nouvelles, à regarder (${nl})</h4><ul>${d.aLire.map(annonceLi).join("")}</ul></div>` : ""}
    ${no ? `<div><h4>Avec une alerte, et pourquoi (${no})</h4><ul>${d.office.map(annonceLi).join("")}</ul></div>` : ""}
    ${d.recherches ? `<div><h4>Recherches lancées</h4><ul>${d.recherches.map(q => `<li><b>${esc(q.site)}</b>${q.zone ? ` — ${esc(q.zone)}` : ""} — ${plur(q.lues || 0, "annonce lue", "annonces lues")}${q.pages ? ` sur ${plur(q.pages, "page")}` : ""}${q.erreur ? ` <span class="ko">(${esc(q.erreur)})</span>` : ""}<br><code>${esc(q.url)}</code></li>`).join("")}</ul></div>` : ""}
    ${d.vues?.length ? `<div><h4>Chaque annonce vue (${d.vues.length})</h4><table class="vues"><tbody>${d.vues.map(x => `<tr class="${/l'agent donne/.test(x.sort) ? "go" : /à vérifier/.test(x.sort) ? "off" : ""}"><td>${esc(x.sort)}</td><td class="m">${esc(x.source || "")}</td><td>${lien(x.url, [x.titre || "(sans titre)", x.prix != null && x.prix + " €", x.m2 && x.m2 + " m²", x.ville].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
  $("activ").scrollTop = 0;
}

/* Gestes de la page */
let aqTimer;
$("activ").addEventListener("input", e => {
  if (e.target.id === "aq") {
    act.q = e.target.value; clearTimeout(aqTimer);
    aqTimer = setTimeout(async () => { act.hits = act.q.trim().length >= 2 ? await window.apparthunt.sessionsCherche(act.q.trim()) : null; listeActivite(); }, 250);
  }
  if (e.target.id === "lq") { act.lq = e.target.value; clearTimeout(aqTimer); aqTimer = setTimeout(dessineLog, 200); }
});
$("activ").addEventListener("toggle", e => {
  const d = e.target; if (!d.matches?.("details.lg")) return;
  if (d.open) { act.ouverts.add(+d.dataset.i); remplirLog(d); } else act.ouverts.delete(+d.dataset.i);
}, true);
$("activ").addEventListener("click", async e => {
  const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); return openWeb(a.dataset.open); }
  const rp = e.target.closest("[data-repondre]"); if (rp) return ouvreReponse(rp.dataset.repondre);
  const c = e.target.closest("[data-chat]"); if (c) { showChat(c.dataset.chat); if (document.body.classList.contains("folded")) setTalk(talkW, false); return; }
  if (e.target.closest("[data-back]")) { act.vue = null; return afficheListe(); }
  const s = e.target.closest("[data-session]");
  if (s) { if (!act.vue) act.scroll = $("activ").scrollTop; return ouvreSession(s.dataset.session, { at: s.dataset.at, apres: +s.dataset.apres || null, q: act.q.trim() }); }
  const p = e.target.closest("[data-passage]");
  if (p) { act.scroll = $("activ").scrollTop; return ouvrePassage(+p.dataset.passage); }
  const f = e.target.closest("[data-af]");
  if (f) { act.filtre = f.dataset.af; $("activ").querySelectorAll("[data-af]").forEach(b => b.classList.toggle("on", b === f)); return listeActivite(); }
  const lf = e.target.closest("[data-lf]");
  if (lf) { act.lf = lf.dataset.lf; $("activ").querySelectorAll("[data-lf]").forEach(b => b.classList.toggle("on", b === lf)); return dessineLog(); }
  const la = e.target.closest("[data-la]"); if (!la) return;
  const quoi = la.dataset.la;
  if (quoi === "fin") $("activ").scrollTop = $("activ").scrollHeight;
  if (quoi === "fichier") window.apparthunt.sessionFichier(act.S.id);
  if (quoi === "copier") { await navigator.clipboard.writeText(texteDuLog(act.S)); la.textContent = "Copié"; setTimeout(() => { la.textContent = "Copier"; }, 1500); }
  if (quoi === "deplier") {
    const ouvre = la.textContent === "Tout déplier";
    $("slog").querySelectorAll("details.lg").forEach(d => { d.open = ouvre; });
    la.textContent = ouvre ? "Tout replier" : "Tout déplier";
  }
});

async function loadProfil() {
  prof = await window.apparthunt.profil();
  renderProfil();
}

function renderProfil() {
  if (!prof) return;
  const el = $("prof"), keepScroll = el.scrollTop;
  const opened = new Set([...el.querySelectorAll(".run[open]")].map(d => d.dataset.id));   // les passages dépliés le restent
  const secs = sections(prof.recherche);
  const runs = prof.passages || [];
  const live = liveRun && !runs.some(r => r.id === liveRun);
  const kept = (data.choix.oui || []).map(u => ({ u, a: data.listings.find(x => x.u === u), r: data.resumes[u] || {} }));
  const total = runs.reduce((n, r) => n + r.gardees.length, 0);

  el.innerHTML = `
    <div class="phead">
      <div><h1>Mon profil</h1>
        <p class="summary">${prof.modifie ? `Critères mis à jour le ${day(prof.modifie)} · ` : ""}${plural(prof.memoire.length, "chose retenue")} · ${plural(runs.length, "recherche")}${total ? `, ${plural(total, "annonce gardée")}` : ""}</p></div>
      <div class="pact">
        <button type="button" data-p="changer">Changer un critère</button>
        <button type="button" class="main" data-p="lancer" ${liveRun ? "disabled" : ""}>${liveRun ? "Recherche en cours…" : "Lancer une recherche"}</button>
      </div>
    </div>
    <nav class="pnav"><a href="#p-cherche">Mes critères</a><a href="#p-retenu">Ce que l'agent a retenu</a><a href="#p-registre">Ce qui a changé</a><a href="#p-archive">Mes recherches</a></nav>

    <section class="psec" id="p-cherche">
      <h2>Mes critères</h2>
      <p class="sub">Ton texte (recherche.md). Dis-le dans la conversation pour changer un point : l'agent met tout à jour et le note dans le registre.</p>
      ${secs.map(sec => `<div class="crit"><div class="ch"><h3>${esc(sec.titre)}</h3><button type="button" class="chg" data-chg="${esc(sec.titre)}">Changer</button></div>${sec.html}${/classe/i.test(sec.titre) ? poidsBars() : ""}</div>`).join("")}
    </section>

    <section class="psec" id="p-retenu">
      <h2>Ce que l'agent a retenu</h2>
      <p class="sub">Tes goûts et ce qu'il a appris en cherchant. Il relit tout ça avant chaque recherche.</p>
      ${prof.memoire.length ? `<ul class="reg">${prof.memoire.map(m => `<li><time>${day(m.ts * 1000)}</time><span>${esc(m.note)}</span></li>`).join("")}</ul>` : `<p class="empty">Rien pour l'instant. Dis par exemple « j'aime les parquets anciens, ça fait plus chaleureux ».</p>`}
      ${kept.length ? `<h3 style="margin:22px 0 4px;font-weight:500;font-size:16px">Ce que j'ai gardé, et pourquoi</h3>
        <ul class="reg">${kept.map(({ u, a, r }) => `<li><time>${a ? a.p + " €" : ""}</time><span><a class="ext" data-open="${esc(u)}" href="#">${esc(a ? (a.w || "").split(" — ").slice(0, 2).join(", ") : siteOf(u))}</a><span class="why">${esc(r.resume || (r.pour || []).join(", ") || "")}</span></span></li>`).join("")}</ul>` : ""}
    </section>

    <section class="psec" id="p-registre">
      <h2>Ce qui a changé</h2>
      <p class="sub">Chaque critère modifié, avec ta raison.</p>
      ${prof.journal.length ? `<ul class="reg">${prof.journal.map(j => `<li><time>${esc(j.date ? day(j.date) : "")}</time><span>${inline(j.quoi || "")}${j.pourquoi ? `<span class="why">${esc(j.pourquoi)}</span>` : ""}</span></li>`).join("")}</ul>` : `<p class="empty">Aucun changement noté pour l'instant.</p>`}
    </section>

    <section class="psec" id="p-archive">
      <h2>Mes recherches</h2>
      <p class="sub">Chaque passage de l'agent : ce qu'il a vu, gardé, écarté, et son raisonnement.</p>
      ${live ? `<details class="run live" open><summary><time>${day(Date.now())} ${hour(Date.now())}</time><span class="rres">Recherche en cours…</span><span class="nums"></span></summary><div class="rbody"><p class="thought">Suis l'avancement dans la conversation.</p></div></details>` : ""}
      ${runs.map(r => `<details class="run${busy && r.id === liveRun ? " live" : ""}" data-id="${esc(r.id)}"${opened.has(r.id) ? " open" : ""}>
        <summary><time>${day(r.debut * 1000)} ${hour(r.debut * 1000)}</time><span class="rres">${esc(r.resume || r.pensees[r.pensees.length - 1] || "Sans compte rendu")}</span>
          <span class="nums">${[r.vues && plural(r.vues, "vue"), plural(r.gardees.length, "gardée"), r.ecartees.length && plural(r.ecartees.length, "écartée")].filter(Boolean).join(" · ")}</span></summary>
        <div class="rbody">
          ${r.gardees.length ? `<h4>Gardées</h4><ul>${r.gardees.map(g => `<li>${g.url ? `<a data-open="${esc(g.url)}" href="#">${esc(g.id)}</a>` : esc(g.id)} — ${esc(g.pourquoi)}</li>`).join("")}</ul>` : ""}
          ${r.ecartees.length ? `<h4>Écartées</h4><ul>${r.ecartees.map(g => `<li>${esc(g.pourquoi || g.id)}</li>`).join("")}</ul>` : ""}
          ${r.favoris || r.candidatures ? `<p>${[r.favoris && plural(r.favoris, "favori"), r.candidatures && plural(r.candidatures, "candidature préparée")].filter(Boolean).join(" · ")}</p>` : ""}
          ${r.pensees.length ? `<h4>Raisonnement</h4><ul>${r.pensees.map(t => `<li class="thought">${esc(t)}</li>`).join("")}</ul>` : ""}
          <p class="thought">Passage ${esc(r.id)} · ${Math.max(1, Math.round((r.fin - r.debut) / 60))} min</p>
        </div></details>`).join("") || (live ? "" : `<p class="empty">Aucune recherche archivée. Lance la première.</p>`)}
    </section>`;
  el.scrollTop = keepScroll;
}

// Demande en cours de rédaction : le champ de la conversation reçoit le début de la phrase
function draft(text) {
  if (document.body.classList.contains("folded")) setTalk(talkW, false);
  box.value = text; grow(); box.focus();
  box.setSelectionRange(text.length, text.length);
}
const runId = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

$("prof").addEventListener("click", e => {
  const a = e.target.closest("a");
  if (a?.dataset.open) { e.preventDefault(); return openWeb(a.dataset.open); }
  if (a?.hash) { e.preventDefault(); return $(a.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.chg) return draft(`Dans « ${b.dataset.chg} », je veux changer : `);
  if (b.dataset.p === "changer") return draft("Je veux changer un critère : ");
  if (b.dataset.p === "lancer") {
    liveRun = runId();
    renderProfil();
    newChat(`Recherche du ${day(Date.now())} à ${hour(Date.now())}`).then(() =>
      send(`Lance une recherche complète avec le skill agent-locataire, d'après recherche.md. Identifiant du passage : ${liveRun}.`));
  }
});

/* ---------- Rechargement de l'interface (son code a changé) : la conversation et l'onglet ouvert survivent ---------- */
const UI_KEY = "apparthunt-ui";
const saveUi = (what = "reload") => {
  for (const id in logs) saveLog(id);
  try { localStorage.setItem(UI_KEY, JSON.stringify({ at: Date.now(), what, tab, webUrl, cible, retourDe })); } catch { /* stockage indisponible : on repart de zéro */ }
};
window.apparthunt.onReloading(saveUi);
addEventListener("beforeunload", () => saveUi());
window.apparthunt.onNotice(text => note(activeChat, text));
(async () => {
  placeWeb();                                    // la page du navigateur restée posée par-dessus est retirée tant que l'onglet n'est pas rouvert
  const s = setChats(await window.apparthunt.chats());
  let st = null;
  try { st = JSON.parse(localStorage.getItem(UI_KEY)); localStorage.removeItem(UI_KEY); } catch { /* idem */ }
  if (st && Date.now() - st.at > 10 * 60 * 1000) st = null;
  // l'ancienne appli à un seul chat gardait sa conversation ici : elle devient le premier chat
  if (st?.log && !(await window.apparthunt.chatLog(s.actif))) { logOf(s.actif).innerHTML = st.log; logs[s.actif].querySelectorAll(".turn").forEach(t => t.classList.add("old")); saveLog(s.actif); }
  // une seule conversation à l'écran : la tienne (la veille a la sienne, à part)
  const mine = [...s.liste].filter(c => c.titre !== "Veille").sort((a, b) => b.maj - a.maj)[0];
  await showChat(chatById(s.actif)?.titre === "Veille" && mine ? mine.id : s.actif);
  // la fenêtre a pu se recharger pendant qu'une tâche tourne : on se remet sur elle
  const etat = await window.apparthunt.agentEtat();
  if (etat?.actif && !busy) { await chargeLog(etat.actif); newTurn(null, etat.actif); busy = true; runChat = etat.actif; addStep("Je travaille"); setOrb(); renderRail(); }
  if (!st) return;
  if (st.cible && chatById(st.cible)?.repondable) { await showChat(st.cible); retourDe = st.retourDe; poseCible(st.cible); }
  // après un redémarrage le navigateur est vide : on rouvre la page ; après un simple rechargement il l'a gardée
  if (st.tab === "web" && st.webUrl) { if (st.what === "restart") openWeb(st.webUrl); else { webUrl = st.webUrl; $("weburl").textContent = webUrl.replace(/^https?:\/\/(www\.)?/, ""); setTab("web"); } }
  else if (st.tab && st.tab !== "annonces") setTab(st.tab);
})();

var phd = null;   // en-tête du panneau (créé plus bas, une fois la page prête)
/* ---------- La colonne de l'agent, à droite : en-tête (ce qu'il fait, la veille), le fil, écrire ---------- */
function openPanel() { scroll(); }          // la colonne est toujours là ; gardé pour les appels existants
{
  const top = $("talk").querySelector(".top");
  phd = document.createElement("div"); phd.className = "phd";
  phd.innerHTML = '<button type="button" data-p="retour" hidden>← Ta conversation</button><button type="button" data-p="neuf" title="Repartir d\'une conversation vide">+ Nouvelle</button><button type="button" data-p="replier" title="Replier la colonne">›</button>';
  const l1 = document.createElement("div"); l1.className = "ch1"; l1.innerHTML = '<span class="ttl">Agent</span>'; l1.appendChild(phd);
  const l2 = document.createElement("div"); l2.className = "ch2"; l2.append($("orb"), $("stateS"));
  const l3 = document.createElement("div"); l3.className = "ch3"; l3.append($("veilleOn"), $("dveille"));
  top.append(l1, l2, l3);
  // bouton Envoyer à côté du champ
  const sb = document.createElement("button"); sb.type = "button"; sb.className = "sendb"; sb.textContent = "↑"; sb.title = "Envoyer (Entrée)"; sb.setAttribute("aria-label", "Envoyer");
  document.querySelector(".typer").appendChild(sb);
  const upd = () => { sb.disabled = !box.value.trim(); };
  box.addEventListener("input", upd); upd();
  sb.addEventListener("click", () => { if (!box.value.trim()) return; send(box.value); box.value = ""; grow(); upd(); });
}
if (!cible) box.placeholder = "Écris à l'agent (ou dicte), puis Entrée";
$("dveille").addEventListener("click", () => setTab("activite"));
// ce qu'il fait en ce moment, en clair
new MutationObserver(() => { if (!$("stateS").textContent) $("stateS").textContent = "Prêt. Écris-lui en bas."; })
  .observe($("stateS"), { childList: true, characterData: true, subtree: true });
if (!$("stateS").textContent) $("stateS").textContent = "Prêt. Écris-lui en bas.";
function renderPanelHead() {
  if (!phd) return;
  const v = chatById(activeChat)?.titre === "Veille";          // ouverte depuis Activité : on peut revenir à la sienne
  phd.querySelector('[data-p="retour"]').hidden = !v;
  $("talk").querySelector(".ttl").textContent = v ? "Conversation de la veille" : "Agent";
}
phd.addEventListener("click", async e => {
  const p = e.target.closest("[data-p]")?.dataset.p; if (!p) return;
  if (p === "neuf") return newChat();
  if (p === "replier") return setChatW(null);
  const mine = [...chats].filter(c => c.titre !== "Veille").sort((a, b) => b.maj - a.maj)[0];
  if (p === "retour" && mine) await showChat(mine.id);
});
renderPanelHead();
// Largeur de la colonne : glisser son bord gauche, double-clic pour revenir à la taille normale ; › la replie, « Agent » la rouvre
const CHAT_W0 = 360;
function setChatW(w) {
  const off = w === null;
  document.body.classList.toggle("chatoff", off);
  if (!off) document.body.style.setProperty("--chat-w", Math.round(w) + "px");
  pref("chat-w", off ? "off" : String(Math.round(w)));
  setTimeout(placeWeb, 60);
}
const cgrip = document.createElement("div"); cgrip.className = "cgrip"; cgrip.title = "Glisse pour élargir ou rétrécir · double-clic : taille normale";
const copen = document.createElement("button"); copen.type = "button"; copen.className = "copen"; copen.textContent = "‹ Agent"; copen.title = "Rouvrir la colonne de l'agent";
document.body.append(cgrip, copen);
copen.addEventListener("click", () => setChatW(+(pref("chat-w-last") || CHAT_W0)));
cgrip.addEventListener("dblclick", () => setChatW(CHAT_W0));
cgrip.addEventListener("pointerdown", e => {
  e.preventDefault(); cgrip.setPointerCapture(e.pointerId); document.body.classList.add("dragging");
  const move = ev => { const w = Math.min(Math.max(innerWidth - ev.clientX, 300), Math.max(320, innerWidth - 460)); document.body.style.setProperty("--chat-w", w + "px"); };
  cgrip.addEventListener("pointermove", move);
  cgrip.addEventListener("pointerup", () => {
    cgrip.removeEventListener("pointermove", move); document.body.classList.remove("dragging");
    const w = parseInt(getComputedStyle(document.body).getPropertyValue("--chat-w")) || CHAT_W0;
    pref("chat-w-last", String(w)); setChatW(w);
  }, { once: true });
});
{ const w = pref("chat-w"); if (w === "off") setChatW(null); else if (+w) setChatW(+w); }

