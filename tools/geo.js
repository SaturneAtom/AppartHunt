// Coordonnées approximatives (centre du quartier ou de la commune) pour placer les annonces sur la carte.
// Elles viennent de la zone de recherche (zone.json, voir tools/zone.js) : le premier quartier placé qui correspond, sinon la commune.
const zone = require("./zone");

let z = null;
function locate(text) {
  z = z || zone.load();
  return zone.locate(z, text || "");
}

module.exports = { locate };
