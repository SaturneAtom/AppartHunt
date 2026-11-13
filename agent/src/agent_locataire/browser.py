"""Navigateur de l'agent : un Chrome piloté par Playwright, avec son propre profil.

Le profil garde les cookies et les connexions d'une session à l'autre : l'utilisateur se connecte
lui-même une fois (commande `agent-locataire login`), l'agent ne saisit jamais de mot de passe.
Les sites d'annonces bloquent les navigateurs « sans tête » : la fenêtre reste visible.
"""
from contextlib import contextmanager

from playwright.sync_api import BrowserContext, sync_playwright

from .db import DATA_DIR

PROFILE_DIR = DATA_DIR / "browser-profile"


@contextmanager
def browser() -> BrowserContext:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE_DIR,
            channel="chrome",       # le Chrome installé, plus discret que le Chromium de Playwright
            headless=False,
            locale="fr-FR",
            viewport={"width": 1280, "height": 860},
        )
        try:
            yield ctx
        finally:
            ctx.close()


def refuse_cookies(page) -> None:
    """Clique sur « Continuer sans accepter » / « Je refuse » si une bannière de cookies s'affiche."""
    for label in ("Continuer sans accepter", "Je refuse", "Tout refuser"):
        btn = page.get_by_text(label, exact=False)
        if btn.count():
            try:
                btn.first.click(timeout=2000)
                return
            except Exception:
                pass
