// Tests du moteur de tâches avec de vrais appels à Claude Code (modèle le moins cher), sur une base et un dossier à part.
// Rien ici ne touche à l'appli, ni à ma-recherche/. Lancer : node app/tests/taches.test.js [numéros des tests]
// Coût : quelques centimes.
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { execSync } = require("child_process");
const Taches = require("../taches");

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ah-taches-")));
const BASE = path.join(DIR, "chats.json");
const CONFIG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJET = path.join(CONFIG, "projects", DIR.replace(/[^a-zA-Z0-9]/g, "-"));
const MARQUE = "[AH]";
const REPRISE = fs.readFileSync(path.join(__dirname, "..", "consignes", "reprise.md"), "utf8").replace(/<!--[\s\S]*?-->\s*/g, "").trim();
const OPTIONS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--replay-user-messages", "--model", "haiku",
  "--append-system-prompt", `Termine toujours ta réponse par ${MARQUE}. Réponses très courtes.`, "--allowedTools", "Bash(sleep:*)", "Bash(echo:*)"];

function nouvelleBase(chats) { fs.writeFileSync(BASE, JSON.stringify({ liste: chats }, null, 1)); }
function moteur(extra = {}) {
  const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
  const ev = [];
  const attentes = [];
  const m = Taches.creer({
    cwd: DIR, config: CONFIG, env: process.env,
    store: { get: id => base.liste.find(c => c.id === id), liste: () => base.liste, save: () => fs.writeFileSync(BASE, JSON.stringify(base, null, 1)) },
    options: () => OPTIONS, consigneReprise: () => REPRISE,
    emit: (e, id) => { ev.push({ ...e, chat: id }); extra.emit?.(e, id, m); for (const a of [...attentes]) if (a.test(e, id)) { attentes.splice(attentes.indexOf(a), 1); a.res(e); } },
    ...extra.moteur,
  });
  m.ev = ev; m.base = base;
  m.chat = id => base.liste.find(c => c.id === id);
  m.quand = (test, ms = 120e3) => new Promise((res, rej) => { const a = { test, res }; attentes.push(a); setTimeout(() => rej(new Error("trop long : " + test)), ms).unref?.(); });
  m.finDe = id => m.quand((e, c) => e.type === "turn_end" && c === id);
  m.fini = async id => { for (;;) { await m.finDe(id); await new Promise(r => setTimeout(r, 50)); if (!m.enCours(id) && !m.taches().find(t => t.id === id && t.etat === "en_attente")) return; } };
  m.resultats = id => ev.filter(e => e.chat === id && e.type === "result").map(e => e.result);
  if (extra.demarrer !== false) m.demarrer();
  return m;
}
const msg = t => ({ demande: t, prompt: t });
const rappelDansSession = sid => fs.readFileSync(path.join(PROJET, sid + ".jsonl"), "utf8").includes("[Reprise]");
const chat = (id, x = {}) => ({ id, titre: "Tâche " + id, ...x });

