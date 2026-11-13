"""
Builds the game page, client/index.html, from client/src/ (page, styles, script) plus the game
content (data/game_data.json) and every balance number (data/balance.json). One self-contained
file: it runs on GitHub Pages and also when opened straight from your computer.

Usage:
    python tools/build_client.py                       # local build, footer says "Development version"
    python tools/build_client.py --version 2026.11.13  # what the release workflow runs (footer: "Version 2026.11.13")
    python tools/build_client.py --version 2026.11.13 --out site/client/index.html
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "client" / "src"
OUT = ROOT / "client" / "index.html"

# Only what the page uses, to keep it small.
KEEP = {
    "materials": ("name", "icon", "quality", "sell", "profession", "rank", "slot", "unlock"),
    "recipes": ("name", "icon", "quality", "sell", "profession", "rank", "slot", "unlock", "role", "reagents"),
    "fire_resistance_set": ("name", "icon", "quality", "profession", "slot", "unlock", "reagents", "fire_resistance"),
    "mobs": ("name", "level", "classification", "trait", "boss", "zone", "rank", "slot", "unlock", "image", "cloth"),
}
SECTIONS = ("ranks", "professions", "traits", "ui_icons", *KEEP)


def game_data() -> dict:
    d = json.loads((ROOT / "data" / "game_data.json").read_text(encoding="utf-8"))
    for key, fields in KEEP.items():
        d[key] = [{f: row[f] for f in fields if f in row} for row in d[key]]
    return {key: d[key] for key in SECTIONS}


def strip_notes(value):
    """balance.json documents itself with "_" keys; the page doesn't need them."""
    if isinstance(value, dict):
        return {k: strip_notes(v) for k, v in value.items() if not k.startswith("_")}
    return value


RELEASES = "https://github.com/ChakraaThePanda/Archipelago-SkillUp/releases"


def version_link(tag: str | None) -> str:
    """Footer text, linking to the release it was built from (or to every release for a local build)."""
    href = f"{RELEASES}/tag/{tag}" if tag else RELEASES
    text = f"Version {tag.removeprefix('v')}" if tag else "Development version"
    return f'<a class="ver" href="{html.escape(href)}" target="_blank" rel="noopener">{html.escape(text)}</a>'


def build(version: str | None = None) -> str:
    page = (SRC / "index.html").read_text(encoding="utf-8")
    balance = strip_notes(json.loads((ROOT / "data" / "balance.json").read_text(encoding="utf-8")))
    parts = {
        "/*__STYLE__*/": (SRC / "style.css").read_text(encoding="utf-8"),
        "/*__LINKS__*/": (SRC / "links.html").read_text(encoding="utf-8"),
        "/*__GAME_DATA__*/null": json.dumps(game_data(), separators=(",", ":"), ensure_ascii=False),
        "/*__BALANCE__*/null": json.dumps(balance, separators=(",", ":")),
        "/*__SCRIPT__*/": (SRC / "game.js").read_text(encoding="utf-8"),
        "/*__VERSION__*/": version_link(version),
        "/*__LOGO__*/": "data:image/png;base64," + base64.b64encode((SRC / "logo.png").read_bytes()).decode(),
    }
    for marker, text in parts.items():
        if marker not in page:
            raise SystemExit(f"{marker} missing from client/src/index.html")
        page = page.replace(marker, text)
    return page


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build client/index.html")
    ap.add_argument("--version", help="the release tag, shown in the page footer and linked to its release, e.g. 2026.11.13")
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    a = ap.parse_args()
    page = build(a.version)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(page, encoding="utf-8")
    print(f"Built {a.out} ({len(page) // 1024} KB)")
