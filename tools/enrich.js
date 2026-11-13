// Calcule les champs de filtre d'une annonce à partir de ses textes (w, f, pro, con).
const { locate } = require("./geo");

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

function enrich(a, i) {
  const all = `${a.w} ${a.f} ${a.pro} ${a.con}`;
  const m2 = parseFloat((a.f.match(/([\d]+(?:[.,]\d+)?) m²/) || [, "0"])[1].replace(",", "."));
  const rooms = /maison/i.test(a.w) ? "maison"
    : /studio|1 p\./i.test(all) ? "studio"
    : /T3|3 p\.|T2 bis/i.test(all) && !/T2 bis/i.test(a.w) ? "T3"
    : "T2";
  const geo = locate(a.w);
  // Décalage stable (~150 m) pour que les épingles d'un même quartier ne se superposent pas
  const h = hash(a.u);
  return {
    ...a,
    id: a.id || `a${i}`,
    m2,
    type: rooms,
    furnished: /non meublé/i.test(all) ? false : /meublé/i.test(all) ? true : null,
    parking: /parking|stationnement|garage/i.test(a.pro),
    outdoor: /terrasse|balcon|jardin/i.test(a.pro + " " + a.f),
    city: geo.city,
    lat: geo.lat + ((h % 100) / 100 - 0.5) * 0.003,
    lng: geo.lng + (((h >> 8) % 100) / 100 - 0.5) * 0.004,
    approx: true,
  };
}

module.exports = { enrich };
