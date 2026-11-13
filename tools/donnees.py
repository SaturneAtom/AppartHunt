#!/usr/bin/env python3
"""Les données de la recherche, au même endroit : la base agent/data/agent.db du dossier de recherche.

Tables : annonces (la liste), fiches (ce que l'agent a lu : verdict, résumé, photos, détails, description),
etats + historique (gardée / écartée, candidatures, daté : voir suivi.py), journal (changements de
critères), prefs (ordre de la liste…). L'appli, l'agent et les outils passent tous par ce module.
recherche.md et profil.json restent des fichiers : ce sont les réglages écrits par l'utilisateur.

  python3 tools/donnees.py snapshot                      tout ce que l'appli affiche (JSON)
  python3 tools/donnees.py fiche <URL> '<json>'           ajoute / met à jour une fiche (champs fusionnés)
  python3 tools/donnees.py fiche - < fiche.json           idem depuis l'extracteur ({"u": …}), ou une liste de verdicts
  python3 tools/donnees.py voir <URL>                     la fiche et l'annonce
  python3 tools/donnees.py annonces-ajout lot.json        ajoute des annonces à la liste (déjà enrichies)
  python3 tools/donnees.py journal "avant → après" ["pourquoi"]
  python3 tools/donnees.py ordre <URL> [<URL> …]          ordre de priorité de la liste
  python3 tools/donnees.py activite [n]                   le journal d'activité (veille, agent), le plus récent d'abord (sans les traces)
  python3 tools/donnees.py activite-detail <id>           une entrée avec sa trace complète (commandes, résultats, annonces vues)
  python3 tools/donnees.py annonces-position - < lot.json  corrige commune et position : [{"u", "city", "lat", "lng"}]
  python3 tools/donnees.py activite-cherche <texte>       les passages de veille où ce texte apparaît
  python3 tools/donnees.py activite-ajout - < entree.json  ajoute une entrée {"type", "titre", "detail"}
  python3 tools/donnees.py migrer                         reprend les anciens fichiers JSON (une fois)

Le dossier de recherche est APPARTHUNT_WORKSPACE s'il est défini, sinon ma-recherche/ à la racine du projet.
"""
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

CODE = Path(__file__).resolve().parent.parent
WORKSPACE = Path(os.environ.get("APPARTHUNT_WORKSPACE") or CODE / "ma-recherche").resolve()
DB = WORKSPACE / "agent" / "data" / "agent.db"
LBC = "https://img.leboncoin.fr/api/v1/lbcpb1/images/{0}/{1}/{2}/{3}.jpg?rule=ad-large"

SCHEMA = """
CREATE TABLE IF NOT EXISTS annonces (url TEXT PRIMARY KEY, rang INTEGER, data TEXT, ajoutee TEXT);
CREATE TABLE IF NOT EXISTS fiches (url TEXT PRIMARY KEY, data TEXT, maj TEXT);
CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, quoi TEXT, pourquoi TEXT);
CREATE TABLE IF NOT EXISTS prefs (cle TEXT PRIMARY KEY, valeur TEXT);
CREATE TABLE IF NOT EXISTS activite (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT, titre TEXT, detail TEXT);   -- veille, agent
CREATE TABLE IF NOT EXISTS etats (
    url TEXT PRIMARY KEY,
    choix TEXT, choix_le TEXT,                 -- oui / non / NULL
    candidature TEXT, candidature_le TEXT,     -- preparee / envoyee / …
    envoyee_le TEXT,                           -- date du premier envoi : jamais effacée
    canal TEXT, message TEXT
);
CREATE TABLE IF NOT EXISTS historique (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, url TEXT, quoi TEXT, avant TEXT, apres TEXT, par TEXT, note TEXT
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def norm(url: str) -> str:
    return str(url).split("?")[0].split("#")[0].rstrip("/")


def connect() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=15)   # l'appli, la veille et l'agent écrivent en même temps : on attend son tour
    con.execute("PRAGMA journal_mode=WAL")
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def pref(con, cle, defaut=None):
    row = con.execute("SELECT valeur FROM prefs WHERE cle = ?", (cle,)).fetchone()
    return json.loads(row["valeur"]) if row else defaut


def set_pref(con, cle, valeur):
    con.execute("INSERT OR REPLACE INTO prefs VALUES (?, ?)", (cle, json.dumps(valeur, ensure_ascii=False)))
    con.commit()


# ---------- Fiches ----------

def _photos(ph):
    return [LBC.format(h[:2], h[2:4], h[4:6], h) if re.fullmatch(r"[0-9a-f]{40}", str(h)) else h for h in ph or []]


def merge_fiche(con, url: str, champs: dict) -> dict:
    """Fusionne des champs dans la fiche : les photos et la description remplacent, les détails s'ajoutent."""
    url = norm(url)
    row = con.execute("SELECT data FROM fiches WHERE url = ?", (url,)).fetchone()
    e = json.loads(row["data"]) if row else {}
    for k, v in champs.items():
        if k in ("u", "url") or v is None or v == "" or v == []:
            continue
        if k == "photos":
            e["photos"] = _photos(v)
        elif k == "details":
            merged = {**e.get("details", {}), **v}
            e["details"] = {kk: vv for kk, vv in merged.items() if not re.fullmatch(r"[a-z0-9_]+", kk)}   # sans les clés techniques
        else:
            e[k] = v
    con.execute("INSERT OR REPLACE INTO fiches VALUES (?, ?, ?)", (url, json.dumps(e, ensure_ascii=False), now()))
    con.commit()
    return e


