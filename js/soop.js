/*
 * SOOP (sooplive.com) API layer — free live baseball.
 * ES5 only: must run on old TV browsers (webOS 3+).
 *
 * SOOP holds the GLOBAL KBO (Korean baseball) rights through 2026 and streams
 * every game free worldwide — no account, no geoblock. The league runs five
 * games at a time and SOOP puts each on its own official channel,
 * kboglobal1..kboglobal5, so one sweep of those five channels is the full slate.
 *
 * Playing a stream takes three calls, all of which SOOP locks to its own origin
 * (Access-Control-Allow-Origin: https://play.sooplive.com), so they go through
 * our Cloudflare Worker (worker/soop-proxy.js):
 *
 *   1. /live   -> is the channel broadcasting? gives BNO (broadcast number),
 *                 title and the CDN name to use
 *   2. /aid    -> a short-lived auth token
 *   3. /assign -> trades the broadcast key for the CDN playlist URL
 *   then: <view_url>?aid=<AID> is a live HLS media playlist (1080p, 2s segments)
 *
 * The playlist and its .TS segments are NOT proxied and carry no CORS headers —
 * that is fine, because a native <video> loads media without a CORS check (the
 * same reason Twitch's usher URLs play on the TV but not via XHR on desktop).
 *
 * SOOP can only ever answer "is this channel live right now", so the KBO fixture
 * list comes from a second upstream (Naver) through the same Worker — see
 * kboSchedule() further down.
 *
 * Finished games stay up as full-length replays on the channel that carried
 * them — see replayFeed() and replayFiles() at the bottom of this file.
 */
