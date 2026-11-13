// Navigateur de l'agent : un onglet Chromium dans la fenêtre de l'appli, exposé à Claude Code comme serveur MCP.
//
// - L'onglet garde ses connexions (partition persistante) : l'utilisateur se connecte une fois aux sites.
// - Il s'affiche à la place des annonces, dans la colonne de droite ; caché, il continue de tourner pour l'agent.
// - Le serveur MCP (HTTP, 127.0.0.1 seulement, jeton aléatoire) donne à Claude Code des outils :
//   ouvrir une page, lire la page, extraire une annonce complète, cliquer, faire une capture, afficher l'onglet.
// - Rien n'est déguisé : si un site bloque ce navigateur, l'outil le dit et l'agent s'arrête sur ce site.
const { WebContentsView } = require("electron");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PARTITION = "persist:apparthunt-navigateur";
const BLOCKED = /accès temporairement restreint|access denied|vérification de sécurité|are you a robot|captcha|cloudflare/i;
let host = null, view = null, attached = false, tell = () => {};

// Bandeaux cookies : on refuse tout seul, dès qu'ils apparaissent (Didomi sur Leboncoin et SeLoger, OneTrust, Axeptio, tarteaucitron…)
const REFUSE_COOKIES = `(() => {
  const SEL = ["#didomi-notice-disagree-button", ".didomi-continue-without-agreeing", "#onetrust-reject-all-handler",
    "#axeptio_btn_dismiss", "[data-testid='uc-deny-all-button']", "#tarteaucitronAllDenied2", "#cmpbntnotxt"];
  const TXT = /^(tout refuser|refuser tout|tout rejeter|continuer sans accepter|je refuse|refuser)/i;
  const BOX = "[id*=didomi],[class*=didomi],[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=cmp i],[role=dialog]";
  const seen = e => e && e.offsetParent !== null;
  const once = () => {
    for (const s of SEL) { const b = document.querySelector(s); if (seen(b)) { b.click(); return true; } }
    const b = [...document.querySelectorAll("button, a, [role=button]")]
      .find(e => seen(e) && e.closest(BOX) && TXT.test((e.innerText || e.textContent || "").trim()));
    if (b) { b.click(); return true; }
    return false;
  };
  if (once()) return;
  const obs = new MutationObserver(() => { if (once()) obs.disconnect(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 10000);
})()`;

// Toutes les cartes d'annonces Leboncoin de la page (résultats, « ces annonces peuvent vous intéresser »…),
// au fur et à mesure qu'elles s'affichent : les données embarquées par la page si elles existent, sinon le texte de la carte
const WATCH_CARDS = `(() => {
  if (window.__ahWatch) return; window.__ahWatch = true;
  window.__ahQueue = []; const sent = new Set(), next = {};
  try { for (const ad of JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps.searchData?.ads || []) next[String(ad.list_id)] = ad; } catch (e) {}
  const price = s => s ? +s.replace(/[\\s\\u202f.]/g, "") : null;           // « 1 200 € »
  const dec = s => s ? parseFloat(s.replace(",", ".")) : null;              // « 43,3 m² »
  const scan = () => {
    const groups = {};
    for (const l of document.querySelectorAll('a[href*="/ad/locations/"]')) {
      const id = (l.getAttribute("href").match(/\\/(\\d{6,})/) || [])[1];
      if (id && !sent.has(id)) (groups[id] = groups[id] || []).push(l);
    }
    for (const [id, links] of Object.entries(groups)) {
      if (location.pathname.includes(id)) { sent.add(id); continue; }        // l'annonce de la page elle-même
      const link = links.find(l => l.querySelector("img")) || links[0];
      const card = link.closest("article, li") || link;                       // le prix et la ville sont dans la carte, pas dans le lien
      const text = (card.innerText || "").replace(/\\s+/g, " ").trim(), ad = next[id];
      if (!ad && !/€/.test(text)) continue;                                  // carte pas encore dessinée : au prochain passage
      sent.add(id);
      if (ad) window.__ahQueue.push({ id, subject: ad.subject || "", body: (ad.body || "").slice(0, 600), p: (ad.price || [])[0] ?? null,
        city: ad.location?.city || "", district: ad.location?.district || "",
        attrs: Object.fromEntries((ad.attributes || []).map(a => [a.key, { v: a.value, l: a.value_label || "" }])) });
      else {
        const loc = text.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ'’ -]+?) (\\d{5})/);
        window.__ahQueue.push({ id, subject: text.slice(0, 300), body: "", attrs: {}, district: "",
          p: price((text.match(/(\\d[\\d\\s\\u202f.]*)\\s*€/) || [])[1]), m2: dec((text.match(/(\\d+(?:[.,]\\d+)?)\\s*m²/) || [])[1]),
          rooms: dec((text.match(/(\\d+)\\s*pi[eè]ces?/i) || [])[1]), city: loc ? loc[1].trim() : "" });
      }
    }
  };
  scan();
  new MutationObserver(() => { clearTimeout(window.__ahT); window.__ahT = setTimeout(scan, 300); }).observe(document.body, { childList: true, subtree: true });
})()`;
const TAKE_CARDS = `(() => { const q = window.__ahQueue || []; window.__ahQueue = []; return q; })()`;

