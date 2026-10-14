/*
 * Cloudflare Worker — TMDB reverse proxy for the Lampa TV app.
 *
 * WHY: this TV's network geo-blocks TMDB directly (api.themoviedb.org = AWS
 * CloudFront, image.tmdb.org = BunnyCDN), so posters go blank. The TV *can*
 * reach Cloudflare (that's how lampa.demitori.com works), so we let a
 * Cloudflare Worker fetch TMDB server-side and hand it back to the TV.
 *
 * DEPLOY (one time, in the user's Cloudflare account):
 *   1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker.
 *   2. Paste this file as the Worker code, Deploy.
 *   3. Worker -> Settings -> Domains & Routes -> Add Custom Domain:
 *        tmdb.demitori.com
 *      (Cloudflare provisions DNS + TLS automatically; it's proxied, so the
 *       TV only ever talks to Cloudflare.)
 *   4. Verify: https://tmdb.demitori.com/t/p/w300/<any-poster>.jpg loads an
 *      image, and https://tmdb.demitori.com/3/movie/550?api_key=... returns JSON.
 *   Re-paste and Deploy again whenever this file changes -- the Worker is not
 *   built from the repo. Deploy it BEFORE bumping TMDB_REV in js/nocub.js, or
 *   the TV caches the unfixed data under the new URLs.
 *
 * Routes by path:
 *   /3/*    -> https://api.themoviedb.org/3/*    (metadata)
 *   /t/p/*  -> https://image.tmdb.org/t/p/*      (posters/backdrops)
 *
 * Two metadata fixes ride on top of the plain proxy (fixTv below):
 *   - TMDB files some anime as ONE long season 1 (Re:Zero: 85 episodes,
 *     2016-2026). Lampa then guesses the seasons from gaps between air dates,
 *     gets them wrong (it calls Re:Zero's 2026 cour "season 5", because season
 *     2 had a winter break) and labels the guessed season with season 1's 2016
 *     date. When such a show has an episode group that splits season 1 into
 *     seasons, /tv/{id} and /tv/{id}/season/{n} answer as if TMDB listed those
 *     seasons itself.
 *   - Episodes whose localized name is TMDB's "Эпизод 78" placeholder get the
 *     English name, when TMDB has one.
 */

const UPSTREAMS = [
    { prefix: "/3/", origin: "https://api.themoviedb.org" },
    { prefix: "/t/p/", origin: "https://image.tmdb.org" },
];

const TMDB_API = "https://api.themoviedb.org";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

// Cache at Cloudflare's edge so repeat posters/metadata are fast and we hit
// TMDB less. TMDB responses are effectively immutable.
const EDGE_CACHE = { cacheEverything: true, cacheTtl: 21600 };

// /3/tv/{id} and /3/tv/{id}/season/{n}
const TV_PATH = /^\/3\/tv\/(\d+)(?:\/season\/(\d+))?\/?$/;

// Episode group types that can describe seasons. TMDB numbers them
// 1 original air date, 2 absolute, 3 DVD, 4 digital, 5 story arc,
// 6 production, 7 TV; absolute and story-arc groups never do.
const SEASON_GROUP_TYPES = [1, 3, 4, 6, 7];

// Preferred when several groups qualify: Re:Zero's "Seasons" group names its
// parts "Season 1".."Season 4".
const SEASON_WORD = /season|сезон|staffel|saison|temporada|stagione|sezon/i;

// The free plan allows 10 ms of CPU per request, and parsing a season plus
// its English copy costs ~1 ms per 150 KB. Most seasons are under 100 KB;
// daily shows run to 1 MB (Running Man: 826 episodes) and are served as is.
const MAX_PARSE = 400000;

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", { status: 405, headers: CORS });
        }

        const url = new URL(request.url);
        const match = UPSTREAMS.find((u) => url.pathname.startsWith(u.prefix));
        if (!match) {
            return new Response("Not found", { status: 404, headers: CORS });
        }

        const target = match.origin + url.pathname + url.search;

        if (request.method === "GET" && match.origin === TMDB_API) {
            try {
                const fixed = await fixTv(url, target);
                if (fixed) return fixed;
            } catch (e) {
                // Anything unexpected in TMDB's data: serve it unfixed.
            }
        }

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: { Accept: request.headers.get("Accept") || "*/*" },
                cf: EDGE_CACHE,
            });
        } catch (e) {
            return new Response("Upstream error: " + e, { status: 502, headers: CORS });
        }

        const headers = new Headers(upstream.headers);
        for (const k in CORS) headers.set(k, CORS[k]);
        return new Response(upstream.body, { status: upstream.status, headers });
    },
};

