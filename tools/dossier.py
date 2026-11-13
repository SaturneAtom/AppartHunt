"""Vérifie le dossier locataire et l'assemble en un seul PDF.

Usage : python3 tools/dossier.py
Pièces dans ma-recherche/dossier/pieces/ (et .../pieces/garant/ ; APPARTHUNT_WORKSPACE pour un autre dossier), nommées 1-identite, 2-domicile, ... (voir dossier/README.md).
Utilise les outils macOS : sips (image → PDF), cupsfilter (page de garde), join (fusion).
"""
import datetime, os, pathlib, subprocess, sys

root = pathlib.Path(os.environ.get("APPARTHUNT_WORKSPACE") or pathlib.Path(__file__).resolve().parent.parent / "ma-recherche")   # le dossier de recherche
d = root / "dossier"
pieces, garant, build = d / "pieces", d / "pieces" / "garant", d / ".build"
JOIN = "/System/Library/Automator/Combine PDF Pages.action/Contents/MacOS/join"
EXT = (".pdf", ".jpg", ".jpeg", ".png", ".heic")

ATTENDU = [
    ("1-identite", "Pièce d'identité"),
    ("2-domicile", "Justificatif de domicile"),
    ("3-contrat", "Contrat de travail / attestation employeur"),
    ("4-salaire-1", "Bulletin de salaire n°1"),
    ("4-salaire-2", "Bulletin de salaire n°2"),
    ("4-salaire-3", "Bulletin de salaire n°3"),
    ("5-impots", "Dernier avis d'imposition"),
]


def trouve(dossier, nom):
    return sorted(p for p in dossier.glob(nom + "*") if p.suffix.lower() in EXT)


def verifier():
    manque, liste = [], []
    for nom, libelle in ATTENDU:
        f = trouve(pieces, nom)
        (liste.extend((libelle, p) for p in f)) if f else manque.append(libelle)
    visale = trouve(garant, "visa-visale")
    if visale:
        liste += [("Garant : visa Visale", p) for p in visale]
    else:
        g = [(f"Garant : {lib}", p) for nom, lib in ATTENDU for p in trouve(garant, nom)]
        liste += g if g else []
        if not g:
            manque.append("Garant (visa Visale ou pièces du garant)")
    # Bulletins : on signale ceux qui ont plus de 4 mois (date du fichier)
    vieux = [p.name for lib, p in liste if "salaire" in p.name
             and (datetime.datetime.now() - datetime.datetime.fromtimestamp(p.stat().st_mtime)).days > 120]
    return liste, manque, vieux


def en_pdf(src, i):
    if src.suffix.lower() == ".pdf":
        return src
    out = build / f"{i:02d}.pdf"
    subprocess.run(["sips", "-s", "format", "pdf", str(src), "--out", str(out)], check=True, capture_output=True)
    return out


def page_de_garde(liste):
    profil = (d / "profil.txt").read_text() if (d / "profil.txt").exists() else ""
    lignes = [l for l in profil.splitlines() if l.split(":", 1)[-1].strip()]
    txt = build / "garde.txt"
    txt.write_text("DOSSIER DE CANDIDATURE — LOCATION\n\n" + "\n".join(lignes)
                   + "\n\nPièces jointes :\n" + "\n".join(f"  - {lib}" for lib, _ in liste) + "\n")
    out = build / "00-garde.pdf"
    with open(out, "wb") as f:
        subprocess.run(["cupsfilter", str(txt)], stdout=f, stderr=subprocess.DEVNULL, check=True)
    return out


def main():
    liste, manque, vieux = verifier()
    print("Présent :")
    for lib, p in liste:
        print(f"  ✓ {lib} — {p.name}")
    if manque:
        print("Manquant :")
        for m in manque:
            print(f"  ✗ {m}")
    for v in vieux:
        print(f"  ⚠ {v} semble daté de plus de 4 mois : vérifie que ce sont bien les 3 derniers")
    if not liste:
        print("\nRien à assembler pour l'instant.")
        return
    build.mkdir(exist_ok=True)
    pdfs = [page_de_garde(liste)] + [en_pdf(p, i) for i, (_, p) in enumerate(liste, 1)]
    out = d / "dossier-locataire.pdf"
    subprocess.run([JOIN, "-o", str(out)] + [str(p) for p in pdfs], check=True)
    print(f"\nPDF prêt : {out.relative_to(root)} ({out.stat().st_size // 1024} Ko)"
          + (" — incomplet, à compléter avant envoi" if manque else ""))


if __name__ == "__main__":
    sys.exit(main())