// Pastilles posées sur chaque carte ; mises à jour si le verdict change, reposées si la page redessine ses cartes
const BADGES = map => `(() => {
  window.__ahMap = Object.assign(window.__ahMap || {}, ${JSON.stringify(map)});
  if (!document.getElementById("ah-style")) {
    const st = document.createElement("style"); st.id = "ah-style";
    st.textContent = ".ah-pill{position:absolute;top:8px;left:8px;z-index:5;display:flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;background:#fff;color:#161616;font:500 12px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.25);pointer-events:none;max-width:90%}"
      + ".ah-pill::before{content:'';flex:none;width:8px;height:8px;border-radius:50%;background:var(--ah)}"
      + ".ah-pill.ah-non{opacity:.85;color:#71717a}.ah-pill i{font-style:normal;color:#71717a;font-weight:400;padding-left:6px;border-left:1px solid #e4e4e7}";
    document.head.appendChild(st);
  }
  const paint = (el, b) => {
    el.className = "ah-pill ah-" + b.v; el.style.setProperty("--ah", b.c); el.title = b.t || "";
    el.textContent = b.l; if (b.n) { const i = document.createElement("i"); i.textContent = b.n; el.appendChild(i); }
  };
  const apply = () => {
    // une carte contient plusieurs liens vers la même annonce : une seule pastille, sur le lien qui porte la photo
    const byId = {};
    for (const link of document.querySelectorAll('a[href*="/ad/locations/"]')) {
      const id = (link.getAttribute("href").match(/\\/(\\d{6,})/) || [])[1];
      if (id && window.__ahMap[id]) (byId[id] = byId[id] || []).push(link);
    }
    for (const [id, links] of Object.entries(byId)) {
      const b = window.__ahMap[id], old = document.querySelector('.ah-pill[data-id="' + id + '"]');
      if (old) { if (old.dataset.k !== b.k) { paint(old, b); old.dataset.k = b.k; } continue; }
      const area = l => { const r = l.getBoundingClientRect(); return r.width * r.height; };
      const link = links.find(l => l.querySelector("img")) || links.sort((x, y) => area(y) - area(x))[0];
      if (getComputedStyle(link).position === "static") link.style.position = "relative";
      const el = document.createElement("span"); el.dataset.id = id; el.dataset.k = b.k; paint(el, b);
      link.appendChild(el);
    }
  };
  apply();
  if (!window.__ahObs) { window.__ahObs = new MutationObserver(() => { clearTimeout(window.__ahB); window.__ahB = setTimeout(apply, 200); }); window.__ahObs.observe(document.body, { childList: true, subtree: true }); }
})()`;

