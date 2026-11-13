// Tâches : chaque chat est une tâche qui lance Claude Code (claude -p, stream-json) et avec laquelle on peut toujours parler.
// - En cours : le message est écrit sur son entrée, Claude le lit à sa prochaine étape, dans le même tour.
// - Finie, arrêtée, plantée, coupée par la fermeture de l'appli : elle reprend avec --resume, depuis le même dossier et avec les mêmes options.
// - Ce qui n'a pas été lu n'est jamais perdu : Claude renvoie chaque message lu (--replay-user-messages) ; ce qui reste sans accusé
//   à la fin du processus repart dans une reprise ; si ce n'est pas possible, le texte est rendu à l'utilisateur.
// Tout l'état utile est enregistré avec le chat (chats.json), pour survivre à un redémarrage : rien ne vit seulement en mémoire.
// Module sans Electron : main.js le branche sur la fenêtre, tests/ le lance seul sur une base à part.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const LIMITE = 1;                    // tâches en même temps : l'agent travaille dans un chat à la fois
const PAUSE_LONGUE = 30 * 60e3;      // au-delà, les choses ont pu changer : le rappel de reprise revient
const MUET_APRES_FIN = 60e3;         // stdin fermé et plus rien depuis une minute : le processus est coupé
const CANDIDATURE = /postul|candidat|envoi|envoy|message au propri|contacte/i;
const urlsDe = t => [...new Set(String(t || "").match(/https?:\/\/[^\s"'<>)\]]+/g) || [])].map(u => u.replace(/[.,;:!?]+$/, ""));

// Les annonces sur lesquelles un événement de Claude fait une action à ne pas faire deux fois : candidature, favori, message
function objetsDe(ev) {
  const out = [];
  if (ev.type !== "assistant") return out;
  for (const b of ev.message?.content || []) {
    if (b.type !== "tool_use") continue;
    const cmd = String(b.input?.command || "");
    if (/suivi\.py\s+candidature/.test(cmd)) out.push(...urlsDe(cmd));
    const m = cmd.match(/\bal\s+tool\s+(like_listing|propose_application)\s+'?(\{.*?\})/);
    if (m) try { const id = JSON.parse(m[2]).listing_id; if (id) out.push("annonce:" + id); } catch { /* commande mal formée */ }
  }
  return out;
}

function creer({ store, options, cwd, env = process.env, emit = () => {}, consigneReprise, surEvenement = () => {}, questionDe = () => null, config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), bin = "claude", muetApresFin = MUET_APRES_FIN }) {
  const runs = new Map();            // id du chat → processus vivant
  const file = [];                   // chats qui attendent leur tour, dans l'ordre
  let ouvert = false;                // false tant que les outils de l'agent ne sont pas prêts

  const refus = error => ({ ok: false, error });
  const sessionExiste = c => !!c.sessionId && fs.existsSync(path.join(config, "projects", (c.cwd || cwd).replace(/[^a-zA-Z0-9]/g, "-"), c.sessionId + ".jsonl"));
  const enAttente = c => file.includes(c.id);
  const repondable = c => runs.has(c.id) || enAttente(c) || sessionExiste(c);

  // Une autre tâche, en train de tourner, agit déjà sur la même annonce ?
  function conflitDe(c, texte) {
    const a = new Set([...(c.objets || []), ...urlsDe(texte)]);
    for (const r of runs.values()) {
      if (r.chat.id === c.id) continue;
      const commun = (r.chat.objets || []).find(o => a.has(o));
      if (commun) return { titre: r.chat.titre, objet: commun };
    }
    return null;
  }

  const ecrire = (r, prompt) => r.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
  const noterObjets = (c, m) => { if (CANDIDATURE.test(m.demande)) { const u = urlsDe(m.demande); if (u.length) c.objets = [...new Set([...(c.objets || []), ...u])]; } };

  // Le message d'un utilisateur (ou de la veille, ou d'une autre tâche) vers une tâche
  // m = { demande : ce qu'on affiche, prompt : ce que Claude reçoit, auto : ne pas le garder au redémarrage, de : autre tâche }
  function envoyer(id, m) {
    const c = store.get(id);
    if (!c) return refus("Cette conversation n'existe plus.");
    const q = questionDe(c);          // elle attend une réponse à sa question : c'est celle-là
    if (q) { q(m.demande); return { ok: true, mode: "question" }; }
    const r = runs.get(id);
    if (r && !r.fermeture && !r.stopDemande) {      // en cours : elle le lit à sa prochaine étape
      r.nonLus.push(m); c.nonLus = r.nonLus; noterObjets(c, m); if (m.de) r.transmis = true; if (!m.auto) r.auto = false; store.save();
      try { ecrire(r, m.prompt); } catch (err) { /* processus tombé : le message reste non lu, la fin du processus s'en occupe */ }
      return { ok: true, mode: "lu" };
    }
    if (!r && !enAttente(c) && c.sessionId && !sessionExiste(c)) return refus("Cette conversation est trop ancienne pour reprendre : Claude Code n'a plus sa session. Ouvre une nouvelle conversation.");
    if (!r) {                          // une reprise : refusée, elle ne doit rien modifier
      const x = conflitDe(c, m.demande);
      if (x) return refus(`« ${x.titre} » travaille déjà sur cette annonce (${x.objet}). Attends qu'elle ait fini, ou réponds-lui plutôt à elle.`);
    }
    (c.attente = c.attente || []).push(m); noterObjets(c, m);
    c.maj = Date.now(); c.arrete = false; c.erreur = null;
    if (r) { r.stopDemande = false; store.save(); return { ok: true, mode: "suite" }; }   // pile à la fin : gardé, repris juste après
    if (!enAttente(c)) file.push(id);
    store.save();
    const lance = pompe().includes(id);
    return { ok: true, mode: lance ? "lance" : "file" };
  }
  // Répondre à une tâche : elle doit pouvoir reprendre, sinon on refuse sans rien toucher
  function repondre(id, m) {
    const c = store.get(id);
    if (!c) return refus("Cette conversation n'existe plus.");
    if (!repondable(c)) return refus(c.sessionId ? "Cette conversation est trop ancienne pour reprendre : Claude Code n'a plus sa session." : "Cette conversation n'a pas encore de session à reprendre.");
    return envoyer(id, m);
  }

  // Lance ce qui attend, dans la limite. Rend les chats lancés.
  function pompe() {
    const lances = [];
    if (!ouvert) return lances;
    while (runs.size < LIMITE && file.length) {
      const id = file.shift(), c = store.get(id);
      if (c && c.attente?.length && lancer(c)) lances.push(id);
    }
    return lances;
  }

  function rendre(c, messages, raison) {
    const textes = messages.filter(m => !m.auto).map(m => m.demande);
    if (textes.length) emit({ type: "rendu", textes, raison }, c.id);
  }

  function lancer(c) {
    // plusieurs messages en attente partent ensemble : Claude n'accusera réception que d'un seul
    const messages = c.attente.length === 1 ? c.attente : [{ demande: c.attente.map(m => m.demande).join("\n\n"), prompt: c.attente.map(m => m.prompt).join("\n\n"),
      ...(c.attente.every(m => m.auto) ? { auto: true } : {}), ...(c.attente.some(m => m.de) ? { de: c.attente.find(m => m.de).de } : {}) }];
    c.attente = [];
    const reprise = !!c.sessionId;
    let args, prompt;
    try {
      if (reprise && !sessionExiste(c)) throw new Error("Cette conversation est trop ancienne pour reprendre : Claude Code n'a plus sa session.");
      prompt = messages[0].prompt;
      // la suite normale d'une conversation n'a pas besoin de ce rappel : seulement après une coupure, un arrêt, un plantage, ou une longue pause
      if (reprise && (c.etat !== "finie" || Date.now() - (c.finLe || 0) > PAUSE_LONGUE)) prompt = consigneReprise() + "\n\n" + prompt;
      args = [...options(c), ...(reprise ? ["--resume", c.sessionId] : [])];
    } catch (err) {
      c.etat = "plantee"; c.erreur = err.message; store.save();
      rendre(c, messages, err.message);
      return false;
    }
    c.cwd = c.cwd || cwd;
    c.etat = "en_cours"; c.arrete = false; c.erreur = null; c.maj = Date.now();
    const r = { chat: c, nonLus: messages, proc: spawn(bin, args, { cwd: c.cwd, env }), fermeture: false, stopDemande: false, vu: false, finie: false, erreurs: "", resultat: null, transmis: messages.some(m => m.de), auto: messages.every(m => m.auto), essais: c.essais || 0 };
    c.nonLus = r.nonLus;
    runs.set(c.id, r);
    store.save();
    emit({ type: "tour_debut", textes: messages.map(m => m.demande), reprise }, c.id);
    let buf = "";
    r.proc.stdin.on("error", () => { /* processus déjà parti : géré à sa fin */ });
    r.proc.stdout.on("data", chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        evenement(r, ev);
      }
    });
    r.proc.stderr.on("data", d => { r.erreurs = (r.erreurs + d).slice(-2000); });
    r.proc.on("close", code => fin(r, code));
    r.proc.on("error", err => { r.erreurs = err.message; fin(r, -1); });
    try { ecrire(r, prompt); } catch { /* idem */ }
    return true;
  }

  function evenement(r, ev) {
    const c = r.chat;
    r.vu = true;
    if (ev.session_id && ev.session_id !== c.sessionId) { c.sessionId = ev.session_id; store.save(); }
    if (ev.type === "user" && ev.isReplay) {         // Claude a lu ce message
      const c0 = ev.message?.content, lu = typeof c0 === "string" ? c0 : Array.isArray(c0) ? c0.map(b => b.text || "").join("\n") : "";
      for (let i = r.nonLus.length - 1; i >= 0; i--) if (lu.includes(r.nonLus[i].prompt)) r.nonLus.splice(i, 1);   // Claude peut en lire plusieurs d'un coup
      r.essais = 0; c.essais = 0; store.save();
      return;
    }
    const obj = objetsDe(ev);
    if (obj.length) { c.objets = [...new Set([...(c.objets || []), ...obj])]; store.save(); }
    surEvenement(r, ev);
    emit(ev, c.id);
    if (ev.type === "result") {
      c.resultat = String(ev.result ?? ""); r.resultat = ev;
      if (ev.total_cost_usd != null) c.cout = Math.max(c.cout || 0, ev.total_cost_usd);   // il compte déjà ce qui précède la reprise : le maximum, pas la somme
      store.save();
      if (!r.fermeture) { r.fermeture = true; try { r.proc.stdin.end(); } catch { /* déjà fermé */ } }   // sinon le processus ne s'arrête jamais
    }
    if (r.fermeture) { clearTimeout(r.muet); r.muet = setTimeout(() => { if (!r.finie) r.proc.kill(); }, muetApresFin); }
  }

  function fin(r, code) {
    if (r.finie) return; r.finie = true;
    clearTimeout(r.muet); clearTimeout(r.tueur);
    const c = r.chat;
    if (runs.get(c.id) === r) runs.delete(c.id);
    const nonLus = r.nonLus.splice(0);
    const echec = !r.stopDemande && (!r.resultat || r.resultat.is_error);
    c.arrete = r.stopDemande;
    c.etat = r.stopDemande ? "arretee" : echec ? "plantee" : "finie";
    c.finLe = Date.now();
    c.erreur = echec ? (r.resultat ? String(r.resultat.result || "") : r.erreurs.trim()) || `Claude Code s'est arrêté (code ${code}).` : null;
    c.nonLus = [];
    if (nonLus.length) {
      if (r.stopDemande) rendre(c, nonLus, "Tu l'as arrêté avant qu'il ait lu ce message.");
      else if (!r.vu || r.essais >= 1) { rendre(c, nonLus, "Message non transmis : " + (c.erreur || "Claude Code s'est arrêté avant de le lire.")); c.essais = 0; }
      else { c.attente = [...nonLus, ...(c.attente || [])]; c.essais = r.essais + 1; }
    }
    const suite = !!c.attente?.length;
    if (suite && !enAttente(c)) file.unshift(c.id);
    store.save();
    surEvenement(r, { type: "fin", code, erreur: c.erreur });
    emit({ type: "turn_end", code, etat: c.etat, error: c.etat === "plantee" && !suite && !r.resultat ? c.erreur : undefined, suite: suite || file.length > 0 }, c.id);
    pompe();
  }

  // Arrêter (Échap) : on interrompt le tour sans tuer la session ; si elle ne répond pas, on la coupe. Elle reprendra au message suivant.
  function stop(id) {
    const r = id ? runs.get(id) : [...runs.values()][0];
    if (!r) return false;
    r.stopDemande = true;
    try { r.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: "stop-" + Date.now(), request: { subtype: "interrupt" } }) + "\n"); } catch { /* déjà fermé */ }
    r.tueur = setTimeout(() => { if (!r.finie) r.proc.kill("SIGINT"); }, 4000);
    return true;
  }

  // Au démarrage : ce qui tournait a été coupé par la fermeture. Les messages de l'utilisateur pas encore lus repartent ; le reste attend qu'on lui réponde.
  function demarrer() {
    const coupees = [];
    for (const c of store.liste()) {
      if (c.etat === "en_cours") { c.etat = "coupee"; coupees.push(c); }
      const reste = [...(c.nonLus || []), ...(c.attente || [])].filter(m => !m.auto);
      c.nonLus = []; c.attente = reste;
      if (reste.length && !file.includes(c.id)) file.push(c.id);
    }
    store.save();
    ouvert = true;
    pompe();
    return coupees;
  }

  const actif = () => [...runs.values()][0] || null;
  const oublier = id => { const i = file.indexOf(id); if (i >= 0) file.splice(i, 1); };
  const couper = () => { for (const r of runs.values()) r.proc.kill(); };
  // Les tâches pour la conversation générale : identifiant, état, résultat entier
  const taches = () => store.liste().filter(c => c.sessionId || runs.has(c.id) || enAttente(c)).map(c => ({
    id: c.id, titre: c.titre, etat: runs.has(c.id) ? "en_cours" : enAttente(c) ? "en_attente" : c.etat || "finie",
    repondable: repondable(c), resultat: c.resultat || null, erreur: c.erreur || null, cout: c.cout ?? null, maj: c.maj }));
  return { envoyer, repondre, stop, demarrer, actif, oublier, couper, repondable, taches, enCours: id => runs.has(id), run: id => runs.get(id) };
}

module.exports = { creer, objetsDe, urlsDe, LIMITE };
