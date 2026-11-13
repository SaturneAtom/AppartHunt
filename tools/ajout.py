"""Ajoute un lot d'annonces à la liste (la base, puis selection.html) et au journal annonces.md.

Usage : python3 tools/ajout.py lot.json "Titre de la passe" "Résumé d'une ligne"
lot.json : liste d'objets {s, site, fav, p, w, f, pro, con, img, u}
  - site Leboncoin : img peut être le hash de l'image (40 caractères hexa)
"""
import json
import os
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent                       # le code
ws = pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or root / "ma-recherche")   # le dossier de recherche
import tempfile
_lot = pathlib.Path(sys.argv[1]).resolve()   # un .json du dossier de recherche (ou un lot temporaire de l'appli), rien d'autre
if _lot.suffix != ".json" or not (_lot.is_relative_to(ws.resolve()) or (_lot.parent == pathlib.Path(tempfile.gettempdir()).resolve() and _lot.name.startswith("apparthunt-"))):
    sys.exit(f"Fichier refusé : {_lot} (seulement un .json du dossier de recherche)")
lot = json.loads(_lot.read_text())
titre, resume = sys.argv[2], sys.argv[3]

subprocess.run(["node", str(root / "tools" / "append.js"), str(pathlib.Path(sys.argv[1]).resolve())], cwd=ws, check=True)

# Journal lisible des passages (non versionné)
md = ws / "annonces.md"
t = md.read_text() if md.exists() else "# Journal des recherches\n\n"
n = max([int(x) for x in re.findall(r"^\| (\d+) \|", t, re.M)] or [0]) + 1
done = max([int(x) for x in re.findall(r"## Recherche n°(\d+)", t)] or [0]) + 1
rows = [f'| {n + k} | {a["w"]} | {a["p"]} € | {a["f"].replace(" · ", ", ")} | ≈ {a["s"]} | [{a["site"]}]({a["u"]}) | '
        f'{"♥ favori " + a["site"] if a.get("fav") else "🆕"} |' for k, a in enumerate(lot)]
sec = (f"## Recherche n°{done} — {titre}\n\n{resume}\n\n"
       "| # | Ville / quartier | Loyer | Surface | Note | Source | Statut |\n|---|---|---|---|---|---|---|\n"
       + "\n".join(rows) + "\n\n")
head, sep, rest = t.partition("## Recherche n°")
md.write_text(head + sec + (sep + rest if sep else ""))
print(f"{len(lot)} annonces ajoutées (recherche n°{done})")
