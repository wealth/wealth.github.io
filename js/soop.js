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

    return {
        LEAGUES: LEAGUES,
        channel: channel,
        leagueGames: leagueGames,
        allGames: allGames,
        streamUrl: streamUrl,
        parseTitle: parseTitle,
        thumb: thumb,
        proxy: function () { return PROXY; }
    };
})();