// Zoom : les sites sont faits pour ~1200 px de large ; dans un onglet plus étroit on dézoome au lieu de basculer
// en mise en page mobile. Cmd + / Cmd − / Cmd 0 ajustent par-dessus.
const PAGE_WIDTH = 1200;
let autoZoom = 1, userZoom = 1;
const applyZoom = () => view && view.webContents.setZoomFactor(Math.min(Math.max(autoZoom * userZoom, 0.5), 2));

// host : la fenêtre principale ; l'onglet s'y insère et lui signale ses changements d'adresse
function init(win) {
  host = win;
  view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const wc = view.webContents;
  // les sites n'ont droit ni à la caméra, ni au micro, ni à la position, ni aux notifications
  const ses = wc.session, ok = new Set(["fullscreen", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ok.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => ok.has(perm));
  ses.setDevicePermissionHandler(() => false);
  // un lien « nouvel onglet » s'ouvre dans l'onglet ; une vraie pop-up (connexion à un compte…) garde sa petite fenêtre,
  // avec la même session, sinon la connexion ne revient jamais à la page
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (!/^https?:\/\//i.test(url)) return { action: "deny" };   // une page ne peut pas ouvrir file:// ni un autre protocole
    if (disposition === "new-window") return { action: "allow", overrideBrowserWindowOptions: { parent: host, width: 520, height: 720 } };
    wc.loadURL(url); return { action: "deny" };
  });
  wc.on("dom-ready", () => wc.executeJavaScriptInIsolatedWorld(999, [{ code: REFUSE_COOKIES }]).catch(() => {}));
  // cartes d'annonces Leboncoin : la page les repère au fil de l'eau, on les relève toutes les 1,5 s,
  // l'interface les note et renvoie les pastilles
  const onLbc = () => /(^|\.)leboncoin\.fr$/.test(new URL(wc.getURL() || "about:blank").hostname || "");
  wc.on("dom-ready", () => onLbc() && wc.executeJavaScriptInIsolatedWorld(999, [{ code: WATCH_CARDS }]).catch(() => {}));
  setInterval(() => {
    if (!onLbc()) return;
    wc.executeJavaScriptInIsolatedWorld(999, [{ code: TAKE_CARDS }])
      .then(ads => ads?.length && !host.isDestroyed() && host.webContents.send("browser-ads", ads)).catch(() => {});
  }, 1500);
  wc.on("did-navigate", applyZoom);
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !(input.meta || input.control)) return;
    const k = input.key;
    if (k === "=" || k === "+") userZoom *= 1.1; else if (k === "-") userZoom /= 1.1; else if (k === "0") userZoom = 1; else return;
    e.preventDefault(); applyZoom();
  });
  // nouvellePage : un vrai chargement (les cartes relevées sur la page précédente ne comptent plus)
  tell = (nouvellePage = false) => !host.isDestroyed() && host.webContents.send("browser-url", { url: wc.getURL(), titre: wc.getTitle(), retour: wc.navigationHistory.canGoBack(), nouvellePage });
  wc.on("did-navigate", () => tell(true));
  for (const ev of ["did-navigate-in-page", "page-title-updated"]) wc.on(ev, () => tell());
}

function browser() { return view; }

// L'interface donne la place de l'onglet (rectangle de la colonne de droite) ; sans rectangle, l'onglet se cache
function place(rect) {
  if (!view || host.isDestroyed()) return;
  if (!rect) { if (attached) host.contentView.removeChildView(view); attached = false; return; }
  if (!attached) host.contentView.addChildView(view);
  attached = true;
  view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
  const z = Math.min(Math.max(rect.width / PAGE_WIDTH, 0.6), 1);
  if (Math.abs(z - autoZoom) > 0.01) { autoZoom = z; applyZoom(); }
}

function show() { if (host && !host.isDestroyed()) host.webContents.send("browser-show"); }

