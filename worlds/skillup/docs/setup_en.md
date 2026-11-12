# Skillup Setup Guide

## Generating

1. Put `skillup.apworld` in your Archipelago `custom_worlds` folder (or double-click it).
2. Generate a template YAML from the Launcher (Generate Template Options), edit it, and
   generate / host as usual.

## Playing

1. Open the game page:
   <https://htmlpreview.github.io/?https://github.com/ChakraaThePanda/Archipelago-Skillup/blob/main/client/Skillup.html>
2. Enter the server (e.g. `archipelago.gg:38281`) and your slot name, then Connect.

You can bookmark `...Skillup.html?server=archipelago.gg:38281&slot=YourName` to
skip typing on your phone.

## Saves

Your progress is saved in the Archipelago server's data storage for that room and slot,
plus a local copy in the browser. Open the same room and slot on any device and it picks
up where you left off (whichever copy is newer wins). Don't play the same slot on two
devices at the same time: the last one to save overwrites the other.

The page is served over HTTPS, so it can only reach servers that accept secure websockets
(`wss://`). archipelago.gg does. For a self-hosted server without TLS, download the HTML
file and open it locally, then enter `ws://host:port`.
