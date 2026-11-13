"""Barème de l'utilisateur (criteres.md) : filtres éliminatoires + note pondérée sur 100.

La notation est déterministe : l'agent l'appelle comme un outil, il ne l'invente pas.
"""
import json
import os
import re
from pathlib import Path

from . import zone

# Réglages tirés de recherche.md par l'agent (profil.json du dossier de recherche, sinon l'exemple du projet)
_ROOT = Path(__file__).resolve().parents[3]
_PROFIL = Path(os.environ.get("APPARTHUNT_WORKSPACE") or _ROOT / "ma-recherche") / "profil.json"
if not _PROFIL.exists():
    _PROFIL = _ROOT / "examples" / "profil.example.json"
_p = json.loads(_PROFIL.read_text(encoding="utf-8")) if _PROFIL.exists() else {}
WEIGHTS = _p.get("poids") or {"lieu": 30, "prix": 25, "surface": 15, "etat": 10, "parking": 10, "exterieur": 5, "non_meuble": 5}
TARGET_RENT = _p.get("budget_cible", 800)
MAX_RENT = _p.get("budget_max", 1000)



def lieu(city: str, district: str | None) -> float:
    # Notes des quartiers et des communes : zone.json du dossier de recherche (voir zone.py)
    return zone.note_lieu(city, district)


def prix(price: int) -> float:
    # ≤ cible-50 = 10 · cible = 9 · +50 = 7 · +100 = 5 · +150 = 4 · +200 = 3 · +250 = 2
    steps = [(TARGET_RENT - 50, 10), (TARGET_RENT, 9), (TARGET_RENT + 50, 7), (TARGET_RENT + 100, 5),
             (TARGET_RENT + 150, 4), (TARGET_RENT + 200, 3), (TARGET_RENT + 250, 2)]
    if price <= steps[0][0]:
        return 10
    for (p0, n0), (p1, n1) in zip(steps, steps[1:]):
        if price <= p1:
            return n0 + (n1 - n0) * (price - p0) / (p1 - p0)
    return 2


def surface(m2: float | None, rooms: int | None) -> float:
    if not m2:
        return 5
    if (rooms or 0) >= 2:
        return 10 if m2 >= 45 else 7 if m2 >= 35 else 3
    return 5 if m2 >= 30 else 3


def etat(dpe: str | None, description: str) -> float:
    kitchen = bool(re.search(r"cuisine (équipée|aménagée)", description or "", re.I))
    if dpe in ("A", "B", "C", "D"):
        return 10 if kitchen else 8
    return {"E": 6, "F": 3}.get(dpe or "", 6)


def eliminatory(ad: dict) -> list[str]:
    """Filtres durs : renvoie la liste des raisons d'élimination (vide = l'annonce passe)."""
    reasons = []
    text = f"{ad.get('title', '')} {ad.get('description', '')}"
    if ad.get("price") and ad["price"] > MAX_RENT:
        reasons.append(f"loyer {ad['price']} € > {MAX_RENT} €")
    if ad.get("floor") == 0 or re.search(r"rez-de-chauss|plain-pied", text, re.I):
        reasons.append("rez-de-chaussée")
    if ad.get("dpe") == "G":
        reasons.append("DPE G (interdit à la location)")
    if re.search(r"bail mobilit|étudiant|etudiant|septembre (à|a) juin|saisonni|colocation|sous-lou", text, re.I):
        reasons.append("pas un bail classique (étudiant, mobilité, saisonnier ou colocation)")
    if re.search(r"\b(recherche|cherche)\b.{0,40}\b(appartement|logement|t2)\b", text, re.I) and not ad.get("photos"):
        reasons.append("c'est une personne qui cherche un logement, pas une offre")
    return reasons


def score(ad: dict) -> dict:
    """Note sur 100 avec le détail par critère (chaque critère noté de 0 à 10)."""
    desc = ad.get("description") or ""
    parts = {
        "lieu": lieu(ad.get("city") or "", ad.get("district")),
        "prix": prix(ad.get("price") or 0),
        "surface": surface(ad.get("m2"), ad.get("rooms")),
        "etat": etat(ad.get("dpe"), desc),
        "parking": 10 if ad.get("parking") else 5,
        "exterieur": {"terrasse": 10, "balcon": 7, "jardin": 7}.get(ad.get("outdoor") or "", 3),
        "non_meuble": {0: 10, 1: 6}.get(ad.get("furnished"), 8),
    }
    total = sum(WEIGHTS[k] * v for k, v in parts.items()) / 10
    return {
        "score": round(total),
        "criteres": {k: round(v, 1) for k, v in parts.items()},
        "elimine": eliminatory(ad),
    }
