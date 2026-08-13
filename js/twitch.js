/*
 * Twitch API layer (public GQL endpoint, no login required).
 * ES5 only: must run on old TV browsers (webOS 3+).
 */
var Twitch = (function () {
    "use strict";

    /*
     * Twitch occasionally rotates the public web client ID.
     * On an "invalid Client-ID" response the next candidate is tried automatically.
     * First entry: current twitch.tv web client ID (checked 2026-08).
     */
    var CLIENT_IDS = [
        "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "kimne78kx3ncx6brgo4mv6wki5h0ko",
        "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"
    ];
    var GQL_URL = "https://gql.twitch.tv/gql";
    var USHER_BASE = "https://usher.ttvnw.net";
    /* Full PlaybackAccessToken query (inline; no persisted-hash dependency) */
    var PLAYBACK_QUERY = 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }}';

    var clientIdx = 0;

    function xhr(method, url, body, headers, callback) {
        var req = new XMLHttpRequest();
        var done = false;
        function finish(err, text) {
            if (done) { return; }
            done = true;
            callback(err, text);
        }
        req.open(method, url, true);
        req.timeout = 15000;
        if (headers) {
            for (var name in headers) {
                if (headers.hasOwnProperty(name)) {
                    req.setRequestHeader(name, headers[name]);
                }
            }
        }
        req.onreadystatechange = function () {
            if (req.readyState === 4) {
                if (req.status >= 200 && req.status < 300) {
                    finish(null, req.responseText);
                } else {
                    finish("HTTP " + req.status + (req.responseText ? ": " + req.responseText.substring(0, 200) : ""), req.responseText);
                }
            }
        };
        req.ontimeout = function () { finish("Request timeout", null); };
        req.onerror = function () { finish("Network error", null); };
        req.send(body);
    }

    function gql(body, callback, attempt) {
        attempt = attempt || 0;
        xhr("POST", GQL_URL, JSON.stringify(body), {
            "Client-ID": CLIENT_IDS[clientIdx],
            "Content-Type": "application/json"
        }, function (err, text) {
            if (err && text && text.indexOf("Client-ID") >= 0 && attempt < CLIENT_IDS.length - 1) {
                clientIdx = (clientIdx + 1) % CLIENT_IDS.length;
                gql(body, callback, attempt + 1);
                return;
            }
            if (err) { callback(err, null); return; }
            var data = null;
            try { data = JSON.parse(text); } catch (e) { callback("Invalid JSON from Twitch", null); return; }
            if (data.errors && data.errors.length > 0 && data.data == null) {
                callback(data.errors[0].message || "Twitch API error", null);
                return;
            }
            callback(null, data.data);
        });
    }

    function query(q, callback) {
        gql({ query: q }, callback);
    }

    /* ------------------------------------------------------------------ */
    /* Authenticated (logged-in) data via GQL with the user's OAuth token.  */
    /* GQL uses the account identity (no OAuth scope enforcement), unlike    */
    /* Helix which rejects this first-party client token.                   */
    /* ------------------------------------------------------------------ */

    /*
     * Live streams from channels the logged-in user follows.
     * Uses the exact operation the Twitch web client uses (FollowingLive_CurrentUser)
     * — proven to work with a registered third-party OAuth token (see the
     * reference SmartTwitchTV app). Ad-hoc personalized queries via the
     * first-party web client are silently gated by Twitch's integrity check.
     */
    function followedStreams(cursor, callback) {
        var after = cursor ? ", after: " + lit(cursor) : "";
        var q = "query FollowingLive_CurrentUser { currentUser { followedLiveUsers(first: 100" + after + ") { pageInfo { hasNextPage } edges { cursor node { stream { id type title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } broadcaster { id login displayName } } } } } } }";
        gqlAuth(q, function (err, data) {
            if (err) { callback(err, null); return; }
            if (!data || !data.currentUser) { callback("Please sign in again", null); return; }
            var conn = data.currentUser.followedLiveUsers;
            var edges = conn && conn.edges ? conn.edges : [];
            var out = { items: [], cursor: null, hasNext: conn && conn.pageInfo ? !!conn.pageInfo.hasNextPage : false };
            for (var i = 0; i < edges.length; i++) {
                var s = edges[i].node && edges[i].node.stream;
                if (s && s.broadcaster) {
                    out.items.push({
                        id: s.id,
                        title: s.title,
                        viewersCount: s.viewersCount,
                        previewImageURL: s.previewImageURL,
                        game: s.game ? { name: s.game.displayName, displayName: s.game.displayName } : { name: "", displayName: "" },
                        broadcaster: { id: s.broadcaster.id, login: s.broadcaster.login, displayName: s.broadcaster.displayName }
                    });
                    out.cursor = edges[i].cursor || out.cursor;
                }
            }
            out.items.sort(function (a, b) { return b.viewersCount - a.viewersCount; });
            callback(null, out);
        });
    }

    /*
     * "Recommended": top live streams across the game categories the user
     * follows (or, failing that, the categories their live follows are
     * playing). Falls back to global top streams only as a last resort.
     */
    function recommendedStreams(callback) {
        var uid = (typeof TwitchAuth !== "undefined") ? TwitchAuth.userId() : null;
        /*
         * followedGames must be read via user(id: <own id>) with the user's token
         * (as the reference app does); currentUser.followedLiveUsers gives us the
         * categories the live follows are playing as a fallback seed. Games are
         * collected by id so we can look up top streams with game(id:) (reliable).
         */
        var gq = "query { " +
            (uid ? "user(id: " + lit(uid) + ") { followedGames(first: 100, type: LIVE) { nodes { id displayName } } } " : "") +
            "currentUser { followedLiveUsers(first: 100) { edges { node { stream { game { id displayName } } } } } } }";
        gqlAuth(gq, function (err, data) {
            var games = [];
            var seenGame = {};
            function addGame(id, name) {
                if (id && !seenGame[id] && games.length < 6) { seenGame[id] = true; games.push({ id: id, name: name }); }
            }
            var u = data ? data.user : null;
            if (u && u.followedGames && u.followedGames.nodes) {
                for (var i = 0; i < u.followedGames.nodes.length; i++) {
                    var fg = u.followedGames.nodes[i];
                    if (fg) { addGame(fg.id, fg.displayName); }
                }
            }
            var cu = data ? data.currentUser : null;
            if (games.length === 0 && cu && cu.followedLiveUsers && cu.followedLiveUsers.edges) {
                var edges = cu.followedLiveUsers.edges;
                for (var j = 0; j < edges.length; j++) {
                    var s = edges[j].node && edges[j].node.stream;
                    if (s && s.game) { addGame(s.game.id, s.game.displayName); }
                }
            }
            if (games.length === 0) {
                topStreams(null, callback);
                return;
            }
            var aliases = [];
            for (var g = 0; g < games.length; g++) {
                aliases.push("g" + g + ": game(id: " + lit(games[g].id) + ") { streams(first: 8) { edges { node { " + STREAM_FIELDS + " } } } }");
            }
            gqlAuth("query { " + aliases.join(" ") + " }", function (err2, data2) {
                if (err2 || !data2) { topStreams(null, callback); return; }
                var seen = {};
                var items = [];
                for (var k = 0; k < games.length; k++) {
                    var gd = data2["g" + k];
                    if (gd && gd.streams && gd.streams.edges) {
                        for (var e = 0; e < gd.streams.edges.length; e++) {
                            var node = gd.streams.edges[e].node;
                            if (node && node.broadcaster && !seen[node.broadcaster.login]) {
                                seen[node.broadcaster.login] = true;
                                items.push(node);
                            }
                        }
                    }
                }
                items.sort(function (a, b) { return b.viewersCount - a.viewersCount; });
                callback(null, { items: items, cursor: null, hasNext: false });
            });
        });
    }

    /* GQL request carrying the user's OAuth token (personalized data) */
    function gqlAuth(q, callback) {
        if (typeof TwitchAuth === "undefined" || !TwitchAuth.isLoggedIn()) {
            callback("Not logged in", null);
            return;
        }
        TwitchAuth.ensureToken(function (ok) {
            if (!ok) { callback("Session expired", null); return; }
            var req = new XMLHttpRequest();
            req.open("POST", GQL_URL, true);
            req.timeout = 15000;
            /* Client-ID must match the token's client (the one it was issued for) */
            req.setRequestHeader("Client-ID", TwitchAuth.clientId());
            req.setRequestHeader("Authorization", "OAuth " + TwitchAuth.token());
            req.setRequestHeader("Content-Type", "application/json");
            req.onreadystatechange = function () {
                if (req.readyState === 4) {
                    if (req.status >= 200 && req.status < 300) {
                        var data = null;
                        try { data = JSON.parse(req.responseText); } catch (e) { }
                        callback(data && data.data ? null : "Invalid response", data ? data.data : null);
                    } else {
                        callback("HTTP " + req.status, null);
                    }
                }
            };
            req.ontimeout = function () { callback("Request timeout", null); };
            req.onerror = function () { callback("Network error", null); };
            req.send(JSON.stringify({ query: q }));
        });
    }

    /* String literal for safe inline embedding into a GQL query */
    function lit(str) {
        return JSON.stringify(String(str));
    }

    var STREAM_FIELDS = "id title viewersCount previewImageURL(width: 440, height: 248) game { name displayName } broadcaster { id login displayName }";

    function mapStreamEdges(conn) {
        var out = { items: [], cursor: null, hasNext: false };
        if (!conn || !conn.edges) { return out; }
        for (var i = 0; i < conn.edges.length; i++) {
            var edge = conn.edges[i];
            if (edge && edge.node && edge.node.broadcaster) {
                out.items.push(edge.node);
                out.cursor = edge.cursor || out.cursor;
            }
        }
        if (conn.pageInfo && conn.pageInfo.hasNextPage) { out.hasNext = true; }
        return out;
    }

    function topStreams(cursor, callback) {
        var after = cursor ? ", after: " + lit(cursor) : "";
        query("query { streams(first: 24" + after + ") { pageInfo { hasNextPage } edges { cursor node { " + STREAM_FIELDS + " } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, mapStreamEdges(data.streams));
        });
    }

    function topGames(cursor, callback) {
        var after = cursor ? ", after: " + lit(cursor) : "";
        query("query { games(first: 24" + after + ") { pageInfo { hasNextPage } edges { cursor node { id name displayName viewersCount boxArtURL(width: 285, height: 380) } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            var out = { items: [], cursor: null, hasNext: false };
            var conn = data.games;
            if (conn && conn.edges) {
                for (var i = 0; i < conn.edges.length; i++) {
                    var edge = conn.edges[i];
                    if (edge && edge.node) {
                        out.items.push(edge.node);
                        out.cursor = edge.cursor || out.cursor;
                    }
                }
                if (conn.pageInfo && conn.pageInfo.hasNextPage) { out.hasNext = true; }
            }
            callback(null, out);
        });
    }

    function gameStreams(gameName, cursor, callback) {
        var after = cursor ? ", after: " + lit(cursor) : "";
        query("query { game(name: " + lit(gameName) + ") { displayName streams(first: 24" + after + ") { pageInfo { hasNextPage } edges { cursor node { " + STREAM_FIELDS + " } } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            if (!data.game) { callback("Game not found", null); return; }
            callback(null, mapStreamEdges(data.game.streams));
        });
    }

    function channel(login, callback) {
        query("query { user(login: " + lit(login) + ") { id login displayName description profileImageURL(width: 300) offlineImageURL followers { totalCount } stream { id title viewersCount createdAt previewImageURL(width: 640, height: 360) game { name displayName } } videos(first: 24, sort: TIME) { edges { node { id title lengthSeconds viewCount publishedAt previewThumbnailURL(width: 440, height: 248) game { displayName } } } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            if (!data.user) { callback("Channel not found", null); return; }
            callback(null, data.user);
        });
    }

    /* Lightweight periodic stats for the player overlay (viewers + uptime) */
    function streamStats(login, callback) {
        query("query { user(login: " + lit(login) + ") { stream { viewersCount createdAt } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, data.user ? data.user.stream : null);
        });
    }

    function usersByLogins(logins, callback) {
        var list = [];
        for (var i = 0; i < logins.length; i++) { list.push(lit(logins[i])); }
        query("query { users(logins: [" + list.join(", ") + "]) { id login displayName profileImageURL(width: 300) stream { title viewersCount previewImageURL(width: 440, height: 248) game { displayName } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, data.users || []);
        });
    }

    function search(text, callback) {
        var q = lit(text);
        query("query { channels: searchFor(userQuery: " + q + ", platform: \"web\", target: {index: CHANNEL}) { channels { edges { item { ... on User { id login displayName profileImageURL(width: 300) stream { title viewersCount previewImageURL(width: 440, height: 248) game { displayName } } } } } } } games: searchFor(userQuery: " + q + ", platform: \"web\", target: {index: GAME}) { games { edges { item { ... on Game { id name displayName viewersCount boxArtURL(width: 285, height: 380) } } } } } }", function (err, data) {
            if (err) { callback(err, null); return; }
            var out = { channels: [], games: [] };
            var edges, i;
            if (data.channels && data.channels.channels && data.channels.channels.edges) {
                edges = data.channels.channels.edges;
                for (i = 0; i < edges.length; i++) {
                    if (edges[i] && edges[i].item && edges[i].item.login) { out.channels.push(edges[i].item); }
                }
            }
            if (data.games && data.games.games && data.games.games.edges) {
                edges = data.games.games.edges;
                for (i = 0; i < edges.length; i++) {
                    if (edges[i] && edges[i].item && edges[i].item.name) { out.games.push(edges[i].item); }
                }
            }
            callback(null, out);
        });
    }

    function playbackToken(login, vodId, callback) {
        var isVod = vodId != null;
        /*
         * Send the FULL query text (not a persisted-query hash). Twitch
         * periodically purges old persisted hashes → "PersistedQueryNotFound";
         * the inline query never depends on a pre-registered hash.
         */
        gql({
            operationName: "PlaybackAccessToken_Template",
            query: PLAYBACK_QUERY,
            variables: {
                isLive: !isVod,
                login: isVod ? "" : login,
                isVod: isVod,
                vodID: isVod ? String(vodId) : "",
                playerType: "site",
                platform: "web"
            }
        }, function (err, data) {
            if (err) { callback(err, null); return; }
            var token = isVod ? data.videoPlaybackAccessToken : data.streamPlaybackAccessToken;
            if (!token || !token.value || !token.signature) {
                callback(isVod ? "Video is not available" : "Channel is offline or not available", null);
                return;
            }
            callback(null, token);
        });
    }

    function usherParams(token) {
        return "?sig=" + encodeURIComponent(token.signature) +
            "&token=" + encodeURIComponent(token.value) +
            "&allow_source=true&allow_audio_only=true&fast_bread=true&player_backend=mediaplayer" +
            "&playlist_include_framerate=true&p=" + Math.floor(Math.random() * 9999999);
    }

    function liveUrl(login, token) {
        return USHER_BASE + "/api/channel/hls/" + encodeURIComponent(login.toLowerCase()) + ".m3u8" + usherParams(token);
    }

    /*
     * Ad-block: fetch the HLS playlist through a "playlist proxy" instead of
     * usher directly. The proxy fetches its OWN anonymous token and requests
     * the stream from an ad-free region, so Twitch doesn't stitch the mid-roll
     * "commercial break" ads in. We never pass the user's token to it.
     *
     * These are the maintained TTV-LOL-PRO v1 endpoints (cdn-perfprod / luminous),
     * which — unlike the old ttv.lol / ontdb / kwabang proxies — need no custom
     * request header, so a TV's native <video> element can load them directly.
     * URL format (from streamlink-ttvlol): {host}/playlist/{channel}.m3u8 with
     * the query string percent-encoded into the path. Public proxies rotate/go
     * down and are region-dependent — always keep direct liveUrl() as a fallback.
     */
    var AD_PROXIES = {
        eu: "https://lb-eu.cdn-perfprod.com",
        eu2: "https://eu.luminous.dev",
        na: "https://lb-na.cdn-perfprod.com",
        as: "https://lb-as.cdn-perfprod.com"
    };

    function liveUrlProxy(login, which) {
        var base = AD_PROXIES[which] || AD_PROXIES.eu;
        var params = "?platform=web&allow_source=true&allow_audio_only=true&fast_bread=true&p=" + Math.floor(Math.random() * 9999999);
        return base + "/playlist/" + login.toLowerCase() + ".m3u8" + encodeURIComponent(params);
    }

    function vodUrl(vodId, token) {
        return USHER_BASE + "/vod/" + encodeURIComponent(String(vodId)) + ".m3u8" + usherParams(token);
    }

    /* Parses an HLS master playlist into [{name, height, bandwidth, url}] (master order kept: best first) */
    function parseMaster(text) {
        var lines = text.split("\n");
        var variants = [];
        var pending = null;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, "");
            if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
                pending = { name: null, height: 0, bandwidth: 0, url: null };
                var video = line.match(/VIDEO="([^"]*)"/);
                var res = line.match(/RESOLUTION=\d+x(\d+)/);
                var bw = line.match(/BANDWIDTH=(\d+)/);
                if (video) { pending.name = video[1]; }
                if (res) { pending.height = parseInt(res[1], 10); }
                if (bw) { pending.bandwidth = parseInt(bw[1], 10); }
            } else if (pending && line.length > 0 && line.charAt(0) !== "#") {
                pending.url = line;
                variants.push(pending);
                pending = null;
            }
        }
        return variants;
    }

    /*
     * quality: "auto" | "source" | "audio_only" | "720" | "480" | ...
     * Returns a variant URL or null (null = use master playlist).
     */
    function pickVariant(variants, quality) {
        if (!variants || variants.length === 0 || quality === "auto") { return null; }
        var i, best = null;
        if (quality === "audio_only") {
            for (i = 0; i < variants.length; i++) {
                if (variants[i].name === "audio_only") { return variants[i].url; }
            }
            return null;
        }
        if (quality === "source") {
            for (i = 0; i < variants.length; i++) {
                if (variants[i].name !== "audio_only") { return variants[i].url; }
            }
            return null;
        }
        var target = parseInt(quality, 10);
        if (!target) { return null; }
        for (i = 0; i < variants.length; i++) {
            var v = variants[i];
            if (v.name === "audio_only") { continue; }
            if (v.height <= target && (best == null || v.height > best.height)) { best = v; }
        }
        return best ? best.url : null;
    }

    function fetchText(url, callback) {
        xhr("GET", url, null, null, callback);
    }

    return {
        topStreams: topStreams,
        topGames: topGames,
        followedStreams: followedStreams,
        recommendedStreams: recommendedStreams,
        streamStats: streamStats,
        gameStreams: gameStreams,
        channel: channel,
        usersByLogins: usersByLogins,
        search: search,
        playbackToken: playbackToken,
        liveUrl: liveUrl,
        liveUrlProxy: liveUrlProxy,
        vodUrl: vodUrl,
        parseMaster: parseMaster,
        pickVariant: pickVariant,
        fetchText: fetchText
    };
})();
