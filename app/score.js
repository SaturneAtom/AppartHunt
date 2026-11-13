// Note rapide sur 100 d'une annonce jamais lue, avec le barème du profil (profil.json) :
// lieu 30, prix 25, surface 15, état 10, parking 10, extérieur 5, non meublé 5 — compensatoire.
// Sert aux pastilles posées sur les pages de résultats ; l'agent affine ensuite en lisant l'annonce.
(function (root) {
  const has = (list, txt) => (list || []).some(q => txt.toLowerCase().includes(q.toLowerCase()));

  function quickScore(a, P, Z) {   // Z : la zone (zone.json), pour reconnaître les communes du premier cercle
    const w = a.w || "", cible = P.budget_cible || 800, max = P.budget_max || 1000;
    const coeur = ((Z && Z.communes) || []).filter(c => (c.cercle || 1) === 1).map(c => c.nom);
    const lieu = has(P.quartiers_non, w) ? 0 : has(P.quartiers_preferes, w) ? 30 : has(P.quartiers_ok, w) || has(coeur, w) ? 24 : has(P.quartiers_loin, w) ? 17 : 14;
    const prix = a.p <= cible ? 25 : a.p >= max ? 5 : 25 - 20 * (a.p - cible) / (max - cible);
    const m2 = a.m2 || 0;
    const surface = m2 >= 55 ? 15 : m2 >= 45 ? 13 : m2 >= 38 ? 10 : m2 >= 30 ? 7 : 3;
    const etat = /neuf|rénové|refait|récent/i.test(a.f + " " + (a.txt || "")) ? 10 : 8;
    const parking = a.parking ? 10 : 0;
    const exterieur = a.outdoor ? 5 : 0;
    const vide = a.furnished === false ? 5 : a.furnished == null ? 3 : 0;
    return Math.round(lieu + prix + surface + etat + parking + exterieur + vide);
  }

  // Filtres éliminatoires (recherche.md) : bail classique, pas de rez-de-chaussée, pas de DPE G, budget max
  function eliminatoire(a, P) {
    const t = ((a.f || "") + " " + (a.txt || "")).toLowerCase();
    if (a.p > (P.budget_max || 1000)) return `${a.p} €, au-dessus de ton maximum`;
    if (/^chambre\b/i.test((a.txt || "").trim())) return "une chambre, pas un logement entier";
    if (/dpe g\b/.test(t)) return "DPE G";
    if (/rez-de-chauss|\brdc\b/.test(t)) return "rez-de-chaussée";
    if (/bail (de )?mobilit|étudiant|colocation|septembre (à|a) juin|saisonni/.test(t)) return "pas un bail classique";
    return null;
  }

  const api = { quickScore, eliminatoire };
  if (typeof module !== "undefined") module.exports = api; else Object.assign(root, api);
})(this);