const TESTS = {
  async "1. répondre à une tâche en cours : elle en tient compte, sans repartir"() {
    nouvelleBase([chat("a")]);
    const m = moteur();
    const fini = m.fini("a");
    assert.equal(m.envoyer("a", msg("Exécute la commande Bash `sleep 8`, puis réponds le mot FIN, sauf si on te donne un autre mot entre-temps.")).mode, "lance");
    await m.quand(e => e.type === "assistant" && e.message.content.some(b => b.type === "tool_use"));
    const r = m.repondre("a", msg("Changement : réponds POMME au lieu de FIN."));
    assert.equal(r.mode, "lu");
    await fini;
    const res = m.resultats("a");
    assert.equal(res.length, 1, "un seul tour : " + JSON.stringify(res));
    assert.match(res[0], /POMME/);
    assert.equal(m.ev.filter(e => e.type === "tour_debut").length, 1, "elle n'a pas été relancée");
    assert.equal(m.chat("a").etat, "finie");
    assert.ok(m.chat("a").sessionId);
  },

  async "2. reprendre une tâche finie : elle se souvient, mêmes options, coût non additionné"() {
    nouvelleBase([chat("b")]);
    const m = moteur();
    let fini = m.fini("b");
    m.envoyer("b", msg("Retiens le mot-code ZEBRE42. Écris un texte de 400 mots sur la mer."));   // un premier tour bien plus cher que le second : si le total du second le dépasse, il le compte
    await fini;
    const c1 = m.chat("b").cout, s1 = m.chat("b").sessionId;
    assert.ok(c1 > 0);
    assert.equal(m.chat("b").etat, "finie");
    fini = m.fini("b");
    assert.equal(m.repondre("b", msg("Quel est le mot-code ?")).mode, "lance");
    await fini;
    const res = m.resultats("b");
    assert.match(res[1], /ZEBRE42/);
    assert.ok(res[1].includes(MARQUE), "le prompt système ajouté est toujours là : " + res[1]);
    const totaux = m.ev.filter(e => e.type === "result").map(e => e.total_cost_usd);
    console.log("     coûts rapportés par Claude :", totaux, "· session", s1 === m.chat("b").sessionId ? "inchangée" : "changée");
    assert.ok(totaux[1] >= totaux[0], "total_cost_usd compte ce qui précède la reprise");
    assert.equal(m.chat("b").cout, Math.max(...totaux));
    assert.ok(m.ev.find(e => e.type === "tour_debut" && e.reprise));
    assert.equal(rappelDansSession(m.chat("b").sessionId), false, "la suite normale d'une conversation n'a pas le rappel de reprise");
  },

  async "3. reprendre après un redémarrage (moteur recréé depuis la base), y compris une tâche coupée en plein travail"() {
    nouvelleBase([chat("c")]);
    let m = moteur();
    let fini = m.fini("c");
    m.envoyer("c", msg("Retiens le mot-code GIRAFE7. Réponds juste OK."));
    await fini;
    m = moteur();
    assert.ok(m.repondable(m.chat("c")));
    fini = m.fini("c");
    assert.equal(m.repondre("c", msg("Quel est le mot-code ?")).mode, "lance");
    await fini;
    assert.match(m.resultats("c")[0], /GIRAFE7/);
    // coupée : le processus est tué en plein travail et l'appli repart de ce que dit la base
    nouvelleBase([chat("c2")]);
    const m1 = moteur();
    m1.envoyer("c2", msg("Retiens le mot-code LOUTRE3. Puis exécute la commande Bash `sleep 40`, puis réponds OK."));
    await m1.quand(e => e.type === "assistant" && e.message.content.some(b => b.type === "tool_use"));
    const photo = fs.readFileSync(BASE);          // ce que la base contenait à la fermeture de l'appli
    const fin1 = m1.finDe("c2");
    m1.couper(); await fin1;
    fs.writeFileSync(BASE, photo);
    const m2 = moteur();
    assert.equal(m2.chat("c2").etat, "coupee");
    assert.equal(m2.enCours("c2"), false, "pas de relance toute seule");
    const f2 = m2.fini("c2");
    assert.equal(m2.repondre("c2", msg("Laisse tomber le sleep. Quel est le mot-code ?")).mode, "lance");
    await f2;
    assert.match(m2.resultats("c2").join(" "), /LOUTRE3/);
    assert.equal(m2.chat("c2").etat, "finie");
  },

  async "4. répondre pile au moment où elle se ferme : rien ne se perd"() {
    nouvelleBase([chat("d"), chat("d2")]);
    let modeApres, modeAvant, dejaApres, dejaAvant;
    const m = moteur({ emit: (e, id, mm) => {
      if (e.type === "result" && id === "d" && !dejaApres) { dejaApres = true; setImmediate(() => { modeApres = mm.repondre("d", msg("Autre question : réponds exactement CERISE.")).mode; }); }
      // juste avant la fin : écrit pendant que Claude finit sa dernière réponse
      if (e.type === "assistant" && id === "d2" && !dejaAvant && e.message.content.some(b => b.type === "text")) { dejaAvant = true; modeAvant = mm.repondre("d2", msg("Autre question : réponds exactement PRUNE.")).mode; }
    } });
    let fini = m.fini("d");
    m.envoyer("d", msg("Réponds juste OK."));
    await fini;
    assert.equal(modeApres, "suite", "arrivé après le résultat : gardé");
    assert.match(m.resultats("d").join(" "), /CERISE/);
    assert.equal(m.resultats("d").length, 2);
    assert.equal(m.chat("d").attente.length, 0);
    assert.equal(m.chat("d").etat, "finie");
    fini = m.fini("d2");
    m.envoyer("d2", msg("Réponds juste OK."));
    await fini;
    console.log("     écrit juste avant la fin : mode", modeAvant, "·", JSON.stringify(m.resultats("d2")));
    const trouves = m.resultats("d2").join(" ").match(/PRUNE/g) || [];
    assert.ok(trouves.length >= 1, "le message a été lu");
    assert.equal((m.chat("d2").attente || []).length, 0);
    assert.equal((m.chat("d2").nonLus || []).length, 0);
  },

  async "5. arrêter une tâche, puis la reprendre : l'arrêt et l'erreur sont remis à zéro"() {
    nouvelleBase([chat("e")]);
    const m = moteur();
    m.envoyer("e", msg("Retiens le mot-code PANDA9. Puis exécute la commande Bash `sleep 60`, puis réponds OK."));
    await m.quand(e => e.type === "assistant" && e.message.content.some(b => b.type === "tool_use"));
    const proc = m.run("e").proc;
    let f = m.finDe("e");
    const t0 = Date.now();
    m.stop("e");
    const fin = await f;
    console.log("     arrêtée en", Date.now() - t0, "ms, code", fin.code);
    assert.equal(fin.etat, "arretee");
    assert.equal(m.chat("e").arrete, true);
    assert.equal(m.chat("e").erreur, null);
    assert.notEqual(proc.exitCode === null && proc.signalCode === null, true, "le processus est parti");
    f = m.fini("e");
    assert.equal(m.repondre("e", msg("On reprend, laisse tomber le sleep. Quel est le mot-code ?")).mode, "lance");
    assert.equal(m.chat("e").arrete, false);
    assert.equal(m.chat("e").erreur, null);
    await f;
    assert.match(m.resultats("e").join(" "), /PANDA9/);
    assert.equal(rappelDansSession(m.chat("e").sessionId), true, "après un arrêt, le rappel de reprise est là");
    assert.equal(m.chat("e").etat, "finie");
    // le minuteur de l'ancien arrêt ne doit pas couper la tâche reprise
    assert.equal(m.enCours("e"), false);
  },

  async "6. refus : sans session, trop ancienne, conflit. Le refus ne modifie rien"() {
    const URL = "https://exemple.test/annonce/1";
    const candidature = `echo 'suivi.py candidature ${URL} preparee'`;
    nouvelleBase([chat("sans"), chat("x"), chat("y"), chat("vieille", { sessionId: "00000000-0000-4000-8000-000000000000", cwd: DIR })]);
    const m = moteur();
    const avant = () => fs.readFileSync(BASE, "utf8");
    let photo = avant();
    let r = m.repondre("sans", msg("Salut"));
    assert.equal(r.ok, false); assert.match(r.error, /pas encore de session/);
    assert.equal(avant(), photo, "tâche sans session : base intacte");
    assert.equal(m.repondable(m.chat("sans")), false);
    r = m.repondre("vieille", msg("Salut"));
    assert.equal(r.ok, false); assert.match(r.error, /trop ancienne/);
    r = m.envoyer("vieille", msg("Salut"));
    assert.equal(r.ok, false); assert.match(r.error, /trop ancienne/, "le champ normal ne promet rien non plus");
    assert.equal(avant(), photo, "tâche trop ancienne : base intacte");
    assert.equal(m.repondable(m.chat("vieille")), false);
    assert.equal(m.repondre("inconnue", msg("Salut")).ok, false);
    // x a préparé une candidature, y travaille sur la même annonce
    let f = m.fini("x");
    m.envoyer("x", msg(`Exécute exactement la commande Bash : ${candidature}\nPuis réponds OK.`));
    await f;
    assert.deepEqual(m.chat("x").objets, [URL], "l'annonce est reconnue dans sa commande");
    const fy = m.fini("y");
    m.envoyer("y", msg(`Exécute exactement la commande Bash : ${candidature}\nPuis exécute la commande Bash \`sleep 15\`, puis réponds OK.`));
    await m.quand((e, id) => id === "y" && e.type === "assistant" && e.message.content.some(b => b.type === "tool_use"));
    await new Promise(res => setTimeout(res, 200));
    assert.deepEqual(m.chat("y").objets, [URL]);
    const xAvant = JSON.stringify(m.chat("x"));
    r = m.repondre("x", msg("Continue."));
    assert.equal(r.ok, false); assert.match(r.error, /travaille déjà sur cette annonce/);
    assert.equal(JSON.stringify(m.chat("x")), xAvant, "conflit : la tâche refusée n'a pas bougé");
    assert.equal(m.enCours("x"), false);
    // et une autre tâche finie, sans objet, qui parle de cette annonce dans son message
    const sansAvant = JSON.stringify(m.chat("sans"));
    const r2 = m.envoyer("sans", msg(`Regarde ${URL}`));
    assert.equal(r2.ok, false); assert.match(r2.error, /travaille déjà/);
    assert.equal(JSON.stringify(m.chat("sans")), sansAvant);
    await fy;
    // y finie : plus de conflit
    const fx = m.fini("x");
    assert.equal(m.repondre("x", msg("Réponds juste CONTINUE.")).mode, "lance");
    await fx;
    assert.match(m.resultats("x").join(" "), /CONTINUE/);
  },

  async "7. la limite tient : une reprise attend son tour dans la même file, sans rien perdre"() {
    nouvelleBase([chat("f"), chat("g")]);
    const m = moteur();
    let f = m.fini("f");
    m.envoyer("f", msg("Retiens le mot-code KOALA1. Réponds juste OK."));
    await f;
    const fg = m.fini("g");
    m.envoyer("g", msg("Exécute la commande Bash `sleep 6`, puis réponds OK."));
    const ff = m.fini("f");
    assert.equal(m.repondre("f", msg("Quel est le mot-code ?")).mode, "file");
    assert.equal(m.enCours("f"), false, "elle attend");
    assert.equal(m.repondre("f", msg("Et réponds aussi le mot TIGRE.")).mode, "file");
    await fg; await ff;
    const res = m.resultats("f").join(" ");
    assert.match(res, /KOALA1/); assert.match(res, /TIGRE/);
    const tours = m.ev.filter(e => e.type === "tour_debut");
    assert.equal(tours.length, 3);
    assert.ok(m.ev.findIndex(e => e.type === "turn_end" && e.chat === "g") < m.ev.findIndex((e, i) => e.type === "tour_debut" && e.chat === "f" && e.reprise));
  },

  async "8. une question en attente : le message y répond, rien sur stdin"() {
    nouvelleBase([chat("h", { sessionId: "x" })]);
    let recu = null;
    const m = moteur({ moteur: { questionDe: c => c.id === "h" ? (t => { recu = t; }) : null } });
    const photo = fs.readFileSync(BASE, "utf8");
    assert.equal(m.envoyer("h", msg("La deuxième")).mode, "question");
    assert.equal(recu, "La deuxième");
    assert.equal(fs.readFileSync(BASE, "utf8"), photo);
  },

  async "9. processus qui plante sans lire : le texte est rendu, avec l'erreur"() {
    nouvelleBase([chat("i")]);
    const m = moteur({ moteur: { bin: path.join(DIR, "existe-pas") } });
    const q = m.quand(e => e.type === "rendu");
    m.envoyer("i", msg("Mon texte important"));
    const e = await q;
    assert.deepEqual(e.textes, ["Mon texte important"]);
    assert.match(e.raison, /non transmis/);
    assert.equal(m.chat("i").etat, "plantee");
    assert.equal(m.enCours("i"), false);
  },

  async "10. message non lu au redémarrage : il repart tout seul ; celui de la veille non"() {
    nouvelleBase([chat("j", { attente: [msg("Réponds exactement VIOLETTE.")] }), chat("k", { attente: [{ ...msg("veille"), auto: true }] })]);
    const m = moteur({ demarrer: false });
    const f = m.fini("j");
    m.demarrer();
    await f;
    assert.match(m.resultats("j").join(" "), /VIOLETTE/);
    assert.equal(m.enCours("k"), false);
    assert.equal(m.chat("k").attente.length, 0);
  },
};

// Un appel qui ne répond jamais vide la boucle de Node : sans ce garde-fou, le script sortirait en silence avec le code 0.
let termine = false;
process.on("exit", () => { if (!termine) { console.log("ÉCHEC : les tests se sont arrêtés avant la fin (un appel à Claude Code n'a jamais répondu)"); process.exitCode = 1; } });

(async () => {
  const qui = process.argv.slice(2);
  let ko = 0;
  for (const [nom, t] of Object.entries(TESTS)) {
    if (qui.length && !qui.includes(nom.split(".")[0])) continue;
    const t0 = Date.now();
    try { await t(); console.log(`ok   ${nom} (${Math.round((Date.now() - t0) / 1000)} s)`); }
    catch (err) { ko++; console.log(`ÉCHEC ${nom}\n     ${err.message}\n${(err.stack || "").split("\n").slice(1, 4).join("\n")}`); }
  }
  // Rien ne reste : ni la base, ni les sessions de test
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.rmSync(PROJET, { recursive: true, force: true });
  console.log(ko ? `${ko} échec(s)` : "tout est passé");
  termine = true;
  process.exit(ko ? 1 : 0);
})();
