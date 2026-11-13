// La zone de recherche (communes, codes des sites, notes des quartiers, positions sur la carte).
// Lue dans zone.json du dossier de recherche, sinon dans examples/zone.example.json : aucun lieu n'est écrit dans le code.
// Module sans Electron : le serveur de l'appli, la veille et les outils s'en servent.
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const plain = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’`]/g, "'").toLowerCase();

function fichier(ws = process.env.APPARTHUNT_WORKSPACE || path.join(REPO, "ma-recherche")) {
  const own = path.join(ws, "zone.json");
  return fs.existsSync(own) ? own : path.join(REPO, "examples", "zone.example.json");
}

function load(ws) {
  const z = JSON.parse(fs.readFileSync(fichier(ws), "utf8"));
  return { nom: "", centre: null, communes: [], quartiers: [], ...z };
}

const communes = (z, cercle) => z.communes.filter(c => cercle == null || (c.cercle || 1) === cercle);
const commune = (z, nom) => z.communes.find(c => plain(c.nom) === plain(nom));
// « Ville_CodePostal » : le format des lieux dans les recherches Leboncoin
const codesLeboncoin = (z, cercle) => communes(z, cercle).filter(c => c.cp).map(c => `${c.nom}_${c.cp}`);
const zonesBienici = z => z.communes.filter(c => c.bienici).map(c => c.bienici);

// Position approchée d'un lieu (« Commune — Quartier ») : le premier quartier placé qui correspond, sinon la commune
function locate(z, text) {
  for (const q of z.quartiers) if (q.lat != null && new RegExp(q.motif, "i").test(text)) return { city: q.commune || "Autre", lat: q.lat, lng: q.lng };
  const t = plain(text);
  const c = [...z.communes].sort((a, b) => b.nom.length - a.nom.length).find(c => c.lat != null && t.includes(plain(c.nom)));
  return c ? { city: c.nom, lat: c.lat, lng: c.lng } : { city: "Autre", lat: z.centre?.[0] ?? null, lng: z.centre?.[1] ?? null };
}

module.exports = { load, fichier, communes, commune, codesLeboncoin, zonesBienici, locate };
