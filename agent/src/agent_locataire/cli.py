"""Ligne de commande : agent-locataire tool | log | status | approvals | login | run (mode API)."""
import argparse
import json

from . import db


def cmd_run(args):
    from .agent import run
    print("🏠 Passage de l'agent…")
    print(run())
    cmd_status(args)


def cmd_tool(args):
    """Appelle un outil et affiche son résultat JSON (utilisé par le skill Claude Code)."""
    import uuid
    from .tools import BY_NAME, NEEDS_BROWSER, Session
    fn = BY_NAME.get(args.name)
    if not fn:
        raise SystemExit(f"Outil inconnu : {args.name}. Outils : {', '.join(BY_NAME)}")
    raw = args.params or "{}"
    if raw.startswith("@"):  # @fichier.json : paramètres lus dans un fichier .json du dossier de recherche ou du projet
        from pathlib import Path
        f = Path(raw[1:]).expanduser().resolve()
        permis = [db.DATA_DIR.parents[1].resolve(), Path(__file__).resolve().parents[3]]
        if f.suffix != ".json" or not any(f.is_relative_to(d) for d in permis):
            raise SystemExit(f"Fichier refusé : {f} (seulement un .json du dossier de recherche ou du projet)")
        raw = f.read_text(encoding="utf-8")
    params = json.loads(raw)
    Session.con, Session.run_id = db.connect(), args.run or uuid.uuid4().hex[:8]
    db.log(Session.con, Session.run_id, "outil", {"nom": args.name, "entree": params})
    if args.name in NEEDS_BROWSER:
        from .browser import browser
        with browser() as ctx:
            Session.ctx = ctx
            print(fn(**params))
    else:
        print(fn(**params))


def cmd_log(args):
    """Note une étape du raisonnement dans le journal (affiché par le panneau « cerveau »)."""
    con = db.connect()
    db.log(con, args.run, args.kind, args.text)
    print("ok")


def cmd_login(args):
    from .browser import browser
    print("Une fenêtre Chrome s'ouvre avec le profil de l'agent. Connecte-toi à Leboncoin, puis ferme-la.")
    with browser() as ctx:
        page = ctx.new_page()
        page.goto("https://www.leboncoin.fr/")
        page.wait_for_event("close", timeout=0)


def cmd_status(args):
    con = db.connect()
    last = con.execute("SELECT payload FROM events WHERE kind = 'fin' ORDER BY ts DESC LIMIT 1").fetchone()
    if last:
        print("Dernier passage :", json.loads(last["payload"]))
    rows = con.execute("SELECT id, price, m2, city, district, score, verdict_reasons FROM listings "
                       "WHERE verdict = 'keep' ORDER BY score DESC LIMIT 10").fetchall()
    for r in rows:
        print(f"  {r['score'] if r['score'] is not None else '?':>3}/100  {r['price']} €  {r['m2'] or '?'} m²  {r['city']} {r['district'] or ''} — {r['verdict_reasons']}")


def cmd_approvals(args):
    con = db.connect()
    rows = con.execute("SELECT a.id, a.listing_id, a.payload, l.url, l.title FROM approvals a "
                       "LEFT JOIN listings l ON l.id = a.listing_id WHERE a.status = 'pending'").fetchall()
    if not rows:
        print("Aucune candidature en attente.")
    for r in rows:
        print(f"\n#{r['id']}  {r['title']}\n{r['url']}\n---\n{json.loads(r['payload'])['message']}\n---")
        choice = input("Valider l'envoi ? (o = oui, n = non, Entrée = plus tard) ").strip().lower()
        if choice in ("o", "n"):
            con.execute("UPDATE approvals SET status = ? WHERE id = ?", ("approved" if choice == "o" else "declined", r["id"]))
            con.commit()
    # L'envoi des candidatures validées arrive à l'étape suivante du projet.


def main():
    p = argparse.ArgumentParser(prog="agent-locataire", description="Agent IA qui cherche un appartement à ta place.")
    sub = p.add_subparsers(required=True)
    for name, fn, help_ in [("run", cmd_run, "lance un passage via l'API Anthropic (nécessite une clé)"),
                            ("login", cmd_login, "ouvre le navigateur de l'agent pour te connecter aux sites"),
                            ("status", cmd_status, "affiche le dernier passage et la sélection"),
                            ("approvals", cmd_approvals, "valide ou refuse les candidatures préparées")]:
        sp = sub.add_parser(name, help=help_)
        sp.set_defaults(fn=fn)
    sp = sub.add_parser("tool", help="appelle un outil de l'agent (JSON en entrée et en sortie)")
    sp.add_argument("name"); sp.add_argument("params", nargs="?"); sp.add_argument("--run")
    sp.set_defaults(fn=cmd_tool)
    sp = sub.add_parser("log", help="note une étape de raisonnement dans le journal")
    sp.add_argument("run"); sp.add_argument("kind", choices=["pensee", "texte", "fin"]); sp.add_argument("text")
    sp.set_defaults(fn=cmd_log)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
