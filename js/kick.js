/*
 * Kick (kick.com) API layer — live streams, categories, channels and VODs.
 * ES5 only: must run on old TV browsers (webOS 3+).
 *
 * Kick has two APIs. The documented one (api.kick.com/public/v1) wants an OAuth
 * app token, and a static page has nowhere to keep a client secret. This uses
 * the endpoints kick.com's own pages call instead: they need no key and answer
 * any Origin with a matching Access-Control-Allow-Origin, so — unlike SOOP —
 * nothing here goes through a Worker.
 *
 * Playback is Amazon IVS, the same stack as Twitch. channel() hands back a
 * tokenised master playlist; without the token IVS answers 403, and the copies
 * of playback_url inside the listing endpoints carry none, so a stream is
 * always resolved through channel() at the moment it is played. IVS only sends
 * its CORS header to kick.com, which stops hls.js but not a native <video> —
 * live plays on the TV and not in a desktop browser, exactly like Twitch's
 * usher URLs. VOD playlists (stream.kick.com) are open to every origin.
 *
 * There is no login: Kick has no device-code flow, and "following" lives behind
 * a kick.com session cookie. Favorites kept on the device stand in for it.
 */
var Kick = (function () {
    "use strict";

    var SITE = "https://kick.com";
    var PAGE_SIZE = 24;

    function xhr(url, callback) {
        var req = new XMLHttpRequest();
        var done = false;
        function finish(err, text) {
            if (done) { return; }
            done = true;
            callback(err, text);
        }
        req.open("GET", url, true);
        req.timeout = 15000;
        req.onreadystatechange = function () {
            if (req.readyState === 4) {
                if (req.status >= 200 && req.status < 300) { finish(null, req.responseText); }
                else { finish("HTTP " + req.status, req.responseText); }
            }
        };
        req.ontimeout = function () { finish("Request timeout", null); };
        req.onerror = function () { finish("Network error", null); };
        req.send(null);
    }

    function getJSON(url, callback) {
        xhr(url, function (err, text) {
            if (err) { callback(err, null); return; }
            var data = null;
            try { data = JSON.parse(text); } catch (e) { callback("Invalid JSON from Kick", null); return; }
            callback(null, data);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Mapping                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * Images come as { src, srcset } (thumbnails), { url, responsive } (category
     * art) or { url } (banners). src is the 720p frame; a card is a fraction of
     * that, so take the smallest srcset candidate that still covers it — a TV
     * decoding two dozen 1280px images at once is where the memory goes.
     */
    function pickImage(image, minWidth) {
        if (!image) { return ""; }
        if (typeof image === "string") { return image; }
        var best = null;
        var parts = String(image.srcset || image.responsive || "").split(",");
        for (var i = 0; i < parts.length; i++) {
            var m = parts[i].replace(/^\s+|\s+$/g, "").match(/^(\S+)\s+(\d+)w$/);
            if (!m) { continue; }
            var width = parseInt(m[2], 10);
            if (width >= minWidth && (!best || width < best.width)) { best = { url: m[1], width: width }; }
        }
        return best ? best.url : (image.src || image.url || "");
    }

    function mapCategory(c) {
        if (!c || !c.slug) { return null; }
        return {
            id: c.id,
            name: c.name || c.slug,
            slug: c.slug,
            viewers: c.viewers || 0,
            image: pickImage(c.banner, 280)
        };
    }

    /* The same person is spelled three ways depending on the endpoint. */
    function avatarOf(user) {
        return user ? (user.profile_pic || user.profilePic || user.profilepic || "") : "";
    }

    /* A row of the livestream listings. */
    function mapStream(s) {
        var ch = s && s.channel;
        if (!ch || !ch.slug) { return null; }
        return {
            id: s.id,
            slug: ch.slug,
            name: ch.user && ch.user.username ? ch.user.username : ch.slug,
            title: s.session_title || "",
            viewers: s.viewer_count || 0,
            thumb: pickImage(s.thumbnail, 440),
            category: s.categories && s.categories.length ? mapCategory(s.categories[0]) : null
        };
    }

    function mapChannel(c) {
        if (!c || !c.slug) { return null; }
        var user = c.user || {};
        var ls = c.livestream && c.livestream.is_live ? c.livestream : null;
        var banner = c.offline_banner_image || c.banner_image;
        return {
            id: c.id,
            userId: c.user_id,
            slug: c.slug,
            name: user.username || c.slug,
            bio: user.bio || "",
            avatar: avatarOf(user),
            banner: pickImage(banner, 640),
            /* A string on the channel endpoint, a number on search. */
            followers: parseInt(c.followers_count || c.followersCount || 0, 10) || 0,
            playbackUrl: c.playback_url || "",
            live: ls ? {
                id: ls.id,
                title: ls.session_title || "",
                viewers: ls.viewer_count || 0,
                /* Not ls.thumbnail: see profile(). */
                thumb: "",
                category: ls.categories && ls.categories.length ? mapCategory(ls.categories[0]) : null
            } : null
        };
    }

    /* Search rows say only whether a channel is live, not what it is showing. */
    function mapSearchChannel(c) {
        if (!c || !c.slug) { return null; }
        return {
            slug: c.slug,
            name: c.user && c.user.username ? c.user.username : c.slug,
            avatar: avatarOf(c.user),
            followers: parseInt(c.followersCount || c.followers_count || 0, 10) || 0,
            isLive: !!c.isLive
        };
    }

    function mapVideo(v) {
        /* The stream in progress is listed too, as a recording with no length yet. */
        if (!v || !v.source || v.is_live) { return null; }
        return {
            id: v.id,
            title: v.session_title || "",
            duration: Math.floor((v.duration || 0) / 1000),
            views: v.views || 0,
            thumb: pickImage(v.thumbnail, 440),
            url: v.source
        };
    }

    function mapList(list, map) {
        var out = [];
        for (var i = 0; list && i < list.length; i++) {
            var item = map(list[i]);
            if (item) { out.push(item); }
        }
        return out;
    }

    /* Laravel paginator: { data: [...], next_page_url }. */
    function paged(url, page, map, callback) {
        page = page || 1;
        getJSON(url + (url.indexOf("?") >= 0 ? "&" : "?") + "page=" + page + "&limit=" + PAGE_SIZE, function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, {
                items: mapList(data && data.data, map),
                page: page,
                hasNext: !!(data && data.next_page_url)
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Catalog                                                            */
    /* ------------------------------------------------------------------ */

    /*
     * The language segment in /stream/livestreams/<lang> is decoration: every
     * value returns the same global list, ordered by viewers.
     */
    function topStreams(page, callback) {
        paged(SITE + "/stream/livestreams/en?sort=desc", page, mapStream, callback);
    }

    function categoryStreams(slug, page, callback) {
        paged(SITE + "/stream/livestreams/en?sort=desc&subcategory=" + encodeURIComponent(slug), page, mapStream, callback);
    }

    /*
     * Kick's hand-picked row. This one does honour the language, and falls
     * back to the English picks for a language it has none in — which makes it
     * the only listing that can surface streams the viewer understands.
     */
    function featuredStreams(lang, callback) {
        var code = /^[a-z]{2}$/.test(lang || "") ? lang : "en";
        getJSON(SITE + "/stream/featured-livestreams/" + code, function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, { items: mapList(data && data.data, mapStream), page: 1, hasNext: false });
        });
    }

    function categories(page, callback) {
        paged(SITE + "/api/v1/subcategories", page, mapCategory, callback);
    }

    function search(text, callback) {
        getJSON(SITE + "/api/search?searched_word=" + encodeURIComponent(text), function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, {
                channels: mapList(data && data.channels, mapSearchChannel),
                categories: mapList(data && data.categories, mapCategory)
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Channel                                                            */
    /* ------------------------------------------------------------------ */

    function livestreamUrl(slug) {
        return SITE + "/api/v2/channels/" + encodeURIComponent(slug) + "/livestream";
    }

    /* A channel as it is played: one call, everything playback and chat need. */
    function channel(slug, callback) {
        getJSON(SITE + "/api/v2/channels/" + encodeURIComponent(slug), function (err, data) {
            if (err) { callback(err.indexOf("404") >= 0 ? "Channel not found" : err, null); return; }
            var mapped = mapChannel(data);
            if (!mapped) { callback("Channel not found", null); return; }
            callback(null, mapped);
        });
    }

    /*
     * A channel as it is shown: channel(), plus the preview frame while live.
     * The thumbnail the channel endpoint carries is a dead link — the bucket
     * answers 403, and for some channels the field is simply null — and the
     * frame that does load is only on /livestream. That second call is why
     * this is separate: starting playback should not wait for a picture.
     */
    function profile(slug, callback) {
        channel(slug, function (err, ch) {
            if (err || !ch.live) { callback(err, ch); return; }
            getJSON(livestreamUrl(slug), function (err2, res) {
                var ls = !err2 && res ? res.data : null;
                if (ls && ls.thumbnail) { ch.live.thumb = pickImage(ls.thumbnail, 640); }
                callback(null, ch);
            });
        });
    }

    /*
     * Several profiles at once, in the order asked for; a channel that fails
     * (renamed, banned, a dropped request) comes back as null rather than
     * failing the rest. There is no batch endpoint, so this is a call each.
     */
    function profiles(slugs, callback) {
        var out = new Array(slugs.length);
        var pending = slugs.length;
        if (!pending) { callback(null, []); return; }
        function collect(i) {
            profile(slugs[i], function (err, ch) {
                out[i] = err ? null : ch;
                if (--pending === 0) { callback(null, out); }
            });
        }
        for (var i = 0; i < slugs.length; i++) { collect(i); }
    }

    function videos(slug, callback) {
        getJSON(SITE + "/api/v2/channels/" + encodeURIComponent(slug) + "/videos", function (err, data) {
            if (err) { callback(err, null); return; }
            callback(null, mapList(data, mapVideo));
        });
    }

    /* Current viewer count for the player overlay; null once the stream ends. */
    function viewers(slug, callback) {
        getJSON(livestreamUrl(slug), function (err, data) {
            if (err) { callback(err, null); return; }
            var ls = data && data.data;
            callback(null, ls && typeof ls.viewers === "number" ? ls.viewers : null);
        });
    }

    return {
        topStreams: topStreams,
        featuredStreams: featuredStreams,
        categoryStreams: categoryStreams,
        categories: categories,
        search: search,
        channel: channel,
        profile: profile,
        profiles: profiles,
        videos: videos,
        viewers: viewers
    };
})();