var SOOP = (function () {
    "use strict";

    /*
     * Cloudflare Worker in front of the SOOP API. See worker/soop-proxy.js.
     * window.SOOP_PROXY overrides it (set before this file loads) so the host
     * can be repointed — at a local proxy while testing, or a new Worker
     * domain — without editing this file.
     */
    var PROXY = (typeof window !== "undefined" && window.SOOP_PROXY) || "https://soop.demitori.com";

    /*
     * Leagues we can actually source. KBO is the only free-worldwide live
     * baseball we found: MLB's rights sit with MLB.TV/ESPN/Apple, the CPBL
     * Twitch channels are commentary-only (titled 無現場賽事畫面 — "no live
     * game footage"), and YouTube no longer exposes a usable HLS manifest.
     * Kept as a list so another league can be dropped in when one appears.
     */
    var LEAGUES = [
        {
            id: "kbo",
            name: "KBO",
            country: "🇰🇷",
            channels: ["kboglobal1", "kboglobal2", "kboglobal3", "kboglobal4", "kboglobal5"]
        }
    ];

    function xhr(url, callback) {
        var req = new XMLHttpRequest();
        var done = false;
        function finish(err, text) {
            if (done) { return; }
            done = true;
            callback(err, text);
        }
        req.open("GET", url, true);
        req.timeout = 15000;
        req.onreadystatechange = function () {
            if (req.readyState === 4) {
                if (req.status >= 200 && req.status < 300) { finish(null, req.responseText); }
                else { finish("HTTP " + req.status, req.responseText); }
            }
        };
        req.ontimeout = function () { finish("Request timeout", null); };
        req.onerror = function () { finish("Network error", null); };
        req.send(null);
    }

    function getJSON(url, callback) {
        xhr(url, function (err, text) {
            if (err) { callback(err, null); return; }
            var data = null;
            try { data = JSON.parse(text); } catch (e) { callback("Invalid JSON from SOOP", null); return; }
            callback(null, data);
        });
    }

    /*
     * Titles arrive as "[KBO] LG vs DOOSAN Live 20260902". Pull the two teams
     * out for the card, and fall back to the raw title if the shape changes.
     */
    function parseTitle(title) {
        var out = { teams: "", away: "", home: "", raw: String(title || "") };
        var m = out.raw.match(/\[([^\]]+)\]\s*(.+?)\s+vs\.?\s+(.+?)(?:\s+Live)?(?:\s+\d{8})?\s*$/i);
        if (m) {
            out.away = m[2].trim();
            out.home = m[3].trim();
            out.teams = out.away + " vs " + out.home;
        } else {
            out.teams = out.raw.replace(/^\[[^\]]*\]\s*/, "").replace(/\s*Live\s*\d{8}\s*$/i, "").trim();
        }
        return out;
    }

    /*
     * Live preview frame for a broadcast. A plain <img> load, so it needs no
     * proxy — only the JSON API is origin-locked. Cache-busted because SOOP
     * serves this from a fixed per-broadcast URL that updates during the game.
     */
    function thumb(bno) {
        return "https://liveimg.sooplive.co.kr/m/" + encodeURIComponent(bno) +
            "?t=" + Math.floor(new Date().getTime() / 60000);
    }

    /* Live state for one channel. Returns null (not an error) when it is idle. */
    function channel(bid, callback) {
        getJSON(PROXY + "/live?bid=" + encodeURIComponent(bid), function (err, data) {
            if (err) { callback(err, null); return; }
            var c = data && data.CHANNEL ? data.CHANNEL : null;
            /* RESULT 0 = not broadcasting. SOOP returns this for unknown ids too. */
            if (!c || !c.RESULT || !c.BNO) { callback(null, null); return; }
            var parsed = parseTitle(c.TITLE);
            callback(null, {
                bid: bid,
                bno: String(c.BNO),
                title: parsed.teams || c.TITLE,
                rawTitle: c.TITLE,
                away: parsed.away,
                home: parsed.home,
                nick: c.BJNICK || bid,
                cdn: c.CDN || "gcp_cdn",
                resolution: c.RESOLUTION || "",
                viewers: typeof c.CTUSER === "number" ? c.CTUSER : 0,
                subtitles: !!c.IS_SUBTITLE
            });
        });
    }

    /*
     * Every live game in a league. Fans the channels out at once and keeps the
     * league's channel order so the list doesn't reshuffle between refreshes.
     */
    function leagueGames(league, callback) {
        var chans = league.channels;
        var results = new Array(chans.length);
        var pending = chans.length;
        var failed = 0;

        if (!pending) { callback(null, []); return; }

        function collect(i) {
            channel(chans[i], function (err, game) {
                if (err) { failed++; }
                results[i] = game || null;
                pending--;
                if (pending > 0) { return; }
                /* Only surface an error if every channel failed — a single
                   flaky call shouldn't blank a slate that is otherwise fine. */
                if (failed === chans.length) { callback("Could not reach SOOP", null); return; }
                var games = [];
                for (var k = 0; k < results.length; k++) {
                    if (results[k]) { games.push(results[k]); }
                }
                callback(null, games);
            });
        }
        for (var i = 0; i < chans.length; i++) { collect(i); }
    }

    /* Every league, in order, each with its live games (leagues with none are kept). */
    function allGames(callback) {
        var out = [];
        var pending = LEAGUES.length;
        var errs = 0;
        for (var i = 0; i < LEAGUES.length; i++) {
            (function (idx) {
                leagueGames(LEAGUES[idx], function (err, games) {
                    if (err) { errs++; }
                    out[idx] = { league: LEAGUES[idx], games: games || [] };
                    if (--pending === 0) {
                        if (errs === LEAGUES.length) { callback("Could not reach SOOP", null); return; }
                        callback(null, out);
                    }
                });
            })(i);
        }
    }

    /*
     * Resolves a channel to a playable HLS URL.
     * quality: "original" (1080p) | "hd4k" (720p) | "hd" (540p) | "sd" (360p)
     */
    function streamUrl(game, quality, callback) {
        quality = quality || "original";
        var q = "?bid=" + encodeURIComponent(game.bid) + "&bno=" + encodeURIComponent(game.bno);

        getJSON(PROXY + "/aid" + q + "&quality=" + encodeURIComponent(quality), function (err, data) {
            if (err) { callback(err, null); return; }
            var aid = data && data.CHANNEL ? data.CHANNEL.AID : null;
            if (!aid) { callback("Stream is not available", null); return; }

            var key = game.bno + "-common-" + quality + "-hls";
            getJSON(PROXY + "/assign?cdn=" + encodeURIComponent(game.cdn) + "&key=" + encodeURIComponent(key),
                function (err2, res) {
                    if (err2) { callback(err2, null); return; }
                    if (!res || !res.view_url) { callback("Stream is not available", null); return; }
                    /* view_url is a bare playlist; the AID is what authorises it. */
                    var sep = res.view_url.indexOf("?") >= 0 ? "&" : "?";
                    callback(null, res.view_url + sep + "aid=" + encodeURIComponent(aid));
                });
        });
    }

    /* ------------------------------------------------------------------ */
    /* KBO schedule                                                       */
    /* ------------------------------------------------------------------ */

    /*
     * The fixture list, so the tab can say when the next game is instead of
     * just "nothing live" on a rest day. It does not come from SOOP: SOOP has
     * no schedule endpoint. Naver's sports API is the one free KBO fixture feed
     * that answers with clean JSON, but it 403s any request carrying an Origin
     * header, so it goes through our Worker as well (route /schedule).
     */

    /* Naver reports Korean short names; SOOP's stream titles are English, so
       use English here too and the two halves of the tab read the same. */
    var KBO_TEAMS = {
        HH: "Hanwha Eagles",
        HT: "KIA Tigers",
        KT: "KT Wiz",
        LG: "LG Twins",
        LT: "Lotte Giants",
        NC: "NC Dinos",
        OB: "Doosan Bears",
        SK: "SSG Landers",
        SS: "Samsung Lions",
        WO: "Kiwoom Heroes"
    };

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function ymd(date) {
        return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    }

    /*
     * gameDateTime is "2026-09-03T18:30:00" — a Korean wall clock with no
     * offset (SOOP's replay list writes the same thing with a space for the
     * "T"). ES5 and ES6 disagree on how to parse that shape (UTC vs local),
     * and old TV browsers are exactly where that bites, so build the instant by
     * hand. KST is UTC+9 year round; Korea has no DST.
     */
    function kstToDate(text) {
        var m = String(text || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!m) { return null; }
        return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] || 0)));
    }

    function mapGame(g) {
        var start = kstToDate(g.gameDateTime);
        if (!start) { return null; }
        var state = "upcoming";
        if (g.cancel || g.suspended) { state = "cancelled"; }
        else if (g.statusCode === "RESULT") { state = "final"; }
        else if (g.statusCode !== "BEFORE") { state = "live"; }
        return {
            id: g.gameId,
            start: start,
            state: state,
            away: KBO_TEAMS[g.awayTeamCode] || g.awayTeamName || g.awayTeamCode,
            home: KBO_TEAMS[g.homeTeamCode] || g.homeTeamName || g.homeTeamCode,
            awayLogo: g.awayTeamEmblemUrl || "",
            homeLogo: g.homeTeamEmblemUrl || "",
            awayScore: g.awayTeamScore || 0,
            homeScore: g.homeTeamScore || 0,
            /* Only meaningful once the game has started. */
            scored: state === "final" || state === "live"
        };
    }

    /*
     * Games from yesterday through `days` days out, oldest first. The window is
     * padded a day on each side because we ask in KST dates but the caller
     * buckets by the viewer's local date, and those disagree by up to a day.
     */
    function kboSchedule(days, callback) {
        var now = new Date();
        var from = new Date(now.getTime() - 86400000);
        var to = new Date(now.getTime() + (days + 1) * 86400000);

        getJSON(PROXY + "/schedule?from=" + ymd(from) + "&to=" + ymd(to), function (err, data) {
            if (err) { callback(err, null); return; }
            var list = data && data.result ? data.result.games : null;
            if (!list) { callback("No schedule in response", null); return; }
            var games = [];
            for (var i = 0; i < list.length; i++) {
                var game = mapGame(list[i]);
                if (game) { games.push(game); }
            }
            games.sort(function (a, b) { return a.start - b.start; });
            callback(null, games);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Replays                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Every game stays up afterwards as a full-length replay on the channel
     * that carried it; SOOP keeps them for a year. Listing them needs no proxy
     * — the station API answers any Origin — so only the call that turns a
     * replay into playlist URLs goes through the Worker (route /vod).
     */
    var STATION = "https://chapi.sooplive.co.kr/api/";

    /*
     * A replay's own thumbnail is the frame its broadcast opened on, and every
     * broadcast opens on the same "the streaming will start soon" slate — a
     * row of them is a row of one picture. What tells games apart is who
     * played, so find the teams. SOOP titles name a team by the first word of
     * its name in capitals ("LOTTE", "KIA"), which is enough to reach the
     * Naver code and, through it, the full name and emblem the schedule uses.
     */
    var KBO_CODES = {};
    for (var teamCode in KBO_TEAMS) {
        if (KBO_TEAMS.hasOwnProperty(teamCode)) {
            KBO_CODES[KBO_TEAMS[teamCode].split(" ")[0].toUpperCase()] = teamCode;
        }
    }

    function emblem(code) {
        return "https://sports-phinf.pstatic.net/team/kbo/default/" + code + ".png";
    }

    function mapReplay(v) {
        var ucc = v && v.ucc;
        if (!ucc || !v.title_no) { return null; }
        var ended = kstToDate(v.reg_date);
        if (!ended) { return null; }
        var seconds = Math.floor((ucc.total_file_duration || 0) / 1000);
        var thumb = String(ucc.thumb || "");
        var parsed = parseTitle(v.title_name);
        var away = KBO_CODES[parsed.away.toUpperCase()];
        var home = KBO_CODES[parsed.home.toUpperCase()];
        /* Both or neither: an all-star game, or the odd title in Korean, has
           no pairing to draw and keeps its title and thumbnail instead. */
        var known = !!(away && home);
        return {
            id: v.title_no,
            title: parsed.teams || v.title_name,
            away: known ? KBO_TEAMS[away] : "",
            home: known ? KBO_TEAMS[home] : "",
            awayLogo: known ? emblem(away) : "",
            homeLogo: known ? emblem(home) : "",
            /* reg_date is when the broadcast ended and the list carries no
               start time, so count back from it. */
            start: new Date(ended.getTime() - seconds * 1000),
            duration: seconds,
            thumb: thumb.indexOf("//") === 0 ? "https:" + thumb : thumb
        };
    }

    /*
     * Replays across every channel, newest first, a screenful at a time:
     *   var feed = SOOP.replayFeed(); feed.next(20, function (err, page) {})
     * where page is { items, hasNext }.
     *
     * Each channel has its own list, 20 a page, and they do not line up — the
     * channels that sit idle on a light day fall weeks behind the busy one, so
     * page 2 of one is newer than page 1 of another. Stitching "page N of
     * every channel" together would therefore come out of order at every page
     * boundary. This is a merge instead: a buffer per channel, always hand out
     * the newest head, and read a channel's next page only when its buffer
     * runs dry.
     */
    function replayFeed() {
        var feeds = [];
        var reached = false;
        for (var l = 0; l < LEAGUES.length; l++) {
            for (var c = 0; c < LEAGUES[l].channels.length; c++) {
                feeds.push({ bid: LEAGUES[l].channels[c], page: 0, buffer: [], done: false });
            }
        }

        function load(feed, callback) {
            getJSON(STATION + encodeURIComponent(feed.bid) + "/vods/review?page=" + (feed.page + 1), function (err, data) {
                var list = !err && data && data.data ? data.data : null;
                if (list) { reached = true; }
                /* A channel that fails drops out instead of stalling the rest. */
                if (!list || !list.length) { feed.done = true; }
                else {
                    feed.page++;
                    for (var i = 0; i < list.length; i++) {
                        var replay = mapReplay(list[i]);
                        if (replay) { feed.buffer.push(replay); }
                    }
                    if (!data.meta || feed.page >= data.meta.last_page) { feed.done = true; }
                }
                callback();
            });
        }

        /* Tops up every channel that is empty but not finished. */
        function refill(callback) {
            var pending = 0;
            function one() {
                if (--pending === 0) { callback(); }
            }
            for (var i = 0; i < feeds.length; i++) {
                if (!feeds[i].buffer.length && !feeds[i].done) {
                    pending++;
                    load(feeds[i], one);
                }
            }
            if (!pending) { callback(); }
        }

        function next(count, callback) {
            var out = [];
            (function step() {
                refill(function () {
                    while (out.length < count) {
                        var newest = null;
                        var dry = false;
                        for (var i = 0; i < feeds.length; i++) {
                            var feed = feeds[i];
                            if (!feed.buffer.length) {
                                if (!feed.done) { dry = true; }
                                continue;
                            }
                            if (!newest || feed.buffer[0].start > newest.buffer[0].start) { newest = feed; }
                        }
                        /* An unread page may hold something newer than every
                           head we have, so read it before handing out more. */
                        if (dry) { step(); return; }
                        if (!newest) { break; }
                        out.push(newest.buffer.shift());
                    }
                    if (!reached) { callback("Could not reach SOOP", null); return; }
                    var more = false;
                    for (var k = 0; k < feeds.length; k++) {
                        if (feeds[k].buffer.length || !feeds[k].done) { more = true; }
                    }
                    callback(null, { items: out, hasNext: more });
                });
            })();
        }

        return { next: next };
    }

    /*
     * Playlist URLs for one replay: [{ url, quality }], one entry per file. A
     * broadcast that was interrupted is stored as several files, in order.
     *
     * url is the best rendition rather than the adaptive master SOOP also
     * offers: a TV's native player given a master tends to settle on its
     * lowest rung. quality is keyed "1080p" / "720p" / "540p", which is the
     * shape Lampa's player reads its default-quality setting against and
     * builds its quality menu from.
     */
    function replayFiles(id, callback) {
        getJSON(PROXY + "/vod?id=" + encodeURIComponent(id), function (err, res) {
            if (err) { callback(err, null); return; }
            var data = res && res.result === 1 ? res.data : null;
            var files = data && data.files ? data.files.slice() : [];
            files.sort(function (a, b) { return (a.file_order || 0) - (b.file_order || 0); });

            var out = [];
            for (var i = 0; i < files.length; i++) {
                var info = files[i].quality_info || [];
                var quality = {};
                var count = 0;
                var best = null;
                var bestHeight = 0;
                for (var k = 0; k < info.length; k++) {
                    /* The "Auto" entry has no resolution: that is the master. */
                    var height = parseInt(String(info[k].resolution || "").split("x")[1], 10);
                    if (!height || !info[k].file) { continue; }
                    quality[height + "p"] = info[k].file;
                    count++;
                    if (height > bestHeight) { bestHeight = height; best = info[k].file; }
                }
                var url = best || files[i].file;
                if (url) { out.push({ url: url, quality: count > 1 ? quality : null }); }
            }
            if (!out.length) {
                /* SOOP explains itself here: "This VOD does not exist." */
                callback(res && res.data && res.data.message ? res.data.message : "Replay is not available", null);
                return;
            }
            callback(null, out);
        });
    }

    return {
        LEAGUES: LEAGUES,
        kboSchedule: kboSchedule,
        replayFeed: replayFeed,
        replayFiles: replayFiles,
        channel: channel,
        leagueGames: leagueGames,
        allGames: allGames,
        streamUrl: streamUrl,
        parseTitle: parseTitle,
        thumb: thumb,
        proxy: function () { return PROXY; }
    };
})();
