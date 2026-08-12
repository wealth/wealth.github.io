/*
 * Twitch chat overlay for the Smart Twitch TV player (MSX).
 * Anonymous IRC over WebSocket + Twitch/BTTV/7TV emotes.
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
    var POSITIONS = { bl: "Bottom left", br: "Bottom right", tl: "Top left", tr: "Top right" };
    var POS_ORDER = ["bl", "br", "tl", "tr"];

    var channel = null;
    var channelId = null;
    var container = null;
    var ws = null;
    var disposed = false;
    var connected = false;
    var reconnectTimer = null;
    var queue = [];
    var flushTimer = null;
    var emoteMap = {};

    /* ------------------------------------------------------------------ */
    /* Settings (shared with the app via localStorage)                    */
    /* ------------------------------------------------------------------ */

    function getStore(key, def) {
        try {
            var value = window.localStorage.getItem("stv:" + key);
            return value == null ? def : value;
        } catch (e) { return def; }
    }

    function setStore(key, value) {
        try { window.localStorage.setItem("stv:" + key, value); } catch (e) { }
    }

    function isEnabled() { return getStore("chat", "on") === "on"; }
    function getSize() { var v = getStore("chatsize", "m"); return SIZES[v] ? v : "m"; }
    function getPos() { var v = getStore("chatpos", "bl"); return POSITIONS[v] ? v : "bl"; }
    function isTopPos() { return getPos().charAt(0) === "t"; }

    /* ------------------------------------------------------------------ */
    /* DOM                                                                */
    /* ------------------------------------------------------------------ */

    function applyStyle() {
        if (container == null) { return; }
        container.className = "stv-chat size-" + getSize() + " pos-" + getPos();
    }

    function ensureContainer() {
        if (container == null) {
            container = document.createElement("div");
            document.body.appendChild(container);
        }
        applyStyle();
    }

    function clearMessages() {
        if (container != null) {
            container.innerHTML = "";
        }
        queue = [];
    }

    function appendMessage(html) {
        if (container == null) { return; }
        var node = document.createElement("div");
        node.className = "stv-msg";
        node.innerHTML = html;
        if (isTopPos()) {
            /* newest message pinned to the top edge */
            container.insertBefore(node, container.firstChild);
            while (container.childNodes.length > MAX_MESSAGES) {
                container.removeChild(container.lastChild);
            }
        } else {
            container.appendChild(node);
            while (container.childNodes.length > MAX_MESSAGES) {
                container.removeChild(container.firstChild);
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
        req.timeout = 10000;
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

    function addBttvEmotes(list) {
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e && e.code && e.id) {
                emoteMap[e.code] = "https://cdn.betterttv.net/emote/" + e.id + "/1x";
            }
        }
    }

    function add7tvEmotes(list) {
        if (!list) { return; }
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e && e.name && e.id) {
                emoteMap[e.name] = "https://cdn.7tv.app/emote/" + e.id + "/1x.webp";
            }
        }
    }

    function loadEmotes() {
        ajax("https://api.betterttv.net/3/cached/emotes/global", function (data) {
            addBttvEmotes(data);
        });
        ajax("https://7tv.io/v3/emote-sets/global", function (data) {
            add7tvEmotes(data && data.emotes);
        });
        if (channelId) {
            ajax("https://api.betterttv.net/3/cached/users/twitch/" + channelId, function (data) {
                if (data) {
                    addBttvEmotes(data.channelEmotes);
                    addBttvEmotes(data.sharedEmotes);
                }
            });
            ajax("https://7tv.io/v3/users/twitch/" + channelId, function (data) {
                add7tvEmotes(data && data.emote_set && data.emote_set.emotes);
            });
        }
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

    function emoteImg(url) {
        return "<img class=\"stv-emote\" src=\"" + url + "\" alt=\"\"/>";
    }

    /* Replaces third-party (BTTV/7TV) emote words inside a plain text chunk */
    function renderPlain(text) {
        var parts = text.split(" ");
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var word = parts[i];
            if (word.length > 0 && emoteMap.hasOwnProperty(word)) {
                out.push(emoteImg(emoteMap[word]));
            } else {
                out.push(escapeHtml(word));
            }
        }
        return out.join(" ");
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
        if (emotes.length === 0) {
            return renderPlain(text);
        }
        var cps = toCodePoints(text);
        var out = [];
        var pos = 0;
        for (var i = 0; i < emotes.length; i++) {
            var em = emotes[i];
            if (em.s < pos || em.e >= cps.length) { continue; }
            if (em.s > pos) {
                out.push(renderPlain(cps.slice(pos, em.s).join("")));
            }
            out.push(emoteImg("https://static-cdn.jtvnw.net/emoticons/v2/" + em.id + "/default/dark/1.0"));
            pos = em.e + 1;
        }
        if (pos < cps.length) {
            out.push(renderPlain(cps.slice(pos).join("")));
        }
        return out.join("");
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
        },
        isAvailable: function () { return channel != null; },
        isEnabled: isEnabled,
        toggle: function () {
            if (channel == null) { return; }
            if (isEnabled()) {
                setStore("chat", "off");
                disconnect();
                clearMessages();
                if (container != null) { container.style.display = "none"; }
            } else {
                setStore("chat", "on");
                if (container != null) { container.style.display = ""; }
                start();
            }
        },
        cycleSize: function () {
            var idx = 0;
            for (var i = 0; i < SIZE_ORDER.length; i++) {
                if (SIZE_ORDER[i] === getSize()) { idx = i; }
            }
            setStore("chatsize", SIZE_ORDER[(idx + 1) % SIZE_ORDER.length]);
            applyStyle();
        },
        cyclePos: function () {
            var idx = 0;
            for (var i = 0; i < POS_ORDER.length; i++) {
                if (POS_ORDER[i] === getPos()) { idx = i; }
            }
            setStore("chatpos", POS_ORDER[(idx + 1) % POS_ORDER.length]);
            applyStyle();
            clearMessages();
        },
        stateLabels: function () {
            return {
                enabled: isEnabled() ? "On" : "Off",
                size: SIZES[getSize()],
                pos: POSITIONS[getPos()]
            };
        }
    };
})();
