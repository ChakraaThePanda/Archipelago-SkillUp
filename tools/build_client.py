"""
Builds the game page, client/index.html, from client/src/ (page, styles, script) plus the game
content (data/game_data.json) and every balance number (data/balance.json). One self-contained
file: it runs on GitHub Pages and also when opened straight from your computer.

Usage:
    python tools/build_client.py
"""
from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "client" / "src"
OUT = ROOT / "client" / "index.html"

# Only what the page uses, to keep it small.
KEEP = {
    "materials": ("name", "id", "icon", "quality", "sell", "profession", "rank", "slot", "unlock"),
    "recipes": ("name", "id", "icon", "quality", "sell", "profession", "rank", "slot", "unlock", "role", "reagents"),
    "fire_resistance_set": ("name", "id", "icon", "quality", "profession", "slot", "unlock", "reagents", "fire_resistance"),
}


def game_data() -> dict:
    d = json.loads((ROOT / "data" / "game_data.json").read_text(encoding="utf-8"))
    for key, fields in KEEP.items():
        d[key] = [{f: row[f] for f in fields if f in row} for row in d[key]]
    return d


def strip_notes(value):
    """balance.json documents itself with "_" keys; the page doesn't need them."""
    if isinstance(value, dict):
        return {k: strip_notes(v) for k, v in value.items() if not k.startswith("_")}
    return value


def build() -> str:
    page = (SRC / "index.html").read_text(encoding="utf-8")
    balance = strip_notes(json.loads((ROOT / "data" / "balance.json").read_text(encoding="utf-8")))
    parts = {
        "/*__STYLE__*/": (SRC / "style.css").read_text(encoding="utf-8"),
        "/*__LINKS__*/": (SRC / "links.html").read_text(encoding="utf-8"),
        "/*__GAME_DATA__*/null": json.dumps(game_data(), separators=(",", ":"), ensure_ascii=False),
        "/*__BALANCE__*/null": json.dumps(balance, separators=(",", ":")),
        "/*__SCRIPT__*/": (SRC / "game.js").read_text(encoding="utf-8"),
    }
    for marker, text in parts.items():
        if marker not in page:
            raise SystemExit(f"{marker} missing from client/src/index.html")
        page = page.replace(marker, text)
    return page


if __name__ == "__main__":
    html = build()
    OUT.write_text(html, encoding="utf-8")
    print(f"Built {OUT.relative_to(ROOT)} ({len(html) // 1024} KB)")
