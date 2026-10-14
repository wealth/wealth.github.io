/* torrent-search.js — torrent search fixes.
 *
 * 1) Find every season of an anime series.
 * Lampa searches the torrent parser with the card's original title and, for a
 * series, asks jac.red for an exact match on it. For anime that is the
 * Japanese title (Re:ゼロから始める異世界生活), which trackers hardly use:
 * jac.red finds 2 torrents for Re:Zero, seasons 1 and 2. Trackers file anime
 * under the romaji title instead ("Re:Zero kara Hajimeru Isekai Seikatsu":
 * 84 torrents, every season), so for an anime series we run that search as
 * well and merge the two result lists.
 *
 * 2) Leave the Ukrainian trackers mazepa and toloka out of jac.red results.
 *
 * Loaded after app.min.js; wraps Lampa.Parser.get, which the torrents screen
 * calls. ES5: old webOS / Tizen browsers.
 */
(function () {
    "use strict";

    var ANIMATION = 16; // TMDB genre id
    var ANIME_LANGUAGES = ["ja", "zh"]; // same test as Lampa's own isAnimeMovie
    var LATIN = /^[\u0020-\u024F\u2010-\u2027]+$/;
    var SPACING = 1000; // ms from the end of the first search to the second
    var RETRY = 2000;   // ms before the one retry of a failed romaji search

    // jac.red's Tracker field names every tracker carrying the same torrent
    // ("mazepa, toloka"). A torrent also carried by another tracker stays,
    // listed under that one only.
    var HIDDEN_TRACKERS = ["mazepa", "toloka"];

    function isAnimeSeries(movie) {
        if (!movie || !movie.original_name) return false;
        if (ANIME_LANGUAGES.indexOf(movie.original_language) < 0) return false;
        var genres = movie.genres || [];
        for (var i = 0; i < genres.length; i++) {
            if (genres[i].id == ANIMATION) return true;
        }
        return false;
    }

    /* A Latin-script title from the show's own country, preferring the ones
       TMDB marks "romaji" / "romanization". The full card carries them as
       alternative_titles. */
    function romajiTitle(movie) {
        if (!isAnimeSeries(movie)) return "";
        var alt = movie.alternative_titles || {};
        var titles = alt.results || alt.titles || [];
        var country = (movie.origin_country && movie.origin_country[0]) || "JP";
        var fallback = "";
        for (var i = 0; i < titles.length; i++) {
            var t = titles[i];
            if (t.iso_3166_1 !== country || !LATIN.test(t.title || "")) continue;
            if (/romaji|romanization/i.test(t.type || "")) return t.title;
            if (!fallback) fallback = t.title;
        }
        return fallback;
    }

    function resultKey(item) {
        return item.MagnetUri || item.Link || [item.Title, item.Size, item.Tracker].join("|");
    }

    function merge(lists) {
        var seen = {};
        var out = [];
        for (var i = 0; i < lists.length; i++) {
            for (var j = 0; j < lists[i].length; j++) {
                var key = resultKey(lists[i][j]);
                if (seen[key]) continue;
                seen[key] = true;
                out.push(lists[i][j]);
            }
        }
        return out;
    }

    function withoutHiddenTrackers(results) {
        var out = [];
        for (var i = 0; i < results.length; i++) {
            var trackers = String(results[i].Tracker || "").split(",");
            var kept = [];
            for (var j = 0; j < trackers.length; j++) {
                var name = trackers[j].trim();
                if (HIDDEN_TRACKERS.indexOf(name.toLowerCase()) < 0) kept.push(name);
            }
            if (!kept.length) continue;
            if (kept.length < trackers.length) results[i].Tracker = kept.join(", ");
            out.push(results[i]);
        }
        return out;
    }

    function start() {
        var get = Lampa.Parser.get;
        var clear = Lampa.Parser.clear;
        var clears = 0;

        Lampa.Parser.clear = function () {
            clears++;
            return clear.apply(this, arguments);
        };

        Lampa.Parser.get = function (params, oncomplite, onerror) {
            // A typed-in search (clarification) or the global search is left alone.
            var romaji = params && !params.from_search && !params.clarification && romajiTitle(params.movie);
            if (!romaji || romaji.toLowerCase() === String(params.search || "").toLowerCase()) {
                return get.apply(this, arguments);
            }

            // clarification drops the exact-title fields, so jac.red matches
            // the romaji text itself instead of the Japanese title.
            var extra = {};
            for (var k in params) extra[k] = params[k];
            extra.search = romaji;
            extra.clarification = true;

            // One after the other, with a pause: jac.red answers a request
            // that reaches it soon after the previous one with a 429 that
            // has no CORS header. Two starts 300 ms apart fail, 600 ms pass,
            // and even 1 s from the first start failed on the TV-like flow:
            // the first request pays for the new connection and so reaches
            // the server late. Hence SPACING from the first one's end, and
            // one retry.
            var self = this;
            var generation = clears;
            function later(ms, run) {
                setTimeout(function () {
                    // The torrents screen closed meanwhile (it calls Parser.clear).
                    if (generation === clears) run();
                }, ms);
            }
            function romajiSearch(done, fail) {
                later(SPACING, function () {
                    get.call(self, extra, done, function () {
                        later(RETRY, function () {
                            get.call(self, extra, done, fail);
                        });
                    });
                });
            }
            get.call(self, params, function (json) {
                romajiSearch(function (more) {
                    json.Results = merge([json.Results || [], (more && more.Results) || []]);
                    oncomplite(json);
                }, function () {
                    oncomplite(json);
                });
            }, function (e) {
                romajiSearch(oncomplite, function () {
                    onerror(e);
                });
            });
        };
    }

    /* Every Jackett-style answer (jac.red), from the torrents screen and from
       the global search alike, passes through here before its caller sees it. */
    function hideTrackers() {
        Lampa.Listener.follow("request_secuses", function (e) {
            var data = e.data;
            if (!data || !Lampa.Arrays.isArray(data.Results)) return;
            if (!/\/api\/v2\.0\/indexers\//.test((e.params && e.params.url) || "")) return;
            data.Results = withoutHiddenTrackers(data.Results);
        });
    }

    if (window.Lampa && Lampa.Parser && Lampa.Parser.get) {
        start();
        hideTrackers();
    } else console.log("Torrent search", "Lampa.Parser is not available");
})();
