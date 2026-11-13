"""Se brancher sur l'appli ouverte pour la déboguer, sans la relancer (port de débogage 127.0.0.1:9333).

    uv run --project agent python tools/appli.py etat              onglet, chat, agent, veille, nombre d'annonces
    uv run --project agent python tools/appli.py capture [img.png]  capture de la fenêtre
    uv run --project agent python tools/appli.py js "<expression>"  évalue du JavaScript dans la fenêtre (lecture)
    uv run --project agent python tools/appli.py journal [n]        les n dernières lignes de appli.log (même appli fermée)

Ne clique ni ne tape rien : c'est un outil pour regarder. APPARTHUNT_DEBUG_PORT pour un autre port.
"""
import json
import os
import sys
from pathlib import Path

PORT = os.environ.get("APPARTHUNT_DEBUG_PORT", "9333")
LOG = Path.home() / "Library" / "Application Support" / "AppartHunt" / "appli.log"

ETAT = """(() => ({
  onglet: document.querySelector('#menu [aria-current="page"], #menu .on')?.textContent?.trim() || null,
  chat: document.getElementById("stateT")?.textContent || null,
  agent: document.getElementById("stateS")?.textContent || "",
  veille: [document.getElementById("veilleT")?.textContent, document.getElementById("veilleM")?.textContent].filter(Boolean).join(" · "),
  annonces_affichees: document.querySelectorAll("#list .ad").length,
  resume: document.getElementById("summary")?.textContent || "",
  fiches_ouvertes: document.querySelectorAll("#fiche .panel").length,
  question_en_attente: !!document.querySelector(".ask:not(.done)"),
}))()"""


def page():
    from playwright.sync_api import sync_playwright
    p = sync_playwright().start()
    try:
        b = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
    except Exception:
        p.stop()
        sys.exit(f"L'appli n'est pas ouverte (ou sans port de débogage {PORT}).")
    pg = next((x for c in b.contexts for x in c.pages if x.url.endswith("/app/index.html")), None)
    if not pg:
        p.stop()
        sys.exit("Fenêtre de l'appli introuvable.")
    return p, pg


def main():
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else "etat"), sys.argv[2:]
    if cmd == "journal":
        lines = LOG.read_text(encoding="utf-8").splitlines() if LOG.exists() else ["(pas encore de journal)"]
        return print("\n".join(lines[-int(args[0] if args else 40):]))
    p, pg = page()
    try:
        if cmd == "etat":
            print(json.dumps(pg.evaluate(ETAT), ensure_ascii=False, indent=1))
        elif cmd == "capture":
            out = args[0] if args else "appli.png"
            pg.screenshot(path=out)
            print(out)
        elif cmd == "js":
            print(json.dumps(pg.evaluate(args[0]), ensure_ascii=False, indent=1, default=str))
        else:
            print(__doc__)
    finally:
        p.stop()


if __name__ == "__main__":
    main()
