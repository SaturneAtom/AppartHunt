"""Tests de bout en bout des outils en ligne de commande, sur un dossier de recherche jetable.

Lancer depuis la racine du projet : agent/.venv/bin/python -m unittest tests/test_outils.py -v
Rien ne touche au réseau ni à ton vrai dossier ma-recherche/.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PY = sys.executable


class Outils(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws = pathlib.Path(tempfile.mkdtemp(prefix="apparthunt-test-"))
        for src, dst in [("recherche.example.md", "recherche.md"), ("profil.example.json", "profil.json"), ("zone.example.json", "zone.json")]:
            shutil.copy(ROOT / "examples" / src, cls.ws / dst)
        cls.env = {**os.environ, "APPARTHUNT_WORKSPACE": str(cls.ws)}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.ws, ignore_errors=True)

    def run_(self, *args, entree=None, code=0):
        r = subprocess.run(list(args), cwd=ROOT, env=self.env, input=entree, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, code, f"{args}\nstdout: {r.stdout}\nstderr: {r.stderr}")
        return r.stdout + (r.stderr if code else "")

    def al(self, outil, params):
        return json.loads(self.run_("./al", "tool", outil, json.dumps(params, ensure_ascii=False), "--run", "test"))

    # ---------- agent : outils sans navigateur ----------
    def test_01_enregistrer_noter_decider(self):
        ads = [{"id": "leboncoin:1", "site": "leboncoin", "url": "https://www.leboncoin.fr/ad/locations/1", "title": "T2 Chartrons",
                "price": 760, "m2": 52, "rooms": 2, "city": "Bordeaux", "district": "Chartrons", "floor": 3, "furnished": 0,
                "dpe": "C", "parking": 0, "outdoor": "balcon", "description": "Cuisine équipée.", "photos": []},
               {"id": "leboncoin:2", "site": "leboncoin", "url": "https://www.leboncoin.fr/ad/locations/2", "title": "Studio étudiant",
                "price": 1200, "m2": 18, "rooms": 1, "city": "Talence", "floor": 0, "description": "Réservé étudiant, rez-de-chaussée."}]
        r = self.al("save_listings", {"listings": ads})
        self.assertEqual(len(r["nouvelles"]), 2)
        self.assertEqual(len(self.al("save_listings", {"listings": ads})["nouvelles"]), 0, "une annonce déjà vue n'est pas renvoyée")
        s = self.al("score_listing", {"listing_id": "leboncoin:1"})
        self.assertGreaterEqual(s["score"], 70); self.assertEqual(s["elimine"], [])
        s2 = self.al("score_listing", {"listing_id": "leboncoin:2"})
        self.assertTrue(any("rez-de-chaussée" in m for m in s2["elimine"]))
        self.assertTrue(any("1200" in m for m in s2["elimine"]), "au-dessus du budget maximum")
        self.al("decide", {"listing_id": "leboncoin:1", "verdict": "keep", "reasons": "Chartrons, balcon"})

    def test_02_candidature_proposee_jamais_deux_fois(self):
        r1 = self.al("propose_application", {"listing_id": "leboncoin:1", "message": "Bonjour, je suis intéressé."})
        r2 = self.al("propose_application", {"listing_id": "leboncoin:1", "message": "Encore"})
        self.assertNotIn("erreur", r1)
        self.assertIn("erreur", r2, "la deuxième proposition doit être refusée")

    def test_03_memoire(self):
        self.al("remember", {"note": "Studapart = baux étudiants"})
        self.assertIn("Studapart", json.dumps(self.al("recall", {}), ensure_ascii=False))

    def test_04_outil_inconnu(self):
        r = subprocess.run(["./al", "tool", "rm_rf", "{}"], cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)

    def test_05_mise_a_jour_partielle_sans_perte(self):
        self.al("save_listings", {"listings": [{"id": "leboncoin:1", "price": "780 €"}]})
        s = self.al("score_listing", {"listing_id": "leboncoin:1"})
        self.assertNotIn("erreur", s, "un prix écrit « 780 € » est lu comme un nombre")
        r = json.loads(self.run_(PY, "-c", "import sqlite3,os,json;c=sqlite3.connect(os.environ['APPARTHUNT_WORKSPACE']+'/agent/data/agent.db');"
                                 "print(json.dumps(c.execute(\"SELECT price, description, city FROM listings WHERE id='leboncoin:1'\").fetchone()))"))
        self.assertEqual(r[0], 780); self.assertEqual(r[1], "Cuisine équipée."); self.assertEqual(r[2], "Bordeaux")

    def test_06_identifiants_et_parametres_valides(self):
        r = self.al("save_listings", {"listings": [{"id": "leboncoin:../../compte", "title": "x"}, {"id": "seloger:1"}]})
        self.assertEqual(r["nouvelles"], [], "un identifiant qui n'est pas leboncoin:<numéro> est ignoré")
        self.assertIn("erreur", self.al("read_listing", {"listing_id": "leboncoin:../../compte"}))
        self.assertIn("erreur", self.al("like_listing", {"listing_id": "leboncoin:1?x=y"}))
        self.assertIn("erreur", self.al("search_listings", {"cities": ["Bordeaux"], "max_price": "1000&x=y"}))

    def test_07_fichier_de_parametres_hors_du_projet_refuse(self):
        secret = pathlib.Path(tempfile.mkdtemp()) / "secret.json"
        secret.write_text('{"note": "secret"}', encoding="utf-8")
        r = subprocess.run(["./al", "tool", "remember", "@" + str(secret)], cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0); self.assertIn("refusé", r.stdout + r.stderr)
        dedans = self.ws / "lot.json"; dedans.write_text('{"note": "depuis un fichier"}', encoding="utf-8")
        self.run_("./al", "tool", "remember", "@" + str(dedans), "--run", "test")
        shutil.rmtree(secret.parent)

    def test_08_deux_candidatures_au_meme_instant(self):
        u = "https://example.org/annonce/course"
        procs = [subprocess.Popen([PY, "tools/suivi.py", "candidature", u, "envoyee"], cwd=ROOT, env=self.env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        codes = sorted(p.wait(timeout=60) for p in procs)
        self.assertEqual(codes.count(0), 1, f"une seule passe, les autres sont arrêtées (codes : {codes})")
        self.assertEqual(codes.count(2), 5)

    # ---------- données de l'appli ----------
    def test_10_fiche_snapshot_ordre_journal(self):
        u = "https://example.org/annonce/42"
        self.run_(PY, "tools/donnees.py", "annonces-ajout", "-", entree=json.dumps([{"u": u, "w": "Bordeaux — Chartrons", "p": 700, "f": "50 m²", "s": 80}]))
        self.run_(PY, "tools/donnees.py", "fiche", u, json.dumps({"note": 8, "resume": "Bien"}))
        self.run_(PY, "tools/donnees.py", "fiche", u, json.dumps({"pour": ["balcon"]}))
        snap = json.loads(self.run_(PY, "tools/donnees.py", "snapshot"))
        self.assertEqual(snap["resumes"][u]["note"], 8, "les champs d'une fiche sont fusionnés, pas remplacés")
        self.assertEqual(snap["resumes"][u]["pour"], ["balcon"])
        self.run_(PY, "tools/donnees.py", "ordre", u)
        self.run_(PY, "tools/donnees.py", "journal", "800 → 850 €", "test")
        self.assertTrue(json.loads(self.run_(PY, "tools/donnees.py", "snapshot"))["journal"])

    def test_11_suivi_deuxieme_envoi_refuse(self):
        u = "https://example.org/annonce/42"
        self.run_(PY, "tools/suivi.py", "choix", u, "oui")
        self.run_(PY, "tools/suivi.py", "candidature", u, "preparee", "--message", "Bonjour")
        self.run_(PY, "tools/suivi.py", "candidature", u, "envoyee", "--canal", "leboncoin")
        out = self.run_(PY, "tools/suivi.py", "candidature", u, "envoyee", code=2)
        self.assertIn("STOP", out)
        self.assertIn("envoyee", self.run_(PY, "tools/suivi.py", "voir", u))

    def test_12_suivi_valeurs_invalides(self):
        r = subprocess.run([PY, "tools/suivi.py", "candidature", "https://example.org/x", "piratee"], cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)

    def test_13_texte_hostile_stocke_tel_quel(self):
        u = "https://example.org/annonce/hostile"
        hostile = "</script><img src=x onerror=alert(1)>'; DROP TABLE annonces; --"
        self.run_(PY, "tools/donnees.py", "annonces-ajout", "-", entree=json.dumps([{"u": u, "w": hostile, "p": 1, "f": hostile}]))
        self.run_(PY, "tools/donnees.py", "fiche", u, json.dumps({"resume": hostile}))
        snap = json.loads(self.run_(PY, "tools/donnees.py", "snapshot"))
        self.assertEqual(snap["resumes"][u]["resume"], hostile)
        self.assertTrue(any(a["u"] == u for a in snap["listings"]), "la table existe toujours")

    # ---------- page à partager ----------
    def test_20_page_a_partager_sans_injection(self):
        self.run_(PY, "tools/build_page.py")
        page = (self.ws / "selection.html").read_text(encoding="utf-8")
        self.assertIn("Bordeaux et alentours", page)
        self.assertNotIn("</script><img", page, "un texte d'annonce ne doit pas pouvoir fermer la balise <script>")

    # ---------- zone ----------
    def test_30_zone(self):
        out = self.run_("node", "-e", "const g=require('./tools/geo');console.log(JSON.stringify([g.locate('Bordeaux — Chartrons'),g.locate('nulle part')]))")
        a, b = json.loads(out)
        self.assertEqual(a["city"], "Bordeaux"); self.assertEqual(b["city"], "Autre")

    def test_31_zone_absente_ou_cassee(self):
        (self.ws / "zone.json").write_text("{pas du json", encoding="utf-8")
        try:
            r = subprocess.run(["./al", "tool", "score_listing", '{"listing_id": "leboncoin:1"}'], cwd=ROOT, env=self.env, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, "un zone.json cassé doit donner une erreur, pas une note inventée")
        finally:
            shutil.copy(ROOT / "examples" / "zone.example.json", self.ws / "zone.json")

    # ---------- permissions de l'agent ----------
    def test_35_permissions_sans_demande_restent_etroites(self):
        import re
        src = (ROOT / "app" / "main.js").read_text(encoding="utf-8")
        outils = re.search(r"const OUTILS = \[(.*?)\];", src, re.S).group(1)
        cmds = re.findall(r'"([^"]+)"', outils)
        for c in cmds:
            self.assertRegex(c, r"^(\./al (tool|log)|python3 tools/[a-z0-9_]+\.py|node tools/[a-z]+\.js)$", f"commande trop large sans demande : {c}")
        self.assertNotIn("tools/dossier.py", outils, "assembler le dossier locataire en PDF, c'est à l'utilisateur de le lancer")
        sur = re.search(r"const ALLOWED_SUR = \[(.*?)\];", src, re.S).group(1)
        for interdit in ['"Read"', '"Edit"', '"Write"', '"WebFetch"', "claude-in-chrome"]:
            self.assertNotIn(interdit, sur, f"{interdit} ne doit pas passer sans demande")
        interdits = re.search(r"const DISALLOWED = \[(.*?)\];", src, re.S).group(1)
        self.assertIn('const DOSSIER = absolu(path.join(WORKSPACE, "dossier"))', src, "tout le dossier locataire est interdit, pas seulement les pièces")
        self.assertNotIn("--chrome", src, "l'agent n'utilise pas le Chrome de l'utilisateur")
        self.assertNotIn("claude-in-chrome", re.search(r"const ALLOWED_DEV = \[(.*?)\];", src, re.S).group(1))
        for regle in ["Read(${DOSSIER})", "Edit(${DOSSIER})", "CLAUDE*.md", ".claude/**", "git push", "mcp__claude-in-chrome__*"]:
            self.assertIn(regle, interdits, f"règle manquante : {regle}")
        # « Toujours » : jamais un outil entier, jamais un interpréteur ou un lanceur
        self.assertIn('if (tool !== "Bash") return null;', src)
        for prog in ["python", "uvx?", "npx", "make", "g?awk", "find"]:
            self.assertIn(prog, re.search(r"const prog = .*?\n(.*?)\n", src, re.S).group(1))

    def test_36_donnees_annonces_ajout_hors_du_dossier_refuse(self):
        dehors = pathlib.Path(tempfile.mkdtemp()) / "lot.json"
        dehors.write_text('[{"u": "https://www.leboncoin.fr/ad/locations/1"}]', encoding="utf-8")
        out = self.run_("python3", "tools/donnees.py", "annonces-ajout", str(dehors), code=1)
        self.assertIn("refusé", out)
        shutil.rmtree(dehors.parent)

    # ---------- veille ----------
    def test_40_veille_tri(self):
        js = """const v=require('./app/veille');const P={budget_max:1000,indispensable:{}};
        console.log(JSON.stringify([v.motifDOffice({titre:'Je cherche un T2',texte:''},P), v.motifDOffice({titre:'T2',texte:'bail mobilité',prix:700},P),
          v.motifDOffice({titre:'T2',texte:'',prix:1500},P), v.motifDOffice({titre:'T2',texte:'lumineux',prix:700,etage:2},P),
          v.cleDe('https://www.leboncoin.fr/ad/locations/123456789'), v.cleDe('https://evil.example/ad/locations/123456789')]))"""
        demande, mobilite, cher, ok, cle, autre = json.loads(self.run_("node", "-e", js))
        self.assertIn("demande", demande); self.assertIn("mobilit", mobilite); self.assertIn("1500", cher)
        self.assertIsNone(ok); self.assertEqual(cle, "lbc:123456789"); self.assertIsNone(autre)


if __name__ == "__main__":
    unittest.main()
