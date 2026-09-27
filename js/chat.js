/*
 * Twitch chat overlay for the Smart Twitch TV player (MSX).
 * Anonymous IRC over WebSocket + Twitch/BTTV/FFZ/7TV emotes.
 * ES5 only: must run on old TV browsers (webOS 3+).
 */
var StvChat = (function () {
    "use strict";

    var IRC_URL = "wss://irc-ws.chat.twitch.tv/";
    var MAX_MESSAGES = 40;
    var FLUSH_MS = 300;
    var MAX_QUEUE = 30;
    var MAX_PER_FLUSH = 5;

    var NICK_COLORS = ["#FF4A80", "#FF7070", "#FA8E4B", "#FEE440", "#5FED83", "#00F5D4", "#00BBF9", "#4371FB", "#9B5DE5", "#F15BB5"];

    var SIZES = { s: "Small", m: "Medium", l: "Large" };
    var SIZE_ORDER = ["s", "m", "l"];
    var POSITIONS = { l: "Left", r: "Right" };
    var POS_ORDER = ["l", "r"];
    var HEIGHTS = { full: "Full", h75: "75%", h50: "50%", h25: "25%" };
    var HEIGHT_ORDER = ["full", "h75", "h50", "h25"];
    var WIDTHS = { w30: "30%", w25: "25%", w20: "20%", w15: "15%", w10: "10%" };
    var WIDTH_ORDER = ["w30", "w25", "w20", "w15", "w10"];

    var channel = null;
    var channelId = null;
    var container = null;
    var headerEl = null;
    var msgsEl = null;
    var viewersCount = null;
    var ws = null;
    var disposed = false;
    var connected = false;
    var reconnectTimer = null;
    var queue = [];
    var flushTimer = null;
    /* Channel emotes shadow global ones with the same name, as in Twitch web */
    var channelEmotes = {};
    var globalEmotes = {};
    var emotesLoaded = false;
    var emoteGen = 0;

    /* ------------------------------------------------------------------ */
    /* Settings (shared with the app via localStorage)                    */
    /* ------------------------------------------------------------------ */

    function getStore(key, def) {
        if (window.Lampa && Lampa.Storage) {
            var mapped = Lampa.Storage.get("twitch_" + key, "");
            if (mapped !== "" && mapped != null) { return String(mapped); }
        }
        try {
            var value = window.localStorage.getItem("stv:" + key);
            return value == null ? def : value;
        } catch (e) { return def; }
    }

    function setStore(key, value) {
        if (window.Lampa && Lampa.Storage) {
            try { Lampa.Storage.set("twitch_" + key, value); } catch (e) { }
        }
        try { window.localStorage.setItem("stv:" + key, value); } catch (e) { }
    }

    function cycleValue(order, current) {
        var idx = 0;
        for (var i = 0; i < order.length; i++) {
            if (order[i] === current) { idx = i; }
        }
        return order[(idx + 1) % order.length];
    }

    function isEnabled() { return getStore("chat", "on") === "on"; }
    function getSize() { var v = getStore("chatsize", "m"); return SIZES[v] ? v : "m"; }
    function getPos() {
        var v = getStore("chatpos", "l");
        if (POSITIONS[v]) { return v; }
        /* migrate pre-1.2.0 corner values (bl/br/tl/tr) */
        return v.indexOf("r") >= 0 ? "r" : "l";
    }
    function getHeight() { var v = getStore("chatheight", "h50"); return HEIGHTS[v] ? v : "h50"; }
    function getWidth() { var v = getStore("chatwidth", "w30"); return WIDTHS[v] ? v : "w30"; }

    /* ------------------------------------------------------------------ */
    /* DOM                                                                */
    /* ------------------------------------------------------------------ */

    function applyStyle() {
        if (container == null) { return; }
        container.className = "stv-chat size-" + getSize() + " pos-" + getPos() +
            " " + getHeight() + " " + getWidth();
    }

    function fmtCount(n) {
        return String(n || 0);
    }

    function renderHeader() {
        if (headerEl == null) { return; }
        if (viewersCount == null) {
            headerEl.style.display = "none";
        } else {
            headerEl.style.display = "";
            headerEl.innerHTML = "<span class=\"stv-head-pill\"><svg class=\"stv-eye\" viewBox=\"0 0 24 24\"><path d=\"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z\"/></svg>" + fmtCount(viewersCount) + "</span>";
        }
    }

    function ensureContainer() {
        if (container == null) {
            container = document.createElement("div");
            headerEl = document.createElement("div");
            headerEl.className = "stv-head";
            headerEl.style.display = "none";
            msgsEl = document.createElement("div");
            msgsEl.className = "stv-msgs";
            container.appendChild(headerEl);
            container.appendChild(msgsEl);
            var host = document.querySelector(".player") || document.body;
            host.appendChild(container);
            renderHeader();
        }
        applyStyle();
    }

    function clearMessages() {
        if (msgsEl != null) {
            msgsEl.innerHTML = "";
        }
        queue = [];
    }

    function appendMessage(html) {
        if (msgsEl == null) { return; }
        var node = document.createElement("div");
        node.className = "stv-msg";
        node.innerHTML = html;
        watchStacks(node);
        msgsEl.appendChild(node);
        while (msgsEl.childNodes.length > MAX_MESSAGES) {
            msgsEl.removeChild(msgsEl.firstChild);
        }
    }

    /*
     * An overlay wider than its base (a pointing hand, a banner) would spill
     * over the nick or the next word. Once the pictures have sizes, pad the
     * stack out to the widest one, like 7TV does. Works in em from the
     * natural aspect ratios (every emote is 1.35em tall, see .stv-emote), so
     * it holds while chat is hidden and across text-size changes.
     */
    function aspect(img) {
        return img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
    }

    function fitStack(stack) {
        var imgs = stack.getElementsByTagName("img");
        var base = aspect(imgs[0]);
        if (!base) { return; }
        var widest = base;
        for (var i = 1; i < imgs.length; i++) {
            widest = Math.max(widest, aspect(imgs[i]));
        }
        var pad = (1.35 * (widest - base) / 2).toFixed(3) + "em";
        stack.style.marginLeft = pad;
        stack.style.marginRight = pad;
    }

    function watchStacks(node) {
        var stacks = node.getElementsByClassName("stv-stack");
        for (var i = 0; i < stacks.length; i++) {
            var imgs = stacks[i].getElementsByTagName("img");
            var fit = fitStack.bind(null, stacks[i]);
            for (var j = 0; j < imgs.length; j++) {
                imgs[j].onload = fit;
            }
        }
    }

    function flush() {
        if (queue.length > MAX_QUEUE) {
            queue = queue.slice(queue.length - MAX_QUEUE);
        }
        var n = Math.min(queue.length, MAX_PER_FLUSH);
        for (var i = 0; i < n; i++) {
            appendMessage(queue.shift());
        }
    }

    /* ------------------------------------------------------------------ */
    /* Emotes                                                             */
    /* ------------------------------------------------------------------ */

    function ajax(url, callback) {
        var req = new XMLHttpRequest();
        req.open("GET", url, true);
        /* A big channel's 7TV set is ~2.3 MB of JSON; give a TV time to pull it */
        req.timeout = 30000;
        req.onreadystatechange = function () {
            if (req.readyState === 4) {
                if (req.status >= 200 && req.status < 300) {
                    try { callback(JSON.parse(req.responseText)); } catch (e) { callback(null); }
                } else {
                    callback(null);
                }
            }
        };
        req.onerror = function () { callback(null); };
        req.send(null);
    }

    /*
     * Modifier emotes (BTTV "w!", FFZ "ffzW", ...) transform the previous
     * emote rather than being pictures of their own, so they stay as text.
     */
    function addBttvEmotes(map, list) {
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e && e.code && e.id && !e.modifier) {
                map[e.code] = { url: "https://cdn.betterttv.net/emote/" + e.id + "/1x" };
            }
        }
    }

    /*
     * FrankerFaceZ, taken from BTTV's cache of it: the same host and CDN as
     * BTTV, and exactly what the BTTV extension shows on twitch.tv (which is
     * why viewers read these as "BTTV emotes").
     */
    function addFfzEmotes(map, list) {
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e && e.code && e.images && e.images["1x"] && !e.modifier) {
                map[e.code] = { url: e.images["1x"] };
            }
        }
    }

    /* Flag bit 0 on a set entry marks a zero-width (overlay) emote */
    function add7tvEmotes(map, list) {
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e && e.name && e.id) {
                map[e.name] = { url: "https://cdn.7tv.app/emote/" + e.id + "/1x.webp", zw: (e.flags & 1) === 1 };
            }
        }
    }

    function loadEmotes() {
        /* Once per stream: toggling chat back on must not refetch every set */
        if (emotesLoaded) { return; }
        emotesLoaded = true;
        var gen = emoteGen;
        function load(url, handle) {
            ajax(url, function (data) {
                /* Drop a late answer for the previous stream */
                if (data && gen === emoteGen) { handle(data); }
            });
        }
        load("https://api.betterttv.net/3/cached/emotes/global", function (data) {
            addBttvEmotes(globalEmotes, data);
        });
        load("https://api.betterttv.net/3/cached/frankerfacez/emotes/global", function (data) {
            addFfzEmotes(globalEmotes, data);
        });
        load("https://7tv.io/v3/emote-sets/global", function (data) {
            add7tvEmotes(globalEmotes, data.emotes);
        });
        if (channelId) {
            load("https://api.betterttv.net/3/cached/users/twitch/" + channelId, function (data) {
                addBttvEmotes(channelEmotes, data.channelEmotes);
                addBttvEmotes(channelEmotes, data.sharedEmotes);
            });
            load("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/" + channelId, function (data) {
                addFfzEmotes(channelEmotes, data);
            });
            load("https://7tv.io/v3/users/twitch/" + channelId, function (data) {
                add7tvEmotes(channelEmotes, data.emote_set && data.emote_set.emotes);
            });
        }
    }

    function findEmote(word) {
        if (channelEmotes.hasOwnProperty(word)) { return channelEmotes[word]; }
        if (globalEmotes.hasOwnProperty(word)) { return globalEmotes[word]; }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Message rendering                                                  */
    /* ------------------------------------------------------------------ */

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    /* Twitch emote indices count unicode code points, not UTF-16 units */
    function toCodePoints(str) {
        var arr = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
                arr.push(str.substr(i, 2));
                i++;
            } else {
                arr.push(str.charAt(i));
            }
        }
        return arr;
    }

    function emoteImg(url, cls) {
        return "<img class=\"" + cls + "\" src=\"" + escapeHtml(url) + "\" alt=\"\"/>";
    }

    /* A base emote with any zero-width overlays drawn on top of it */
    function emoteHtml(urls) {
        if (urls.length === 1) { return emoteImg(urls[0], "stv-emote"); }
        var html = "<span class=\"stv-stack\">" + emoteImg(urls[0], "stv-emote");
        for (var i = 1; i < urls.length; i++) {
            html += emoteImg(urls[i], "stv-emote stv-zw");
        }
        return html + "</span>";
    }

    /* Splits a plain text chunk into word/space tokens, BTTV/FFZ/7TV words as emotes */
    function tokenizePlain(text, tokens) {
        var parts = text.split(" ");
        for (var i = 0; i < parts.length; i++) {
            if (i > 0) { tokens.push({ text: " " }); }
            var word = parts[i];
            if (word.length === 0) { continue; }
            var emote = findEmote(word);
            tokens.push(emote ? { url: emote.url, zw: emote.zw } : { text: word });
        }
    }

    /*
     * 7TV zero-width emotes (RainTime, MOONMOON's whole "...00" family) are
     * overlays for the emote before them -- "PEPW twostar00" is one picture.
     * Stack each onto the previous emote across the spaces between; with no
     * emote before it, a zero-width emote just shows on its own.
     */
    function renderTokens(tokens) {
        var groups = [];
        for (var i = 0; i < tokens.length; i++) {
            var tok = tokens[i];
            if (tok.zw) {
                var j = groups.length - 1;
                while (j >= 0 && groups[j].text === " ") { j--; }
                if (j >= 0 && groups[j].urls) {
                    groups[j].urls.push(tok.url);
                    groups.length = j + 1;
                    continue;
                }
            }
            groups.push(tok.url ? { urls: [tok.url] } : tok);
        }
        var out = [];
        for (var k = 0; k < groups.length; k++) {
            out.push(groups[k].urls ? emoteHtml(groups[k].urls) : escapeHtml(groups[k].text));
        }
        return out.join("");
    }

    function parseEmoteTag(tag) {
        /* "25:0-4,12-16/1902:6-10" -> [{s,e,id}] sorted by start */
        var out = [];
        if (!tag) { return out; }
        var groups = tag.split("/");
        for (var i = 0; i < groups.length; i++) {
            var sep = groups[i].indexOf(":");
            if (sep <= 0) { continue; }
            var id = groups[i].substring(0, sep);
            var ranges = groups[i].substring(sep + 1).split(",");
            for (var j = 0; j < ranges.length; j++) {
                var range = ranges[j].split("-");
                var s = parseInt(range[0], 10);
                var e = parseInt(range[1], 10);
                if (!isNaN(s) && !isNaN(e)) {
                    out.push({ s: s, e: e, id: id });
                }
            }
        }
        out.sort(function (a, b) { return a.s - b.s; });
        return out;
    }

    function renderMessage(text, emoteTag) {
        var emotes = parseEmoteTag(emoteTag);
        var tokens = [];
        if (emotes.length === 0) {
            tokenizePlain(text, tokens);
            return renderTokens(tokens);
        }
        var cps = toCodePoints(text);
        var pos = 0;
        for (var i = 0; i < emotes.length; i++) {
            var em = emotes[i];
            if (em.s < pos || em.e >= cps.length) { continue; }
            if (em.s > pos) {
                tokenizePlain(cps.slice(pos, em.s).join(""), tokens);
            }
            tokens.push({ url: "https://static-cdn.jtvnw.net/emoticons/v2/" + em.id + "/default/dark/1.0" });
            pos = em.e + 1;
        }
        if (pos < cps.length) {
            tokenizePlain(cps.slice(pos).join(""), tokens);
        }
        return renderTokens(tokens);
    }

    function hashColor(name) {
        var h = 0;
        for (var i = 0; i < name.length; i++) {
            h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
        }
        return NICK_COLORS[h % NICK_COLORS.length];
    }

    /* ------------------------------------------------------------------ */
    /* IRC                                                                */
    /* ------------------------------------------------------------------ */

    function parseTags(raw) {
        var tags = {};
        var parts = raw.split(";");
        for (var i = 0; i < parts.length; i++) {
            var sep = parts[i].indexOf("=");
            if (sep > 0) {
                tags[parts[i].substring(0, sep)] = parts[i].substring(sep + 1);
            }
        }
        return tags;
    }

    function handleLine(line) {
        if (line.indexOf("PING") === 0) {
            if (ws != null) { ws.send("PONG :tmi.twitch.tv"); }
            return;
        }
        var tagsRaw = "";
        var rest = line;
        if (line.charAt(0) === "@") {
            var sp = line.indexOf(" ");
            if (sp < 0) { return; }
            tagsRaw = line.substring(1, sp);
            rest = line.substring(sp + 1);
        }
        var cmdIdx = rest.indexOf(" PRIVMSG #");
        if (cmdIdx < 0) { return; }
        var msgIdx = rest.indexOf(" :", cmdIdx);
        if (msgIdx < 0) { return; }
        var text = rest.substring(msgIdx + 2);
        /* strip /me action wrapper */
        if (text.indexOf("\u0001ACTION ") === 0) {
            text = text.substring(8);
            if (text.charAt(text.length - 1) === "\u0001") {
                text = text.substring(0, text.length - 1);
            }
        }
        var tags = parseTags(tagsRaw);
        var name = tags["display-name"];
        if (!name) {
            var excl = rest.indexOf("!");
            name = excl > 1 ? rest.substring(1, excl) : "chat";
        }
        var color = tags.color && tags.color.charAt(0) === "#" ? tags.color : hashColor(name);
        var html = "<span class=\"stv-nick\" style=\"color:" + color + "\">" + escapeHtml(name) + "</span>: " +
            renderMessage(text, tags.emotes || "");
        queue.push(html);
    }

    function disconnect() {
        connected = false;
        if (reconnectTimer != null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (ws != null) {
            var socket = ws;
            ws = null;
            try { socket.onclose = null; socket.close(); } catch (e) { }
        }
    }

    function connect() {
        if (disposed || channel == null || ws != null) { return; }
        try {
            ws = new WebSocket(IRC_URL);
        } catch (e) {
            ws = null;
            return;
        }
        ws.onopen = function () {
            if (ws == null) { return; }
            connected = true;
            ws.send("CAP REQ :twitch.tv/tags");
            ws.send("NICK justinfan" + Math.floor(Math.random() * 80000 + 1000));
            ws.send("JOIN #" + channel);
        };
        ws.onmessage = function (event) {
            var lines = String(event.data).split("\r\n");
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].length > 0) {
                    try { handleLine(lines[i]); } catch (e) { }
                }
            }
        };
        ws.onclose = function () {
            ws = null;
            if (!disposed && connected) {
                reconnectTimer = setTimeout(function () {
                    reconnectTimer = null;
                    connect();
                }, 3000);
            }
        };
        ws.onerror = function () { };
    }

    /* ------------------------------------------------------------------ */
    /* Public interface                                                   */
    /* ------------------------------------------------------------------ */

    function start() {
        ensureContainer();
        loadEmotes();
        connect();
        if (flushTimer == null) {
            flushTimer = setInterval(flush, FLUSH_MS);
        }
    }

    return {
        init: function (channelLogin, cid) {
            if (!channelLogin) { return; }
            /* Reusable across streams (the self-rendered app keeps one instance) */
            disposed = false;
            channelEmotes = {};
            globalEmotes = {};
            emotesLoaded = false;
            emoteGen++;
            channel = String(channelLogin).toLowerCase();
            channelId = cid || null;
            if (isEnabled()) {
                start();
            }
        },
        dispose: function () {
            disposed = true;
            disconnect();
            if (flushTimer != null) {
                clearInterval(flushTimer);
                flushTimer = null;
            }
            /* Remove the overlay from the DOM so it doesn't linger over the app */
            if (container != null && container.parentNode) { container.parentNode.removeChild(container); }
            container = null;
            headerEl = null;
            msgsEl = null;
            viewersCount = null;
        },
        isAvailable: function () { return channel != null; },
        isEnabled: isEnabled,
        setViewers: function (count) {
            viewersCount = typeof count === "number" ? count : null;
            renderHeader();
        },
        toggle: function () {
            if (channel == null) { return; }
            if (isEnabled()) {
                /* Just hide it. Keep the IRC connection + messages so turning
                   it back on doesn't clear the chat (visibility toggle). */
                setStore("chat", "off");
                if (container != null) { container.style.display = "none"; }
            } else {
                setStore("chat", "on");
                start();   /* idempotent: reuses the live connection if any */
                if (container != null) { container.style.display = ""; }
            }
        },
        cycleSize: function () {
            setStore("chatsize", cycleValue(SIZE_ORDER, getSize()));
            applyStyle();
        },
        cyclePos: function () {
            setStore("chatpos", cycleValue(POS_ORDER, getPos()));
            applyStyle();
        },
        cycleHeight: function () {
            setStore("chatheight", cycleValue(HEIGHT_ORDER, getHeight()));
            applyStyle();
        },
        cycleWidth: function () {
            setStore("chatwidth", cycleValue(WIDTH_ORDER, getWidth()));
            applyStyle();
        },
        stateLabels: function () {
            return {
                enabled: isEnabled() ? "On" : "Off",
                size: SIZES[getSize()],
                pos: POSITIONS[getPos()],
                height: HEIGHTS[getHeight()],
                width: WIDTHS[getWidth()]
            };
        }
    };
})();
