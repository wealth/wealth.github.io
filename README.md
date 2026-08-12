# Smart Twitch TV for Media Station X

An unofficial Twitch client that runs inside [Media Station X](https://msx.benzac.de/info/) on LG webOS TVs (and any other platform MSX supports — Samsung Tizen, Android TV, Fire TV, etc.).

Inspired by [SmartTwitchTV](https://github.com/fgl27/smarttwitchtv) for Android. This is a from-scratch web port for the MSX platform — no Android code involved.

## Features

- **Chat overlay on video** — live Twitch chat rendered over the stream, with **7TV and BetterTTV emotes** (global + per-channel) plus native Twitch emotes, colored usernames, and flood protection
  - **Position** (left / right), **height from bottom** (full / 75% / 50% / 25%), **width** (30–10% of screen), and **text size** — all switchable in Settings and live during playback
  - **Live viewer count** at the top of the chat (refreshed every minute; Twitch locks the chatters-only count behind bot protection, so viewers is shown)
  - Anonymous IRC-over-WebSocket connection, no login needed
- **Player controls show the stream title** (not just the streamer name) and the **total stream uptime** in the corner, ticking live
- **Top streams** — browse the most-viewed live channels, with previews, viewer counts, and games
- **Games** — top categories with box art; open a game to see its live streams
- **Search** — on-screen keyboard (remote-friendly), finds channels and games as you type
- **Channel pages** — live preview, stream title, game, uptime, follower count, watch button
- **Recent videos (VODs)** — play past broadcasts of any channel
- **Favorites** — your own followed-channels list, stored on the TV, live channels sorted first (no Twitch login needed)
- **Settings** — chat overlay, preferred stream quality, and player selection
- Uses Twitch's public GQL API anonymously — no login, no API key, no backend server. All requests go directly from the TV to Twitch.

## Repository layout

```
msx/start.json   MSX start parameter file (entry point)
main.html        Interaction plugin (the app shell MSX loads)
js/twitch.js     Twitch API layer (GQL queries, playback tokens, HLS URL handling)
js/app.js        UI: menu, pages, cards, search, favorites, settings, playback
player.html      Video player page with the chat overlay (native HLS + hls.js fallback)
js/player.js     Player logic (video + chat options panel)
js/chat.js       Chat overlay: Twitch IRC over WebSocket, 7TV/BTTV/Twitch emotes
```

Everything is static files — host them on any web server.

## Setup on an LG TV (webOS)

1. **Host these files** somewhere the TV can reach:
   - **GitHub Pages (easiest):** push this repo to GitHub, enable Pages. Your app lives at `https://<user>.github.io/<repo>/`.
   - **Local server on your LAN:**
     ```
     npx http-server /path/to/smart-twitch-tv-msx -p 8080 --cors
     ```
     (Any static server works; CORS headers are recommended so the MSX app can fetch `start.json`.)

2. **Install "Media Station X"** from the LG Content Store on the TV.

3. Open Media Station X → **Settings → Start Parameter → Setup**, and enter the location, without protocol:
   - GitHub Pages: `<user>.github.io` (choose the **security lock/https** option when asked)
   - Local server: `192.168.x.x:8080` (your computer's IP)

   MSX then loads `<host>/msx/start.json` and starts the app.

   **Note:** the MSX on-screen keyboard has no `/`, so the app must be hosted at the **root** of a host — use the GitHub Pages *user site* repo (named exactly `<user>.github.io`), not a project repo with a path.

4. If you host somewhere else, edit [msx/start.json](msx/start.json) and set the parameter to the full absolute URL of `main.html` at your host, e.g.:
   ```json
   "parameter": "menu:request:interaction:init@https://your.host/main.html"
   ```

## Remote control quick reference

- **OK** on a live stream card → plays immediately (no intermediate page)
- **Options/menu key** on a card → "Channel & videos" (channel page with recent VODs); offline channels open it directly
- **Back** → previous page / stop playback

### During playback

- **OK** → player controls (with stream title and total stream time)
- **Green** → chat on/off
- **Yellow** → chat position left/right
- **Channel up** → chat height (Full → 75% → 50% → 25%)
- **Channel down** → chat width (30% → 25% → 20% → 15% → 10%)
- **Settings icon** in the player controls → options panel: **add/remove favorite**, chat toggle, position, height, width, text size

(Arrow keys are reserved by the Media Station X player for navigation and seeking, and red/blue for restart/menu — so chat shortcuts live on the green/yellow and channel keys.)

Changes apply instantly and are remembered. The same chat options are available app-wide under **Settings**.

## Settings notes

- **Chat overlay** — when On, live streams play through the bundled player page so chat can be drawn over the video (native HLS first, hls.js as automatic fallback). When Off, playback uses the player selected below.
- **Stream quality** — `Auto` hands Twitch's adaptive master playlist to the player (recommended on TVs). Fixed qualities (Source/720p/…) require reading the playlist from the TV browser; on platforms where Twitch's CDN blocks that (CORS), playback silently falls back to Auto.
- **Player (chatless playback)** — `TV player` uses the TV's native HLS support via MSX (recommended on webOS). `App player` is the bundled [player.html](player.html) without chat. Note: desktop browsers can't fetch Twitch streams at all due to Twitch CDN CORS policy — that's a Twitch restriction, not a bug; on TVs native playback is unaffected (chat still works everywhere).

## Testing in a desktop browser

The MSX web shell can run the app on your computer:

```
https://msx.benzac.de/?start=menu:request:interaction:init@https://<your-host>/main.html
```

The plugin URL must be **https** (the shell upgrades http URLs). For localhost you'll need a self-signed certificate and to accept it in the browser first. Browsing, search, and favorites fully work on desktop; **video playback works only on real TVs** (Twitch's CDN only allows twitch.tv web origins to read streams via JavaScript — TVs play them natively instead).

## If Twitch requests start failing

Twitch occasionally rotates its public web Client-ID. The app tries several known IDs automatically (see `CLIENT_IDS` in [js/twitch.js](js/twitch.js)). If all of them stop working, grab the current one:

```
curl -s https://www.twitch.tv/ | grep -oE 'clientId="[^"]+"'
```

and put it first in the `CLIENT_IDS` array.

## Disclaimer

Unofficial hobby project. Not affiliated with, endorsed by, or supported by Twitch Interactive, Amazon, LG, or Media Station X. Uses the publicly reachable Twitch API the same way a web browser does; no ads are removed and no paywalls are bypassed. Credits: [fgl27/smarttwitchtv](https://github.com/fgl27/smarttwitchtv) for the inspiration, [Benjamin Zachey](https://msx.benzac.de/info/) for Media Station X, [hls.js](https://github.com/video-dev/hls.js) for the fallback player.
