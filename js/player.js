/*
 * HLS video plugin for Smart Twitch TV (MSX) with chat overlay.
 * Playback: native <video> first (webOS/Safari play HLS without CORS),
 * automatic hls.js fallback where native HLS is unavailable (desktop, Android).
 * Chat: see js/chat.js; controlled via the player options panel.
 * ES5 only.
 */
function HlsPlayer() {
    "use strict";

    var player = null;
    var hls = null;
    var ready = false;
    var ended = false;
    var livePosition = 0;
    var videoUrl = null;
    var nativeTried = false;
    var hlsTried = false;
    var urls = [];         /* candidate URLs, tried in order (e.g. ad-block proxy, then direct) */
    var urlIndex = 0;
    var statsChannel = null;
    var statsTimer = null;

    /* ------------------------------------------------------------------ */
    /* Live stream stats: viewers (chat header) + uptime (OSD label)      */
    /* ------------------------------------------------------------------ */

    function fmtUptime(iso) {
        var start = new Date(iso).getTime();
        if (!start) { return null; }
        var mins = Math.floor(Math.max(0, new Date().getTime() - start) / 60000);
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h > 0 ? h + "h " + (m < 10 ? "0" + m : m) + "m" : m + "m";
    }

    function updateStats() {
        if (statsChannel == null || typeof Twitch === "undefined") { return; }
        Twitch.streamStats(statsChannel, function (err, stream) {
            if (err || stream == null) { return; }
            StvChat.setViewers(stream.viewersCount);
            var uptime = stream.createdAt ? fmtUptime(stream.createdAt) : null;
            if (uptime != null) {
                TVXVideoPlugin.setupExtensionLabel("{ico:msx-white:schedule} " + uptime);
            }
        });
    }

    function startStats(channel) {
        statsChannel = channel;
        updateStats();
        statsTimer = setInterval(updateStats, 60000);
    }

    function canUseHlsJs() {
        return typeof Hls !== "undefined" && Hls.isSupported();
    }

    function canPlayHlsNatively() {
        try {
            var video = document.createElement("video");
            return video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
                video.canPlayType("application/x-mpegURL") !== "";
        } catch (e) { return false; }
    }

    function onWaiting() { TVXVideoPlugin.startLoading(); }
    function onPlaying() {
        TVXVideoPlugin.stopLoading();
        TVXVideoPlugin.setState(TVXVideoState.PLAYING);
    }
    function onPaused() {
        TVXVideoPlugin.stopLoading();
        TVXVideoPlugin.setState(TVXVideoState.PAUSED);
    }
    function onContinue() { TVXVideoPlugin.stopLoading(); }
    function onReady() {
        if (player != null && !ready) {
            ready = true;
            TVXVideoPlugin.applyVolume();
            TVXVideoPlugin.stopLoading();
            TVXVideoPlugin.startPlayback(true);
        }
    }
    /* Move on to the next candidate URL (e.g. ad-block proxy failed → direct). */
    function advanceUrl() {
        if (urlIndex >= urls.length - 1) { return false; }
        urlIndex++;
        nativeTried = false;
        hlsTried = false;
        if (hls != null) { try { hls.destroy(); } catch (e) { } hls = null; }
        TVXVideoPlugin.startLoading();
        setupVideo(urls[urlIndex]);
        return true;
    }

    function onError() {
        if (player == null || player.error == null) { return; }
        /* Native attempt failed (e.g. desktop browser): retry once with hls.js */
        if (nativeTried && !hlsTried && canUseHlsJs()) {
            setupHlsJs();
            return;
        }
        /* This URL is exhausted: try the next candidate before giving up */
        if (advanceUrl()) { return; }
        TVXVideoPlugin.error("Video error " + player.error.code + (player.error.message ? ": " + player.error.message : ""));
        TVXVideoPlugin.stopLoading();
    }
    function onEnded() {
        if (!ended) {
            ended = true;
            TVXVideoPlugin.stopPlayback();
        }
    }

    function setupHlsJs() {
        hlsTried = true;
        try { player.removeAttribute("src"); } catch (e) { }
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });
        hls.on(Hls.Events.ERROR, function (event, data) {
            if (data && data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else if (!advanceUrl()) {
                    TVXVideoPlugin.error("HLS error: " + (data.details || data.type));
                    TVXVideoPlugin.stopLoading();
                }
            }
        });
        hls.loadSource(videoUrl);
        hls.attachMedia(player);
    }

    function setupVideo(url) {
        videoUrl = url;
        if (canPlayHlsNatively() || !canUseHlsJs()) {
            /* Native first: on TVs this avoids CORS entirely (media resource load).
               If it errors and hls.js is available, onError() falls back once. */
            nativeTried = true;
            player.src = url;
            player.load();
        } else {
            setupHlsJs();
        }
    }

    /* ------------------------------------------------------------------ */
    /* Favorites (shared with the app via localStorage)                   */
    /* ------------------------------------------------------------------ */

    function getFavorites() {
        try {
            var list = JSON.parse(window.localStorage.getItem("stv:favorites") || "[]");
            return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
        } catch (e) { return []; }
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
        try { window.localStorage.setItem("stv:favorites", JSON.stringify(out)); } catch (e) { }
    }

    /* ------------------------------------------------------------------ */
    /* Chat options panel (opened from the player OSD / options button)   */
    /* ------------------------------------------------------------------ */

    var lastOptionMessage = null;

    function chatOptionItem(icon, label, message) {
        return {
            focus: lastOptionMessage === message,
            icon: icon,
            label: label,
            action: "player:commit:message:" + message
        };
    }

    function createOptionsPanel() {
        var items = [];
        if (StvChat.isAvailable()) {
            var labels = StvChat.stateLabels();
            if (statsChannel != null) {
                var fav = isFavorite(statsChannel);
                items.push(chatOptionItem(fav ? "star" : "star-border", fav ? "Remove favorite" : "Add favorite", "fav:toggle"));
            }
            items.push(chatOptionItem("chat", "Chat: " + labels.enabled, "chat:toggle"));
            if (StvChat.isEnabled()) {
                items.push(chatOptionItem("swap-horiz", "Position: " + labels.pos, "chat:pos"));
                items.push(chatOptionItem("unfold-more", "Height: " + labels.height, "chat:height"));
                items.push(chatOptionItem("settings-ethernet", "Width: " + labels.width, "chat:width"));
                items.push(chatOptionItem("format-size", "Text size: " + labels.size, "chat:size"));
            }
        } else {
            items.push({ enable: false, label: "No options available" });
        }
        return {
            cache: false,
            reuse: false,
            headline: "Options",
            template: {
                enumerate: false,
                type: "control",
                layout: "0,0,8,1"
            },
            items: items
        };
    }

    function applyChatCommand(cmd) {
        if (cmd === "toggle") {
            StvChat.toggle();
        } else if (cmd === "size") {
            StvChat.cycleSize();
        } else if (cmd === "pos") {
            StvChat.cyclePos();
        } else if (cmd === "height") {
            StvChat.cycleHeight();
        } else if (cmd === "width") {
            StvChat.cycleWidth();
        } else {
            return false;
        }
        return true;
    }

    function handleMessage(message) {
        if (!TVXTools.isFullStr(message)) { return; }
        if (message.indexOf("chatkey:") === 0) {
            /* Direct remote-key shortcut: apply silently, no panel */
            applyChatCommand(message.substring(8));
            return;
        }
        if (message === "fav:toggle") {
            if (statsChannel != null) { toggleFavorite(statsChannel); }
        } else if (message.indexOf("chat:") === 0) {
            if (!applyChatCommand(message.substring(5))) { return; }
        } else {
            return;
        }
        lastOptionMessage = message;
        /* Reopen the panel so it reflects the new state */
        TVXVideoPlugin.executeAction("cleanup");
        TVXVideoPlugin.executeAction("panel:request:player:options");
    }

    /* ------------------------------------------------------------------ */
    /* Player interface                                                   */
    /* ------------------------------------------------------------------ */

    this.init = function () {
        player = document.getElementById("player");
        player.addEventListener("canplay", onReady);
        player.addEventListener("error", onError);
        player.addEventListener("ended", onEnded);
        player.addEventListener("waiting", onWaiting);
        player.addEventListener("play", onContinue);
        player.addEventListener("playing", onPlaying);
        player.addEventListener("pause", onPaused);
        player.addEventListener("seeked", onContinue);
    };

    this.ready = function () {
        if (player == null) {
            TVXVideoPlugin.error("Video player is not initialized");
            return;
        }
        TVXVideoPlugin.startLoading();
        var url = TVXServices.urlParams.get("url");
        var fallback = TVXServices.urlParams.get("fallback");
        var channel = TVXServices.urlParams.get("channel");
        var cid = TVXServices.urlParams.get("cid");
        if (TVXTools.isFullStr(url)) {
            urls = [url];
            /* Ad-block proxy passes the direct URL as a fallback (retried on error) */
            if (TVXTools.isFullStr(fallback)) { urls.push(fallback); }
            urlIndex = 0;
            setupVideo(urls[0]);
            if (TVXTools.isFullStr(channel)) {
                StvChat.init(channel, cid);
                startStats(channel);
            }
        } else {
            TVXVideoPlugin.warn("Video URL is missing");
            TVXVideoPlugin.stopLoading();
        }
    };

    this.dispose = function () {
        StvChat.dispose();
        if (statsTimer != null) {
            clearInterval(statsTimer);
            statsTimer = null;
        }
        if (hls != null) {
            try { hls.destroy(); } catch (e) { }
            hls = null;
        }
        player = null;
    };

    this.play = function () { if (player != null) { player.play(); } };
    this.pause = function () { if (player != null) { player.pause(); } };
    this.stop = function () { if (player != null) { player.pause(); } };

    this.getDuration = function () {
        if (player != null) {
            if (isFinite(player.duration)) { return player.duration; }
            if (isFinite(player.currentTime)) {
                if (player.currentTime > livePosition) { livePosition = player.currentTime; }
                return livePosition;
            }
        }
        return 0;
    };
    this.getPosition = function () { return player != null ? player.currentTime : 0; };
    this.setPosition = function (position) { if (player != null) { player.currentTime = position; } };
    this.setVolume = function (volume) { if (player != null) { player.volume = volume / 100; } };
    this.getVolume = function () { return player != null ? player.volume * 100 : 100; };
    this.setMuted = function (muted) { if (player != null) { player.muted = muted; } };
    this.isMuted = function () { return player != null ? player.muted : false; };
    this.getSpeed = function () { return player != null ? player.playbackRate : 1; };
    this.setSpeed = function (speed) { if (player != null) { player.playbackRate = speed; } };
    this.getUpdateData = function () {
        return {
            position: this.getPosition(),
            duration: this.getDuration(),
            speed: this.getSpeed()
        };
    };
    this.handleData = function (data) {
        handleMessage(data != null ? data.message : null);
    };
    this.handleRequest = function (dataId, data, callback) {
        if (dataId === "options") {
            callback(createOptionsPanel());
        } else {
            callback(null);
        }
    };
}

TVXPluginTools.onReady(function () {
    TVXVideoPlugin.setupPlayer(new HlsPlayer());
    TVXVideoPlugin.init();
});
