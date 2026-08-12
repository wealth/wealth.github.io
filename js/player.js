/*
 * HLS video plugin for Smart Twitch TV (MSX).
 * Plays the "url" parameter: natively where HLS is supported (webOS, Safari),
 * otherwise via hls.js (desktop browsers, Android, some Tizen models).
 * ES5 only.
 */
function HlsPlayer() {
    "use strict";

    var player = null;
    var hls = null;
    var ready = false;
    var ended = false;
    var livePosition = 0;

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
        if (player != null && player.error != null) {
            TVXVideoPlugin.error("Video error " + player.error.code + (player.error.message ? ": " + player.error.message : ""));
            TVXVideoPlugin.stopLoading();
        }
    }
    function onEnded() {
        if (!ended) {
            ended = true;
            TVXVideoPlugin.stopPlayback();
        }
    }

    function canPlayHlsNatively() {
        try {
            var video = document.createElement("video");
            return video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
                video.canPlayType("application/x-mpegURL") !== "";
        } catch (e) { return false; }
    }

    function setupVideo(url) {
        /* Prefer hls.js: some browsers (e.g. Chrome) report "maybe" for native
           HLS support but cannot actually play it. Native is used only where
           MSE/hls.js is unavailable (Safari/iOS, old TV browsers). */
        if (typeof Hls !== "undefined" && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true
            });
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data && data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        hls.startLoad();
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    } else {
                        TVXVideoPlugin.error("HLS error: " + (data.details || data.type));
                        TVXVideoPlugin.stopLoading();
                    }
                }
            });
            hls.loadSource(url);
            hls.attachMedia(player);
        } else {
            /* Native HLS (Safari/iOS, webOS) or last resort */
            player.src = url;
            player.load();
        }
    }

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
        if (TVXTools.isFullStr(url)) {
            setupVideo(url);
        } else {
            TVXVideoPlugin.warn("Video URL is missing");
            TVXVideoPlugin.stopLoading();
        }
    };

    this.dispose = function () {
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
}

TVXPluginTools.onReady(function () {
    TVXVideoPlugin.setupPlayer(new HlsPlayer());
    TVXVideoPlugin.init();
});
