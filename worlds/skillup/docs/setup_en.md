# Skillup Setup Guide

## Generating

1. Put `skillup.apworld` in your Archipelago `custom_worlds` folder (or double-click it).
2. Generate a template YAML from the Launcher (Generate Template Options), edit it, and
   generate / host as usual.

## Playing

1. Open the game page:
   <https://chakraathepanda.github.io/Archipelago-Skillup/client/>
2. Enter the server (e.g. `archipelago.gg:38281`) and your slot name, then Connect.

You can bookmark `https://chakraathepanda.github.io/Archipelago-Skillup/client/?server=archipelago.gg:38281&slot=YourName` to
skip typing on your phone.

## Saves

Your progress is saved on the Archipelago server for that room and slot, plus a copy in your
browser. Open the same room and slot on any device and it picks up where you left off
(whichever copy is newer wins). Don't play the same slot on two devices at the same time: the
last one to save overwrites the other.

## While the page is closed

For up to 8 hours, each slot keeps repeating what it was doing. Nothing is sold while the page
is closed: once a material's storage is full, extra materials are lost (you still gain skill).
Time away beyond 8 hours turns into Rested XP. Before leaving, "Sell all" a material to make room.

The page is served over HTTPS, so it can only reach servers that accept secure websockets
(`wss://`). archipelago.gg does. For a self-hosted server without TLS, download the HTML
file and open it locally, then enter `ws://host:port`.
