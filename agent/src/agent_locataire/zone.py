"""La zone de recherche : communes, codes des sites, notes des quartiers et positions sur la carte.

Lue dans zone.json du dossier de recherche, sinon dans examples/zone.example.json.
Rien sur un lieu précis n'est écrit dans le code : tout vient de ce fichier.
"""
import json
import os
import re
import unicodedata
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]


def _path() -> Path:
    own = Path(os.environ.get("APPARTHUNT_WORKSPACE") or _ROOT / "ma-recherche") / "zone.json"
    return own if own.exists() else _ROOT / "examples" / "zone.example.json"


def load() -> dict:
    z = json.loads(_path().read_text(encoding="utf-8"))
    z.setdefault("communes", [])
    z.setdefault("quartiers", [])
    return z


def _plain(s: str) -> str:
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def communes(cercle: int | None = None) -> list[str]:
    """Noms des communes de la zone (toutes, ou celles d'un cercle)."""
    return [c["nom"] for c in load()["communes"] if cercle is None or c.get("cercle", 1) == cercle]


def commune(nom: str) -> dict | None:
    return next((c for c in load()["communes"] if _plain(c["nom"]) == _plain(nom)), None)


def code_leboncoin(nom: str) -> str | None:
    """« Ville_CodePostal », le format des lieux dans les recherches Leboncoin."""
    c = commune(nom)
    return f"{c['nom']}_{c['cp']}" if c and c.get("cp") else None


def note_lieu(city: str, district: str | None) -> float:
    """Note du lieu de 0 à 10 : le premier quartier noté qui correspond, sinon la commune, sinon 5."""
    text = f"{city} {district or ''}"
    for q in load()["quartiers"]:
        if q.get("note") is not None and re.search(q["motif"], text, re.I):
            return q["note"]
    c = commune(city or "")
    return c["note"] if c and c.get("note") is not None else 5
