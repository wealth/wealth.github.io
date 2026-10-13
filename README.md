# Lampa + Twitch

A fork of [Lampa](https://github.com/yumata/lampa) with **Twitch, Kick and live baseball as first-class sidebar sections**.

Lampa is a free media catalog for Smart TVs (movies and series via public metadata). This fork keeps that app and adds the unofficial Twitch client that used to live in this repo as a standalone Media Station X plugin, plus a Kick section and a Baseball section built the same way.

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
- **Chat overlay** on live playback (Twitch / 7TV / BTTV / FFZ emotes)
- Settings under **Settings → Twitch**: chat layout, quality, regional ad-block playlist proxies

Long-press a live card to open the channel page. Playback uses Lampa’s player.

Twitch code lives in:

```
plugins/twitch.js   Lampa section (menu, catalog, channel, login, player hook)
plugins/twitch.css  Cards, channel page, chat overlay
js/twitch.js        Twitch GQL / playback
js/auth.js          OAuth device-code login
js/chat.js          Chat overlay (shared with Kick)
```

## Kick section

Open **Kick** in the Lampa sidebar (directly under Twitch).

- **Featured** (in the app's language where Kick has picks for it, English otherwise), **Top streams** and **Categories**
- **Search** for channels and categories
- **Favorites** stored on the device — Kick has no TV login flow, so this stands in for "following"
- **Channel pages** with recent VODs; VODs resume where you stopped
- **Chat overlay** on live playback (Kick / 7TV emotes), with the same button, remote keys and **Settings → Twitch** layout options as Twitch chat

Long-press a live card to open the channel page.

Two things work differently from Twitch, both because of what Kick lets another origin do:

- **Chat is sampled, not complete.** Kick's live chat socket only accepts connections from kick.com, so the overlay polls the public chat history instead: the newest ~25 messages every few seconds. Quiet chats come through whole; busy ones are a sample.
- **Live quality is chosen by the TV.** The live playlist cannot be read from another origin, so there is no quality picker for live streams. VODs do get one.

```
plugins/kick.js     Lampa section (menu, catalog, channel, player hook)
plugins/kick.css    Cards and channel page
js/kick.js          kick.com API (no key, no proxy)
js/chat.js          Chat overlay, shared with Twitch
```

## Baseball section

Open **Baseball** in the Lampa sidebar. It carries KBO (Korean baseball), which SOOP streams free worldwide.

- **Live now** — every game in progress
- **Replays** — every finished game in full, newest first, up to 1080p; **More** opens the whole archive (SOOP keeps a year). Replays resume where you stopped, and deliberately show no scores
- **Schedule** — the next seven days in your own timezone, with scores for today's games

```
plugins/baseball.js   Lampa section (live, replays, schedule)
plugins/baseball.css  Cards
js/soop.js            SOOP API + KBO schedule
worker/soop-proxy.js  Cloudflare Worker in front of the origin-locked SOOP calls
```

The Worker is deployed by hand (steps are at the top of the file) and is **not rebuilt from the repo**: re-paste it into Cloudflare whenever `worker/soop-proxy.js` changes. Until then the app says which feature is waiting for it — replays, for instance, list fine but need the `/vod` route to play.

Not affiliated with Twitch, Kick, SOOP, Amazon, or Lampa’s authors.

## Install for MSX

This TV's MSX webview can't reach GitHub's Fastly edge (`wealth.github.io`, `185.199.x`): connections hang ~60s and fail with **status 0 / operation timed out**. It reaches Cloudflare fine. Proven with an A/B probe: the *same* static page opened via a Cloudflare CDN but timed out via github.io. So the app is served through a **Cloudflare-proxied domain that fronts GitHub Pages** — the TV only ever talks to Cloudflare.

On the TV:

1. **Settings → Start Parameter → Setup**
2. **HTTPS lock ON**
3. Enter `lampa.demitori.com`

MSX fetches `https://lampa.demitori.com/msx/start.json` and opens the app with `link:https://lampa.demitori.com/`. No TinyURL or jsDelivr needed — it's one Cloudflare origin, same-origin throughout.

### Cloudflare + GitHub Pages (one-time)

GitHub Pages stays the origin; Cloudflare proxies the host so the TV never hits Fastly.

1. **Cloudflare → DNS**: add `CNAME  lampa → wealth.github.io`, **grey-cloud (DNS only)** for now.
2. Push this repo (the `CNAME` file sets the custom domain). **GitHub → Settings → Pages**: wait for the TLS certificate to be issued, then enable **Enforce HTTPS**.
3. **Cloudflare → DNS**: flip the record to **orange-cloud (Proxied)**.
4. **Cloudflare → SSL/TLS**: set the mode to **Full**.

Only the bokeh background images still load from `yumata.github.io` (cosmetic, non-blocking).

## Docker

1. Put your host in `msx/start.json`.
2. `docker build -t lampa .`
3. `docker run -p 8080:80 -d --restart unless-stopped --name lampa lampa`

## Run locally

```
npx http-server . -p 8080 --cors
```

Open `http://localhost:8080`. Twitch and Kick browsing work in a desktop browser; **live video usually only plays on a real TV** (the Twitch and Kick CDNs only answer their own sites' scripts). Kick VODs and baseball replays play on desktop too.

## Upstream

- Lampa app: [yumata/lampa](https://github.com/yumata/lampa)
- Lampa source: [yumata/lampa-source](https://github.com/yumata/lampa-source)
- Original Twitch TV inspiration: [fgl27/smarttwitchtv](https://github.com/fgl27/smarttwitchtv)
