// Ajoute un lot d'annonces (JSON) à la liste, dans la base, avec les champs de filtre et la date d'ajout,
// puis régénère selection.html (la page à partager).
//   node tools/append.js lot.json
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { enrich } = require("./enrich");

const DONNEES = path.join(__dirname, "donnees.py");
const LBC = h => `https://img.leboncoin.fr/api/v1/lbcpb1/images/${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}/${h}.jpg?rule=ad-large`;

// un .json du dossier de recherche, ou le lot temporaire de la veille : rien d'autre
const os = require("os");
const WS = path.resolve(process.env.APPARTHUNT_WORKSPACE || path.join(__dirname, "..", "ma-recherche"));
const fichier = fs.realpathSync(path.resolve(process.argv[2] || ""));
const dansWs = fichier.startsWith(fs.realpathSync(WS) + path.sep), lotVeille = path.dirname(fichier) === fs.realpathSync(os.tmpdir()) && path.basename(fichier).startsWith("apparthunt-");
if (!fichier.endsWith(".json") || !(dansWs || lotVeille)) { console.error("Fichier refusé : " + fichier + " (seulement un .json du dossier de recherche)"); process.exit(1); }
const lot = JSON.parse(fs.readFileSync(fichier, "utf8"));
const A = JSON.parse(execFileSync("python3", [DONNEES, "snapshot"], { encoding: "utf8", maxBuffer: 64 << 20 })).listings;
const known = new Set(A.map(a => a.u));
const now = new Date().toISOString().slice(0, 16);
const fresh = lot.filter(a => !known.has(a.u)).map((a, k) => {
  if (a.site === "Leboncoin" && /^[0-9a-f]{40}$/.test(a.img || "")) a.img = LBC(a.img);
  return { ...enrich(a, A.length + k), id: `a${A.length + k}`, added: now };
});
process.stdout.write(execFileSync("python3", [DONNEES, "annonces-ajout", "-"], { input: JSON.stringify(fresh), encoding: "utf8" }));
execFileSync("python3", [path.join(__dirname, "build_page.py")], { stdio: "inherit" });
