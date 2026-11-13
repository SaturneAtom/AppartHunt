#!/usr/bin/env python3
"""Suivi des annonces, dans la base agent/data/agent.db (tables etats et historique, voir donnees.py) :
la seule source de vérité pour « gardée / écartée » et les candidatures. Chaque changement y est daté.

  python3 tools/suivi.py voir <url>
  python3 tools/suivi.py choix <url> oui|non|aucun [--par toi|agent] [--note …]
  python3 tools/suivi.py candidature <url> <etat> [--par …] [--note …] [--canal leboncoin] [--message …]
  python3 tools/suivi.py liste                       toutes les annonces suivies

États de candidature : preparee → envoyee → relancee → visite → retenue | refusee | abandonnee.
« envoyee » est refusé si l'annonce a déjà une candidature partie (STOP, code de sortie 2) :
c'est le garde-fou contre une deuxième candidature par erreur. Nouveau message = « relancee ».
"""
import argparse
import json
import sys

from donnees import connect, norm, now   # même base, même schéma

ETATS = ["preparee", "envoyee", "relancee", "visite", "retenue", "refusee", "abandonnee"]
PARTIE = {"envoyee", "relancee", "visite", "retenue", "refusee"}


def etat(con, url) -> dict:
    row = con.execute("SELECT * FROM etats WHERE url = ?", (url,)).fetchone()
    return dict(row) if row else {"url": url}


def tracer(con, url, quoi, avant, apres, par, note=""):
    con.execute("INSERT INTO historique (date, url, quoi, avant, apres, par, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (now(), url, quoi, avant, apres, par, note or None))


def sauver(con, e: dict):
    cols = ["url", "choix", "choix_le", "candidature", "candidature_le", "envoyee_le", "canal", "message"]
    con.execute(f"INSERT OR REPLACE INTO etats ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                [e.get(c) for c in cols])


def cmd_voir(con, a):
    e = etat(con, a.url)
    h = [dict(r) for r in con.execute("SELECT date, quoi, avant, apres, par, note FROM historique WHERE url = ? ORDER BY date, id", (a.url,))]
    print(json.dumps({**e, "historique": h}, ensure_ascii=False, indent=2))


def cmd_liste(con, a):
    for r in con.execute("SELECT * FROM etats ORDER BY COALESCE(candidature_le, choix_le) DESC"):
        print(f"{r['choix'] or '—':>4}  {r['candidature'] or '':<10} {('envoyée le ' + r['envoyee_le'][:10]) if r['envoyee_le'] else '':<22} {r['url']}")


def cmd_choix(con, a):
    e = etat(con, a.url)
    avant, apres = e.get("choix"), None if a.valeur == "aucun" else a.valeur
    if avant == apres:
        return print(f"déjà {apres or 'sans choix'}, rien ne change")
    e.update(choix=apres, choix_le=now())
    sauver(con, e)
    tracer(con, a.url, "choix", avant, apres, a.par, a.note)
    con.commit()
    print(f"choix : {avant or 'aucun'} → {apres or 'aucun'}")


def cmd_candidature(con, a):
    con.execute("BEGIN IMMEDIATE")   # lecture et écriture d'un seul tenant : deux envois en même temps ne passent pas tous les deux
    e = etat(con, a.url)
    avant = e.get("candidature")
    if a.etat in ("envoyee", "preparee") and (avant in PARTIE or e.get("envoyee_le")):
        print(f"STOP : candidature déjà envoyée le {(e.get('envoyee_le') or '?')[:16].replace('T', ' à ')} (état : {avant}). "
              "Ne rien renvoyer ; pour un nouveau message, état « relancee » après son accord.", file=sys.stderr)
        sys.exit(2)
    if avant == a.etat and not (a.message or a.canal):
        return print(f"déjà {a.etat}, rien ne change")
    e.update(candidature=a.etat, candidature_le=now())
    if a.etat == "envoyee":
        e["envoyee_le"] = e["candidature_le"]
    if a.canal:
        e["canal"] = a.canal
    if a.message:
        e["message"] = a.message
    sauver(con, e)
    tracer(con, a.url, "candidature", avant, a.etat, a.par, a.note)
    con.commit()
    print(f"candidature : {avant or 'aucune'} → {a.etat}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(required=True)
    s = sub.add_parser("voir"); s.add_argument("url"); s.set_defaults(fn=cmd_voir)
    s = sub.add_parser("liste"); s.set_defaults(fn=cmd_liste, url=None)
    s = sub.add_parser("choix"); s.add_argument("url"); s.add_argument("valeur", choices=["oui", "non", "aucun"])
    s.set_defaults(fn=cmd_choix)
    s = sub.add_parser("candidature"); s.add_argument("url"); s.add_argument("etat", choices=ETATS)
    s.add_argument("--canal"); s.add_argument("--message"); s.set_defaults(fn=cmd_candidature)
    for s in sub.choices.values():
        s.add_argument("--par", default="agent"); s.add_argument("--note", default="")
    a = p.parse_args()
    if a.url:
        a.url = norm(a.url)
    a.fn(connect(), a)


if __name__ == "__main__":
    main()
