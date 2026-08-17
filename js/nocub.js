/* nocub.js — strip ads + CUB telemetry and route TMDB directly.
 *
 * Loaded from index.html AFTER vender/jquery.js and BEFORE app.min.js, so it
 * can wrap $.ajax before Lampa ever uses it. Lampa makes all of the calls we
 * want gone (ads, metrics, mirror-check) through jQuery $.ajax, and builds its
 * TMDB URLs directly (api.themoviedb.org / image.tmdb.org) unless the
 * `proxy_tmdb` setting is on — so we just turn that off and swallow the rest.
 *
 * Kept OUT of scope on purpose: api.themoviedb.org / image.tmdb.org (the
 * catalog) and everything on lampa.demitori.com.
 */
(function () {
    "use strict";

    function ls(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    /* 1) TMDB straight to source, and don't let the broken-image fallback
     *    silently switch the cub proxy back on. */
    ls("proxy_tmdb", false);
    ls("proxy_tmdb_auto", false);

    /* 2) No CUB account / bookmark sync (Twitch uses its own auth here). */
    ls("account_use", false);
    ls("account_sync", false);

    /* 3) Drop any pre-installed CUB plugins (sport / tsarea / shots ...). */
    ls("plugins", []);

    /* 4) Swallow cub.rip ad / telemetry / mirror-probe calls: no network hit,
     *    benign empty response so Lampa's own handlers run without throwing. */
    var BLOCK = [
        /\/api\/ad\/get\//i,          // VAST prerolls + banners
        /\/api\/metric\//i,           // telemetry (unic / stat / histogram)
        /\/api\/checker(?:[\/?]|$)/i, // cub mirror liveness probe
        /\/\/geo\.cub\./i             // geo lookup
    ];

    function blocked(url) {
        url = String(url || "");
        for (var i = 0; i < BLOCK.length; i++) {
            if (BLOCK[i].test(url)) return true;
        }
        return false;
    }

    function wrap($) {
        if (!$ || !$.ajax || $.__nocub) return;

        var real = $.ajax;

        $.ajax = function (a, b) {
            var opts = (a && typeof a === "object") ? a : (b || {});
            var url = opts.url || (typeof a === "string" ? a : "");

            if (blocked(url)) {
                var res = opts.dataType === "text" ? "" : { ad: [], secuses: true };
                var d = $.Deferred();

                try { if (opts.success) opts.success(res, "success", null); } catch (e) {}
                try { if (opts.complete) opts.complete(null, "success"); } catch (e) {}

                d.resolve(res, "success", null);

                var jq = d.promise();
                jq.abort = jq.setRequestHeader = function () {};
                jq.getAllResponseHeaders = function () { return ""; };
                return jq;
            }

            return real.apply(this, arguments);
        };

        $.__nocub = true;
    }

    if (window.jQuery) {
        wrap(window.jQuery);
    } else {
        var poll = setInterval(function () {
            if (window.jQuery) { wrap(window.jQuery); clearInterval(poll); }
        }, 10);
        setTimeout(function () { clearInterval(poll); }, 8000);
    }

    /* 5) Re-assert the TMDB/account settings once Lampa is up, in case its
     *    first-run defaults (proxy_tmdb: true) overwrite ours. */
    var tries = 0;
    var settle = setInterval(function () {
        tries++;
        if (window.Lampa && Lampa.Storage) {
            Lampa.Storage.set("proxy_tmdb", false);
            Lampa.Storage.set("proxy_tmdb_auto", false);
            if (window.lampa_settings) {
                window.lampa_settings.account_use = false;
                window.lampa_settings.account_sync = false;
            }
            clearInterval(settle);
        }
        if (tries > 200) clearInterval(settle);
    }, 50);
})();