/* A fixed /tv response, or null to proxy the request untouched. */
async function fixTv(url, target) {
    const m = TV_PATH.exec(url.pathname);
    if (!m) return null;
    const auth = {
        api_key: url.searchParams.get("api_key"),
        language: url.searchParams.get("language"),
    };
    return m[2] === undefined
        ? fixShow(target, auth)
        : fixSeason(target, auth, m[1], Number(m[2]));
}

async function fixShow(target, auth) {
    const res = await getJson(target);
    if (!res.ok) return null;
    const text = await res.text();
    // Only a single-season show can be a collapsed one; skip parsing the rest.
    if (!/"number_of_seasons":1\b/.test(text) || text.length > MAX_PARSE) return json(text);
    const show = JSON.parse(text);
    const split = await realSeasons(show, auth);
    if (!split) return json(text);

    const first = show.seasons.find((s) => s.season_number === 1);
    const where = new Map(); // episode id -> [season, episode]
    split.seasons.forEach((eps, i) => eps.forEach((e, j) => where.set(e.id, [i + 1, j + 1])));

    show.seasons = show.seasons
        .filter((s) => s.season_number === 0)
        .concat(split.seasons.map((eps, i) => {
            const season = seasonInfo(first, i + 1, eps);
            season.episode_count = eps.length;
            return season;
        }));
    show.number_of_seasons = split.seasons.length;
    for (const key of ["last_episode_to_air", "next_episode_to_air"]) {
        const at = show[key] && where.get(show[key].id);
        if (at) {
            show[key].season_number = at[0];
            show[key].episode_number = at[1];
        }
    }
    return json(JSON.stringify(show));
}

async function fixSeason(target, auth, id, n) {
    const [show, res] = await Promise.all([
        n > 0 ? tmdb(`/3/tv/${id}`, auth) : null,
        getJson(target),
    ]);
    const split = show && (await realSeasons(show, auth));

    if (split) {
        if (res.body) res.body.cancel(); // season 1 in full, or a 404 for n > 1
        const eps = split.seasons[n - 1];
        if (!eps) {
            return json(JSON.stringify({
                success: false,
                status_code: 34,
                status_message: "The resource you requested could not be found.",
            }), 404);
        }
        // Before renumbering: a placeholder carries the original number.
        await fillPlaceholders(eps, auth, async () => {
            const en = await tmdb(`/3/tv/episode_group/${split.group}`, { ...auth, language: "en-US" });
            return en ? groupEpisodes(en) : [];
        });
        const first = show.seasons.find((s) => s.season_number === 1);
        const season = seasonInfo(first, n, eps);
        season.episodes = eps.map((e, i) => {
            const { order, ...ep } = e;
            ep.season_number = n;
            ep.episode_number = i + 1;
            return ep;
        });
        return json(JSON.stringify(season));
    }

    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_PARSE) return json(text);
    const season = JSON.parse(text);
    const changed = await fillPlaceholders(season.episodes || [], auth, async () => {
        const en = await tmdb(`/3/tv/${id}/season/${n}`, { ...auth, language: "en-US" });
        return (en && en.episodes) || [];
    });
    return json(changed ? JSON.stringify(season) : text);
}

/*
 * The real seasons of a show TMDB files as one long season 1, as
 * { seasons: [[episode, ...], ...], group: <episode group id> }, or null for
 * a normal show. They come from an episode group that splits season 1 into
 * runs of consecutive episodes covering ALL of it. A group that misses
 * episodes (say, a new cour TMDB added before anyone updated the group) is
 * ignored so nothing disappears -- Lampa's own guess applies then.
 */
