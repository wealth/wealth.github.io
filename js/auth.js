/*
 * Twitch account login for Smart Twitch TV (MSX).
 * OAuth Device Code Flow — the TV shows a code, the user activates it on a
 * phone at twitch.tv/activate. No backend, no client secret.
 * ES5 only: must run on old TV browsers (webOS 3+).
 */
var TwitchAuth = (function () {
    "use strict";

    /*
     * A *registered* third-party Twitch application client-ID (device-flow
     * enabled). This is required for personalized data: Twitch gates the
     * first-party web client (kimne...) behind an anti-bot integrity check on
     * followed/recommended GQL fields, so those silently return empty for it.
     * A registered app's OAuth token is not subject to that gate.
     * Reused (published as reusable) from the open-source SmartTwitchTV app;
     * swap in your own from dev.twitch.tv/console if you prefer.
     */
    var CLIENT_ID = "ue6666qo983tsx6so1t0vnawi233wa";
    var SCOPES = "user:read:follows";
    var DEVICE_URL = "https://id.twitch.tv/oauth2/device";
    var TOKEN_URL = "https://id.twitch.tv/oauth2/token";
    var VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
    var REVOKE_URL = "https://id.twitch.tv/oauth2/revoke";
    var DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
    var STORE_KEY = "stv:auth";

    var auth = null;      /* {access_token, refresh_token, expires_at, user_id, login, display} */
    var pollTimer = null;

    function loadAuth() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            auth = raw ? JSON.parse(raw) : null;
        } catch (e) { auth = null; }
        /*
         * A token is only valid for the client-ID it was issued for. If the app
         * client-ID changed (e.g. upgrading from the old first-party client),
         * discard the stored token so the user re-logs in cleanly.
         */
        if (auth && auth.client_id !== CLIENT_ID) {
            auth = null;
            saveAuth();
        }
    }

    function saveAuth() {
        try {
            if (auth) {
                window.localStorage.setItem(STORE_KEY, JSON.stringify(auth));
            } else {
                window.localStorage.removeItem(STORE_KEY);
            }
        } catch (e) { }
    }

    function form(obj) {
        var parts = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
            }
        }
        return parts.join("&");
    }

    function xhr(method, url, body, headers, callback) {
        var req = new XMLHttpRequest();
        var done = false;
        function finish(status, text) {
            if (done) { return; }
            done = true;
            var data = null;
            if (text) { try { data = JSON.parse(text); } catch (e) { } }
            callback(status, data);
        }
        req.open(method, url, true);
        req.timeout = 15000;
        if (headers) {
            for (var name in headers) {
                if (headers.hasOwnProperty(name)) { req.setRequestHeader(name, headers[name]); }
            }
        }
        req.onreadystatechange = function () {
            if (req.readyState === 4) { finish(req.status, req.responseText); }
        };
        req.ontimeout = function () { finish(0, null); };
        req.onerror = function () { finish(0, null); };
        req.send(body || null);
    }

    function postForm(url, obj, callback) {
        xhr("POST", url, form(obj), { "Content-Type": "application/x-www-form-urlencoded" }, callback);
    }

    /* Fetches user_id + login for the current access token, then stores auth */
    function finalizeLogin(token, callback) {
        xhr("GET", VALIDATE_URL, null, { "Authorization": "OAuth " + token.access_token }, function (status, data) {
            if (status !== 200 || !data || !data.user_id) {
                callback("Could not verify login");
                return;
            }
            auth = {
                client_id: CLIENT_ID,
                access_token: token.access_token,
                refresh_token: token.refresh_token || null,
                expires_at: token.expires_in ? (new Date().getTime() + token.expires_in * 1000) : 0,
                user_id: data.user_id,
                login: data.login,
                display: data.login
            };
            saveAuth();
            callback(null);
        });
    }

    function stopPolling() {
        if (pollTimer != null) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    /*
     * Begins device login.
     * onCode(info)   -> info = {user_code, verification_uri, expires_in}
     * onDone(status) -> status = "success" | "expired" | "error"
     */
    function startDeviceLogin(onCode, onDone) {
        stopPolling();
        postForm(DEVICE_URL, { client_id: CLIENT_ID, scopes: SCOPES }, function (status, data) {
            if (status !== 200 || !data || !data.device_code) {
                onDone("error");
                return;
            }
            onCode({
                user_code: data.user_code,
                verification_uri: data.verification_uri || "https://www.twitch.tv/activate",
                expires_in: data.expires_in
            });
            var interval = (data.interval || 5) * 1000;
            var deadline = new Date().getTime() + (data.expires_in || 1800) * 1000;

            function poll() {
                pollTimer = null;
                if (new Date().getTime() >= deadline) { onDone("expired"); return; }
                postForm(TOKEN_URL, {
                    client_id: CLIENT_ID,
                    scopes: SCOPES,
                    device_code: data.device_code,
                    grant_type: DEVICE_GRANT
                }, function (tstatus, tdata) {
                    if (tstatus === 200 && tdata && tdata.access_token) {
                        finalizeLogin(tdata, function (err) {
                            onDone(err ? "error" : "success");
                        });
                        return;
                    }
                    if (tdata && tdata.message === "authorization_pending") {
                        pollTimer = setTimeout(poll, interval);
                    } else if (tdata && tdata.message && tdata.message.indexOf("slow") >= 0) {
                        interval += 2000;
                        pollTimer = setTimeout(poll, interval);
                    } else if (tstatus === 0) {
                        pollTimer = setTimeout(poll, interval);
                    } else {
                        onDone("error");
                    }
                });
            }
            pollTimer = setTimeout(poll, interval);
        });
    }

    /* Ensures a valid token, refreshing if expired. callback(ok) */
    function ensureToken(callback) {
        if (auth == null) { callback(false); return; }
        var soon = new Date().getTime() + 60000;
        if (!auth.expires_at || auth.expires_at > soon) { callback(true); return; }
        if (!auth.refresh_token) { callback(true); return; }
        postForm(TOKEN_URL, {
            client_id: CLIENT_ID,
            grant_type: "refresh_token",
            refresh_token: auth.refresh_token
        }, function (status, data) {
            if (status === 200 && data && data.access_token) {
                auth.access_token = data.access_token;
                if (data.refresh_token) { auth.refresh_token = data.refresh_token; }
                auth.expires_at = data.expires_in ? (new Date().getTime() + data.expires_in * 1000) : 0;
                saveAuth();
                callback(true);
            } else {
                /* Refresh failed (e.g. token revoked): treat as logged out */
                auth = null;
                saveAuth();
                callback(false);
            }
        });
    }

    function logout() {
        stopPolling();
        if (auth && auth.access_token) {
            postForm(REVOKE_URL, { client_id: CLIENT_ID, token: auth.access_token }, function () { });
        }
        auth = null;
        saveAuth();
    }

    /* Stable per-install device id (Twitch personalized queries want X-Device-ID) */
    function deviceId() {
        var id = null;
        try { id = window.localStorage.getItem("stv:deviceid"); } catch (e) { }
        if (!id || id.length < 16) {
            var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            id = "";
            for (var i = 0; i < 32; i++) { id += chars.charAt(Math.floor(Math.random() * chars.length)); }
            try { window.localStorage.setItem("stv:deviceid", id); } catch (e) { }
        }
        return id;
    }

    loadAuth();

    return {
        isLoggedIn: function () { return auth != null; },
        userId: function () { return auth ? auth.user_id : null; },
        login: function () { return auth ? auth.login : null; },
        displayName: function () { return auth ? (auth.display || auth.login) : null; },
        token: function () { return auth ? auth.access_token : null; },
        clientId: function () { return CLIENT_ID; },
        deviceId: deviceId,
        ensureToken: ensureToken,
        startDeviceLogin: startDeviceLogin,
        cancelLogin: stopPolling,
        logout: logout
    };
})();
