/*
 * Remote control for this Lampa fork: lets something outside the TV — Home
 * Assistant behind a voice assistant, say — start a TV channel or a Twitch
 * stream on this device. ES5: old webOS / Tizen browsers.
 *
 * Off by default, per device. Settings → Пульт turns it on and shows the
 * device's code: random, generated here, never in this repo. The device then
 * listens on the ntfy.sh topic named after that code and acts only on what is
 * published there, so a command meant for one TV never reaches another device
 * running this fork. Anyone who learns the code can switch channels on that
 * TV and nothing else; "new code" in the same menu revokes it.
 *
 * Message body (JSON), published to https://ntfy.sh/<topic>:
 *   {"action":"tv","value":1}            -> LampaTV.play(1)       (plugins/tv.js)
 *   {"action":"twitch","value":"login"}  -> LampaTwitch.play(...) (plugins/twitch.js)
 *
 * On connect we ask ntfy for the last MAX_AGE seconds. That is what makes
 * "switch the TV on, open Lampa, play channel 1" work: the command is sent
 * while the app is still loading and picked up once it connects. Handled
 * messages are remembered, so a reload inside that window doesn't replay one.
 */
(function () {
    "use strict";

    var VERSION = "1.0.0";
    var SERVER = "https://ntfy.sh";
    var MAX_AGE = 120;
    var KEY_ON = "remote_enabled";
    var KEY_CODE = "remote_code";
    var KEY_LAST = "remote_last";
    /* No 0/O or 1/I: the code gets read off a TV screen. */
    var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var CODE_LENGTH = 12;
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="2.5" width="10" height="19" rx="3"/><circle cx="12" cy="7.5" r="1.6"/><path d="M10 12.5h4M10 15.5h4"/></svg>';

    /* Lampa opens its start page just after "app ready"; a player started
       before that is torn down by it (and trips a player listener that
       expects an active page). Hold early commands back until then. */
    var SETTLE_MS = 2500;

    var source = null;
    var retryTimer = null;
    var retryDelay = 2000;
    var seen = {};
    var readyAt = 0;

    function t(key) {
        return Lampa.Lang.translate(key);
    }

    /* ------------------------------------------------------------------ */
    /* Device code                                                        */
    /* ------------------------------------------------------------------ */

    function generate() {
        var out = "";
        var bytes = null;
        try {
            bytes = new Uint8Array(CODE_LENGTH);
            window.crypto.getRandomValues(bytes);
        } catch (e) { bytes = null; }
        for (var i = 0; i < CODE_LENGTH; i++) {
            var n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
            out += ALPHABET.charAt(n % ALPHABET.length);
        }
        return out;
    }

    function getCode() {
        var code = String(Lampa.Storage.get(KEY_CODE, "") || "");
        if (!code) {
            code = generate();
            Lampa.Storage.set(KEY_CODE, code);
        }
        return code;
    }

    function pretty(code) {
        return code.replace(/(.{4})(?=.)/g, "$1-");
    }

    function topic() {
        return "lampa-" + getCode().toLowerCase();
    }

    function enabled() {
        return String(Lampa.Storage.get(KEY_ON, "off")) === "on";
    }

    /* ------------------------------------------------------------------ */
    /* Commands                                                           */
    /* ------------------------------------------------------------------ */

    function run(cmd) {
        var wait = readyAt + SETTLE_MS - Date.now();
        if (wait > 0) {
            setTimeout(function () { run(cmd); }, wait);
            return;
        }
        function go() {
            if (cmd.action === "tv" && window.LampaTV) { window.LampaTV.play(cmd.value); }
            else if (cmd.action === "twitch" && window.LampaTwitch) { window.LampaTwitch.play(cmd.value); }
        }
        /* The player only hosts one thing at a time; close it first, or the
           new stream starts under the old one's controls. */
        if (Lampa.Player.opened()) {
            Lampa.Player.close();
            setTimeout(go, 400);
        } else {
            go();
        }
    }

    /* ntfy ids are random, so "already handled" is decided by server time
       first and id second. */
    function isNew(msg) {
        var last = String(Lampa.Storage.get(KEY_LAST, "") || "").split(":");
        var lastTime = +last[0] || 0;
        return msg.time > lastTime || (msg.time === lastTime && msg.id !== last[1]);
    }

    function onMessage(e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (x) { return; }
        if (!msg || msg.event !== "message" || seen[msg.id]) { return; }
        seen[msg.id] = true;
        if (!isNew(msg)) { return; }
        Lampa.Storage.set(KEY_LAST, msg.time + ":" + msg.id);

        var cmd;
        try { cmd = JSON.parse(msg.message); } catch (x) { return; }
        if (cmd && cmd.action) { run(cmd); }
    }

    /* ------------------------------------------------------------------ */
    /* Connection                                                         */
    /* ------------------------------------------------------------------ */

    function stop() {
        clearTimeout(retryTimer);
        retryTimer = null;
        if (source) {
            source.close();
            source = null;
        }
    }

    /* EventSource reconnects by itself after a dropped connection, re-asking
       for the same window (duplicates are filtered in onMessage). It gives up
       on an HTTP error, though, so that case is retried here with backoff. */
    function start() {
        stop();
        if (!enabled() || typeof EventSource === "undefined") { return; }
        source = new EventSource(SERVER + "/" + topic() + "/sse?since=" + MAX_AGE + "s");
        source.onopen = function () { retryDelay = 2000; };
        source.onmessage = onMessage;
        source.onerror = function () {
            if (source && source.readyState === 2) {
                stop();
                retryTimer = setTimeout(start, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 60000);
            }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Settings                                                           */
    /* ------------------------------------------------------------------ */

    function addLang() {
        Lampa.Lang.add({
            remote: { ru: "Пульт", en: "Remote control", uk: "Пульт" },
            remote_enabled: { ru: "Удалённое управление", en: "Remote control", uk: "Віддалене керування" },
            remote_enabled_hint: {
                ru: "Разрешить Home Assistant включать на этом устройстве ТВ-каналы и Twitch",
                en: "Let Home Assistant start TV channels and Twitch on this device",
                uk: "Дозволити Home Assistant вмикати на цьому пристрої ТБ-канали та Twitch"
            },
            remote_code: { ru: "Код устройства", en: "Device code", uk: "Код пристрою" },
            remote_code_hint: {
                ru: "Укажите его в Home Assistant. Другие устройства с Lampa его не знают.",
                en: "Enter it in Home Assistant. Other Lampa devices don't know it.",
                uk: "Вкажіть його в Home Assistant. Інші пристрої з Lampa його не знають."
            },
            remote_new_code: { ru: "Сменить код", en: "New code", uk: "Змінити код" },
            remote_new_code_hint: {
                ru: "Старый код перестанет работать",
                en: "The old code stops working",
                uk: "Старий код перестане працювати"
            }
        });
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: "remote",
            icon: ICON,
            name: t("remote")
        });
        Lampa.SettingsApi.addParam({
            component: "remote",
            param: { name: KEY_ON, type: "select", values: { on: t("settings_param_yes") || "On", off: t("settings_param_no") || "Off" }, default: "off" },
            field: { name: t("remote_enabled"), description: t("remote_enabled_hint") }
        });
        Lampa.SettingsApi.addParam({
            component: "remote",
            param: { type: "button" },
            field: { name: t("remote_code"), description: t("remote_code_hint") },
            onRender: function (item) {
                item.find(".settings-param__name").text(t("remote_code") + ": " + pretty(getCode()));
            },
            onChange: function () {
                Lampa.Noty.show(t("remote_code") + ": " + pretty(getCode()));
            }
        });
        Lampa.SettingsApi.addParam({
            component: "remote",
            param: { type: "button" },
            field: { name: t("remote_new_code"), description: t("remote_new_code_hint") },
            onChange: function () {
                Lampa.Storage.set(KEY_CODE, generate());
                Lampa.Storage.set(KEY_LAST, "");
                start();
                Lampa.Noty.show(t("remote_code") + ": " + pretty(getCode()));
            }
        });
    }

    function startPlugin() {
        if (window.plugin_remote_ready) { return; }
        window.plugin_remote_ready = true;

        addLang();
        addSettings();
        Lampa.Storage.listener.follow("change", function (e) {
            if (e.name === KEY_ON) { start(); }
        });

        window.LampaRemote = { version: VERSION, topic: topic, restart: start };

        if (window.appready) {
            /* Loaded late (the plugin chain can finish after "ready"): the start
               page may still be on its way, so keep the settle window. */
            readyAt = Date.now();
            start();
        } else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") {
                    readyAt = Date.now();
                    start();
                }
            });
        }
    }

    if (!window.plugin_remote_ready) { startPlugin(); }
})();