async function realSeasons(show, auth) {
    const regular = (show.seasons || []).filter((s) => s.season_number > 0);
    if (regular.length !== 1 || regular[0].season_number !== 1) return null;
    const total = regular[0].episode_count;

    const list = await tmdb(`/3/tv/${show.id}/episode_groups`, { api_key: auth.api_key });
    const ids = ((list && list.results) || [])
        .filter((g) => g.group_count >= 2 && g.episode_count >= total && SEASON_GROUP_TYPES.includes(g.type))
        .slice(0, 3)
        .map((g) => g.id);
    if (!ids.length) return null;

    const groups = await Promise.all(ids.map((gid) => tmdb(`/3/tv/episode_group/${gid}`, auth)));
    let best = null;
    for (const group of groups) {
        const parts = group && seasonParts(group, total);
        if (parts && (!best || (parts.named && !best.named))) {
            best = { seasons: parts.seasons, named: parts.named, group: group.id };
        }
    }
    return best;
}

/* The group's season-1 episodes as consecutive seasons, or null if they aren't. */
function seasonParts(group, total) {
    const parts = (group.groups || [])
        .map((g) => ({
            name: g.name || "",
            order: g.order,
            episodes: (g.episodes || [])
                .filter((e) => e.season_number === 1)
                .sort((a, b) => a.order - b.order),
        }))
        .filter((p) => p.episodes.length)
        .sort((a, b) => a.order - b.order);
    if (parts.length < 2) return null;

    let last = 0;
    let count = 0;
    for (const p of parts) {
        for (const e of p.episodes) {
            if (e.episode_number <= last) return null; // overlap or out of order
            last = e.episode_number;
            count++;
        }
    }
    if (count !== total) return null;

    return {
        seasons: parts.map((p) => p.episodes),
        named: parts.every((p) => SEASON_WORD.test(p.name)),
    };
}

function groupEpisodes(group) {
    return (group.groups || []).reduce((all, g) => all.concat(g.episodes || []), []);
}

/* Season fields Lampa reads, for season n built from episodes eps. */
function seasonInfo(first, n, eps) {
    const rated = eps.filter((e) => e.vote_count > 0);
    const vote = rated.reduce((sum, e) => sum + e.vote_average, 0) / (rated.length || 1);
    return {
        air_date: eps[0].air_date,
        id: n === 1 ? first.id : first.id * 100 + n,
        name: /\d+/.test(first.name || "") ? first.name.replace(/\d+/, String(n)) : "Season " + n,
        overview: n === 1 ? first.overview : "",
        poster_path: first.poster_path,
        season_number: n,
        vote_average: Math.round(vote * 10) / 10,
    };
}

/* TMDB's stand-in for a missing translation: "Эпизод 78", "Episode 78", ... */
function isPlaceholder(ep) {
    const m = /^\S+\s+(\d+)$/.exec((ep.name || "").trim());
    return !ep.name || (m !== null && Number(m[1]) === ep.episode_number);
}

/*
 * Give placeholder-named episodes their English name. loadEnglish returns the
 * same episodes in English and runs only if a placeholder is present.
 * Returns whether any name changed.
 */
async function fillPlaceholders(episodes, auth, loadEnglish) {
    if (!auth.language || /^en/i.test(auth.language)) return false;
    if (!episodes.some(isPlaceholder)) return false;

    const english = new Map((await loadEnglish()).map((e) => [e.id, e]));
    let changed = false;
    for (const ep of episodes) {
        const en = english.get(ep.id);
        if (en && isPlaceholder(ep) && !isPlaceholder(en)) {
            ep.name = en.name;
            changed = true;
        }
    }
    return changed;
}

function getJson(url) {
    return fetch(url, { headers: { Accept: "application/json" }, cf: EDGE_CACHE });
}

async function tmdb(path, params) {
    const url = new URL(TMDB_API + path);
    for (const k in params) {
        if (params[k]) url.searchParams.set(k, params[k]);
    }
    const res = await getJson(url.toString());
    return res.ok ? res.json() : null;
}

function json(body, status = 200) {
    const headers = new Headers(CORS);
    headers.set("Content-Type", "application/json;charset=utf-8");
    headers.set("Cache-Control", "public, max-age=21600");
    return new Response(body, { status, headers });
}