const wait = ms => new Promise(r => setTimeout(r, ms));
// Le navigateur de l'agent n'ouvre que des pages web : jamais file://, ni un autre protocole, même si une annonce ou l'agent le demande
const web = url => { if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("Adresse refusée : seules les pages web (http, https) s'ouvrent ici."); return String(url); };

async function open(url) {
  url = web(url);
  const w = browser();
  await w.webContents.loadURL(url).catch(() => {});
  await wait(2500);                                             // laisser la page finir de s'afficher, comme une personne
  const info = await w.webContents.executeJavaScript(`({ title: document.title, text: (document.body?.innerText || "").slice(0, 400) })`).catch(() => ({ title: "", text: "" }));
  const blocked = BLOCKED.test(info.title + " " + info.text);
  return { url: w.webContents.getURL(), titre: info.title, bloque: blocked };
}

async function pageText(max = 12000) {
  const t = await browser().webContents.executeJavaScript(`document.body.innerText`).catch(() => "");
  return t.replace(/\n{3,}/g, "\n\n").slice(0, max);
}

// Fiche complète Leboncoin : l'extracteur du projet, exécuté dans la page, puis enregistrement dans la base (tools/donnees.py)
async function extract(workspace, repo) {
  const w = browser(), u = w.webContents.getURL();
  if (/leboncoin\.fr\/ad\//.test(u)) {
    const src = fs.readFileSync(path.join(repo, "tools", "extract", "leboncoin.js"), "utf8");
    const fiche = JSON.parse(await w.webContents.executeJavaScript(src));
    fiche.u = u;                    // la page ne choisit pas sur quelle annonce elle écrit
    saveFiche(workspace, fiche);
    return { url: fiche.u, photos: fiche.photos.length, details: fiche.details, description: fiche.description };
  }
  return { url: u, note: "Pas d'extracteur dédié pour ce site : voici le texte de la page ; enregistre la fiche toi-même avec python3 tools/donnees.py fiche.", texte: await pageText() };
}

// même règle de fusion que pour l'agent : photos et description remplacent, détails ajoutés, clés techniques écartées
function saveFiche(workspace, f) {
  const fiche = Object.fromEntries(["u", "photos", "details", "description", "lat", "lng", "statut"].filter(k => f[k] != null).map(k => [k, f[k]]));
  execFileSync("python3", [path.join(__dirname, "..", "tools", "donnees.py"), "fiche", "-"], { cwd: workspace, input: JSON.stringify(fiche), encoding: "utf8" });
}

// Veille : une page de résultats lue dans un onglet invisible, avec la même session que l'onglet Navigateur (rien ne bouge à l'écran)
async function scanSearch(url, pages = 1, jamaisVue = null) {
  const v = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const out = { ads: [], pages: [] };
  try {
    for (let p = 1; p <= pages; p++) {
      const r = await lirePage(v, p === 1 ? url : url + "&page=" + p);
      if (!r.ads) { if (p === 1) return { ...out, bloque: BLOCKED.test(r.texte), vide: true }; break; }
      out.ads.push(...r.ads); out.pages.push({ page: p, annonces: r.ads.length });
      if (r.ads.length < 30) break;          // dernière page
      if (jamaisVue && p >= 3 && !r.ads.some(jamaisVue)) break;   // au-delà de 3 pages, on continue seulement s'il y a du nouveau
      await wait(2000 + Math.random() * 2000);   // comme une personne : on ne tourne pas les pages en rafale
    }
    return out;
  } finally { v.webContents.close(); }
}
async function lirePage(v, url) {
  {
    await v.webContents.loadURL(web(url));
    await wait(2500);
    const r = await v.webContents.executeJavaScript(`(() => {
      let ads = null;
      try { ads = JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps.searchData.ads; } catch (e) {}
      return { texte: document.body.innerText.slice(0, 2000), ads: ads && ads.map(a => ({ id: String(a.list_id), titre: a.subject || "", body: (a.body || "").slice(0, 1500), prix: (a.price || [])[0] ?? null,
        ville: a.location?.city || "", quartier: a.location?.district || "", date: a.first_publication_date || "",
        img: (a.images && (a.images.urls_large || a.images.urls || [])[0]) || a.images?.thumb_url || "",
        attrs: Object.fromEntries((a.attributes || []).map(x => [x.key, x.value_label || x.value])) })) };
    })()`);
    return r;
  }
}

