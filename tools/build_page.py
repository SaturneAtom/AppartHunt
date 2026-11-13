"""Fabrique selection.html à partir du modèle, des annonces et de « Mes contraintes et choix ».

    python3 tools/build_page.py

Sources (ton dossier de recherche d'abord, sinon les exemples du projet) :
- les annonces de la base ou examples/annonces.example.json
- recherche.md            ou examples/recherche.example.md
- profil.json             ou examples/profil.example.json
- zone.json               ou examples/zone.example.json
selection.html est généré dans le dossier de recherche : il n'est jamais versionné (il contient tes annonces).
"""
import html
import json
import os
import pathlib
import re

import donnees as base

root = pathlib.Path(__file__).resolve().parent.parent                       # le code (modèle, exemples)
ws = pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or root / "ma-recherche")   # le dossier de recherche


def pick(own: str, example: str) -> pathlib.Path:
    p = ws / own
    return p if p.exists() else root / "examples" / example


def inline(text: str) -> str:
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html.escape(text))


def render(md: str) -> str:
    out, in_list = [], False
    for line in md.splitlines():
        if line.startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(line[2:])}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if line.startswith("## "):
            out.append(f"<h3>{inline(line[3:])}</h3>")
        elif line.startswith("# "):
            out.append(f"<h2>{inline(line[2:])}</h2>")
        elif line.strip():
            out.append(f"<p>{inline(line)}</p>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


def js(obj) -> str:
    """JSON à poser dans une balise <script> : un texte d'annonce ne doit jamais pouvoir la fermer."""
    return (json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def main():
    annonces = base.annonces(base.connect()) or json.loads((root / "examples" / "annonces.example.json").read_text(encoding="utf-8"))
    doc = render(pick("recherche.md", "recherche.example.md").read_text(encoding="utf-8"))
    profil = json.loads(pick("profil.json", "profil.example.json").read_text(encoding="utf-8"))
    zone = json.loads(pick("zone.json", "zone.example.json").read_text(encoding="utf-8"))
    contraintes = (f'<template id="doctpl">\n{doc}\n</template>\n'
                   f'<script id="profil">window.PROFIL = {js(profil)};\n'
                   f'window.ZONE = {js(zone)};</script>')
    donnees = ('<script id="data">\nwindow.ANNONCES = [\n'
               + ",\n".join(js(a) for a in annonces) + "\n];\n</script>")
    page = (root / "page" / "template.html").read_text(encoding="utf-8")
    page = page.replace("%%CONTRAINTES%%", contraintes).replace("%%DONNEES%%", donnees)
    page = page.replace("%%ZONE%%", html.escape(zone.get("nom") or "Ta zone"))
    (ws / "selection.html").write_text(page, encoding="utf-8")
    print(f"selection.html généré ({len(annonces)} annonces)")


if __name__ == "__main__":
    main()
