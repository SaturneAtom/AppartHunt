"""Stockage local (SQLite) : annonces, journal de l'agent, mémoire et actions en attente de validation."""
import json
import os
import sqlite3
import time
from pathlib import Path

# Données dans le dossier de recherche : APPARTHUNT_WORKSPACE s'il est défini, sinon ma-recherche/ à la racine du projet
DATA_DIR = Path(os.environ.get("APPARTHUNT_WORKSPACE") or Path(__file__).resolve().parents[3] / "ma-recherche") / "agent" / "data"
DB_PATH = DATA_DIR / "agent.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,          -- site:identifiant (ex. leboncoin:1234567890)
    site TEXT, url TEXT, title TEXT,
    price INTEGER, m2 REAL, rooms INTEGER,
    city TEXT, district TEXT, floor INTEGER,
    furnished INTEGER, dpe TEXT, parking INTEGER, outdoor TEXT,
    description TEXT, photos TEXT,  -- JSON : liste d'URL
    lat REAL, lng REAL,
    first_seen REAL, last_seen REAL,
    score INTEGER, score_detail TEXT,  -- JSON
    verdict TEXT,                      -- keep / reject / null
    verdict_reasons TEXT
);
CREATE TABLE IF NOT EXISTS events (
    ts REAL, run_id TEXT, kind TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS memory (
    ts REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL, action TEXT, listing_id TEXT, payload TEXT,
    status TEXT DEFAULT 'pending'      -- pending / approved / declined / done
);
"""


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def upsert_listing(con: sqlite3.Connection, ad: dict) -> bool:
    """Insère ou met à jour une annonce. Renvoie True si elle est nouvelle."""
    now = time.time()
    known = con.execute("SELECT 1 FROM listings WHERE id = ?", (ad["id"],)).fetchone()
    cols = ["id", "site", "url", "title", "price", "m2", "rooms", "city", "district", "floor",
            "furnished", "dpe", "parking", "outdoor", "description", "photos", "lat", "lng"]
    values = [json.dumps(ad.get(c)) if c == "photos" else ad.get(c) for c in cols]
    if known:
        sets = ", ".join(f"{c} = ?" for c in cols[1:])
        con.execute(f"UPDATE listings SET {sets}, last_seen = ? WHERE id = ?", values[1:] + [now, ad["id"]])
    else:
        con.execute(
            f"INSERT INTO listings ({', '.join(cols)}, first_seen, last_seen) VALUES ({', '.join('?' * len(cols))}, ?, ?)",
            values + [now, now],
        )
    con.commit()
    return not known


def get_listing(con: sqlite3.Connection, listing_id: str) -> dict | None:
    row = con.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["photos"] = json.loads(d["photos"] or "[]")
    d["score_detail"] = json.loads(d["score_detail"] or "null")
    return d


def log(con: sqlite3.Connection, run_id: str, kind: str, payload) -> None:
    con.execute("INSERT INTO events VALUES (?, ?, ?, ?)",
                (time.time(), run_id, kind, json.dumps(payload, ensure_ascii=False, default=str)))
    con.commit()
