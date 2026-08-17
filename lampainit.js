/* Loaded when this host is used as a Lampa URL (Android remote). */
(function () {
    "use strict";

    function load(src, next) {
        var script = document.createElement("script");
        script.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + Math.floor(Date.now() / 9e5);
        script.onload = next;
        document.body.appendChild(script);
    }

    function boot() {
        if (window.plugin_twitch_ready) { return; }
        load("js/twitch.js", function () {
            load("js/auth.js", function () {
                load("js/chat.js", function () {
                    load("plugins/twitch.js", function () {});
                });
            });
        });
    }

    function wait() {
        if (window.appready) { boot(); return; }
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { boot(); }
            });
            return;
        }
        setTimeout(wait, 200);
    }

    wait();
})();
