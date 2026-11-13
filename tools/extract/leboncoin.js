// Extraction complète d'une fiche Leboncoin, à exécuter dans la page de l'annonce (Claude in Chrome, javascript_tool).
// Lit le JSON que la page embarque déjà (__NEXT_DATA__) : aucune requête supplémentaire vers le site.
// Renvoie une chaîne JSON compacte ; les photos sont données par leur empreinte (40 caractères),
// tools/save_fiche.py les retransforme en URL complètes.
(() => {
  const ad = JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps.ad;
  const details = {};
  for (const a of ad.attributes || []) {
    const k = a.key_label || a.key, v = a.value_label || a.value;
    // les clés techniques (district_id, store_logo, …) n'ont pas de libellé : on ne garde que ce qui se lit
    if (k && v != null && v !== "" && !/^[a-z0-9_]+$/.test(k) && !/^(Référence|lbc_|ad_)/i.test(k)) details[k] = String(v);
  }
  const store = (ad.attributes || []).find(a => a.key === "store_name");
  const loc = ad.location || {};
  details["Loyer charges comprises"] = (ad.price || [])[0] != null ? ad.price[0] + " €" : undefined;
  details["Adresse"] = [loc.district, loc.city, loc.zipcode].filter(Boolean).join(", ") || undefined;
  details["Annonceur"] = ad.owner ? `${ad.owner.type === "pro" ? "Agence" : "Particulier"}${(store?.value || ad.owner.name) ? " : " + (store?.value || ad.owner.name) : ""}` : undefined;
  details["Publiée le"] = (ad.first_publication_date || "").slice(0, 10) || undefined;
  details["Mise à jour"] = (ad.index_date || "").slice(0, 10) || undefined;
  for (const k of Object.keys(details)) if (details[k] === undefined) delete details[k];
  const photos = (ad.images?.urls_large || ad.images?.urls || []).map(u => (u.match(/\/([0-9a-f]{40})\.jpg/) || [])[1]).filter(Boolean);
  return JSON.stringify({
    u: "https://www.leboncoin.fr/ad/locations/" + ad.list_id,
    statut: ad.status,
    photos,
    lat: loc.lat, lng: loc.lng,
    details,
    description: (ad.body || "").replace(/\s+\n/g, "\n").trim().slice(0, 1800),
  });
})()
