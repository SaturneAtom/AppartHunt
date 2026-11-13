// Doublure de window.apparthunt (preload.js) pour charger le vrai écran dans un navigateur, avec de fausses données.
(() => {
  const cb = { agent: [], question: [] };
  const liste = [
    { id: "gen", titre: "Ma conversation", auto: false, sessionId: "s0", cree: 1, maj: Date.now() - 1000, repondable: true },
    { id: "rech", titre: "Recherche du 3 novembre", auto: false, sessionId: "s1", cree: 2, maj: Date.now() - 5000, repondable: true },
    { id: "old", titre: "Vieille recherche", auto: false, sessionId: "s2", cree: 3, maj: Date.now() - 9000, repondable: false },
  ];
  const etat = { actif: "gen", liste };
  const logs = { rech: '<div class="you">Lance une recherche</div><div class="turn"><div class="answer"><p>J\'ai lu 12 annonces.</p></div></div>' };
  window.__faux = { asks: [], reponse: () => ({ ok: true, mode: "lu" }), stops: 0, emit: (ev, chat) => cb.agent.forEach(f => f(ev, chat)), question: q => cb.question.forEach(f => f(q)), liste, saved: {}, answers: [] };
  const vue = () => ({ ...etat, liste: liste.map(c => ({ ...c })) });
  const rien = () => {};
  window.apparthunt = new Proxy({
    snapshot: async () => ({ listings: [], resumes: {}, choix: { oui: [], non: [] }, ecran: {}, updated: 0, profil: {}, annonces: [] }),
    profil: async () => null,
    ask: async (t, s, chat, o) => { window.__faux.asks.push({ t, chat, o }); return window.__faux.reponse(t, chat, o); },
    agentEtat: async () => ({ actif: null }),
    chats: async () => vue(), newChat: async () => vue(),
    openChat: async id => { etat.actif = id; return vue(); },
    renameChat: async () => vue(), deleteChat: async id => { liste.splice(liste.findIndex(c => c.id === id), 1); return vue(); },
    chatLog: async id => logs[id] || "",
    saveChat: (id, h) => { window.__faux.saved[id] = h; },
    stop: async () => { window.__faux.stops++; return true; },
    onAgent: f => cb.agent.push(f), onQuestion: f => cb.question.push(f),
    answer: (id, t) => window.__faux.answers.push([id, t]),
    veille: async () => ({ active: false, minutes: 30 }),
    activite: async () => [],
    sessions: async () => [["rech", "s1", "Recherche du 3 novembre"], ["old", "s2", "Vieille recherche"], [null, "s3", "Session sans chat"]].map(([chat, id, titre], i) => ({ id, jour: new Date().toLocaleDateString("sv-SE"), debut: Date.now() - 6e5, fin: Date.now() - 6e4 * (i + 1), at: 0, tours: 2, actions: 5, erreurs: 0, resume: "J'ai lu 12 annonces.", pages: 3, titre, chat, actif: false })),
    session: async id => ({ id, titre: "Recherche du 3 novembre", debut: Date.now() - 6e5, fin: Date.now(), modele: "", version: "", cout: null, tours: 1, etapes: [], chat: "rech", actif: false }), sessionsCherche: async () => ({ sessions: [], veille: [] }),
  }, { get: (t, k) => t[k] || (/^on[A-Z]/.test(String(k)) ? rien : async () => null) });
})();
