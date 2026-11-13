// Veille : les sources d'annonces lues sans l'agent, et le tri d'office de ce qui ne peut pas convenir.
// Module sans Electron (testable seul : node app/veille.js) ; main.js s'en sert à chaque passage.
//
// - Bien'ici : son API publique (realEstateAds.json), pas besoin de navigateur.
// - Leboncoin : lu par main.js dans un onglet invisible (agent-browser.scanSearch), puis passé ici.
// - Alertes : bail étudiant ou mobilité, saisonnier, colocation, rez-de-chaussée, au-dessus du budget, DPE G.
//   Ce sont des mots-clés, ils peuvent se tromper : l'annonce reste dans la liste, avec son alerte, et c'est toi qui tries.
//   Seules les demandes ou échanges de logement sont mis de côté : ce ne sont pas des appartements.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// Les communes suivies (codes Leboncoin, zoneIds Bien'ici) viennent de la zone de recherche : zone.json, voir tools/zone.js
const zone = require("../tools/zone");
const urlLeboncoin = (communes, budgetMax) => "https://www.leboncoin.fr/recherche?category=10&locations=" + communes.map(encodeURIComponent).join(",")
  + "&real_estate_type=1,2&rooms=1-3&price=min-" + (budgetMax || 1000) + "&sort=time&order=desc";

