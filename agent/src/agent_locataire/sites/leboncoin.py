"""Leboncoin : recherche de locations et lecture des fiches.

Les données sont lues dans le JSON `__NEXT_DATA__` que le site embarque dans chaque page
(résultats et fiche annonce), depuis le navigateur de l'agent.
"""
import json
import re
from urllib.parse import quote

from .. import zone
from ..browser import refuse_cookies

NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _attrs(ad: dict) -> dict:
    return {a["key"]: a.get("value_label") or a.get("value") for a in ad.get("attributes", [])}


def _to_listing(ad: dict, body: str = "", photos: list[str] | None = None) -> dict:
    at = _attrs(ad)
    floor = at.get("floor_number")
    outside = (at.get("outside_access") or "").lower()
    text = body or ad.get("body") or ""
    return {
        "id": f"leboncoin:{ad['list_id']}",
        "site": "leboncoin",
        "url": f"https://www.leboncoin.fr/ad/locations/{ad['list_id']}",
        "title": ad.get("subject", ""),
        "price": (ad.get("price") or [None])[0],
        "m2": float(str(at.get("square", "0")).split()[0].replace(",", ".") or 0) or None,
        "rooms": int(at["rooms"]) if str(at.get("rooms", "")).isdigit() else None,
        "city": ad.get("location", {}).get("city"),
        "district": ad.get("location", {}).get("district"),
        "floor": int(floor) if str(floor).isdigit() else None,
        "furnished": 1 if at.get("furnished") == "Meublé" else 0 if at.get("furnished") else None,
        "dpe": (at.get("energy_rate") or "").upper()[:1] or None,
        "parking": 1 if re.search(r"parking|garage|stationnement", text, re.I) or at.get("parking") else 0,
        "outdoor": "terrasse" if "terrasse" in outside or re.search(r"terrasse", text, re.I)
                   else "balcon" if "balcon" in outside or re.search(r"balcon", text, re.I)
                   else "jardin" if "jardin" in outside else None,
        "description": text,
        "photos": photos if photos is not None else (ad.get("images", {}).get("urls_large") or [])[:8],
        "lat": ad.get("location", {}).get("lat"),
        "lng": ad.get("location", {}).get("lng"),
    }


def search(ctx, cities: list[str], max_price: int, rooms_min: int, rooms_max: int,
           include_houses: bool, max_pages: int = 3) -> list[dict]:
    """Lance une recherche triée par date et renvoie les annonces (sans la description complète)."""
    # Codes « Ville_CodePostal » tirés de zone.json ; une commune hors zone est ignorée
    locs = ",".join(quote(code, safe="_") for c in cities if (code := zone.code_leboncoin(c)))[:2000]
    if not locs:
        raise ValueError(f"Aucune de ces communes n'est dans zone.json : {cities}")
    types = "1,2" if include_houses else "2"
    url = (f"https://www.leboncoin.fr/recherche?category=10&locations={locs}&real_estate_type={types}"
           f"&rooms={rooms_min}-{rooms_max}&price=min-{max_price}&sort=time&order=desc")
    page = ctx.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded")
        refuse_cookies(page)
        ads = []
        for n in range(1, max_pages + 1):
            html = page.content() if n == 1 else page.evaluate("u => fetch(u).then(r => r.text())", f"{url}&page={n}")
            m = NEXT_DATA.search(html)
            if not m:
                raise RuntimeError("Leboncoin n'a pas renvoyé de résultats (vérification anti-robot ? ouvre la fenêtre et résous-la toi-même).")
            data = json.loads(m.group(1))["props"]["pageProps"]["searchData"]
            ads += data.get("ads", [])
            if len(ads) >= data.get("total", 0):
                break
        return [_to_listing(ad) for ad in ads]
    finally:
        page.close()


def details(ctx, list_id: str) -> dict:
    """Lit la fiche complète d'une annonce : description et photos."""
    page = ctx.new_page()
    try:
        page.goto(f"https://www.leboncoin.fr/ad/locations/{list_id}", wait_until="domcontentloaded")
        refuse_cookies(page)
        m = NEXT_DATA.search(page.content())
        ad = json.loads(m.group(1))["props"]["pageProps"]["ad"]
        photos = (ad.get("images", {}).get("urls_large") or [])[:8]
        return _to_listing(ad, body=ad.get("body", ""), photos=photos)
    finally:
        page.close()


def like(ctx, list_id: str) -> str:
    """Met l'annonce en favori sur le compte de l'utilisateur (si elle n'y est pas déjà)."""
    page = ctx.new_page()
    try:
        page.goto(f"https://www.leboncoin.fr/ad/locations/{list_id}", wait_until="domcontentloaded")
        refuse_cookies(page)
        btn = page.locator("button[aria-label*='favoris']").first
        label = btn.get_attribute("aria-label") or ""
        if label.startswith("Retirer"):
            return "déjà en favori"
        btn.click()
        page.wait_for_timeout(1200)
        label = btn.get_attribute("aria-label") or ""
        return "ajouté aux favoris" if label.startswith("Retirer") else "échec : es-tu connecté à Leboncoin dans le navigateur de l'agent ?"
    finally:
        page.close()
