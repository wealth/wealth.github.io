# Lampa + Twitch

A fork of [Lampa](https://github.com/yumata/lampa) with **Twitch as a first-class sidebar section**.

Lampa is a free media catalog for Smart TVs (movies and series via public metadata). This fork keeps that app and adds the unofficial Twitch client that used to live in this repo as a standalone Media Station X plugin.

Sources for Lampa itself: [yumata/lampa-source](https://github.com/yumata/lampa-source).

#### Devices

* LG WebOS
* Samsung Tizen
* MSX
* Android
* MacOS
* Windows

## Twitch section

Open **Twitch** in the Lampa sidebar.

- **Top streams** and **Games** (open a game to see its live channels)
- **Search** for channels and games
- **Favorites** stored on the device
- **Channel pages** with recent VODs
- **Optional Twitch login** (device code at [twitch.tv/activate](https://www.twitch.tv/activate)) for **Following** and **Recommended**
- **Chat overlay** on live playback (Twitch / 7TV / BTTV emotes)
- Settings under **Settings → Twitch**: chat layout, quality, regional ad-block playlist proxies

Long-press a live card to open the channel page. Playback uses Lampa’s player.

Twitch code lives in:

```
plugins/twitch.js   Lampa section (menu, catalog, channel, login, player hook)
plugins/twitch.css  Cards, channel page, chat overlay
js/twitch.js        Twitch GQL / playback
js/auth.js          OAuth device-code login
js/chat.js          IRC chat overlay
```

Not affiliated with Twitch, Amazon, or Lampa’s authors.

## Install for MSX

You need your own hosting or a local web server.

1. Host this repo (GitHub Pages works; this user site is `https://wealth.github.io`).
2. Open `msx/start.json` and set the host if you are not using `wealth.github.io`.
3. Install **Media Station X**, then set the start parameter to that host (no `https://`).

MSX loads `/msx/start.json` and opens Lampa via `link:`.

## Docker

1. Put your host in `msx/start.json`.
2. `docker build -t lampa .`
3. `docker run -p 8080:80 -d --restart unless-stopped --name lampa lampa`

## Run locally

```
npx http-server . -p 8080 --cors
```

Open `http://localhost:8080`. Twitch browsing works in a desktop browser; **live video usually only plays on a real TV** (Twitch CDN CORS).

## Upstream

- Lampa app: [yumata/lampa](https://github.com/yumata/lampa)
- Lampa source: [yumata/lampa-source](https://github.com/yumata/lampa-source)
- Original Twitch TV inspiration: [fgl27/smarttwitchtv](https://github.com/fgl27/smarttwitchtv)
