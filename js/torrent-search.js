/* torrent-search.js — find every season of an anime series in the torrent search.
 *
 * Lampa searches the torrent parser with the card's original title and, for a
 * series, asks jac.red for an exact match on it. For anime that is the
 * Japanese title (Re:ゼロから始める異世界生活), which trackers hardly use:
 * jac.red finds 2 torrents for Re:Zero, seasons 1 and 2. Trackers file anime
 * under the romaji title instead ("Re:Zero kara Hajimeru Isekai Seikatsu":
 * 84 torrents, every season), so for an anime series we run that search as
 * well and merge the two result lists.
 *
 * Loaded after app.min.js; wraps Lampa.Parser.get, which the torrents screen
 * calls. ES5: old webOS / Tizen browsers.
 */
(function () {
    "use strict";

    var ANIMATION = 16; // TMDB genre id
    var ANIME_LANGUAGES = ["ja", "zh"]; // same test as Lampa's own isAnimeMovie
    var LATIN = /^[ -ɏ‐-‧]+$/;
    var SPACING = 1000; // ms between the starts of the two searches

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

            // One after the other, starting at least SPACING ms apart: jac.red
            // answers a request that starts ~300 ms after the previous one
            // with a 429 that has no CORS header (600 ms is fine), and a
            // cached first answer can come back that fast.
            var self = this;
            var started = Date.now();
            var generation = clears;
            function then(run) {
                setTimeout(function () {
                    // The torrents screen closed meanwhile (it calls Parser.clear).
                    if (generation === clears) run();
                }, Math.max(0, SPACING - (Date.now() - started)));
            }
            get.call(self, params, function (json) {
                then(function () {
                    get.call(self, extra, function (more) {
                        json.Results = merge([json.Results || [], (more && more.Results) || []]);
                        oncomplite(json);
                    }, function () {
                        oncomplite(json);
                    });
                });
            }, function (e) {
                then(function () {
                    get.call(self, extra, oncomplite, function () {
                        onerror(e);
                    });
                });
            });
        };
    }

    if (window.Lampa && Lampa.Parser && Lampa.Parser.get) start();
    else console.log("Torrent search", "Lampa.Parser is not available");
})();