# ---------- Annonces ----------

def annonces(con) -> list:
    return [json.loads(r["data"]) for r in con.execute("SELECT data FROM annonces ORDER BY rang DESC")]


def _nombre(x):
    try:
        return round(float(str(x).replace(",", ".").replace(" ", "").replace("€", "")), 2) if x not in (None, "") else None
    except ValueError:
        return None


def ajouter_annonces(con, lot: list) -> int:
    """Ajoute en tête les annonces jamais vues (le lot est déjà enrichi par tools/append.js)."""
    top = con.execute("SELECT COALESCE(MAX(rang), 0) FROM annonces").fetchone()[0]
    n = 0
    for a in reversed(lot):          # le premier du lot finit en tête
        if con.execute("SELECT 1 FROM annonces WHERE url = ?", (norm(a["u"]),)).fetchone():
            continue
        n += 1
        a = {**a, "p": _nombre(a.get("p"))}   # le prix vient d'une page web : un nombre, ou rien
        con.execute("INSERT INTO annonces VALUES (?, ?, ?, ?)",
                    (norm(a["u"]), top + n, json.dumps(a, ensure_ascii=False), a.get("added") or now()))
    con.commit()
    return n


# ---------- Ce que l'appli affiche ----------

def choix(con) -> dict:
    rows = [dict(r) for r in con.execute("SELECT * FROM etats")]
    return {
        "oui": [r["url"] for r in rows if r["choix"] == "oui"],
        "non": [r["url"] for r in rows if r["choix"] == "non"],
        "candidatures": {r["url"]: {k: v for k, v in (("etat", r["candidature"]), ("maj", r["candidature_le"]),
                                                         ("envoyee_le", r["envoyee_le"]), ("canal", r["canal"]),
                                                         ("message", r["message"])) if v}
                         for r in rows if r["candidature"]},
        "historique": [{k: v for k, v in dict(h).items() if k != "id" and v is not None}
                       for h in con.execute("SELECT * FROM historique ORDER BY date, id")],
        "ordre": pref(con, "ordre", []),
    }


def snapshot(con) -> dict:
    return {
        "listings": annonces(con),
        "resumes": {r["url"]: json.loads(r["data"]) for r in con.execute("SELECT url, data FROM fiches")},
        "choix": choix(con),
        "journal": [dict(r) for r in con.execute("SELECT date, quoi, pourquoi FROM journal ORDER BY id DESC")],
    }


# ---------- Reprise des anciens fichiers ----------

def migrer(con):
    """Reprend resumes.json, data/annonces.json ou selection.html, journal.json et la clé « ordre » de choix.json,
    puis range ces fichiers dans archives/avant-base/ (rien n'est effacé)."""
    ws, faits, ranges = WORKSPACE, [], []
    if not con.execute("SELECT 1 FROM annonces").fetchone():
        lot = None
        if (ws / "data" / "annonces.json").exists():
            lot, src = json.loads((ws / "data" / "annonces.json").read_text(encoding="utf-8")), ws / "data" / "annonces.json"
        elif (ws / "selection.html").exists():
            s = (ws / "selection.html").read_text(encoding="utf-8")
            i = s.find("window.ANNONCES = ")
            if i >= 0:
                lot, src = json.loads(s[i + 18:s.index("];", i) + 1]), None   # la page reste : elle sera régénérée
        if lot:
            faits.append(f"{ajouter_annonces(con, lot)} annonces")
            if src:
                ranges.append(src)
    if (ws / "resumes.json").exists() and not con.execute("SELECT 1 FROM fiches").fetchone():
        data = json.loads((ws / "resumes.json").read_text(encoding="utf-8"))
        for u, e in data.items():
            con.execute("INSERT OR REPLACE INTO fiches VALUES (?, ?, ?)", (norm(u), json.dumps(e, ensure_ascii=False), now()))
        con.commit()
        faits.append(f"{len(data)} fiches")
        ranges.append(ws / "resumes.json")
    if (ws / "journal.json").exists() and not con.execute("SELECT 1 FROM journal").fetchone():
        j = json.loads((ws / "journal.json").read_text(encoding="utf-8"))
        for e in reversed(j):            # le fichier met le plus récent en tête
            con.execute("INSERT INTO journal (date, quoi, pourquoi) VALUES (?, ?, ?)", (e.get("date"), e.get("quoi"), e.get("pourquoi", "")))
        con.commit()
        faits.append(f"{len(j)} lignes de journal")
        ranges.append(ws / "journal.json")
    if (ws / "choix.json").exists():
        c = json.loads((ws / "choix.json").read_text(encoding="utf-8"))
        if c.get("ordre") and not pref(con, "ordre"):
            set_pref(con, "ordre", c["ordre"])
            faits.append("l'ordre de la liste")
        ranges.append(ws / "choix.json")    # ses choix sont déjà dans etats / historique (suivi.py)
    arch = ws / "archives" / "avant-base"
    for f in ranges:
        arch.mkdir(parents=True, exist_ok=True)
        shutil.move(str(f), arch / f.name)
    print("repris : " + (", ".join(faits) or "rien de neuf") + (f" ; anciens fichiers rangés dans {arch.relative_to(ws)}/" if ranges else ""))


