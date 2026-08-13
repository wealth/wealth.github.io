/*
 * Smart Twitch TV — Media Station X interaction plugin.
 * Unofficial Twitch client for MSX (LG webOS, Samsung Tizen, etc.),
 * inspired by SmartTwitchTV (https://github.com/fgl27/smarttwitchtv).
 *
 * ES5 only: must run on old TV browsers (webOS 3+).
 */
(function () {
    "use strict";

    var VERSION = "1.5.7";
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

    function channelOptions(login) {
        return {
            headline: "Channel",
            template: { enumerate: false, type: "control", layout: "0,0,8,1" },
            items: [{
                icon: "video-library",
                label: "Channel & videos",
                action: creq("channel:" + login)
            }]
        };
    }

    function streamCard(node) {
        var footer = "{ico:visibility} " + fmtNum(node.viewersCount);
        if (node.game && node.game.displayName) {
            footer += "  " + node.game.displayName;
        }
        return {
            image: bust(node.previewImageURL),
            title: node.broadcaster.displayName || node.broadcaster.login,
            titleFooter: footer,
            action: "interaction:commit",
            data: {
                action: "play",
                channel: node.broadcaster.login,
                cid: node.broadcaster.id,
                label: node.broadcaster.displayName || node.broadcaster.login,
                title: node.title,
                game: node.game && node.game.displayName ? node.game.displayName : null
            },
            options: channelOptions(node.broadcaster.login)
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
            options: channelOptions(user.login)
        };
        if (live) {
            var s = user.stream;
            card.image = bust(s.previewImageURL || user.profileImageURL);
            card.tag = "LIVE";
            card.tagColor = "msx-red";
            card.titleFooter = "{ico:visibility} " + fmtNum(s.viewersCount) +
                (s.game && s.game.displayName ? "  " + s.game.displayName : "");
            card.action = "interaction:commit";
            card.data = {
                action: "play",
                channel: user.login,
                cid: user.id,
                label: user.displayName || user.login,
                title: s.title
            };
        } else {
            card.image = user.profileImageURL;
            card.titleFooter = "Offline";
            card.action = creq("channel:" + user.login);
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
        if (key === "following") {
            return { headline: "Following", template: STREAM_TEMPLATE, empty: "None of the channels you follow are live right now." };
        }
        if (key === "recommended") {
            return { headline: "Recommended", template: STREAM_TEMPLATE };
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
        } else if (key === "following") {
            Twitch.followedStreams(sec.cursor, accept(streamCard));
        } else if (key === "recommended") {
            Twitch.recommendedStreams(accept(streamCard));
        } else {
            Twitch.gameStreams(decodeURIComponent(key.substring(5)), sec.cursor, accept(streamCard));
        }
    }

    function buildSectionRoot(key, sec) {
        var meta = sectionMeta(key);
        if (sec.cards.length === 0 && meta.empty) {
            return {
                type: "pages",
                headline: meta.headline,
                cache: false,
                pages: [{
                    items: [{
                        type: "default",
                        layout: "2,2,8,2",
                        color: "msx-glass",
                        icon: "info",
                        text: meta.empty
                    }]
                }]
            };
        }
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
                preview.data = { action: "play", channel: user.login, cid: user.id, label: user.displayName || user.login, title: s.title, game: s.game && s.game.displayName ? s.game.displayName : null };
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
                        data: { action: "play", channel: user.login, cid: user.id, label: user.displayName || user.login, title: live ? s.title : null, game: live && s.game && s.game.displayName ? s.game.displayName : null }
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
        { value: "html5x", label: "App player (hls.js)" }
    ];

    /* Ad-block: route live playback through a playlist proxy (see twitch.js).
       Different regions get different ad campaigns, so offer a few — try each. */
    var ADBLOCK_OPTIONS = [
        { value: "off", label: "Off" },
        { value: "eu", label: "On — Europe proxy" },
        { value: "eu2", label: "On — Europe proxy 2" },
        { value: "na", label: "On — North America proxy" },
        { value: "as", label: "On — Asia proxy" }
    ];

    var CHAT_OPTIONS = [
        { value: "on", label: "On (over video)" },
        { value: "off", label: "Off" }
    ];

    var CHAT_SIZE_OPTIONS = [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
        { value: "l", label: "Large" }
    ];

    var CHAT_POS_OPTIONS = [
        { value: "l", label: "Left" },
        { value: "r", label: "Right" }
    ];

    var CHAT_HEIGHT_OPTIONS = [
        { value: "full", label: "Full" },
        { value: "h75", label: "75%" },
        { value: "h50", label: "50%" },
        { value: "h25", label: "25%" }
    ];

    var CHAT_WIDTH_OPTIONS = [
        { value: "w30", label: "30%" },
        { value: "w25", label: "25%" },
        { value: "w20", label: "20%" },
        { value: "w15", label: "15%" },
        { value: "w10", label: "10%" }
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

    /* Migrates pre-1.2.0 corner values (bl/br/tl/tr) to l/r */
    function chatPos() {
        var v = store.get("chatpos", "l");
        if (v === "l" || v === "r") { return v; }
        return v.indexOf("r") >= 0 ? "r" : "l";
    }

    function settingsRoot() {
        return {
            type: "list",
            headline: "Settings",
            cache: false,
            refocus: true,
            pages: [
                { headline: "Chat overlay (also switchable during playback via player options)", items: radioItems(CHAT_OPTIONS, "chat", store.get("chat", "on")) },
                { headline: "Chat position", items: radioItems(CHAT_POS_OPTIONS, "chatpos", chatPos()) },
                { headline: "Chat height (from bottom)", items: radioItems(CHAT_HEIGHT_OPTIONS, "chatheight", store.get("chatheight", "h50")) },
                { headline: "Chat width", items: radioItems(CHAT_WIDTH_OPTIONS, "chatwidth", store.get("chatwidth", "w30")) },
                { headline: "Chat text size", items: radioItems(CHAT_SIZE_OPTIONS, "chatsize", store.get("chatsize", "m")) },
                { headline: "Stream quality", items: radioItems(QUALITY_OPTIONS, "quality", store.get("quality", "auto")) },
                { headline: "Block ads (routes live streams through a proxy; falls back to normal playback if it fails — try either proxy)", items: radioItems(ADBLOCK_OPTIONS, "adblock", store.get("adblock", "off")) },
                { headline: "Player for chatless playback (switch if playback fails)", items: radioItems(PLAYER_OPTIONS, "player", store.get("player", "default")) }
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
                        "Optionally sign in to see channels you follow and recommended streams.",
                        "Uses the public Twitch API. Not affiliated with Twitch or Amazon.",
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

    function launchVideo(url, label, extra) {
        var action;
        var ownPlayer = false;
        var chatOn = extra != null && extra.channel != null && store.get("chat", "on") === "on";
        var hasFallback = extra != null && extra.fallback != null;
        /* Our own player page is required for the chat overlay AND for ad-block
           (it retries with the direct URL if the proxy playlist fails). */
        if (chatOn || hasFallback || store.get("player", "default") === "html5x") {
            action = "video:plugin:" + PLAYER_URL + "?url=" + encodeURIComponent(url);
            if (chatOn) {
                action += "&channel=" + encodeURIComponent(extra.channel) +
                    (extra.cid ? "&cid=" + encodeURIComponent(extra.cid) : "");
            }
            if (hasFallback) {
                action += "&fallback=" + encodeURIComponent(extra.fallback);
            }
            ownPlayer = true;
        } else {
            action = "video:" + url;
        }
        var data = { playerLabel: label };
        if (ownPlayer) {
            /* OK = player controls (default); content button opens the options
               panel (favorite + chat controls). */
            data.properties = {
                "button:content:icon": "settings",
                "button:content:action": "panel:request:player:options"
            };
            if (chatOn) {
                /* Repurpose player OSD buttons as chat controls with remote-key
                   shortcuts. Arrows are reserved by MSX for navigation, red for
                   player restart and blue for the menu, so:
                   green = chat on/off, yellow = position, channel up = height,
                   channel down = width. */
                data.properties["button:prev:icon"] = "chat";
                data.properties["button:prev:key"] = "green";
                data.properties["button:prev:action"] = "player:commit:message:chatkey:toggle";
                data.properties["button:next:icon"] = "swap-horiz";
                data.properties["button:next:key"] = "yellow";
                data.properties["button:next:action"] = "player:commit:message:chatkey:pos";
                data.properties["button:speed:icon"] = "unfold-more";
                data.properties["button:speed:key"] = "channel_up";
                data.properties["button:speed:action"] = "player:commit:message:chatkey:height";
                data.properties["button:rewind:icon"] = "settings-ethernet";
                data.properties["button:rewind:key"] = "channel_down";
                data.properties["button:rewind:action"] = "player:commit:message:chatkey:width";
            }
        }
        TVXInteractionPlugin.stopLoading();
        TVXInteractionPlugin.executeAction(action, data);
    }

    function playFailed(err) {
        TVXInteractionPlugin.stopLoading();
        TVXInteractionPlugin.executeAction("error:" + err);
    }

    function resolveQualityAndPlay(masterUrl, label, extra, forcedQuality) {
        var quality = forcedQuality || store.get("quality", "auto");
        if (quality === "auto") {
            launchVideo(masterUrl, label, extra);
            return;
        }
        Twitch.fetchText(masterUrl, function (err, text) {
            if (err || !text) {
                /* Can't read the master (e.g. proxy without CORS): let the
                   player pick adaptively from the master instead. */
                launchVideo(masterUrl, label, extra);
                return;
            }
            var url = Twitch.pickVariant(Twitch.parseMaster(text), quality);
            launchVideo(url || masterUrl, label, extra);
        });
    }

    function playLive(channel, cid, label, title, game) {
        TVXInteractionPlugin.startLoading();
        Twitch.playbackToken(channel, null, function (err, token) {
            if (err) { playFailed(err); return; }
            /* Player controls label: stream title, then game, then streamer */
            var parts = [];
            if (title) { parts.push(title); }
            if (game) { parts.push(game); }
            if (label) { parts.push(label); }
            var playerLabel = parts.length ? parts.join("  —  ") : "LIVE";
            var directUrl = Twitch.liveUrl(channel, token);
            var extra = { channel: channel, cid: cid };
            var adblock = store.get("adblock", "off");
            var primaryUrl = directUrl;
            var forcedQuality = null;
            if (adblock !== "off") {
                /* Ad-free proxy first; fall back to direct (ad-supported) on failure */
                primaryUrl = Twitch.liveUrlProxy(channel, adblock);
                extra.fallback = directUrl;
                /* Adaptive bitrate tends to stick on the lowest rendition through
                   the proxy, so force best quality unless the user picked a fixed
                   one. (Needs the proxy to allow cross-origin reads; falls back to
                   adaptive if not.) */
                if (store.get("quality", "auto") === "auto") { forcedQuality = "source"; }
            }
            resolveQualityAndPlay(primaryUrl, playerLabel, extra, forcedQuality);
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
        var menu = [];
        var loggedIn = typeof TwitchAuth !== "undefined" && TwitchAuth.isLoggedIn();
        if (loggedIn) {
            menu.push({ icon: "favorite", label: "Following", data: req("following") });
            menu.push({ icon: "recommend", label: "Recommended", data: req("recommended") });
            menu.push({ type: "separator" });
        }
        menu.push({ icon: "live-tv", label: "Top streams", data: req("streams") });
        menu.push({ icon: "videogame-asset", label: "Games", data: req("games") });
        menu.push({ icon: "search", label: "Search", data: req("search") });
        menu.push({ icon: "star", label: "Favorites", data: req("favorites") });
        menu.push({ type: "separator" });
        if (loggedIn) {
            menu.push({ icon: "account-circle", label: TwitchAuth.displayName(), data: req("account") });
        } else {
            menu.push({ icon: "account-circle", label: "Connect account", data: req("login") });
        }
        menu.push({ icon: "tune", label: "Settings", data: req("settings") });
        menu.push({ icon: "info", label: "About", data: req("about") });
        return {
            name: "Smart Twitch TV",
            version: VERSION,
            headline: "Smart Twitch TV",
            refocus: true,
            menu: menu
        };
    }

    /* ------------------------------------------------------------------ */
    /* Account login (OAuth device flow)                                  */
    /* ------------------------------------------------------------------ */

    var loginState = null;

    function beginLogin() {
        loginState = { status: "starting" };
        TwitchAuth.startDeviceLogin(function (info) {
            loginState = { status: "code", code: info.user_code, uri: info.verification_uri };
            TVXInteractionPlugin.executeAction("reload:content");
        }, function (result) {
            if (result === "success") {
                loginState = { status: "success" };
                TVXInteractionPlugin.executeAction("reload:menu");
                TVXInteractionPlugin.executeAction("reload:content");
                TVXInteractionPlugin.executeAction("success:Signed in as " + (TwitchAuth.displayName() || "Twitch"));
            } else {
                loginState = { status: result === "expired" ? "expired" : "error" };
                TVXInteractionPlugin.executeAction("reload:content");
            }
        });
    }

    function loginRoot(callback) {
        if (TwitchAuth.isLoggedIn()) { callback(accountRoot()); return; }
        if (loginState == null || loginState.status === "expired" || loginState.status === "error") {
            beginLogin();
        }
        var st = loginState || { status: "starting" };
        var page;
        if (st.status === "code") {
            callback({
                type: "pages",
                headline: "Connect account",
                cache: false,
                pages: [{
                    items: [
                        {
                            type: "default",
                            layout: "1,1,10,1",
                            enable: false,
                            text: "On your phone or computer, open {col:msx-white}https://www.twitch.tv/activate{col} and enter this code:"
                        },
                        {
                            type: "default",
                            layout: "3,2,6,2",
                            color: "msx-glass",
                            headline: "{col:msx-white}" + st.code + "{col}",
                            text: "{ico:hourglass-empty} Waiting for you to authorize on Twitch…"
                        }
                    ]
                }]
            });
            return;
        } else if (st.status === "success") {
            page = {
                headline: "Signed in",
                text: "{ico:check-circle} Signed in as {txt:msx-bold:" + (TwitchAuth.displayName() || "Twitch") + "}",
                button: { label: "{ico:favorite} Show Following", action: creq("following") }
            };
        } else if (st.status === "expired") {
            page = {
                headline: "Code expired",
                text: "The code expired before it was entered.",
                button: { label: "{ico:refresh} Try again", action: creq("login") }
            };
        } else if (st.status === "error") {
            page = {
                headline: "Could not connect",
                text: "Something went wrong reaching Twitch. Please try again.",
                button: { label: "{ico:refresh} Try again", action: creq("login") }
            };
        } else {
            page = { headline: "Connecting…", text: "{ico:hourglass-empty} Contacting Twitch…" };
        }
        var items = [{
            type: "default",
            layout: "1,1,10,3",
            color: "msx-glass",
            headline: page.headline,
            text: page.text
        }];
        if (page.button) {
            items.push({
                type: "button",
                layout: "1,4,4,1",
                label: page.button.label,
                action: page.button.action
            });
        }
        callback({
            type: "pages",
            headline: "Connect account",
            cache: false,
            pages: [{ items: items }]
        });
    }

    function accountRoot() {
        return {
            type: "pages",
            headline: "Account",
            cache: false,
            pages: [{
                items: [
                    {
                        type: "default",
                        layout: "1,1,10,2",
                        color: "msx-glass",
                        headline: "{ico:account-circle} " + TwitchAuth.displayName(),
                        text: "Signed in to Twitch. Your followed and recommended streams are in the menu."
                    },
                    {
                        type: "button",
                        layout: "1,3,4,1",
                        label: "{ico:favorite} Following",
                        action: creq("following")
                    },
                    {
                        type: "button",
                        layout: "5,3,4,1",
                        label: "{ico:exit-to-app} Log out",
                        action: "interaction:commit",
                        data: { action: "logout" }
                    }
                ]
            }]
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
                playLive(d.channel, d.cid, d.label || d.channel, d.title, d.game);
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
            } else if (d.action === "logout") {
                TwitchAuth.logout();
                delete sections.following;
                delete sections.recommended;
                TVXInteractionPlugin.executeAction("reload:menu");
                TVXInteractionPlugin.executeAction("menu:request:interaction:streams@" + PLUGIN_URL);
                TVXInteractionPlugin.executeAction("info:Logged out");
            }
        },
        handleRequest: function (dataId, data, callback) {
            try {
                var sep = dataId.indexOf(":");
                var cmd = sep < 0 ? dataId : dataId.substring(0, sep);
                var arg = sep < 0 ? null : dataId.substring(sep + 1);
                if (cmd === "init") {
                    callback(menuRoot());
                } else if (cmd === "streams" || cmd === "games" || cmd === "following" || cmd === "recommended") {
                    sectionContent(cmd, callback);
                } else if (cmd === "game" && arg) {
                    sectionContent("game:" + arg, callback);
                } else if (cmd === "channel" && arg) {
                    channelRoot(arg, callback);
                } else if (cmd === "search") {
                    callback(buildSearchRoot());
                } else if (cmd === "favorites") {
                    favoritesRoot(callback);
                } else if (cmd === "login") {
                    loginRoot(callback);
                } else if (cmd === "account") {
                    callback(accountRoot());
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