// Annonces affichées sur une page de résultats : lien et texte de chaque carte (après défilement, pour charger les cartes paresseuses)
async function listAds() {
  const wc = browser().webContents;
  for (let i = 0; i < 8; i++) { await wc.executeJavaScript(`window.scrollBy(0, innerHeight)`).catch(() => {}); await wait(400); }
  return wc.executeJavaScript(`(() => {
    const out = {};
    for (const a of document.querySelectorAll('a[href*="/ad/"]')) {
      const id = (a.getAttribute("href").match(/\\/(\\d{6,})/) || [])[1];
      if (!id || out[id]) continue;
      let card = a; for (let k = 0; k < 6 && card.parentElement && card.innerText.length < 60; k++) card = card.parentElement;
      out[id] = { url: new URL(a.getAttribute("href"), location.href).href.split("?")[0], texte: card.innerText.replace(/\\s*\\n\\s*/g, " · ").slice(0, 300) };
    }
    return Object.values(out);
  })()`).catch(() => []);
}

async function click(text) {
  const ok = await browser().webContents.executeJavaScript(`(() => {
    const t = ${JSON.stringify(text)}.toLowerCase();
    const els = [...document.querySelectorAll("button, a, [role=button], label")];
    const el = els.find(e => (e.getAttribute("aria-label") || e.innerText || "").trim().toLowerCase() === t)
            || els.find(e => (e.getAttribute("aria-label") || e.innerText || "").toLowerCase().includes(t));
    if (!el) return false;
    el.scrollIntoView({ block: "center" }); el.click(); return (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 80);
  })()`).catch(() => false);
  await wait(1500);
  return ok ? { clique: ok } : { erreur: `Aucun bouton ou lien « ${text} » sur la page.` };
}

const TOOLS = [
  { name: "ouvrir_page", description: "Ouvre une URL dans le navigateur de l'appli (avec les connexions de l'utilisateur) et dit si le site bloque. Une page à la fois, comme une personne.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "lire_page", description: "Renvoie le texte visible de la page ouverte.", inputSchema: { type: "object", properties: {} } },
  { name: "annonces_page", description: "Sur une page de résultats (Leboncoin…) : fait défiler puis liste chaque annonce affichée avec son URL et le texte de sa carte.", inputSchema: { type: "object", properties: {} } },
  { name: "extraire_annonce", description: "Sur la page d'une annonce : récupère tout (photos, caractéristiques, prix détaillé, description, annonceur, dates) et l'enregistre dans resumes.json. Sur Leboncoin c'est automatique ; ailleurs, renvoie le texte de la page.",
    inputSchema: { type: "object", properties: {} } },
  { name: "cliquer", description: "Clique sur le bouton ou le lien dont le texte (ou l'étiquette) correspond, par exemple « Je refuse » pour les cookies, « Voir plus », « Ajouter cette annonce à mes favoris ».",
    inputSchema: { type: "object", properties: { texte: { type: "string" } }, required: ["texte"] } },
  { name: "capture", description: "Capture d'écran de la page ouverte (pour regarder les photos, vérifier un état).", inputSchema: { type: "object", properties: {} } },
  { name: "afficher_navigateur", description: "Affiche l'onglet Navigateur dans l'appli, à la place des annonces (pour que l'utilisateur se connecte à un site, ou voie ce que tu fais).",
    inputSchema: { type: "object", properties: {} } },
];

async function callTool(name, args, ctx) {
  const text = obj => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }] });
  if (name === "ouvrir_page") {
    const r = await open(args.url);
    return text(r.bloque ? { ...r, consigne: "Le site bloque ce navigateur. Ne contourne pas : arrête-toi sur ce site et dis-le à l'utilisateur." } : r);
  }
  if (name === "lire_page") return text(await pageText());
  if (name === "annonces_page") return text(await listAds());
  if (name === "extraire_annonce") return text(await extract(ctx.workspace, ctx.repo));
  if (name === "cliquer") return text(await click(args.texte));
  if (name === "capture") {
    const img = await browser().webContents.capturePage();
    if (img.isEmpty()) return text("L'onglet Navigateur est caché : appelle afficher_navigateur, puis refais la capture.");
    return { content: [{ type: "image", data: img.resize({ width: 1000 }).toPNG().toString("base64"), mimeType: "image/png" }] };
  }
  if (name === "afficher_navigateur") { show(); return text("Onglet Navigateur affiché dans l'appli."); }
  throw new Error("Outil inconnu : " + name);
}

