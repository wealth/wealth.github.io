/*
 * Smart Twitch TV — self-rendered TV app (launched by MSX via the link: action,
 * so this page owns its own UI and, crucially, its own key handling incl. Back).
 * Reuses the Twitch API (twitch.js), login (auth.js) and chat overlay (chat.js).
 * ES5 only (old webOS/Tizen browsers).
 */
(function () {
    "use strict";

    var VERSION = "1.7.4";

    /* Toggle a class on <html> — ES5-safe (no classList assumptions). */
    function setRootPlaying(on) {
        var el = document.documentElement;
        var cls = (" " + (el.className || "") + " ").replace(" playing ", " ").replace(/^\s+|\s+$/g, "");
        el.className = on ? (cls ? cls + " playing" : "playing") : cls;
    }

    /* ------------------------------------------------------------------ */
    /* Small helpers                                                      */
    /* ------------------------------------------------------------------ */

    var store = {
        get: function (k, d) { try { var v = localStorage.getItem("stv:" + k); return v == null ? d : v; } catch (e) { return d; } },
        set: function (k, v) { try { localStorage.setItem("stv:" + k, v); } catch (e) { } }
    };

    function $(id) { return document.getElementById(id); }
    function elem(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) { e.className = cls; }
        if (html != null) { e.innerHTML = html; }
        return e;
    }
    function empty(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

    function fmtNum(n) {
        n = n || 0;
        if (n >= 1000000) { return (n / 1000000).toFixed(1).replace(".0", "") + "M"; }
        if (n >= 1000) { return (n / 1000).toFixed(1).replace(".0", "") + "K"; }
        return String(n);
    }
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    function uptime(iso) {
        var start = new Date(iso).getTime();
        if (!start) { return ""; }
        var mins = Math.floor(Math.max(0, new Date().getTime() - start) / 60000);
        var h = Math.floor(mins / 60), m = mins % 60;
        return h > 0 ? h + "h " + (m < 10 ? "0" + m : m) + "m" : m + "m";
    }

    var ICONS = {
        tv: "M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z",
        games: "M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zM9 16.5V22h6v-5.5l-3-3-3 3zM16.5 9l-3 3 3 3H22V9h-5.5z",
        search: "M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z",
        star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
        starO: "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z",
        heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
        thumb: "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z",
        account: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
        settings: "M19.14 12.94a7.49 7.49 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 00-.61.22L2.66 8.84a.5.5 0 00.12.64l2.03 1.58a7.49 7.49 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32a.5.5 0 00.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54a.5.5 0 00.5.42h3.84a.5.5 0 00.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.5.5 0 00.61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z",
        info: "M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
        eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
        chat: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
        swap: "M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z",
        height: "M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z",
        width: "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z",
        text: "M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z",
        play: "M8 5v14l11-7z",
        pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
        back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
    };
    function icon(name, cls) {
        return "<svg class=\"" + (cls || "") + "\" viewBox=\"0 0 24 24\"><path d=\"" + (ICONS[name] || "") + "\"/></svg>";
    }

    function showLoading() { $("loading").style.display = "flex"; }
    function hideLoading() { $("loading").style.display = "none"; }
    var toastTimer = null;
    function toast(msg) {
        var t = $("toast");
        t.textContent = msg;
        t.style.display = "block";
        if (toastTimer) { clearTimeout(toastTimer); }
        toastTimer = setTimeout(function () { t.style.display = "none"; }, 3200);
    }

    /* ------------------------------------------------------------------ */
    /* Favorites                                                          */
    /* ------------------------------------------------------------------ */
    function getFavorites() {
        try { var l = JSON.parse(store.get("favorites", "[]")); return Object.prototype.toString.call(l) === "[object Array]" ? l : []; } catch (e) { return []; }
    }
    function isFavorite(login) { var l = getFavorites(); for (var i = 0; i < l.length; i++) { if (l[i] === login) { return true; } } return false; }
    function toggleFavorite(login) {
        var l = getFavorites(), out = [], found = false;
        for (var i = 0; i < l.length; i++) { if (l[i] === login) { found = true; } else { out.push(l[i]); } }
        if (!found) { out.push(login); }
        try { store.set("favorites", JSON.stringify(out)); } catch (e) { }
        return !found;
    }

    /* ------------------------------------------------------------------ */
    /* Player (fully owned: video + chat + OSD + Back)                    */
    /* ------------------------------------------------------------------ */

    var Player = (function () {
        var video = null, layer = null, osd = null;
        var open = false, osdOpen = false;
        var hls = null, urls = [], urlIndex = 0, nativeTried = false, hlsTried = false;
        var stream = null, statsTimer = null, curStats = null;
        var osdFocusables = [];

        function canNative() {
            try { var v = document.createElement("video"); return v.canPlayType("application/vnd.apple.mpegurl") !== "" || v.canPlayType("application/x-mpegURL") !== ""; } catch (e) { return false; }
        }
        function canHls() { return typeof Hls !== "undefined" && Hls.isSupported(); }

        function setupHls() {
            hlsTried = true;
            try { video.removeAttribute("src"); } catch (e) { }
            hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hls.on(Hls.Events.ERROR, function (evt, data) {
                if (data && data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR) { hls.startLoad(); }
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); }
                    else if (!advance()) { toast("Playback error"); hideLoading(); }
                }
            });
            hls.loadSource(urls[urlIndex]);
            hls.attachMedia(video);
        }
        function setupVideo() {
            if (canNative() || !canHls()) { nativeTried = true; video.src = urls[urlIndex]; video.load(); }
            else { setupHls(); }
        }
        function advance() {
            if (urlIndex >= urls.length - 1) { return false; }
            urlIndex++; nativeTried = false; hlsTried = false;
            if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
            showLoading(); setupVideo(); return true;
        }
        function onError() {
            if (!video || !video.error) { return; }
            if (nativeTried && !hlsTried && canHls()) { setupHls(); return; }
            if (advance()) { return; }
            toast("Video error"); hideLoading();
        }
        function onPlaying() { hideLoading(); }

        function startStats() {
            if (!stream) { return; }
            var login = stream.broadcaster.login;
            function tick() {
                Twitch.streamStats(login, function (err, s) {
                    if (err || !s) { return; }
                    if (typeof StvChat !== "undefined") { StvChat.setViewers(s.viewersCount); }
                    curStats = s;
                    if (osdOpen) { renderOsd(s); }
                });
            }
            tick();
            statsTimer = setInterval(tick, 60000);
        }

        function start(url, fallbacks, s) {
            stream = s;
            urls = [url].concat(fallbacks || []);
            urlIndex = 0; nativeTried = false; hlsTried = false;
            curStats = null;
            open = true; osdOpen = false;
            setRootPlaying(true);   /* reveal the TV's hardware video plane */
            layer.style.display = "block";
            hideLoading();
            showLoading();
            setupVideo();
            try { video.play(); } catch (e) { }
            /* chat overlay */
            if (typeof StvChat !== "undefined") {
                StvChat.init(stream.broadcaster.login, stream.broadcaster.id);
            }
            startStats();
        }

        function stop() {
            if (!open) { return; }
            open = false; osdOpen = false;
            if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
            if (typeof StvChat !== "undefined") { try { StvChat.dispose(); } catch (e) { } }
            if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
            if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) { } }
            osd.style.display = "none"; empty(osd);
            layer.style.display = "none";
            setRootPlaying(false);  /* restore the browse UI (un-hide #app) */
            hideLoading();
            App.onPlayerClosed();
        }

        function togglePlay() {
            if (!video) { return; }
            try { if (video.paused) { video.play(); } else { video.pause(); } } catch (e) { }
            if (osdOpen) { renderOsd(curStats); }
        }

        function renderOsd(stats) {
            curStats = stats;
            var prevIdx = -1;
            if (osdFocusables.length) {
                var cf = Nav.current();
                for (var pi = 0; pi < osdFocusables.length; pi++) { if (osdFocusables[pi] === cf) { prevIdx = pi; break; } }
            }
            empty(osd);
            var b = stream.broadcaster;
            var title = stream.title || "";
            var game = (stream.game && stream.game.displayName) ? stream.game.displayName : "";
            var name = b.displayName || b.login;

            /* Title block: stream title, then game, then streamer (+ uptime/viewers) */
            osd.appendChild(elem("div", "osd-title", esc(title) || "LIVE"));
            if (game) { osd.appendChild(elem("div", "osd-sub", esc(game))); }
            var meta = [esc(name)];
            var vc = stats ? stats.viewersCount : stream.viewersCount;
            if (vc != null) { meta.push(icon("eye", "ob-ico") + " " + fmtNum(vc)); }
            if (stats && stats.createdAt) { meta.push(uptime(stats.createdAt)); }
            var streamerEl = elem("div", "osd-streamer");
            streamerEl.innerHTML = meta.join("  &middot;  ");
            osd.appendChild(streamerEl);

            /* Player controls (play/pause + favorite). No chat toggles here —
               chat is controlled with the arrow keys while watching. */
            var actions = elem("div", "osd-actions");
            osdFocusables = [];
            function addBtn(ic, label, fn) {
                var btn = elem("div", "osd-btn focusable", icon(ic, "ob-ico") + "<span>" + esc(label) + "</span>");
                btn._action = fn;
                actions.appendChild(btn);
                osdFocusables.push(btn);
            }
            var paused = !!(video && video.paused);
            addBtn(paused ? "play" : "pause", paused ? "Play" : "Pause", togglePlay);
            var fav = isFavorite(b.login);
            addBtn(fav ? "star" : "starO", fav ? "Remove favorite" : "Add favorite", function () {
                var added = toggleFavorite(b.login); toast(added ? "Added to favorites" : "Removed from favorites"); renderOsd(curStats);
            });
            osd.appendChild(actions);
            if (osdOpen && osdFocusables.length) {
                var idx = prevIdx >= 0 ? Math.min(prevIdx, osdFocusables.length - 1) : 0;
                Nav.setFocus(osdFocusables[idx]);
            }
        }

        function showOsd() {
            osdOpen = true;
            osd.style.display = "block";
            renderOsd(curStats);
            Nav.setScope(osd);
            if (osdFocusables.length) { Nav.setFocus(osdFocusables[0]); }
        }
        function hideOsd() {
            osdOpen = false;
            osd.style.display = "none"; empty(osd);
            Nav.setScope(document);
        }

        /* Back while the player is open: close the OSD first, else stop the stream.
           (Back keys are routed here from App via handleBack — not via onKey.) */
        function back() {
            if (osdOpen) { hideOsd(); } else { stop(); }
        }

        function onKey(k) {
            if (osdOpen) {
                switch (k) {
                    case 37: Nav.move("left"); return;
                    case 39: Nav.move("right"); return;
                    case 38: Nav.move("up"); return;
                    case 40: Nav.move("down"); return;
                    case 13: var c = Nav.current(); if (c && c._action) { c._action(); } return;
                    default: return;
                }
            }
            /* OSD closed: arrows are chat shortcuts (the mapping you asked for) */
            switch (k) {
                case 13: showOsd(); return;                                   /* OK -> controls */
                case 40: if (typeof StvChat !== "undefined") { StvChat.toggle(); } return;  /* down: chat on/off */
                case 37: if (typeof StvChat !== "undefined") { StvChat.cyclePos(); } return; /* left: position */
                case 39: if (typeof StvChat !== "undefined") { StvChat.cycleWidth(); } return; /* right: width */
                case 38: if (typeof StvChat !== "undefined") { StvChat.cycleHeight(); } return; /* up: height */
                default: return;
            }
        }

        function init() {
            layer = $("player-layer");
            video = $("player");
            osd = $("osd");
            video.addEventListener("playing", onPlaying);
            video.addEventListener("error", onError);
            video.addEventListener("waiting", showLoading);
            video.addEventListener("canplay", hideLoading);
        }

        return {
            init: init, start: start, stop: stop,
            isOpen: function () { return open; },
            onKey: onKey, back: back
        };
    })();

    /* Build the playback URL(s) honouring ad-block + quality, then start */
    function playStream(stream) {
        showLoading();
        var channel = stream.broadcaster.login;
        Twitch.playbackToken(channel, null, function (err, token) {
            if (err) { hideLoading(); toast(err); return; }
            var direct = Twitch.liveUrl(channel, token);
            var adblock = store.get("adblock", "off");
            var quality = store.get("quality", "auto");
            if (adblock !== "off") {
                var proxy = Twitch.liveUrlProxy(channel, adblock);
                if (quality === "auto") {
                    Twitch.fetchText(proxy, function (e2, text) {
                        var u = (!e2 && text) ? Twitch.pickVariant(Twitch.parseMaster(text), "source") : null;
                        Player.start(u || proxy, [direct], stream);
                    });
                } else {
                    Player.start(proxy, [direct], stream);
                }
                return;
            }
            if (quality === "auto") { Player.start(direct, [], stream); return; }
            Twitch.fetchText(direct, function (e2, text) {
                var u = (!e2 && text) ? Twitch.pickVariant(Twitch.parseMaster(text), quality) : null;
                Player.start(u || direct, [], stream);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* App: menu + sections + navigation                                  */
    /* ------------------------------------------------------------------ */

    var App = (function () {
        var currentKey = null;
        var viewStack = [];    /* for Back within content (e.g. game -> streams) */
        var lastPlayEl = null; /* card we launched a stream from (restore focus on close) */

        var SECTIONS = [
            { key: "following", label: "Following", icon: "heart", auth: true },
            { key: "recommended", label: "Recommended", icon: "thumb", auth: true },
            { key: "top", label: "Top streams", icon: "tv" },
            { key: "games", label: "Games", icon: "games" },
            { key: "favorites", label: "Favorites", icon: "star" },
            { key: "account", label: "", icon: "account" },   /* label computed */
            { key: "settings", label: "Settings", icon: "settings" },
            { key: "about", label: "About", icon: "info" }
        ];

        function menuItems() {
            var loggedIn = typeof TwitchAuth !== "undefined" && TwitchAuth.isLoggedIn();
            var out = [];
            for (var i = 0; i < SECTIONS.length; i++) {
                var s = SECTIONS[i];
                if (s.auth && !loggedIn) { continue; }
                var label = s.label;
                if (s.key === "account") { label = loggedIn ? (TwitchAuth.displayName() || "Account") : "Connect account"; }
                out.push({ key: s.key, label: label, icon: s.icon });
            }
            return out;
        }

        function renderMenu() {
            var menu = $("menu");
            empty(menu);
            menu.appendChild(elem("div", "menu-title", "Smart Twitch TV"));
            var items = menuItems();
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.key === "account") { menu.appendChild(elem("div", "menu-sep")); }
                var mi = elem("div", "menu-item focusable", icon(it.icon, "mi-ico") + "<span>" + esc(it.label) + "</span>");
                mi._key = it.key;
                menu.appendChild(mi);
            }
        }

        function sectionTitle(text, sub) {
            var t = elem("div", "section-title", esc(text) + (sub ? " <span class=\"st-sub\">" + esc(sub) + "</span>" : ""));
            return t;
        }

        function streamCard(node) {
            var b = node.broadcaster;
            var card = elem("div", "card focusable");
            var thumb = elem("div", "card-thumb");
            var img = (node.previewImageURL || "").replace("{width}", "440").replace("{height}", "248");
            if (img) { thumb.style.backgroundImage = "url('" + img + "')"; }
            thumb.appendChild(elem("div", "card-live", "LIVE"));
            var badge = elem("div", "card-badge", icon("eye", "eye") + "<span>" + fmtNum(node.viewersCount) + "</span>");
            thumb.appendChild(badge);
            card.appendChild(thumb);
            var body = elem("div", "card-body");
            body.appendChild(elem("div", "card-title", esc(b.displayName || b.login)));
            var sub = (node.game && node.game.displayName ? node.game.displayName : "");
            body.appendChild(elem("div", "card-sub", esc(node.title || sub || "")));
            card.appendChild(body);
            card._play = node;
            return card;
        }

        function gameCard(node) {
            var card = elem("div", "card game-card focusable");
            var thumb = elem("div", "card-thumb");
            var img = (node.boxArtURL || "").replace("{width}", "285").replace("{height}", "380");
            if (img) { thumb.style.backgroundImage = "url('" + img + "')"; }
            card.appendChild(thumb);
            var body = elem("div", "card-body");
            body.appendChild(elem("div", "card-title", esc(node.displayName || node.name)));
            if (node.viewersCount) { body.appendChild(elem("div", "card-sub", fmtNum(node.viewersCount) + " viewers")); }
            card.appendChild(body);
            card._game = node;
            return card;
        }

        function renderGrid(container, result, kind, emptyMsg) {
            var items = (result && result.items) || [];
            if (items.length === 0) { container.appendChild(elem("div", "empty-msg", emptyMsg || "Nothing here right now.")); return; }
            var grid = elem("div", "grid");
            for (var i = 0; i < items.length; i++) {
                grid.appendChild(kind === "games" ? gameCard(items[i]) : streamCard(items[i]));
            }
            container.appendChild(grid);
        }

        /* Load + render a section (or a sub-view pushed onto the stack) */
        function showStreams(loader, title, sub, emptyMsg) {
            var content = $("content");
            empty(content);
            content.appendChild(sectionTitle(title, sub));
            showLoading();
            loader(function (err, result) {
                hideLoading();
                if (err) { content.appendChild(elem("div", "empty-msg", err)); Nav.refocus(); return; }
                renderGrid(content, result, "streams", emptyMsg);
                focusContentFirst();
            });
        }

        function focusContentFirst() {
            var first = $("content").querySelector(".focusable");
            if (first) { Nav.setFocus(first); } else { Nav.refocus(); }
        }

        function openGame(game) {
            viewStack.push({ type: "game", game: game });
            showStreams(function (cb) { Twitch.gameStreams(game.name, null, cb); }, game.displayName || game.name, "streams", "No live streams right now.");
        }

        function selectSection(key) {
            currentKey = key;
            viewStack = [];
            var content = $("content");
            if (key === "top") { showStreams(function (cb) { Twitch.topStreams(null, cb); }, "Top streams"); return; }
            if (key === "following") { showStreams(function (cb) { Twitch.followedStreams(null, cb); }, "Following", null, "None of the channels you follow are live right now."); return; }
            if (key === "recommended") { showStreams(function (cb) { Twitch.recommendedStreams(cb); }, "Recommended", "Live channels we think you'll like"); return; }
            if (key === "favorites") { showFavorites(); return; }
            if (key === "games") {
                empty(content); content.appendChild(sectionTitle("Games")); showLoading();
                Twitch.topGames(null, function (err, result) {
                    hideLoading();
                    if (err) { content.appendChild(elem("div", "empty-msg", err)); return; }
                    renderGrid(content, result, "games"); focusContentFirst();
                });
                return;
            }
            if (key === "settings") { showSettings(); return; }
            if (key === "about") { showAbout(); return; }
            if (key === "account") { showAccount(); return; }
        }

        function showFavorites() {
            var logins = getFavorites();
            var content = $("content");
            empty(content); content.appendChild(sectionTitle("Favorites"));
            if (logins.length === 0) { content.appendChild(elem("div", "empty-msg", "No favorites yet. Add channels from the player controls.")); return; }
            showLoading();
            Twitch.usersByLogins(logins, function (err, users) {
                hideLoading();
                if (err) { content.appendChild(elem("div", "empty-msg", err)); return; }
                var items = [];
                for (var i = 0; i < users.length; i++) {
                    var u = users[i];
                    if (u.stream) {
                        items.push({
                            id: u.stream.title, title: u.stream.title, viewersCount: u.stream.viewersCount,
                            previewImageURL: u.stream.previewImageURL, game: u.stream.game || { displayName: "" },
                            broadcaster: { id: u.id, login: u.login, displayName: u.displayName }
                        });
                    }
                }
                items.sort(function (a, b) { return b.viewersCount - a.viewersCount; });
                renderGrid(content, { items: items }, "streams", "None of your favorites are live right now.");
                focusContentFirst();
            });
        }

        /* ---- Settings ---- */
        var CHAT_OPTS = [["on", "On (over video)"], ["off", "Off"]];
        var POS_OPTS = [["l", "Left"], ["r", "Right"]];
        var HEIGHT_OPTS = [["full", "Full"], ["h75", "75%"], ["h50", "50%"], ["h25", "25%"]];
        var WIDTH_OPTS = [["w30", "30%"], ["w25", "25%"], ["w20", "20%"], ["w15", "15%"], ["w10", "10%"]];
        var SIZE_OPTS = [["s", "Small"], ["m", "Medium"], ["l", "Large"]];
        var QUALITY_OPTS = [["auto", "Auto (adaptive)"], ["source", "Source (best)"], ["720", "720p"], ["480", "480p"], ["360", "360p"], ["audio_only", "Audio only"]];
        var ADBLOCK_OPTS = [["off", "Off"], ["eu", "On — Europe"], ["eu2", "On — Europe 2"], ["na", "On — North America"], ["as", "On — Asia"]];

        function settingRow(label, key, opts, def) {
            var cur = store.get(key, def);
            var curLabel = cur;
            for (var i = 0; i < opts.length; i++) { if (opts[i][0] === cur) { curLabel = opts[i][1]; } }
            var row = elem("div", "btn-row focusable", "<span>" + esc(label) + "</span><span class=\"br-check\">" + esc(curLabel) + "</span>");
            row._cycle = function () {
                var c = store.get(key, def), idx = 0;
                for (var j = 0; j < opts.length; j++) { if (opts[j][0] === c) { idx = j; } }
                var next = opts[(idx + 1) % opts.length][0];
                store.set(key, next);
                showSettings();
            };
            return row;
        }

        function showSettings() {
            var content = $("content");
            empty(content); content.appendChild(sectionTitle("Settings"));
            content.appendChild(settingRow("Chat overlay", "chat", CHAT_OPTS, "on"));
            content.appendChild(settingRow("Chat position", "chatpos", POS_OPTS, "l"));
            content.appendChild(settingRow("Chat height", "chatheight", HEIGHT_OPTS, "h50"));
            content.appendChild(settingRow("Chat width", "chatwidth", WIDTH_OPTS, "w30"));
            content.appendChild(settingRow("Chat text size", "chatsize", SIZE_OPTS, "m"));
            content.appendChild(settingRow("Stream quality", "quality", QUALITY_OPTS, "auto"));
            content.appendChild(settingRow("Block ads (try each region)", "adblock", ADBLOCK_OPTS, "off"));
            Nav.refocus();
            focusContentFirst();
        }

        function showAbout() {
            var content = $("content");
            empty(content); content.appendChild(sectionTitle("About"));
            var box = elem("div", "btn-row", "Smart Twitch TV — v" + VERSION + "<br>Self-rendered TV app. Unofficial Twitch client.");
            box.style.maxWidth = "70vw"; box.style.display = "block";
            content.appendChild(box);
            Nav.refocus();
        }

        /* ---- Account / login (device code flow) ---- */
        function showAccount() {
            var content = $("content");
            empty(content);
            if (typeof TwitchAuth !== "undefined" && TwitchAuth.isLoggedIn()) {
                content.appendChild(sectionTitle("Account", TwitchAuth.displayName() || ""));
                var out = elem("div", "btn-row focusable", icon("account", "br-ico") + "<span>Log out</span>");
                out._action = function () { TwitchAuth.logout(); renderMenu(); selectSection("top"); toast("Logged out"); };
                content.appendChild(out);
                focusContentFirst();
                return;
            }
            content.appendChild(sectionTitle("Connect account"));
            var start = elem("div", "btn-row focusable", icon("account", "br-ico") + "<span>Get sign-in code</span>");
            start._action = beginLogin;
            content.appendChild(start);
            content.appendChild(elem("div", "subhead", "Connect your Twitch account to see Following and Recommended."));
            focusContentFirst();
        }

        function beginLogin() {
            var content = $("content");
            empty(content); content.appendChild(sectionTitle("Connect account"));
            var box = elem("div", "btn-row", "Requesting code…"); box.style.display = "block"; box.style.maxWidth = "70vw";
            content.appendChild(box);
            TwitchAuth.startDeviceLogin(function (info) {
                box.innerHTML = "Go to <b>" + esc((info.verification_uri || "twitch.tv/activate").replace("https://www.", "")) + "</b> on your phone and enter this code:" +
                    "<div style=\"font-size:6vh;letter-spacing:0.3vw;margin:2vh 0;color:#fff;\">" + esc(info.user_code) + "</div>Waiting for you to authorize…";
            }, function (status) {
                if (status === "success") { renderMenu(); toast("Signed in as " + (TwitchAuth.displayName() || "Twitch")); selectSection("following"); }
                else if (status === "expired") { box.innerHTML = "Code expired. Go back and try again."; }
                else { box.innerHTML = "Sign-in failed. Go back and try again."; }
            });
        }

        /* ---- key handling for content/menu ---- */
        function activate(el) {
            if (!el) { return; }
            if (el._key != null) { selectSection(el._key); Nav.refocus(); return; }
            if (el._play) { lastPlayEl = el; playStream(el._play); return; }
            if (el._game) { openGame(el._game); return; }
            if (el._cycle) { el._cycle(); return; }
            if (el._action) { el._action(); return; }
        }

        /* One step "back" inside the app. Returns true if it was handled
           (stay in the app), false only at the very top (menu) -> exit to MSX. */
        function appBack() {
            if (Player.isOpen()) { Player.back(); return true; }
            if (viewStack.length > 0) {
                viewStack.pop();
                if (viewStack.length > 0 && viewStack[viewStack.length - 1].type === "game") {
                    var g = viewStack[viewStack.length - 1].game; viewStack.pop(); openGame(g);
                } else { selectSection(currentKey); }
                return true;
            }
            /* If focus is in the content area, move it back to the menu first. */
            var cur = Nav.current();
            var inMenu = cur && (" " + cur.className + " ").indexOf(" menu-item ") >= 0;
            if (!inMenu) {
                var mi = $("menu").querySelector(".menu-item.focused") || $("menu").querySelector(".menu-item");
                if (mi) { Nav.setFocus(mi); }
                return true;
            }
            return false;   /* at the top menu */
        }

        /* Back handling that survives webOS/MSX: the platform Back does a real
           browser history navigation, so we keep a pushed "trap" state and
           absorb the resulting popstate (re-arming it) instead of letting the
           window navigate back to the MSX launcher (which looked like a restart).
           The keydown path is kept too; a short debounce stops a single Back
           press being handled twice when BOTH fire. */
        var backLock = 0;
        function nowMs() { return (new Date()).getTime(); }
        function armTrap() { try { history.pushState({ stv: 1 }, ""); } catch (e) { } }

        function handleBack(fromPopstate) {
            var t = nowMs();
            if (t - backLock < 300) { if (fromPopstate) { armTrap(); } return; }
            backLock = t;
            if (appBack()) { if (fromPopstate) { armTrap(); } return; }
            /* Top level: leave the app -> back to MSX (which launched us). */
            try { if (fromPopstate) { history.back(); } else { history.go(-2); } } catch (e) { }
        }

        function onKeyGlobal(e) {
            var k = e.keyCode || e.which;
            if (k === 8 || k === 27 || k === 461 || k === 10009) { e.preventDefault(); handleBack(false); return; }
            if (Player.isOpen()) { Player.onKey(k); e.preventDefault(); return; }
            switch (k) {
                case 37: Nav.move("left"); break;
                case 38: Nav.move("up"); break;
                case 39: Nav.move("right"); break;
                case 40: Nav.move("down"); break;
                case 13: activate(Nav.current()); break;
                default: return;
            }
            e.preventDefault();
        }

        function onPlayerClosed() {
            Nav.setScope(document);
            if (lastPlayEl && document.body.contains(lastPlayEl)) { Nav.setFocus(lastPlayEl); }
            else { Nav.refocus(); }
        }

        /* Collapse the sidebar to icons whenever focus is in the content area,
           expand it when focus returns to the menu. */
        function isMenuEl(el) { return !!(el && (" " + (el.className || "") + " ").indexOf(" menu-item ") >= 0); }
        function updateChrome(el) {
            var menu = $("menu");
            var cls = menu.className.replace(/\bcollapsed\b/g, "").replace(/\s+$/, "");
            menu.className = isMenuEl(el) ? cls : (cls + " collapsed");
        }

        function start() {
            Player.init();
            renderMenu();
            Nav.onChange(updateChrome);
            /* Arm the history trap so the platform Back fires popstate that we
               absorb (see handleBack) instead of navigating out of the app. */
            try { history.replaceState({ stv: "root" }, ""); } catch (e) { }
            armTrap();
            window.addEventListener("popstate", function () { handleBack(true); });
            document.addEventListener("keydown", onKeyGlobal);
            /* Land on the first available section (Following when signed in). */
            var items = menuItems();
            selectSection(items.length ? items[0].key : "top");
            var first = $("menu").querySelector(".menu-item");
            if (first) { Nav.setFocus(first); }
        }

        return { start: start, onPlayerClosed: onPlayerClosed, selectSection: selectSection };
    })();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", App.start);
    } else { App.start(); }

})();
