#!/usr/bin/env python3
"""
Build iptv/ru.json, the channel list behind the TV section (plugins/tv.js).

Pulls Russian channels from the iptv-org database (https://github.com/iptv-org/iptv),
checks every stream from the machine it runs on, and keeps the ones that play.
Stream availability depends on where you are -- many Russian broadcasters only
serve Russian addresses -- so run it from the TV's own network, not from CI:

    ssh root@rockpi 'docker exec -i homeassistant python3 -' < tools/iptv.py > iptv/ru.json

Standard library only, so any Python 3.8+ will do (the Home Assistant container
is just a convenient one on the home network). Progress goes to stderr.

The TV can't reach GitHub's CDN (see README), which is why the list is copied
into this repo instead of being read from iptv-org at runtime.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://iptv-org.github.io/api/"
COUNTRY = "RU"
TIMEOUT = 8
WORKERS = 32
MAX_STREAMS = 3
UA = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager"

# Preferred variants of a channel, in order: the viewer's regional edition and
# the feed shifted to their clock. Vladivostok is Moscow +7.
REGION_WORDS = ["владивосток", "приморь"]
TIMESHIFT_FEED = "Plus7"

# The 20 free-to-air federal channels, in their usual button order. They lead
# the section and keep these numbers, so "channel 1" means the same thing here
# as on any Russian TV.
FEDERAL = [
    ("ChannelOne.ru", "Первый канал"), ("Russia1.ru", "Россия 1"), ("Match.ru", "Матч ТВ"),
    ("NTV.ru", "НТВ"), ("Channel5.ru", "Пятый канал"), ("RussiaK.ru", "Россия К"),
    ("Russia24.ru", "Россия 24"), ("Carousel.ru", "Карусель"), ("OTR.ru", "ОТР"),
    ("TVCentr.ru", "ТВ Центр"), ("RENTV.ru", "РЕН ТВ"), ("Spas.ru", "Спас"),
    ("STS.ru", "СТС"), ("Domashniy.ru", "Домашний"), ("TV3.ru", "ТВ-3"),
    ("Friday.ru", "Пятница!"), ("Zvezda.ru", "Звезда"), ("Mir.ru", "Мир"),
    ("TNT.ru", "ТНТ"), ("MuzTV.ru", "Муз-ТВ"),
]

# iptv-org categories -> section lines. First match wins; anything unlisted lands in "other".
GROUPS = [
    ("federal", "Эфирные", []),
    ("news", "Новости", ["news", "weather", "business", "legislative"]),
    ("movies", "Кино и сериалы", ["movies", "series", "classic"]),
    ("sports", "Спорт", ["sports", "outdoor", "auto"]),
    ("kids", "Детям", ["kids", "animation"]),
    ("music", "Музыка", ["music"]),
    ("docs", "Познавательные", ["documentary", "science", "education", "travel", "culture"]),
    ("fun", "Развлекательные", ["entertainment", "comedy", "family", "lifestyle", "cooking", "general"]),
    ("other", "Другие", []),
]
SKIP_CATEGORIES = {"shop", "religious", "xxx"}


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def fetch(url, limit=None, headers=None):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return res.status, res.geturl(), res.read(limit) if limit else res.read()


def api(name):
    return json.loads(fetch(API + name + ".json")[2])


def first_uri(base, text):
    """First non-comment line of a playlist, resolved against its URL."""
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return urllib.parse.urljoin(base, line)
    return None


def check(url):
    """Playable = the playlist loads and a media segment answers. Returns (ok, height)."""
    try:
        _, final, body = fetch(url, 512 * 1024)
        text = body.decode("utf-8", "replace")
        if "#EXTM3U" not in text[:1024]:
            return False, None
        height = None
        if "#EXT-X-STREAM-INF" in text:
            heights = [int(h) for h in re.findall(r"RESOLUTION=\d+x(\d+)", text)]
            height = max(heights) if heights else None
            variant = first_uri(final, text)
            if not variant:
                return False, None
            _, final, body = fetch(variant, 512 * 1024)
            text = body.decode("utf-8", "replace")
            if "#EXTINF" not in text:
                return False, None
        segments = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
        if not segments:
            return False, None
        status, _, _ = fetch(urllib.parse.urljoin(final, segments[-1]), 2048, {"Range": "bytes=0-2047"})
        return status in (200, 206), height
    except Exception:
        return False, None


def rank(stream, height):
    """Lower sorts first."""
    title = (stream.get("title") or "").lower()
    feed = stream.get("feed") or ""
    regional = any(w in title for w in REGION_WORDS)
    shifted = feed.startswith("Plus") or "+" in title
    return (
        0 if regional else 1,
        0 if feed == TIMESHIFT_FEED else (2 if shifted else 1),
        1 if "Not 24/7" in (stream.get("labels") or []) else 0,
        -(height or 0),
    )


def pick_logo(logos):
    if not logos:
        return None
    logos = sorted(logos, key=lambda l: (
        l.get("feed") is not None,                    # the channel's own logo, not a feed's
        not l.get("in_use"),
        (l.get("width") or 0) < (l.get("height") or 0),  # wide logos fit the cards
        -(l.get("width") or 0),
    ))
    return logos[0]["url"]


def group_of(channel):
    cats = channel.get("categories") or []
    for gid, _title, names in GROUPS:
        if any(c in names for c in cats):
            return gid
    return "other"


def main():
    log("loading iptv-org database ...")
    channels = {c["id"]: c for c in api("channels") if c.get("country") == COUNTRY
                and not c.get("closed") and not c.get("is_nsfw")
                and not SKIP_CATEGORIES.intersection(c.get("categories") or [])}
    streams = [s for s in api("streams") if s.get("channel") in channels
               and not s.get("referrer") and not s.get("user_agent")]
    logos = {}
    for l in api("logos"):
        if l.get("channel") in channels:
            logos.setdefault(l["channel"], []).append(l)
    log(f"{len(channels)} channels, {len(streams)} streams to check")

    started = time.time()
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda s: check(s["url"]), streams))
    # Free servers drop connections under load, and a handful of hosts carry
    # dozens of channels each, so give the failures one slower second chance.
    retry = [i for i, (ok, _h) in enumerate(results) if not ok]
    with ThreadPoolExecutor(WORKERS // 4) as pool:
        for i, res in zip(retry, pool.map(lambda i: check(streams[i]["url"]), retry)):
            results[i] = res
    log(f"checked in {time.time() - started:.0f}s, {sum(ok for ok, _ in results)} streams play")

    playable = {}
    for stream, (ok, height) in zip(streams, results):
        if ok:
            playable.setdefault(stream["channel"], []).append((rank(stream, height), stream["url"], height))

    federal_ids = [cid for cid, _ in FEDERAL]
    federal_names = dict(FEDERAL)
    out = []
    for cid, found in playable.items():
        ch = channels[cid]
        found.sort()
        seen, urls = set(), []
        for _r, url, height in found:
            if url not in seen:
                seen.add(url)
                urls.append({"url": url, "h": height} if height else {"url": url})
        cyrillic = [a for a in ch.get("alt_names") or [] if re.search("[а-яА-Я]", a) and len(a) <= 24]
        entry = {
            "id": cid,
            "name": federal_names.get(cid) or (cyrillic[0] if cyrillic else ch["name"]),
            "group": "federal" if cid in federal_names else group_of(ch),
            "streams": urls[:MAX_STREAMS],
        }
        if cid in federal_names:
            entry["number"] = federal_ids.index(cid) + 1
        logo = pick_logo(logos.get(cid))
        if logo:
            entry["logo"] = logo
        out.append(entry)

    # A federal channel with nothing playable stays in, stream-less, so the
    # numbers stay contiguous: the player maps digits to list positions.
    missing = [(cid, name) for cid, name in FEDERAL if cid not in playable]
    for cid, name in missing:
        entry = {"id": cid, "name": name, "group": "federal", "streams": [], "number": federal_ids.index(cid) + 1}
        logo = pick_logo(logos.get(cid))
        if logo:
            entry["logo"] = logo
        out.append(entry)
    if missing:
        log("federal channels with no playable stream:", ", ".join(name for _cid, name in missing))

    order = {gid: i for i, (gid, _t, _n) in enumerate(GROUPS)}
    out.sort(key=lambda c: (order[c["group"]], c.get("number", 99), c["name"].lower()))

    json.dump({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://github.com/iptv-org/iptv",
        "groups": [{"id": gid, "title": title} for gid, title, _n in GROUPS
                   if any(c["group"] == gid for c in out)],
        "channels": out,
    }, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    log(f"{len(out)} channels written")


if __name__ == "__main__":
    main()