// Serveur MCP minimal (JSON-RPC sur HTTP, réponses JSON), réservé à cette machine et protégé par un jeton
function startMcp(ctx) {
  const token = crypto.randomBytes(24).toString("hex");
  // configs laissées par une appli arrêtée brutalement : leur jeton ne sert plus, on les retire
  for (const f of fs.readdirSync(os.tmpdir()).filter(f => /^apparthunt-mcp-\d+\.json$/.test(f))) {
    const pid = +f.match(/\d+/)[0];
    try { process.kill(pid, 0); } catch { fs.rmSync(path.join(os.tmpdir(), f), { force: true }); }
  }
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer " + token) { res.writeHead(401).end(); return; }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = "";
    req.on("data", d => { body += d; if (body.length > 2e6) req.destroy(); });   // 2 Mo au plus
    req.on("end", async () => {
      let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      if (msg.id === undefined) { res.writeHead(202).end(); return; }      // notification
      const reply = result => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })); };
      const fail = m => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: m } })); };
      try {
        if (msg.method === "initialize") reply({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "apparthunt-navigateur", version: "0.1.0" } });
        else if (msg.method === "tools/list") reply({ tools: [...TOOLS, ...(ctx.tools || []).map(({ run, ...def }) => def)] });
        else if (msg.method === "tools/call") {
          const own = (ctx.tools || []).find(t => t.name === msg.params.name);   // outils de la conversation (question, plan, proposition), tenus par main.js
          reply(own ? { content: [{ type: "text", text: String(await own.run(msg.params.arguments || {})) }] } : await callTool(msg.params.name, msg.params.arguments || {}, ctx));
        }
        else if (msg.method === "ping") reply({});
        else fail("Méthode non prise en charge : " + msg.method);
      } catch (e) { reply({ content: [{ type: "text", text: "Erreur : " + e.message }], isError: true }); }
    });
  });
  server.requestTimeout = 0;   // poser_question attend la réponse de l'utilisateur aussi longtemps qu'il faut
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const config = path.join(os.tmpdir(), `apparthunt-mcp-${process.pid}.json`);
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { navigateur: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: "Bearer " + token } } } }), { mode: 0o600 });
    process.on("exit", () => { try { fs.unlinkSync(config); } catch { /* déjà supprimé */ } });   // le jeton ne survit pas à l'appli
    resolve({ port, config });
  }));
}

function badge(map) { view?.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: BADGES(map) }]).catch(() => {}); }

module.exports = { init, place, show, badge, scanSearch, // ouverte depuis la liste : l'annonce devient la première page de l'onglet (« retour » ramène alors aux annonces)
  load: url => /^https?:\/\//i.test(String(url || "")) && view?.webContents.loadURL(url).then(() => { view.webContents.navigationHistory.clear(); tell(); }).catch(() => {}), back: () => view?.webContents.navigationHistory.goBack(), startMcp };
