# Refait les captures du README : le vrai écran de l'appli, avec les données fictives de docs/demo/faux.js.
# Lancer depuis la racine du projet : agent/.venv/bin/python docs/demo/captures.py
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "images"
OUT.mkdir(parents=True, exist_ok=True)

TOURS = [
    ("agent", {"type": "tour_debut", "textes": ["Lance une recherche, et regarde aussi Talence."]}, "rech"),
    ("plan", "rech", [{"texte": "Relire tes critères et ma mémoire", "etat": "fait"},
                      {"texte": "Chercher sur Leboncoin et Bien'ici", "etat": "fait"},
                      {"texte": "Lire et noter les 14 nouvelles", "etat": "fait"},
                      {"texte": "Te proposer la meilleure", "etat": "fait"}]),
    ("agent", {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "./al tool recall '{}' --run 1113-0930"}},
        {"type": "tool_use", "id": "t2", "name": "mcp__navigateur__ouvrir_page", "input": {"url": "https://www.leboncoin.fr/recherche?category=10&locations=Bordeaux_33000,Talence_33400"}},
        {"type": "tool_use", "id": "t3", "name": "mcp__navigateur__annonces_page", "input": {}},
        {"type": "thinking", "thinking": "Deux baux étudiants déguisés à Talence : je les écarte, je le note pour la suite."},
        {"type": "tool_use", "id": "t4", "name": "Bash", "input": {"command": "./al tool score_listing '{\"listing_id\": \"leboncoin:2841\"}'"}},
        {"type": "tool_use", "id": "t5", "name": "Bash", "input": {"command": "./al tool remember '{\"note\": \"Résidences étudiantes de Talence : baux de 9 mois\"}'"}},
    ]}}, "rech"),
    ("agent", {"type": "result", "result": "J'ai lu **14 nouvelles annonces**, dont 5 à Talence. Trois valent le coup :\n\n"
               "- **Le Bouscat, 790 €** : 9/10, parking et balcon, tout ce que tu demandes\n"
               "- **Chartrons, 760 €** : 9/10, ton quartier préféré, mais sans parking\n"
               "- **Talence, 690 €** : 8/10, près du tram, un peu petit\n\n"
               "J'en ai écarté 4 : deux baux étudiants, un rez-de-chaussée, un au-dessus de ton budget."}, "rech"),
    ("proposition", "rech", {"texte": "Je prépare la candidature pour celle du Bouscat ? Rien ne part sans ton accord.",
                             "boutons": [{"label": "Oui, prépare-la", "message": "Oui"}, {"label": "Compare les deux premières", "message": "Compare"}]}),
]

with sync_playwright() as p:
    deja = sorted(pathlib.Path.home().glob("Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
    b = p.chromium.launch(**({"executable_path": str(deja[-1])} if deja and not pathlib.Path(p.chromium.executable_path).exists() else {}))
    page = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    erreurs = []
    page.on("pageerror", lambda e: erreurs.append(str(e)))
    page.add_init_script(path=str(ROOT / "docs" / "demo" / "faux.js"))
    page.goto((ROOT / "app" / "index.html").as_uri())
    page.wait_for_timeout(800)
    for t in TOURS:
        page.evaluate("([k, ...a]) => window.__demo.emit(k, ...a)", list(t))
        page.wait_for_timeout(150)
    page.evaluate("turn.dataset.t0 = Date.now() - 154000")      # un passage de 2 min 34 s, pour le résumé « N étapes · durée »
    page.evaluate("window.__demo.emit('agent', {type: 'turn_end', code: 0}, 'rech')")
    page.evaluate("document.querySelector('.log:not([hidden])').scrollTop = 0")
    page.wait_for_timeout(2500)          # le fond de carte se charge
    page.screenshot(path=str(OUT / "annonces.jpg"), quality=82)

    page.locator("text=Bordeaux · Chartrons").first.click()
    page.wait_for_timeout(2500)
    page.evaluate("document.querySelector('#fiche .fwhy:nth-of-type(2), #fiche .resume')?.closest('section').scrollIntoView({block: 'center'})")
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / "fiche.jpg"), quality=82)
    b.close()

print("captures dans", OUT, "| erreurs JavaScript :", erreurs or "aucune")
