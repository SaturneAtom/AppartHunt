"""Convertit les lignes compactes relevées dans une page de résultats (window._cmp) en lot pour ajout.py.

Ligne : [note, prix, ville, quartier, pieces, m2, etage, meuble(0/1), dpe, parking(0/1), ext(0/1/2), img, id]
Usage : python3 tools/cmp2lot.py cmp.json lot.json
"""
import json, os, pathlib, sys

# Communes du deuxième cercle de la zone (zone.json du dossier de recherche, sinon l'exemple)
_root = pathlib.Path(__file__).resolve().parent.parent
_zone = pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or _root / "ma-recherche") / "zone.json"
_zone = _zone if _zone.exists() else _root / "examples" / "zone.example.json"
CERCLE_2 = {c["nom"] for c in json.load(open(_zone, encoding="utf-8")).get("communes", []) if c.get("cercle", 1) == 2}
_profil = pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or _root / "ma-recherche") / "profil.json"
CIBLE = json.load(open(_profil, encoding="utf-8")).get("budget_cible", 800) if _profil.exists() else 800

# entrée et sortie : seulement des .json du dossier de recherche (l'agent lance cet outil sans demander)
_ws = (pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or _root / "ma-recherche")).resolve()
def _dans_ws(f):
    f = pathlib.Path(f).resolve()
    if f.suffix != ".json" or not f.is_relative_to(_ws):
        sys.exit(f"Fichier refusé : {f} (seulement un .json du dossier de recherche)")
    return f
ENTREE, SORTIE = _dans_ws(sys.argv[1]), _dans_ws(sys.argv[2])

lot = []
for s, p, city, d, r, sq, fl, m, dpe, park, ext, img, i in json.load(open(ENTREE)):
    typ = {1: " — studio", 3: " — T3"}.get(r, "")
    pro = [x for x in ["parking" if park else "", "terrasse" if ext == 2 else "balcon" if ext == 1 else "",
                       "non meublé" if not m else ""] if x]
    con = [x for x in ["2e cercle" if city in CERCLE_2 else "", "prix" if p > CIBLE + 50 else "",
                       "parking ?" if not park else "", "étage ?" if fl == "" else ""] if x]
    lot.append(dict(s=s, site="Leboncoin", fav=1, p=p, w=city + (" — " + d if d else "") + typ,
                    f=f"{sq:g} m² · {r} p. · ét. {fl or '?'} · {'meublé' if m else 'non meublé'} · DPE {dpe or '?'}",
                    pro=", ".join(pro) or "—", con=" ; ".join(con) or "—", img=img,
                    u=f"https://www.leboncoin.fr/ad/locations/{i}"))
lot.sort(key=lambda x: -x["s"])
json.dump(lot, open(SORTIE, "w"), ensure_ascii=False)
print(len(lot), "annonces")
