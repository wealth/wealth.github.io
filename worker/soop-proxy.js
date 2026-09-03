/*
 * Cloudflare Worker — SOOP (sooplive.com) API proxy for the Lampa TV app.
 *
 * WHY: SOOP holds the global KBO (Korean baseball) rights and streams every
 * game free worldwide, but its API answers with
 *   Access-Control-Allow-Origin: https://play.sooplive.com
 * so the browser refuses to let our app read the response. The video itself is
 * fine — a native <video> element loads HLS without a CORS check (same as the
 * Twitch usher URLs) — so ONLY the three small JSON/handshake calls need
 * proxying, never the playlist or the .TS segments.
 *
 * Do NOT add edge caching to the three SOOP routes (unlike worker/tmdb-proxy.js):
 * the AID token is short-lived and live/offline state flips constantly, so a
 * cached response hands the TV a dead stream. /schedule is the exception and
 * says why at the route.
 *
 * DEPLOY (one time, in the user's Cloudflare account):
 *   1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker.
 *   2. Paste this file as the Worker code, Deploy.
 *   3. Worker -> Settings -> Domains & Routes -> Add Custom Domain:
 *        soop.demitori.com
 *   4. Verify: https://soop.demitori.com/live?bid=kboglobal1 returns JSON with
 *      a CHANNEL object (RESULT 1 while a game is on, 0 when idle).
 *   Re-paste and Deploy again whenever this file changes -- the Worker is not
 *   built from the repo. /schedule was added after the first deploy, so an
 *   un-redeployed Worker answers it with 404 and the app shows the fixture list
 *   as unavailable while live games keep working.
 *
 * Routes by path:
 *   /live?bid=<id>                      -> player_live_api.php  (channel + BNO)
 *   /aid?bid=<id>&bno=<n>[&quality=..]  -> player_live_api.php  (AID token)
 *   /assign?cdn=<cdn>&key=<broad_key>   -> broad_stream_assign.html (view_url)
 *   /schedule?from=&to= (YYYY-MM-DD)    -> Naver sports API (KBO fixture list)
 */

const LIVE_API = "https://live.sooplive.co.kr/afreeca/player_live_api.php";
const ASSIGN = "https://livestream-manager.sooplive.com/broad_stream_assign.html";
const SCHEDULE = "https://api-gw.sports.naver.com/schedule/games";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
};

/* SOOP rejects requests that don't look like they came from its own player. */
function playerHeaders(bid, bno) {
    return {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://play.sooplive.com/" + bid + (bno ? "/" + bno : ""),
        Origin: "https://play.sooplive.com",
        "User-Agent": "Mozilla/5.0",
    };
}

function json(body, status, cache) {
    const headers = new Headers(CORS);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", cache || "no-store");
    return new Response(body, { status: status || 200, headers });
}

async function post(url, form, bid, bno) {
    const res = await fetch(url, {
        method: "POST",
        headers: playerHeaders(bid, bno),
        body: form,
    });
    return json(await res.text(), res.status);
}

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", { status: 405, headers: CORS });
        }

        const url = new URL(request.url);
        const q = url.searchParams;
        const bid = q.get("bid") || "";

        try {
            /* 1) Channel state: is it live, and what is the broadcast number? */
            if (url.pathname === "/live") {
                if (!bid) return json('{"error":"bid required"}', 400);
                return await post(
                    LIVE_API,
                    "bid=" + encodeURIComponent(bid) +
                        "&type=live&player_type=html5&mode=landing&from_api=0",
                    bid
                );
            }

            /* 2) Short-lived auth token for the playlist URL. */
            if (url.pathname === "/aid") {
                const bno = q.get("bno") || "";
                if (!bid || !bno) return json('{"error":"bid and bno required"}', 400);
                const quality = q.get("quality") || "original";
                return await post(
                    LIVE_API + "?bjid=" + encodeURIComponent(bid),
                    "bid=" + encodeURIComponent(bid) +
                        "&bno=" + encodeURIComponent(bno) +
                        "&type=aid&pwd=&player_type=html5&stream_type=common" +
                        "&quality=" + encodeURIComponent(quality) +
                        "&mode=landing&from_api=0",
                    bid,
                    bno
                );
            }

            /* 3) Hand the broadcast key to the CDN manager for the playlist URL. */
            if (url.pathname === "/assign") {
                const key = q.get("key") || "";
                if (!key) return json('{"error":"key required"}', 400);
                const cdn = q.get("cdn") || "gcp_cdn";
                const target = ASSIGN +
                    "?return_type=" + encodeURIComponent(cdn) +
                    "&use_cors=true&cors_origin_url=play.sooplive.com" +
                    "&broad_key=" + encodeURIComponent(key) +
                    "&time=" + Date.now();
                const res = await fetch(target, {
                    headers: {
                        Referer: "https://play.sooplive.com/",
                        Origin: "https://play.sooplive.com",
                        "User-Agent": "Mozilla/5.0",
                    },
                });
                return json(await res.text(), res.status);
            }

            /* 4) KBO fixture list, so the app can say when the next game is and
                  not just what is on right now. Naver's sports API is the one
                  free KBO schedule feed that answers with clean JSON, but it
                  rejects any request carrying an Origin header with a 403, so
                  it has to come through here too. Unlike the calls above this
                  one IS worth caching briefly: a fixture list barely moves, and
                  the worst case is a five-minute-old score. */
            if (url.pathname === "/schedule") {
                const from = q.get("from") || "";
                const to = q.get("to") || from;
                const day = /^\d{4}-\d{2}-\d{2}$/;
                if (!day.test(from) || !day.test(to)) {
                    return json('{"error":"from and to must be YYYY-MM-DD"}', 400);
                }
                const res = await fetch(
                    SCHEDULE + "?categoryId=kbo&fromDate=" + from + "&toDate=" + to + "&size=100",
                    { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }
                );
                return json(await res.text(), res.status, "public, max-age=300");
            }
        } catch (e) {
            return json('{"error":"upstream: ' + String(e).replace(/"/g, "'") + '"}', 502);
        }

        return json('{"error":"not found"}', 404);
    },
};
