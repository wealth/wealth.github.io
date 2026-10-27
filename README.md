# Lampa + Twitch

A fork of [Lampa](https://github.com/yumata/lampa) with **Twitch, Kick, live baseball and free Russian TV as first-class sidebar sections**.

Lampa is a free media catalog for Smart TVs (movies and series via public metadata). This fork keeps that app and adds the unofficial Twitch client that used to live in this repo as a standalone Media Station X plugin, plus Kick, Baseball and TV sections built the same way.

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

## TV section

Open **ТВ** in the Lampa sidebar (under Baseball). Free Russian channels, live, from the [iptv-org](https://github.com/iptv-org/iptv) database.

- **Эфирные** — the 20 federal channels first, under their usual numbers. One with no working stream stays in, dimmed, so the numbers keep matching the remote
- One line per genre after that: news, movies and series, sports, kids, music, documentaries, entertainment
- **Favorites** — long-press a card; they lead the page from the next visit
- Playback uses Lampa's IPTV player over the whole list: **CH+/CH−** zap, **digits** jump to a channel number
- `window.LampaTV.play(idOrNumber)` opens a channel from outside the UI, e.g. `LampaTV.play(1)` for Первый канал. A number is the channel's place in the whole list, the same one the player's digits and counter use, so it goes past the 20 federal ones (`LampaTV.play(31)`)

```
plugins/tv.js    Lampa section (lines, favorites, IPTV player)
plugins/tv.css   Cards
iptv/ru.json     Channel list, generated — do not edit by hand
tools/iptv.py    Builds iptv/ru.json: iptv-org channels for RU, every stream checked
```

The list is a copy in this repo rather than read from iptv-org at runtime, because the TV cannot reach GitHub's CDN (see below). Streams are checked by `tools/iptv.py` **from the network the TV is on** — many Russian broadcasters only serve Russian addresses, so a check from CI or a VPN would throw away the channels that work at home. Rebuild it from any machine there with Python 3, for example the home Home Assistant box:

```
ssh root@<home box> 'docker exec -i homeassistant python3 -' < tools/iptv.py > iptv/ru.json
```

The check takes several minutes (about a thousand streams, failures retried once). Free streams come and go, so expect a few percent of channels to change between runs. Each channel keeps up to three working streams; on a page served over HTTPS, newer browsers (Chromium 81+) block `http://` video, so there the plugin picks an `https://` one when the channel has it.

## Remote control

Lets something outside the TV — Home Assistant behind a voice assistant, say — start a TV channel or a Twitch stream on one device. **Off by default, per device.**

**Settings → Пульт → Удалённое управление: Да** turns it on. The same menu shows the device's code (e.g. `X3RB-A6KB-MG4U`): random, generated on the device, never in this repo. The device listens on the [ntfy.sh](https://ntfy.sh) topic `lampa-<code, lowercase, no dashes>` and acts only on what is published there, so a command for one TV never reaches another device running this fork. Whoever knows the code can switch channels on that TV and nothing else; **Сменить код** revokes it.

```
curl -d '{"action":"tv","value":1}'          https://ntfy.sh/lampa-x3rba6kbmg4u   # TV channel 1 (or an iptv-org id)
curl -d '{"action":"twitch","value":"login"}' https://ntfy.sh/lampa-x3rba6kbmg4u   # live stream, or the channel page if offline
```

On connect the device asks for the last two minutes, so a command sent while the TV is still switching on and Lampa is loading is picked up once it starts. Handled messages are remembered, so a reload doesn't replay one.

```
plugins/remote.js   Settings, device code, ntfy.sh subscription
```

It drives `window.LampaTV.play()` (plugins/tv.js) and `window.LampaTwitch.play()` (plugins/twitch.js).

Not affiliated with Twitch, Kick, SOOP, Amazon, iptv-org, ntfy, or Lampa’s authors.

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
