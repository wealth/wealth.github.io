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
 *
 * Routes by path:
 *   /3/*    -> https://api.themoviedb.org/3/*    (metadata)
 *   /t/p/*  -> https://image.tmdb.org/t/p/*      (posters/backdrops)
 */

const UPSTREAMS = [
    { prefix: "/3/", origin: "https://api.themoviedb.org" },
    { prefix: "/t/p/", origin: "https://image.tmdb.org" },
];

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

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

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: { Accept: request.headers.get("Accept") || "*/*" },
                // Cache at Cloudflare's edge so repeat posters/metadata are fast
                // and we hit TMDB less. TMDB responses are effectively immutable.
                cf: { cacheEverything: true, cacheTtl: 21600 },
            });
        } catch (e) {
            return new Response("Upstream error: " + e, { status: 502, headers: CORS });
        }

        const headers = new Headers(upstream.headers);
        for (const k in CORS) headers.set(k, CORS[k]);
        return new Response(upstream.body, { status: upstream.status, headers });
    },
};
