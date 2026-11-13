"""Ancien nom, gardé pour les habitudes : enregistre une fiche dans la base (voir donnees.py).

    python3 tools/save_fiche.py fiche.json          # ou : … | python3 tools/save_fiche.py -
"""
import pathlib
import subprocess
import sys

src = sys.stdin.read() if sys.argv[1:] in ([], ["-"]) else pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
sys.exit(subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("donnees.py")), "fiche", "-"], input=src, text=True).returncode)
