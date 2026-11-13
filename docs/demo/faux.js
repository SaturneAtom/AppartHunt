// Données de démonstration pour les captures du README : le vrai écran (app/index.html, app/renderer.js)
// avec des annonces fictives autour de Bordeaux et une conversation jouée. Aucune donnée réelle, aucune photo d'annonce :
// les « photos » sont des pièces dessinées en SVG. Utilisé par docs/demo/captures.py.
(() => {
  /* ---------- Pièces dessinées ---------- */
  const PAL = [
    { mur: "#efe7dc", sol: "#c9a37a", ciel: "#bcd8ea", tissu: "#5f7d6b", bois: "#8a6243" },
    { mur: "#e6ebe8", sol: "#b88b63", ciel: "#cfe3ef", tissu: "#c97b5a", bois: "#6d4c35" },
    { mur: "#f3eee6", sol: "#d8bf9b", ciel: "#c4dcec", tissu: "#3f5d7a", bois: "#9a7253" },
    { mur: "#ebe4ec", sol: "#a98463", ciel: "#d6e7f1", tissu: "#b6a06b", bois: "#5e4130" },
    { mur: "#e9efe9", sol: "#c0976f", ciel: "#c7deeb", tissu: "#8c5a6a", bois: "#7a573d" },
  ];
  function piece(n, sorte) {
    const c = PAL[n % PAL.length], W = 800, H = 560;
    const fenetre = `<rect x="${430 - (n % 3) * 60}" y="70" width="220" height="250" rx="4" fill="${c.ciel}"/><rect x="${430 - (n % 3) * 60}" y="70" width="220" height="250" rx="4" fill="none" stroke="#fff" stroke-width="12"/><line x1="${540 - (n % 3) * 60}" y1="70" x2="${540 - (n % 3) * 60}" y2="320" stroke="#fff" stroke-width="8"/>
      <path d="M${430 - (n % 3) * 60} 300 q60 -40 110 -10 q50 -30 110 0 v20 h-220z" fill="#9fc2a3" opacity=".7"/>`;
    const plante = `<rect x="70" y="330" width="46" height="60" rx="6" fill="${c.bois}"/><ellipse cx="93" cy="300" rx="42" ry="56" fill="#6f9a72"/><ellipse cx="70" cy="320" rx="22" ry="34" fill="#5d8a62"/>`;
    const lampe = `<line x1="700" y1="150" x2="700" y2="390" stroke="#333" stroke-width="4"/><path d="M670 150 h60 l-14 -44 h-32z" fill="#f2d48a"/><ellipse cx="700" cy="392" rx="26" ry="6" fill="#333"/>`;
    const meubles = {
      salon: `<rect x="190" y="300" width="330" height="90" rx="22" fill="${c.tissu}"/><rect x="170" y="330" width="40" height="80" rx="14" fill="${c.tissu}"/><rect x="500" y="330" width="40" height="80" rx="14" fill="${c.tissu}"/><rect x="200" y="400" width="12" height="22" fill="${c.bois}"/><rect x="498" y="400" width="12" height="22" fill="${c.bois}"/>
        <ellipse cx="360" cy="470" rx="110" ry="18" fill="${c.bois}" opacity=".85"/>`,
      chambre: `<rect x="170" y="250" width="22" height="170" rx="6" fill="${c.bois}"/><rect x="190" y="330" width="380" height="80" rx="10" fill="#fff"/><rect x="190" y="350" width="380" height="60" rx="8" fill="${c.tissu}"/><rect x="205" y="305" width="90" height="40" rx="14" fill="#fff"/><rect x="305" y="305" width="90" height="40" rx="14" fill="#fff"/>`,
      cuisine: `<rect x="0" y="300" width="${W}" height="110" fill="${c.bois}"/><rect x="0" y="290" width="${W}" height="16" fill="#e8e2d8"/><rect x="40" y="320" width="150" height="80" rx="4" fill="#fff" opacity=".25"/><rect x="230" y="320" width="150" height="80" rx="4" fill="#fff" opacity=".25"/><rect x="600" y="230" width="60" height="60" rx="30" fill="#d9d2c4"/>`,
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${c.mur}"/>
      <rect y="410" width="${W}" height="150" fill="${c.sol}"/><g opacity=".12" stroke="#000">${Array.from({ length: 9 }, (_, k) => `<line x1="${k * 100}" y1="410" x2="${k * 100 - 60}" y2="560"/>`).join("")}</g>
      ${fenetre}${sorte === "cuisine" ? "" : plante}${sorte === "salon" ? lampe : ""}${meubles[sorte]}</svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  const photos = n => ["salon", "chambre", "cuisine", "salon"].map((s, k) => piece(n + k, s));

  /* ---------- Les annonces ---------- */
  const jour = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 16);
  const A = [
    { u: "https://example.org/annonce/1", site: "Exemple", w: "Bordeaux — Chartrons", p: 760, f: "52 m² · 2 p. · 3e ét. · non meublé · DPE C", pro: "balcon, non meublé", con: "pas de parking", city: "Bordeaux", lat: 44.8536, lng: -0.5711, m2: 52, type: "T2", furnished: false, parking: false, outdoor: true, added: jour(0), s: 88 },
    { u: "https://example.org/annonce/2", site: "Exemple", w: "Le Bouscat — centre", p: 790, f: "48 m² · 2 p. · 2e ét. · non meublé · DPE B", pro: "parking, balcon, non meublé", con: "—", city: "Le Bouscat", lat: 44.8654, lng: -0.6001, m2: 48, type: "T2", furnished: false, parking: true, outdoor: true, added: jour(0), s: 90 },
    { u: "https://example.org/annonce/3", site: "Exemple", w: "Bordeaux — Saint-Seurin", p: 840, f: "45 m² · 2 p. · 4e ét. · meublé · DPE D", pro: "ascenseur", con: "meublé", city: "Bordeaux", lat: 44.8433, lng: -0.5874, m2: 45, type: "T2", furnished: true, parking: false, outdoor: false, added: jour(1), s: 74 },
    { u: "https://example.org/annonce/4", site: "Exemple", w: "Talence — Forum", p: 690, f: "41 m² · 2 p. · 1er ét. · non meublé · DPE C", pro: "parking, non meublé", con: "un peu petit", city: "Talence", lat: 44.8083, lng: -0.5889, m2: 41, type: "T2", furnished: false, parking: true, outdoor: false, added: jour(1), s: 79 },
    { u: "https://example.org/annonce/5", site: "Exemple", w: "Bordeaux — Bastide", p: 720, f: "38 m² · 2 p. · 2e ét. · non meublé · DPE E", pro: "terrasse, non meublé", con: "DPE E", city: "Bordeaux", lat: 44.8424, lng: -0.5562, m2: 38, type: "T2", furnished: false, parking: false, outdoor: true, added: jour(2), s: 66 },
    { u: "https://example.org/annonce/6", site: "Exemple", w: "Bègles — Terres Neuves", p: 650, f: "44 m² · 2 p. · 3e ét. · non meublé · DPE B", pro: "parking, balcon", con: "loin du centre", city: "Bègles", lat: 44.8085, lng: -0.5491, m2: 44, type: "T2", furnished: false, parking: true, outdoor: true, added: jour(3), s: 71 },
    { u: "https://example.org/annonce/7", site: "Exemple", w: "Bordeaux — Saint-Michel — studio", p: 590, f: "29 m² · 1 p. · rez-de-chaussée · meublé · DPE F", pro: "—", con: "rez-de-chaussée, studio", city: "Bordeaux", lat: 44.8334, lng: -0.5702, m2: 29, type: "studio", furnished: true, parking: false, outdoor: false, added: jour(4), s: 31 },
  ].map((a, i) => ({ ...a, id: "d" + i, img: photos(i)[0], approx: true }));

  const fiches = {
    "https://example.org/annonce/1": { note: 9, resume: "Les Chartrons, un de tes quartiers préférés, 52 m² au 3e étage avec balcon, 40 € sous ton budget. Seul vrai manque : pas de parking, mais la rue est en zone résidentielle.",
      pour: ["Les Chartrons, un de tes quartiers préférés", "40 € sous ton budget idéal", "Vraie chambre séparée, 52 m²", "Balcon plein ouest"], contre: ["Pas de parking, c'est important pour toi"],
      details: { "Loyer charges comprises": "760 €", "Charges": "60 €", "Surface": "52 m²", "Pièces": "2", "Étage": "3e sur 4, sans ascenseur", "Meublé": "Non", "Classe énergie": "C", "Dépôt de garantie": "700 €", "Disponible": "1er décembre" },
      description: "Bel appartement de deux pièces dans un immeuble en pierre, au calme. Séjour lumineux ouvert sur un balcon, cuisine équipée, chambre avec placard, salle d'eau avec fenêtre. Bail classique de trois ans. (Annonce fictive.)", photos: photos(0) },
    "https://example.org/annonce/2": { note: 9, resume: "Le Bouscat, dans tes préférés, avec parking et balcon pour 790 €. Coche tout ce qui compte pour toi.", pour: ["Le Bouscat, un de tes préférés", "Parking", "Balcon", "DPE B"], contre: [], photos: photos(1) },
    "https://example.org/annonce/3": { note: 7, resume: "Bien placé, mais meublé et un peu au-dessus de ta cible.", pour: ["Saint-Seurin, un de tes préférés", "Ascenseur"], contre: ["Meublé, tu préfères vide", "40 € au-dessus de ta cible"], photos: photos(2) },
    "https://example.org/annonce/4": { note: 8, resume: "Talence près du tram, parking compris, 690 €. Un peu petit mais très bon rapport qualité-prix.", pour: ["Parking", "110 € sous ton budget"], contre: ["41 m², un peu juste"], photos: photos(3) },
    "https://example.org/annonce/5": { note: 6, resume: "Terrasse et bon prix, mais DPE E et 38 m².", pour: ["Terrasse"], contre: ["DPE E", "38 m²"], photos: photos(4) },
    "https://example.org/annonce/6": { note: 7, resume: "Récent, parking et balcon, mais Bègles est plus loin de ce que tu aimes.", pour: ["Parking", "DPE B"], contre: ["Hors de tes quartiers préférés"], photos: photos(5) },
    "https://example.org/annonce/7": { note: 2, resume: "Rez-de-chaussée et studio : deux de tes refus.", pour: [], contre: ["Rez-de-chaussée", "Studio, pas de vraie chambre"], alerte: "rez-de-chaussée", photos: photos(6) },
  };

  const PROFIL = { budget_cible: 800, budget_max: 1000, types_acceptes: ["T2", "studio", "T3"], type_prefere: "T2", surface_min_studio: 30, veut_chambre_separee: true,
    quartiers_preferes: ["Chartrons", "Saint-Pierre", "Saint-Seurin", "Caudéran", "Le Bouscat"], quartiers_ok: ["Saint-Michel", "Bastide", "Talence", "Bègles"], quartiers_non: ["Belcier"],
    indispensable: { bail_classique: true, pas_rez_de_chaussee: true, pas_dpe_g: true }, important: { parking: true, non_meuble: true }, bonus: { exterieur: true } };
  const ZONE = { nom: "Bordeaux et alentours", centre: [44.84, -0.58], communes: [
    { nom: "Bordeaux", cercle: 1, lat: 44.8378, lng: -0.5792 }, { nom: "Talence", cercle: 1, lat: 44.808, lng: -0.589 }, { nom: "Le Bouscat", cercle: 1, lat: 44.865, lng: -0.599 }, { nom: "Bègles", cercle: 1, lat: 44.808, lng: -0.548 }], quartiers: [] };

  /* ---------- Le pont avec l'appli (comme preload.js) ---------- */
  const cb = {};
  const on = k => f => (cb[k] = cb[k] || []).push(f);
  const liste = [{ id: "rech", titre: "Recherche du jour", auto: false, sessionId: "s1", cree: 1, maj: Date.now(), repondable: true }];
  const snap = { listings: A, resumes: fiches, choix: { oui: ["https://example.org/annonce/2"], non: [] }, journal: [], ecran: {}, profil: PROFIL, zone: ZONE, updated: 1 };
  window.__demo = { emit: (k, ...a) => (cb[k] || []).forEach(f => f(...a)) };
  window.apparthunt = new Proxy({
    snapshot: async () => snap, profil: async () => null,
    chats: async () => ({ actif: "rech", liste }), openChat: async () => ({ actif: "rech", liste }), newChat: async () => ({ actif: "rech", liste }),
    agentEtat: async () => ({ actif: null }), chatLog: async () => "", saveChat: () => {},
    veille: async () => ({ active: true, minutes: 30, prochaine: Date.now() + 22 * 6e4, derniere: Date.now() - 8 * 6e4, message: "3 nouvelles annonces" }),
    activite: async () => [], sessions: async () => [], sessionsCherche: async () => ({ sessions: [], veille: [] }),
    onAgent: on("agent"), onPlan: on("plan"), onProposition: on("proposition"), onQuestion: on("question"), onVeille: on("veille"),
  }, { get: (t, k) => t[k] || (/^on[A-Z]/.test(String(k)) ? () => {} : async () => null) });
})();
