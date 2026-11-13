# Le vrai écran (index.html, renderer.js) avec de fausses données, dans un navigateur sans fenêtre.
# Lancer : agent/.venv/bin/python app/tests/ecran.test.py [capture.png]
import pathlib, sys
from playwright.sync_api import sync_playwright

APP = pathlib.Path(__file__).resolve().parent.parent
ok = 0
def verifie(cond, quoi):
    global ok
    assert cond, quoi
    ok += 1
    print("ok  ", quoi)

with sync_playwright() as p:
    # le navigateur attendu par cette version de Playwright, sinon le plus récent déjà installé (rien à télécharger)
    deja = sorted(pathlib.Path.home().glob("Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
    b = p.chromium.launch(**({"executable_path": str(deja[-1])} if deja and not pathlib.Path(p.chromium.executable_path).exists() else {}))
    page = b.new_page(viewport={"width": 1300, "height": 820})
    erreurs = []
    page.on("pageerror", lambda e: erreurs.append(str(e)))
    page.add_init_script(path=str(APP / "tests" / "ecran.faux.js"))
    page.goto((APP / "index.html").as_uri())
    page.get_by_role("button", name="Activité", exact=True).last.click()
    page.wait_for_selector('#alist [data-repondre="rech"]')
    box, cible = page.locator("#type"), page.locator("#cible")
    actif = lambda: page.locator(".log:not([hidden])")
    asks = lambda: page.evaluate("__faux.asks")
    def repondre():
        page.locator('#alist [data-repondre="rech"]').first.click()
        page.wait_for_function('document.getElementById("cible").hidden === false')
    def ferme():
        page.wait_for_function('document.getElementById("cible").hidden === true')
    actif_est = lambda i: page.wait_for_function(f'activeChat === "{i}"')

    # le bouton
    verifie(page.locator('#alist [data-repondre="old"]').count() == 0, "une tâche trop ancienne n'a pas de bouton")
    verifie(page.locator('#alist .ar').count() == 3 and page.locator('#alist [data-repondre]').count() == 1, "seule celle qu'on peut reprendre a son bouton Répondre")
    verifie(not cible.is_visible(), "au départ, le champ parle à la conversation")
    if len(sys.argv) > 1: page.screenshot(path=sys.argv[1] + "-liste.png")
    repondre()
    verifie("Tu réponds à Recherche du 3 novembre" in cible.inner_text(), "le champ indique à qui je parle")
    verifie(page.url.endswith("index.html") and page.locator('#alist .ar').count() == 3, "pas de nouvelle page, l'écran reste le même")
    verifie("J'ai lu 12 annonces" in actif().inner_text(), "ses réponses précédentes restent affichées")
    verifie(page.evaluate("document.activeElement.id") == "type", "le curseur est dans le champ")
    if len(sys.argv) > 1: page.screenshot(path=sys.argv[1] + ".png")

    # l'envoi : tâche en cours, message lu, on reste sur la tâche
    page.evaluate('__faux.emit({type:"tour_debut",textes:["Lance une autre recherche"],reprise:true},"rech")')
    box.fill("Regarde aussi Talence"); box.press("Enter")
    page.wait_for_function("__faux.asks.length === 1")
    a = asks()[0]
    verifie(a["chat"] == "rech" and a["o"]["reponse"] is True and a["t"] == "Regarde aussi Talence", "le message part vers la tâche, en mode réponse")
    verifie(box.input_value() == "", "le champ se vide")
    page.wait_for_selector(".log:not([hidden]) .you.steer")
    verifie(cible.is_visible(), "je reste sur la tâche après l'envoi")
    txt = actif().inner_text()
    verifie(txt.index("Lance une recherche") < txt.index("Lance une autre recherche") < txt.index("Regarde aussi Talence"), "mes messages restent dans l'ordre")
    page.evaluate('__faux.emit({type:"result",result:"Talence ajouté.",is_error:false},"rech"); __faux.emit({type:"turn_end",code:0,etat:"finie"},"rech")')
    verifie("Talence ajouté." in actif().inner_text(), "sa réponse s'affiche à la suite")
    verifie("Talence ajouté." in page.evaluate("__faux.saved.rech"), "le fil est enregistré")

    # l'échec : le texte revient, avec l'erreur
    page.evaluate('__faux.reponse = () => ({ ok:false, error:"« Autre » travaille déjà sur cette annonce." }); 0')
    box.fill("Postule"); box.press("Enter")
    page.wait_for_selector("#envoiErr:not([hidden])")
    verifie(box.input_value() == "Postule", "si l'envoi échoue, mon texte revient dans le champ")
    verifie("travaille déjà" in page.locator("#envoiErr").inner_text(), "avec un message d'erreur clair")
    verifie(cible.is_visible(), "et je reste sur la tâche")
    if len(sys.argv) > 1: page.screenshot(path=sys.argv[1] + "-erreur.png")
    box.type(" vite")
    verifie(not page.locator("#envoiErr").is_visible(), "l'erreur s'efface quand je retape")
    box.fill("")
    page.evaluate('__faux.reponse = () => { throw new Error("IPC coupé") }; 0')
    box.fill("Texte perdu ?"); box.press("Enter")
    page.wait_for_selector("#envoiErr:not([hidden])")
    verifie(box.input_value() == "Texte perdu ?" and "IPC coupé" in page.locator("#envoiErr").inner_text(), "même si l'appel plante")
    box.fill("")
    # le moteur rend un texte qu'il n'a pas pu transmettre
    page.evaluate('__faux.emit({type:"rendu",textes:["Mon texte rendu"],raison:"Message non transmis : session perdue"},"rech")')
    verifie(box.input_value() == "Mon texte rendu" and "non transmis" in page.locator("#envoiErr").inner_text(), "un message non transmis revient aussi")
    box.fill("")
    page.evaluate('__faux.reponse = () => ({ ok:true, mode:"lance" }); 0')

    # Échap ramène à la conversation, et n'arrête rien
    box.press("Escape"); ferme(); actif_est("gen")
    verifie(page.evaluate("__faux.stops") == 0, "Échap ferme la réponse sans arrêter la tâche")
    verifie(page.get_attribute("#type", "placeholder").startswith("Écris à l'agent"), "le champ revient à la conversation générale")
    # ✕
    repondre(); page.locator("#cibleX").click(); ferme(); actif_est("gen")
    verifie(True, "✕ fait pareil")
    # ouvrir une autre conversation met fin à la réponse
    repondre(); page.evaluate('showChat("old")'); ferme()
    verifie(True, "ouvrir une autre conversation ferme la réponse : le champ ne ment pas")
    # hors réponse, Échap arrête encore l'agent, comme avant
    page.evaluate('__faux.emit({type:"tour_debut",textes:["x"],reprise:false},"old")')
    box.click(); box.press("Escape")
    verifie(page.evaluate("__faux.stops") == 1, "hors réponse, Échap arrête l'agent, comme avant")
    page.evaluate('__faux.emit({type:"turn_end",code:1,etat:"arretee"},"old")')

    # une question en attente
    page.evaluate('__faux.reponse = () => ({ ok:true, mode:"lu" }); __faux.emit({type:"tour_debut",textes:["y"],reprise:false},"rech"); __faux.question({id:7,chat:"rech",question:"Laquelle ?",reponses:["A","B"]}); 0')
    repondre()
    n = len(asks())
    box.fill("La B"); box.press("Enter")
    page.wait_for_function("__faux.answers.length === 1")
    verifie(page.evaluate("__faux.answers")[0] == [7, "La B"] and len(asks()) == n, "si elle attend une réponse, mon message répond à sa question")
    page.evaluate('__faux.emit({type:"turn_end",code:0,etat:"finie"},"rech")')
    box.press("Escape"); ferme()

    # le même bouton sur le log d'une session
    page.locator('#alist .ar').first.click()
    page.wait_for_selector('#shead [data-repondre="rech"]')
    page.locator('#shead [data-repondre="rech"]').click()
    page.wait_for_function('document.getElementById("cible").hidden === false')
    verifie(True, "le bouton est aussi sur le log de la tâche")
    box.press("Escape"); ferme()

    # ce qu'il dit entre deux actions : en entier ; une autorisation : la commande en entier, et la réponse
    page.evaluate('__faux.reponse = () => ({ ok:true, mode:"lu" }); __faux.emit({type:"tour_debut",textes:["Supprime la carte"],reprise:false},"gen"); showChat("gen")')
    page.wait_for_function('activeChat === "gen"')
    long = "Je retire la carte de la liste et de la fiche, puis je vérifie que le reste se charge. " * 3
    page.evaluate("t => __faux.emit({type:'assistant',message:{stop_reason:null,content:[{type:'text',text:t}]}},'gen')", long + chr(10) + "Deuxième ligne")
    verifie(long.strip() in actif().inner_text() and "Deuxième ligne" in actif().inner_text(), "ce qu'il dit entre deux actions s'affiche en entier")
    page.evaluate("q => __faux.question(q)", {"id": 9, "chat": "gen", "question": "Je veux lancer cette commande :" + chr(10) + "rm app/demo.html", "reponses": ["Oui", "Non"]})
    carte = page.locator(".log:not([hidden]) .ask:not(.done)")
    verifie("rm app/demo.html" in carte.inner_text() and carte.locator("button").count() == 2, "une autorisation montre la commande et ses boutons")
    if len(sys.argv) > 1: page.screenshot(path=sys.argv[1] + "-carte.png")
    carte.locator("button", has_text="Oui").click()
    page.wait_for_function("__faux.answers.at(-1)[0] === 9")
    verifie(page.evaluate("__faux.answers.at(-1)") == [9, "Oui"], "cliquer Oui répond à la demande")

    verifie(not erreurs, "aucune erreur JavaScript : " + str(erreurs))
    b.close()
print(f"{ok} vérifications, tout est passé")
