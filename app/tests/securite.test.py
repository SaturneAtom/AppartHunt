# Une annonce piégée (texte écrit par un inconnu) ne doit rien pouvoir faire : ni script, ni HTML, ni sortie de style,
# ni lien vers autre chose qu'une page web. Vérifié sur le vrai écran de l'appli et sur la page à partager.
# Lancer : agent/.venv/bin/python app/tests/securite.test.py
import json, os, pathlib, shutil, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

APP = pathlib.Path(__file__).resolve().parent.parent
ROOT = APP.parent
ok = 0
def verifie(cond, quoi):
    global ok
    assert cond, quoi
    ok += 1
    print("ok  ", quoi)

PIEGE_HTML = '<img src=x onerror="window.__pirate=1"><a id="piege" href="https://evil.example">clic</a>'
PIEGE_CSS = "https://x.example/a.jpg');position:fixed;inset:0;z-index:2147483647;background:url('https://evil.example/f.png"
U = "smb://evil.example/partage"
annonces = [
    {"u": U, "site": "Exemple", "w": "Bordeaux — " + PIEGE_HTML, "p": PIEGE_HTML, "f": PIEGE_HTML, "pro": PIEGE_HTML, "con": PIEGE_HTML,
     "img": PIEGE_CSS, "city": "Bordeaux", "lat": 44.84, "lng": -0.58, "m2": 40, "type": "T2", "s": 80, "added": "2026-11-13T10:00"},
    {"u": "https://example.org/2", "site": "Exemple", "w": "Talence</script><script>window.__pirate=2</script>", "p": 700, "f": "40 m²",
     "img": "javascript:window.__pirate=3", "city": "Talence", "lat": 44.81, "lng": -0.59, "m2": 40, "type": "T2", "s": 70, "added": "2026-11-13T10:00"},
]
fiches = {U: {"note": 9, "resume": PIEGE_HTML, "pour": [PIEGE_HTML], "contre": [PIEGE_HTML], "details": {PIEGE_HTML: PIEGE_HTML},
              "description": PIEGE_HTML, "alerte": PIEGE_HTML, "photos": [PIEGE_CSS, "javascript:alert(1)"]}}
FAUX = """(() => {
  const snap = %s;
  window.apparthunt = new Proxy({ snapshot: async () => snap, chats: async () => ({ actif: "c", liste: [{ id: "c", titre: "t", cree: 1, maj: 1 }] }),
    openChat: async () => ({ actif: "c", liste: [] }), veille: async () => ({ active: false }), activite: async () => [], sessions: async () => [] },
    { get: (t, k) => t[k] || (/^on[A-Z]/.test(String(k)) ? () => {} : async () => null) });
})();""" % json.dumps({"listings": annonces, "resumes": fiches, "choix": {"oui": [], "non": []}, "journal": [], "ecran": {},
                       "profil": {"budget_cible": 800, "budget_max": 1000, "poids": {"lieu": "<b>30</b>"}}, "zone": {"communes": [], "quartiers": []}, "updated": 1})

def controles(page, ou):
    verifie(page.evaluate("window.__pirate") is None, f"{ou} : aucun script de l'annonce ne s'exécute")
    verifie(page.locator("#piege").count() == 0, f"{ou} : le HTML de l'annonce s'affiche en texte, pas en éléments")
    verifie(page.evaluate("[...document.querySelectorAll('[style]')].every(e => !/position:\\s*fixed|evil/.test(e.getAttribute('style')))"),
            f"{ou} : une adresse d'image ne peut pas sortir de son style")
    verifie(page.evaluate("[...document.querySelectorAll('a[href]')].every(a => /^(https?:|#|$)/.test(a.getAttribute('href')))"),
            f"{ou} : tous les liens sont des pages web")

with sync_playwright() as p:
    deja = sorted(pathlib.Path.home().glob("Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
    b = p.chromium.launch(**({"executable_path": str(deja[-1])} if deja and not pathlib.Path(p.chromium.executable_path).exists() else {}))

    # 1. l'appli : liste, carte, fiche, comparaison
    page = b.new_page(viewport={"width": 1300, "height": 900})
    dialogues = []
    page.on("dialog", lambda d: (dialogues.append(d.message), d.dismiss()))
    page.add_init_script(FAUX)
    page.goto((APP / "index.html").as_uri())
    page.wait_for_timeout(1200)
    controles(page, "liste")
    page.evaluate("setFiches([" + json.dumps(U) + "])"); page.wait_for_timeout(600)
    controles(page, "fiche")
    page.evaluate("setView('compare', [" + json.dumps(U) + ", 'https://example.org/2'])"); page.wait_for_timeout(600)
    controles(page, "comparaison")
    page.get_by_role("button", name="Profil", exact=True).last.click(); page.wait_for_timeout(600)
    verifie(page.evaluate("window.__pirate") is None and page.locator(".poids b b").count() == 0, "profil : les poids s'affichent en nombres")
    verifie(not dialogues, "aucune boîte de dialogue ouverte par une annonce")

    # 2. la page à partager, fabriquée par tools/build_page.py avec les mêmes annonces
    ws = pathlib.Path(tempfile.mkdtemp(prefix="apparthunt-secu-"))
    try:
        env = {**os.environ, "APPARTHUNT_WORKSPACE": str(ws)}
        subprocess.run([sys.executable, str(ROOT / "tools" / "donnees.py"), "annonces-ajout", "-"], input=json.dumps(annonces), text=True, env=env, check=True, capture_output=True)
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_page.py")], env=env, check=True, capture_output=True)
        p2 = b.new_page(viewport={"width": 1300, "height": 900})
        p2.on("dialog", lambda d: (dialogues.append(d.message), d.dismiss()))
        p2.goto((ws / "selection.html").as_uri()); p2.wait_for_timeout(1500)
        controles(p2, "page à partager")
        verifie(not dialogues, "page à partager : aucune boîte de dialogue")
    finally:
        shutil.rmtree(ws, ignore_errors=True)
    b.close()
print(ok, "vérifications, tout est passé")