const slug = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function bienici(budgetMax = 1000, z = zone.load()) {
  const filters = { size: 100, from: 0, filterType: "rent", propertyType: ["flat", "house"], maxPrice: budgetMax, minRooms: 1, maxRooms: 3,
    sortBy: "publicationDate", sortOrder: "desc", onTheMarket: [true], zoneIdsByTypes: { zoneIds: zone.zonesBienici(z) } };
  if (!filters.zoneIdsByTypes.zoneIds.length) return [];
  const r = await fetch("https://www.bienici.com/realEstateAds.json?filters=" + encodeURIComponent(JSON.stringify(filters)), { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("Bien'ici a répondu " + r.status);
  const j = await r.json();
  return (j.realEstateAds || []).map(a => ({
    cle: "bienici:" + a.id, source: "Bien'ici",
    url: `https://www.bienici.com/annonce/location/${slug(a.city)}/${a.propertyType === "house" ? "maison" : "appartement"}/${a.roomsQuantity || 1}pieces/${a.id}`,
    titre: a.title || "", texte: (a.description || "").slice(0, 1500), prix: a.price ?? null, img: (a.photos || [])[0]?.url || "",
    parking: !!a.parkingPlacesQuantity, ville: a.city || "", quartier: a.district?.name || "",
    m2: a.surfaceArea ?? null, pieces: a.roomsQuantity ?? null, etage: a.floor ?? null, meuble: a.isFurnished ?? null,
    dpe: a.energyClassification || null, date: a.publicationDate || "",
    // de quoi faire la fiche sans ouvrir la page
    fiche: {
      photos: (a.photos || []).map(p => p.url).filter(Boolean),
      description: a.description || "",
      details: Object.fromEntries([
        ["Loyer charges comprises", a.price != null && `${a.price} €`], ["Charges", a.charges != null && `${a.charges} €`],
        ["Surface", a.surfaceArea && `${a.surfaceArea} m²`], ["Pièces", a.roomsQuantity], ["Chambres", a.bedroomsQuantity],
        ["Étage", a.floor === 0 ? "rez-de-chaussée" : a.floor], ["Meublé", a.isFurnished === true ? "Oui" : a.isFurnished === false ? "Non" : null],
        ["Classe énergie", a.energyClassification], ["GES", a.greenhouseGazClassification], ["Chauffage", a.heating],
        ["Parking", a.parkingPlacesQuantity ? `${a.parkingPlacesQuantity} place(s)` : null], ["Honoraires", a.agencyRentalFee != null && `${a.agencyRentalFee} €`],
        ["Publiée le", (a.publicationDate || "").slice(0, 10)], ["Annonceur", a.accountType === "agency" ? "Agence" : a.accountType ? "Particulier" : null],
        ["Adresse ou quartier", [a.district?.name, a.city, a.postalCode].filter(Boolean).join(", ")],
      ].filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")),
    },
  }));
}

// Leboncoin : la carte telle que la lit scanSearch → même forme que Bien'ici
function depuisLeboncoin(a) {
  const at = a.attrs || {};
  return { cle: "lbc:" + a.id, source: "Leboncoin", url: "https://www.leboncoin.fr/ad/locations/" + a.id, titre: a.titre || "", texte: a.body || "", img: a.img || "",
    prix: a.prix, ville: a.ville, quartier: a.quartier, m2: parseFloat(at.square) || null, pieces: +at.rooms || null,
    // étage : « Rez-de-chaussée » → 0, un nombre → ce nombre, rien ou « non communiqué » → inconnu (jamais un rez-de-chaussée par défaut)
    etage: /rez/i.test(String(at.floor_number ?? "")) ? 0 : /\d/.test(String(at.floor_number ?? "")) ? parseInt(String(at.floor_number).match(/\d+/)[0], 10) : null,
    meuble: /non meubl/i.test(at.furnished || "") ? false : /meubl/i.test(at.furnished || "") ? true : null, dpe: at.energy_rate || null, date: a.date || "" };
}

// Ce qui ne peut pas convenir, d'après ses critères (recherche.md → profil.json) : un motif, ou null
function motifDOffice(x, profil = {}) {
  const t = `${x.titre} ${x.texte}`;
  if (/\b(je|nous) (recherche|cherche)|recherche (un |une )?(appartement|logement|studio|t[1-3])|échange (de |d')?(logement|appartement)|echange appartement/i.test(t)) return "c'est une demande ou un échange de logement, pas une offre";
  if (/étudiant|etudiant|bail mobilit|bail de mobilit|studapart|réservé aux? (jeunes|alternants)/i.test(t)) return "bail étudiant ou mobilité";
  if (/colocation|coloc\b|chambre (à louer|dans|chez)/i.test(t)) return "colocation ou chambre";
  if (/saisonni|location de vacances|courte durée|de septembre à juin|jusqu'(en|au) (juin|mai|juillet)|bail de [1-9] mois|\b[1-9] mois maximum|sous-location/i.test(t)) return "location saisonnière ou de courte durée";
  if (profil.indispensable?.pas_rez_de_chaussee !== false && (x.etage === 0 || /rez-de-chauss|\brdc\b/i.test(t))) return "rez-de-chaussée";
  if (profil.budget_max && x.prix > profil.budget_max) return `${x.prix} €, au-dessus de ton maximum (${profil.budget_max} €)`;
  if (profil.indispensable?.pas_dpe_g !== false && /^G$/i.test(x.dpe || "")) return "DPE G";
  return null;
}

// Clé d'une annonce déjà connue (liste, fiches) : « lbc:<numéro> » ou « bienici:<id> »
function cleDe(url) {
  const u = String(url);
  const l = u.match(/leboncoin\.fr\/(?:ad\/)?[a-z_]+\/(\d{6,})/); if (l) return "lbc:" + l[1];
  const b = u.match(/bienici\.com\/annonce\/.*\/([^/?#]+)$/); if (b) return "bienici:" + b[1];
  return null;
}

// La carte de la liste (même format que tools/ajout.py), pour qu'une annonce vue arrive tout de suite dans ta liste
function carte(x, profil = {}, motif = null, z = null) {
  const t = `${x.titre} ${x.texte}`;
  const etage = x.etage === 0 ? "rez-de-chaussée" : x.etage ? `${x.etage}${x.etage === 1 ? "er" : "e"} ét.` : null;
  const parking = x.parking || /parking|garage|box|stationnement/i.test(t), ext = (t.match(/terrasse|balcon|jardin/i) || [])[0];
  const c = { site: x.source, fav: false, p: Math.round(x.prix) || null, u: x.url, img: x.img || "",
    w: [x.ville, x.quartier && x.quartier !== x.ville && x.quartier.length <= 30 ? x.quartier : null].filter(Boolean).join(" — ") || x.titre.slice(0, 40),
    f: [x.m2 && `${String(Math.round(x.m2 * 10) / 10).replace(".", ",")} m²`, x.pieces && `${x.pieces} p.`, etage,
      x.meuble === false ? "non meublé" : x.meuble === true ? "meublé" : null, x.dpe && `DPE ${x.dpe}`].filter(Boolean).join(" · "),
    pro: [parking && "parking", ext && ext.toLowerCase(), x.meuble === false && "non meublé"].filter(Boolean).join(", "),
    con: motif || "" };
  try { c.s = Math.round(require("./score").quickScore({ ...c, m2: x.m2, parking, outdoor: !!ext, furnished: x.meuble }, profil, z)); } catch { c.s = 50; }
  if (motif && !/au-dessus/.test(motif)) c.s = Math.min(c.s, 40);
  return c;
}

const pasUneOffre = motif => /^c'est une demande/.test(motif || "");

module.exports = { bienici, depuisLeboncoin, motifDOffice, pasUneOffre, cleDe, carte, urlLeboncoin };

// node app/veille.js : essaie Bien'ici et montre le tri d'office
if (require.main === module) {
  bienici(1000).then(ads => {
    console.log(ads.length, "annonces Bien'ici");
    for (const a of ads) console.log((motifDOffice(a, { budget_max: 1000, indispensable: { pas_rez_de_chaussee: true, pas_dpe_g: true } }) || "→ à lire").padEnd(48), a.prix, "€", a.m2, "m²", a.ville, "|", a.titre.slice(0, 50));
  }).catch(e => console.error(e.message));
}
