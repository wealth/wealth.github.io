/* nocub.js — strip ads + CUB telemetry and route TMDB directly.
 *
 * Loaded from index.html AFTER vender/jquery.js and BEFORE app.min.js so it can
 * hook $.ajax / element src before Lampa uses them.
 *
 * Lampa's active TMDB source is hard-wired to apitmdb.{cub}/imagetmdb.com and
 * ignores the proxy_tmdb setting, so we can't fix it via Storage. Instead we
 * rewrite the hosts to source (api.themoviedb.org / image.tmdb.org) at every
 * layer they can appear — $.ajax URLs, <img>/<script> src, and Lampa.TMDB
 * itself — and swallow the ad / telemetry / mirror-probe calls.
 *
 * NOTE: direct TMDB only works where the TV's network can reach TMDB
 * (api.themoviedb.org = CloudFront, image.tmdb.org = BunnyCDN). If posters go
 * blank on the TV, TMDB is geo-blocked and we need a self-hosted proxy instead.
 */
(function () {
    "use strict";

    // Any cub host: cub.rip / cub.red / cub.watch and subdomains.
    var CUB = /\/\/([a-z0-9-]+\.)*cub\.(rip|red|watch)\b/i;

    // Rewrite cub TMDB mirrors -> TMDB source.
    function toDirect(url) {
        return String(url || "")
            .replace(/https?:\/\/apitmdb\.[^\/]+\/3\//i, "https://api.themoviedb.org/3/")
            .replace(/https?:\/\/(?:[a-z0-9-]+\.)?imagetmdb\.com\//i, "https://image.tmdb.org/")
            .replace(/https?:\/\/lampa\.byskaz\.ru\/tmdb\/api\/3\//i, "https://api.themoviedb.org/3/")
            .replace(/https?:\/\/lampa\.byskaz\.ru\/tmdb\/img\//i, "https://image.tmdb.org/");
    }

    // Calls we drop entirely (no network hit, benign empty response).
    var BLOCK = [
        /\/api\/ad\/get\//i,           // VAST prerolls + banners
        /\/api\/metric\//i,            // telemetry
        /\/api\/checker(?:[\/?]|$)/i,  // cub mirror liveness probe
        /\/api\/plugins\//i,           // plugin blacklist etc.
        /\/\/geo\.cub\./i,             // geo lookup
        /\/\/tmdb\.cub\./i             // content-filter lists (blocked / lgbt.json)
    ];
    function isBlocked(url) {
        url = String(url || "");
        for (var i = 0; i < BLOCK.length; i++) {
            if (BLOCK[i].test(url)) return true;
        }
        return false;
    }

    /* 1) Wrap jQuery $.ajax: block cub telemetry/ads, rewrite TMDB to source. */
    function wrapAjax($) {
        if (!$ || !$.ajax || $.__nocub) return;
        var real = $.ajax;

        $.ajax = function (a, b) {
            var opts = (a && typeof a === "object") ? a : (b || {});
            var url = opts.url || (typeof a === "string" ? a : "");

            if (isBlocked(url)) {
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

            var direct = toDirect(url);
            if (direct !== url) {
                if (a && typeof a === "object") a.url = direct;
                else if (typeof a === "string") a = direct;
                opts.url = direct;
            }
            return real.apply(this, arguments);
        };

        $.__nocub = true;
    }

    if (window.jQuery) {
        wrapAjax(window.jQuery);
    } else {
        var poll = setInterval(function () {
            if (window.jQuery) { wrapAjax(window.jQuery); clearInterval(poll); }
        }, 10);
        setTimeout(function () { clearInterval(poll); }, 8000);
    }

    /* 2) Rewrite <img> src (posters) and neutralise cub plugin <script> src. */
    function patchSrc(proto, neutraliseCub) {
        try {
            var desc = Object.getOwnPropertyDescriptor(proto, "src");
            if (!desc || !desc.set) return;
            Object.defineProperty(proto, "src", {
                configurable: true,
                enumerable: desc.enumerable,
                get: function () { return desc.get.call(this); },
                set: function (v) {
                    var u = toDirect(v);
                    if (neutraliseCub && CUB.test(u)) u = "data:text/javascript,"; // cub plugin -> empty
                    desc.set.call(this, u);
                }
            });
        } catch (e) {}
    }
    patchSrc(HTMLImageElement.prototype, false);
    patchSrc(HTMLScriptElement.prototype, true);

    /* 3) Once Lampa is up, override TMDB.api/image at the source too. */
    var tries = 0;
    var settle = setInterval(function () {
        tries++;
        var L = window.Lampa;
        if (L && L.TMDB) {
            if (!L.TMDB.__nocub) {
                var _api = L.TMDB.api, _image = L.TMDB.image;
                L.TMDB.api = function (u) { return toDirect(_api.call(this, u)); };
                L.TMDB.image = function (u) { return toDirect(_image.call(this, u)); };
                L.TMDB.__nocub = true;
            }
            if (window.lampa_settings) {
                window.lampa_settings.account_use = false;
                window.lampa_settings.account_sync = false;
            }
            clearInterval(settle);
        }
        if (tries > 300) clearInterval(settle);
    }, 30);
})();
