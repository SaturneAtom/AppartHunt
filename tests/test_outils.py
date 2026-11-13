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
