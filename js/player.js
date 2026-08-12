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
    function onError() {
        if (player == null || player.error == null) { return; }
        /* Native attempt failed (e.g. desktop browser): retry once with hls.js */
        if (nativeTried && !hlsTried && canUseHlsJs()) {
            setupHlsJs();
            return;
        }
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
                } else {
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

    function handleMessage(message) {
        if (!TVXTools.isFullStr(message)) { return; }
        if (message === "chat:toggle") {
            StvChat.toggle();
        } else if (message === "chat:size") {
            StvChat.cycleSize();
        } else if (message === "chat:pos") {
            StvChat.cyclePos();
        } else if (message === "chat:height") {
            StvChat.cycleHeight();
        } else if (message === "chat:width") {
            StvChat.cycleWidth();
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
        var channel = TVXServices.urlParams.get("channel");
        var cid = TVXServices.urlParams.get("cid");
        if (TVXTools.isFullStr(url)) {
            setupVideo(url);
            if (TVXTools.isFullStr(channel)) {
                StvChat.init(channel, cid);
            }
        } else {
            TVXVideoPlugin.warn("Video URL is missing");
            TVXVideoPlugin.stopLoading();
        }
    };

    this.dispose = function () {
        StvChat.dispose();
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