def main():
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help"):
        return print(__doc__)
    con, cmd = connect(), a[0]
    if cmd == "snapshot":
        print(json.dumps(snapshot(con), ensure_ascii=False))
    elif cmd == "fiche":
        src = sys.stdin.read() if a[1:] in ([], ["-"]) else (a[2] if len(a) > 2 else "{}")
        f = json.loads(src)
        if isinstance(f, str):           # le script de page renvoie une chaîne JSON
            f = json.loads(f)
        if isinstance(f, list):          # plusieurs verdicts d'un coup : [{"u", "verdict", "resume", "pour", "contre"}, …]
            for x in f:
                merge_fiche(con, x["u"], x)
            return print(f"{len(f)} fiches mises à jour")
        url = (f.get("u") or f.get("url")) if a[1:] in ([], ["-"]) else a[1]
        e = merge_fiche(con, url, f)
        print(f"Fiche enregistrée : {len(e.get('photos', []))} photos, {len(e.get('details', {}))} détails, "
              f"{len(e.get('description', ''))} caractères de description" + (f", verdict {e['verdict']}" if e.get("verdict") else ""))
    elif cmd == "voir":
        u = norm(a[1])
        f = con.execute("SELECT data FROM fiches WHERE url = ?", (u,)).fetchone()
        an = con.execute("SELECT data FROM annonces WHERE url = ?", (u,)).fetchone()
        print(json.dumps({"annonce": json.loads(an["data"]) if an else None, "fiche": json.loads(f["data"]) if f else None},
                         ensure_ascii=False, indent=1))
    elif cmd == "annonces-ajout":
        lot = json.loads(sys.stdin.read() if a[1:] in ([], ["-"]) else Path(a[1]).read_text(encoding="utf-8"))
        n = ajouter_annonces(con, lot)
        print(n, "ajoutées (", con.execute("SELECT COUNT(*) FROM annonces").fetchone()[0], "au total )")
    elif cmd == "annonces-position":
        for p in json.loads(sys.stdin.read()):
            r = con.execute("SELECT data FROM annonces WHERE url = ?", (norm(p["u"]),)).fetchone()
            if r: con.execute("UPDATE annonces SET data = ? WHERE url = ?", (json.dumps({**json.loads(r["data"]), "city": p["city"], "lat": p["lat"], "lng": p["lng"]}, ensure_ascii=False), norm(p["u"])))
        con.commit()
    elif cmd == "journal":
        con.execute("INSERT INTO journal (date, quoi, pourquoi) VALUES (?, ?, ?)",
                    (datetime.now().strftime("%Y-%m-%d"), a[1], a[2] if len(a) > 2 else ""))
        con.commit()
        print("noté dans le journal")
    elif cmd == "ordre":
        set_pref(con, "ordre", [norm(u) for u in a[1:]])
        print(f"ordre enregistré ({len(a) - 1} annonces)")
    elif cmd == "activite":
        rows = con.execute("SELECT * FROM activite ORDER BY id DESC LIMIT ?", (int(a[1]) if len(a) > 1 else 300,))
        leger = lambda d: {k: v for k, v in d.items() if k not in ("trace", "vues")}   # la trace se charge à part
        print(json.dumps([{**dict(r), "detail": leger(json.loads(r["detail"] or "{}"))} for r in rows], ensure_ascii=False))
    elif cmd == "activite-detail":
        r = con.execute("SELECT * FROM activite WHERE id = ?", (int(a[1]),)).fetchone()
        print(json.dumps({**dict(r), "detail": json.loads(r["detail"] or "{}")} if r else None, ensure_ascii=False))
    elif cmd == "activite-cherche":
        rows = con.execute("SELECT id FROM activite WHERE type = 'veille' AND detail LIKE ? ORDER BY id DESC", (f"%{a[1]}%",))
        print(json.dumps([r["id"] for r in rows]))
    elif cmd == "activite-ajout":
        e = json.loads(sys.stdin.read() if a[1:] in ([], ["-"]) else a[1])
        con.execute("INSERT INTO activite (date, type, titre, detail) VALUES (?, ?, ?, ?)",
                    (e.get("date") or now(), e.get("type", "info"), e.get("titre", ""), json.dumps(e.get("detail", {}), ensure_ascii=False)))
        con.execute("DELETE FROM activite WHERE id <= (SELECT MAX(id) FROM activite) - 3000")   # on garde les 3 000 dernières
        con.commit()
        print("noté")
    elif cmd == "migrer":
        migrer(con)
    else:
        sys.exit(f"commande inconnue : {cmd}\n\n{__doc__}")


if __name__ == "__main__":
    main()
