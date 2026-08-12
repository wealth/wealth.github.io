/*
 * Smart Twitch TV — Media Station X interaction plugin.
 * Unofficial Twitch client for MSX (LG webOS, Samsung Tizen, etc.),
 * inspired by SmartTwitchTV (https://github.com/fgl27/smarttwitchtv).
 *
 * ES5 only: must run on old TV browsers (webOS 3+).
 */
(function () {
    "use strict";

    var VERSION = "1.0.0";
    var PLUGIN_URL = window.location.protocol + "//" + window.location.host + window.location.pathname;
    var PLAYER_URL = PLUGIN_URL.replace(/[^\/]*$/, "") + "player.html";
    var MAX_INPUT_LENGTH = 30;
    var SECTION_CACHE_MS = 60000;

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function req(dataId) {
        return "request:interaction:" + dataId + "@" + PLUGIN_URL;
    }

    function creq(dataId) {
        return "content:" + req(dataId);
    }

    var store = {
        get: function (key, def) {
            try {
                var value = window.localStorage.getItem("stv:" + key);
                return value == null ? def : value;
            } catch (e) { return def; }
        },
        set: function (key, value) {
            try { window.localStorage.setItem("stv:" + key, value); } catch (e) { }
        }
    };

    function getFavorites() {
        try {
            var list = JSON.parse(store.get("favorites", "[]"));
            return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
        } catch (e) { return []; }
    }

    function setFavorites(list) {
        store.set("favorites", JSON.stringify(list));
    }

    function isFavorite(login) {
        var list = getFavorites();
        for (var i = 0; i < list.length; i++) {
            if (list[i] === login) { return true; }
        }
        return false;
    }

    function toggleFavorite(login) {
        var list = getFavorites();
        var out = [];
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i] === login) { found = true; } else { out.push(list[i]); }
        }
        if (!found) { out.push(login); }
        setFavorites(out);
        return !found;
    }

    function fmtNum(n) {
        n = n || 0;
        if (n >= 1000000) { return (n / 1000000).toFixed(1).replace(".0", "") + "M"; }
        if (n >= 1000) { return (n / 1000).toFixed(1).replace(".0", "") + "K"; }
        return String(n);
    }

    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function fmtDuration(sec) {
        sec = sec || 0;
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
    }

    function timeAgo(iso) {
        var then = new Date(iso).getTime();
        if (!then) { return ""; }
        var diff = Math.max(0, Date.now() - then);
        var mins = Math.floor(diff / 60000);
        if (mins < 60) { return mins + "m ago"; }
        var hours = Math.floor(mins / 60);
        if (hours < 24) { return hours + "h ago"; }
        var days = Math.floor(hours / 24);
        if (days < 30) { return days + "d ago"; }
        var months = Math.floor(days / 30);
        if (months < 12) { return months + "mo ago"; }
        return Math.floor(months / 12) + "y ago";
    }

    function uptime(iso) {
        var start = new Date(iso).getTime();
        if (!start) { return ""; }
        var mins = Math.floor(Math.max(0, Date.now() - start) / 60000);
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h > 0 ? h + "h " + m + "m" : m + "m";
    }

    function bust(url) {
        if (!url) { return url; }
        return url + (url.indexOf("?") < 0 ? "?" : "&") + "_=" + Math.floor(Date.now() / 60000);
    }

    function errorRoot(message) {
        return {
            type: "pages",
            headline: "Error",
            cache: false,
            pages: [{
                items: [{
                    type: "default",
                    layout: "2,2,8,2",
                    color: "msx-glass",
                    icon: "warning",
                    text: String(message)
                }]
            }]
        };
    }

    /* Chunks card items into pages of a manual w x h grid (12 x 6 cells) */
    function flowPages(items, w, h, headline) {
        var cols = Math.floor(12 / w);
        var rows = Math.floor(6 / h);
        var perPage = cols * rows;
        var pages = [];
        for (var i = 0; i < items.length; i++) {
            var slot = i % perPage;
            if (slot === 0) {
                pages.push({ headline: headline, items: [] });
            }
            var item = items[i];
            item.layout = ((slot % cols) * w) + "," + (Math.floor(slot / cols) * h) + "," + w + "," + h;
            pages[pages.length - 1].items.push(item);
        }
        return pages;
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                              */
    /* ------------------------------------------------------------------ */

    var STREAM_TEMPLATE = {
        type: "separate",
        layout: "0,0,3,2",
        color: "msx-glass",
        imageFiller: "cover"
    };

    var GAME_TEMPLATE = {
        type: "separate",
        layout: "0,0,2,3",
        color: "msx-glass",
        imageFiller: "cover"
    };

    function streamCard(node) {
        var footer = "{ico:visibility} " + fmtNum(node.viewersCount);
        if (node.game && node.game.displayName) {
            footer += "  " + node.game.displayName;
        }
        return {
            image: bust(node.previewImageURL),
            title: node.broadcaster.displayName || node.broadcaster.login,
            titleFooter: footer,
            action: creq("channel:" + node.broadcaster.login)
        };
    }

    function gameCard(node) {
        return {
            type: "separate",
            color: "msx-glass",
            imageFiller: "cover",
            image: node.boxArtURL,
            title: node.displayName || node.name,
            titleFooter: node.viewersCount ? "{ico:visibility} " + fmtNum(node.viewersCount) : " ",
            action: creq("game:" + encodeURIComponent(node.name))
        };
    }

    function channelCard(user) {
        var live = user.stream != null;
        var card = {
            type: "separate",
            color: "msx-glass",
            imageFiller: "cover",
            title: user.displayName || user.login,
            action: creq("channel:" + user.login)
        };
        if (live) {
            var s = user.stream;
            card.image = bust(s.previewImageURL || user.profileImageURL);
            card.tag = "LIVE";
            card.tagColor = "msx-red";
            card.titleFooter = "{ico:visibility} " + fmtNum(s.viewersCount) +
                (s.game && s.game.displayName ? "  " + s.game.displayName : "");
        } else {
            card.image = user.profileImageURL;
            card.titleFooter = "Offline";
        }
        return card;
    }

    function vodCard(node) {
        return {
            type: "separate",
            color: "msx-glass",
            imageFiller: "cover",
            image: node.previewThumbnailURL,
            title: node.title || "Untitled",
            titleFooter: "{ico:timer} " + fmtDuration(node.lengthSeconds) +
                "  {ico:visibility} " + fmtNum(node.viewCount) +
                "  " + timeAgo(node.publishedAt),
            action: "interaction:commit",
            data: { action: "playvod", vodId: node.id, label: node.title || "Video" }
        };
    }

    function moreItem(sectionKey) {
        return {
            type: "button",
            label: "{ico:add} Load more",
            action: "interaction:commit",
            data: { action: "more", section: sectionKey }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Sections (top streams, top games, streams per game)                */
    /* ------------------------------------------------------------------ */

    var sections = {};

    function sectionMeta(key) {
        if (key === "streams") {
            return { headline: "Top streams", template: STREAM_TEMPLATE };
        }
        if (key === "games") {
            return { headline: "Top games", template: GAME_TEMPLATE };
        }
        /* key = "game:<encoded name>" */
        return { headline: decodeURIComponent(key.substring(5)), template: STREAM_TEMPLATE };
    }

    function fetchSection(key, sec, done) {
        function accept(mapper) {
            return function (err, page) {
                if (err) { done(err); return; }
                for (var i = 0; i < page.items.length; i++) {
                    sec.cards.push(mapper(page.items[i]));
                }
                sec.cursor = page.cursor;
                sec.hasNext = page.hasNext;
                done(null);
            };
        }
        if (key === "streams") {
            Twitch.topStreams(sec.cursor, accept(streamCard));
        } else if (key === "games") {
            Twitch.topGames(sec.cursor, accept(gameCard));
        } else {
            Twitch.gameStreams(decodeURIComponent(key.substring(5)), sec.cursor, accept(streamCard));
        }
    }

    function buildSectionRoot(key, sec) {
        var meta = sectionMeta(key);
        var items = sec.cards.slice(0);
        if (sec.hasNext) { items.push(moreItem(key)); }
        return {
            type: "pages",
            headline: meta.headline,
            cache: false,
            refocus: true,
            template: meta.template,
            items: items
        };
    }

    function sectionContent(key, callback) {
        var sec = sections[key];
        var now = Date.now();
        if (sec && sec.cards.length > 0 && (sec.keep || now - sec.ts < SECTION_CACHE_MS)) {
            sec.keep = false;
            callback(buildSectionRoot(key, sec));
            return;
        }
        sec = sections[key] = { cards: [], cursor: null, hasNext: false, ts: now, keep: false, loading: false };
        fetchSection(key, sec, function (err) {
            if (err) { callback(errorRoot(err)); return; }
            callback(buildSectionRoot(key, sec));
        });
    }

    function loadMore(key) {
        var sec = sections[key];
        if (!sec || sec.loading) { return; }
        sec.loading = true;
        TVXInteractionPlugin.startLoading();
        fetchSection(key, sec, function (err) {
            sec.loading = false;
            TVXInteractionPlugin.stopLoading();
            if (err) {
                TVXInteractionPlugin.executeAction("error:" + err);
                return;
            }
            sec.keep = true;
            sec.ts = Date.now();
            TVXInteractionPlugin.executeAction("reload:content");
        });
    }

    /* ------------------------------------------------------------------ */
    /* Channel page                                                       */
    /* ------------------------------------------------------------------ */

    function channelRoot(login, callback) {
        Twitch.channel(login, function (err, user) {
            if (err) { callback(errorRoot(err)); return; }
            var s = user.stream;
            var live = s != null;
            var fav = isFavorite(user.login);
            var lines = [];
            if (live) {
                if (s.title) { lines.push(s.title); }
                var meta = "{ico:visibility} " + fmtNum(s.viewersCount);
                if (s.game && s.game.displayName) { meta += "   {ico:videogame-asset} " + s.game.displayName; }
                lines.push(meta);
                if (s.createdAt) { lines.push("{ico:schedule} Live for " + uptime(s.createdAt)); }
            } else {
                lines.push("Offline");
            }
            if (user.followers) { lines.push("{ico:group} " + fmtNum(user.followers.totalCount) + " followers"); }
            if (!live && user.description) { lines.push(user.description.substring(0, 220)); }

            var preview = {
                type: "default",
                layout: "0,0,7,4",
                color: "msx-glass",
                image: live ? bust(s.previewImageURL) : (user.offlineImageURL || user.profileImageURL),
                imageFiller: "cover"
            };
            if (live) {
                preview.action = "interaction:commit";
                preview.data = { action: "play", channel: user.login, label: user.displayName || user.login };
            }

            var page1 = {
                items: [
                    preview,
                    {
                        type: "default",
                        layout: "7,0,5,4",
                        enable: false,
                        headline: user.displayName || user.login,
                        text: lines.join("{br}")
                    },
                    {
                        type: "button",
                        layout: "0,4,3,1",
                        label: "{ico:play-arrow} " + (live ? "Watch live" : "Offline"),
                        enable: live,
                        action: "interaction:commit",
                        data: { action: "play", channel: user.login, label: user.displayName || user.login }
                    },
                    {
                        type: "button",
                        layout: "3,4,3,1",
                        label: "{ico:" + (fav ? "star" : "star-border") + "} " + (fav ? "Remove favorite" : "Add favorite"),
                        action: "interaction:commit",
                        data: { action: "fav", channel: user.login }
                    }
                ]
            };

            var vods = [];
            if (user.videos && user.videos.edges) {
                for (var i = 0; i < user.videos.edges.length; i++) {
                    var edge = user.videos.edges[i];
                    if (edge && edge.node) { vods.push(vodCard(edge.node)); }
                }
            }

            callback({
                type: "pages",
                headline: user.displayName || user.login,
                cache: false,
                refocus: true,
                pages: [page1].concat(flowPages(vods, 3, 2, "Recent videos"))
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Search                                                             */
    /* ------------------------------------------------------------------ */

    var searchInput = "";
    var searchResults = null;
    var searchSeq = 0;
    var searchTimer = null;

    function keyButton(label, key, x, y, w, dataAction) {
        return {
            type: "button",
            layout: x + "," + y + "," + (w || 1) + ",1",
            label: label,
            key: key,
            action: "interaction:commit",
            data: dataAction
        };
    }

    function buildKeyboardPage() {
        var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        var items = [];
        for (var i = 0; i < chars.length; i++) {
            var ch = chars.charAt(i);
            items.push(keyButton(ch.toUpperCase(), ch, i % 12, Math.floor(i / 12), 1, { action: "skey", value: ch }));
        }
        items.push(keyButton("{ico:backspace}", "delete", 0, 3, 4, { action: "sctl", value: "back" }));
        items.push(keyButton("{ico:space-bar}", "space|insert", 4, 3, 4, { action: "skey", value: " " }));
        items.push(keyButton("{ico:clear}", "home|end", 8, 3, 4, { action: "sctl", value: "clear" }));
        return {
            headline: searchInput.length > 0 ? "{ico:search} " + searchInput + "_" : "{ico:search} Type to search",
            offset: "0,0,0,0.5",
            items: items
        };
    }

    function buildSearchRoot() {
        var pages = [buildKeyboardPage()];
        if (searchResults && searchInput.length > 0) {
            var i, items;
            if (searchResults.channels.length > 0) {
                items = [];
                for (i = 0; i < searchResults.channels.length && i < 12; i++) {
                    items.push(channelCard(searchResults.channels[i]));
                }
                pages = pages.concat(flowPages(items, 3, 2, "Channels"));
            }
            if (searchResults.games.length > 0) {
                items = [];
                for (i = 0; i < searchResults.games.length && i < 12; i++) {
                    items.push(gameCard(searchResults.games[i]));
                }
                pages = pages.concat(flowPages(items, 2, 3, "Games"));
            }
            if (searchResults.channels.length === 0 && searchResults.games.length === 0) {
                pages.push({
                    items: [{
                        type: "default",
                        layout: "0,0,12,1",
                        enable: false,
                        text: "No results for \"" + searchResults.forInput + "\""
                    }]
                });
            }
        }
        return {
            type: "list",
            cache: false,
            headline: "Search",
            pages: pages
        };
    }

    function updateSearch() {
        searchSeq++;
        var seq = searchSeq;
        if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
        TVXInteractionPlugin.executeAction("reload:content");
        if (searchInput.length === 0) {
            searchResults = null;
            return;
        }
        searchTimer = setTimeout(function () {
            var input = searchInput;
            Twitch.search(input, function (err, res) {
                if (seq !== searchSeq) { return; }
                if (err) { return; }
                res.forInput = input;
                searchResults = res;
                TVXInteractionPlugin.executeAction("reload:content");
            });
        }, 400);
    }

    function handleSearchKey(value) {
        if (value === " " && (searchInput.length === 0 || searchInput.charAt(searchInput.length - 1) === " ")) { return; }
        if (searchInput.length >= MAX_INPUT_LENGTH) { return; }
        searchInput += value;
        updateSearch();
    }

    function handleSearchControl(value) {
        if (value === "back") {
            if (searchInput.length === 0) { return; }
            searchInput = searchInput.substring(0, searchInput.length - 1);
        } else if (value === "clear") {
            if (searchInput.length === 0) { return; }
            searchInput = "";
        }
        updateSearch();
    }

    /* ------------------------------------------------------------------ */
    /* Favorites                                                          */
    /* ------------------------------------------------------------------ */

    function favoritesRoot(callback) {
        var logins = getFavorites();
        if (logins.length === 0) {
            callback({
                type: "pages",
                headline: "Favorites",
                cache: false,
                pages: [{
                    items: [{
                        type: "default",
                        layout: "2,2,8,2",
                        color: "msx-glass",
                        icon: "star-border",
                        text: "No favorites yet.{br}Open a channel and press \"Add favorite\"."
                    }]
                }]
            });
            return;
        }
        Twitch.usersByLogins(logins, function (err, users) {
            if (err) { callback(errorRoot(err)); return; }
            var live = [];
            var offline = [];
            for (var i = 0; i < users.length; i++) {
                if (!users[i]) { continue; }
                if (users[i].stream != null) { live.push(users[i]); } else { offline.push(users[i]); }
            }
            live.sort(function (a, b) { return b.stream.viewersCount - a.stream.viewersCount; });
            var cards = [];
            for (i = 0; i < live.length; i++) { cards.push(channelCard(live[i])); }
            for (i = 0; i < offline.length; i++) { cards.push(channelCard(offline[i])); }
            callback({
                type: "pages",
                headline: "Favorites",
                cache: false,
                refocus: true,
                template: STREAM_TEMPLATE,
                items: cards
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Settings + About                                                   */
    /* ------------------------------------------------------------------ */

    var QUALITY_OPTIONS = [
        { value: "auto", label: "Auto (adaptive)" },
        { value: "source", label: "Source (best)" },
        { value: "720", label: "720p" },
        { value: "480", label: "480p" },
        { value: "360", label: "360p" },
        { value: "160", label: "160p" },
        { value: "audio_only", label: "Audio only" }
    ];

    var PLAYER_OPTIONS = [
        { value: "default", label: "TV player (recommended)" },
        { value: "html5x", label: "HLS.js player (fallback)" }
    ];

    function radioItems(options, storeKey, current) {
        var items = [];
        for (var i = 0; i < options.length; i++) {
            var selected = options[i].value === current;
            items.push({
                type: "button",
                label: "{ico:" + (selected ? "radio-button-checked" : "radio-button-unchecked") + "} " + options[i].label,
                action: "interaction:commit",
                data: { action: "set", key: storeKey, value: options[i].value }
            });
        }
        return flowPages(items, 4, 1, null)[0].items;
    }

    function settingsRoot() {
        return {
            type: "list",
            headline: "Settings",
            cache: false,
            refocus: true,
            pages: [
                { headline: "Stream quality", items: radioItems(QUALITY_OPTIONS, "quality", store.get("quality", "auto")) },
                { headline: "Player (switch if playback fails)", items: radioItems(PLAYER_OPTIONS, "player", store.get("player", "default")) }
            ]
        };
    }

    function aboutRoot() {
        return {
            type: "pages",
            headline: "About",
            cache: true,
            pages: [{
                items: [{
                    type: "default",
                    layout: "1,1,10,4",
                    color: "msx-glass",
                    headline: "Smart Twitch TV for Media Station X — v" + VERSION,
                    text: [
                        "Unofficial Twitch client running as a Media Station X plugin.",
                        "Inspired by SmartTwitchTV for Android (github.com/fgl27/smarttwitchtv).",
                        "",
                        "Browse top streams and games, search, keep favorites, and watch live streams and recent videos.",
                        "Uses the public Twitch API — no login required. Not affiliated with Twitch or Amazon.",
                        "",
                        "Tip: if playback does not start on your TV, switch the player in Settings."
                    ].join("{br}")
                }]
            }]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Playback                                                           */
    /* ------------------------------------------------------------------ */

    function launchVideo(url, label) {
        var action;
        if (store.get("player", "default") === "html5x") {
            action = "video:plugin:" + PLAYER_URL + "?url=" + encodeURIComponent(url);
        } else {
            action = "video:" + url;
        }
        TVXInteractionPlugin.stopLoading();
        TVXInteractionPlugin.executeAction(action, { playerLabel: label });
    }

    function playFailed(err) {
        TVXInteractionPlugin.stopLoading();
        TVXInteractionPlugin.executeAction("error:" + err);
    }

    function resolveQualityAndPlay(masterUrl, label) {
        var quality = store.get("quality", "auto");
        if (quality === "auto") {
            launchVideo(masterUrl, label);
            return;
        }
        Twitch.fetchText(masterUrl, function (err, text) {
            if (err || !text) {
                launchVideo(masterUrl, label);
                return;
            }
            var url = Twitch.pickVariant(Twitch.parseMaster(text), quality);
            launchVideo(url || masterUrl, label);
        });
    }

    function playLive(channel, label) {
        TVXInteractionPlugin.startLoading();
        Twitch.playbackToken(channel, null, function (err, token) {
            if (err) { playFailed(err); return; }
            resolveQualityAndPlay(Twitch.liveUrl(channel, token), label + " — LIVE");
        });
    }

    function playVod(vodId, label) {
        TVXInteractionPlugin.startLoading();
        Twitch.playbackToken(null, vodId, function (err, token) {
            if (err) { playFailed(err); return; }
            resolveQualityAndPlay(Twitch.vodUrl(vodId, token), label);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Menu                                                               */
    /* ------------------------------------------------------------------ */

    function menuRoot() {
        return {
            name: "Smart Twitch TV",
            version: VERSION,
            headline: "Smart Twitch TV",
            refocus: true,
            menu: [
                { icon: "live-tv", label: "Top streams", data: req("streams") },
                { icon: "videogame-asset", label: "Games", data: req("games") },
                { icon: "search", label: "Search", data: req("search") },
                { icon: "star", label: "Favorites", data: req("favorites") },
                { type: "separator" },
                { icon: "tune", label: "Settings", data: req("settings") },
                { icon: "info", label: "About", data: req("about") }
            ]
        };
    }

    /* ------------------------------------------------------------------ */
    /* MSX handler                                                        */
    /* ------------------------------------------------------------------ */

    var handler = {
        init: function () { },
        ready: function () { },
        handleEvent: function (data) { },
        handleData: function (data) {
            var d = data && data.data;
            if (!d || !d.action) { return; }
            if (d.action === "play") {
                playLive(d.channel, d.label || d.channel);
            } else if (d.action === "playvod") {
                playVod(d.vodId, d.label || "Video");
            } else if (d.action === "fav") {
                toggleFavorite(d.channel);
                TVXInteractionPlugin.executeAction("reload:content");
            } else if (d.action === "more") {
                loadMore(d.section);
            } else if (d.action === "skey") {
                handleSearchKey(d.value);
            } else if (d.action === "sctl") {
                handleSearchControl(d.value);
            } else if (d.action === "set") {
                store.set(d.key, d.value);
                TVXInteractionPlugin.executeAction("reload:content");
            }
        },
        handleRequest: function (dataId, data, callback) {
            try {
                var sep = dataId.indexOf(":");
                var cmd = sep < 0 ? dataId : dataId.substring(0, sep);
                var arg = sep < 0 ? null : dataId.substring(sep + 1);
                if (cmd === "init") {
                    callback(menuRoot());
                } else if (cmd === "streams" || cmd === "games") {
                    sectionContent(cmd, callback);
                } else if (cmd === "game" && arg) {
                    sectionContent("game:" + arg, callback);
                } else if (cmd === "channel" && arg) {
                    channelRoot(arg, callback);
                } else if (cmd === "search") {
                    callback(buildSearchRoot());
                } else if (cmd === "favorites") {
                    favoritesRoot(callback);
                } else if (cmd === "settings") {
                    callback(settingsRoot());
                } else if (cmd === "about") {
                    callback(aboutRoot());
                } else {
                    callback(null);
                }
            } catch (e) {
                callback(errorRoot("Plugin error: " + e));
            }
        },
        onError: function (message, error) { }
    };

    TVXPluginTools.onReady(function () {
        TVXInteractionPlugin.setupHandler(handler);
        TVXInteractionPlugin.init();
    });
})();
