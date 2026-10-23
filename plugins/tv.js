/*
 * TV section for this Lampa fork — free Russian channels, live.
 * The channel list is iptv/ru.json, built by tools/iptv.py from the iptv-org
 * database with every stream checked from the TV's own network.
 * ES5: old webOS / Tizen browsers.
 *
 * One horizontal line per group, the federal channels first under their usual
 * numbers, and Favorites above everything once there are any (long-press a
 * card). A card opens Lampa's IPTV player over the whole list, so the remote's
 * channel keys and digits zap the way they do on live TV.
 *
 * window.LampaTV.play(idOrNumber) opens a channel directly — the hook for
 * starting a channel from outside the UI (e.g. a voice assistant).
 */
(function () {
    "use strict";

    var VERSION = "1.0.0";
    var LIST_URL = "iptv/ru.json";
    var FAV_KEY = "tv_favorites";
    /* Logos are on third-party hosts, ~300 of them: fetch a screenful per line,
       then a few ahead of the focused card. */
    var LOGOS_AHEAD = 8;
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M8 2.5l4 3.5 4-3.5"/></svg>';

    var list = null;

    function t(key) {
        return Lampa.Lang.translate(key);
    }

    /* ------------------------------------------------------------------ */
    /* Data                                                               */
    /* ------------------------------------------------------------------ */

    function load(callback) {
        if (list) { callback(null, list); return; }
        var req = new XMLHttpRequest();
        req.open("GET", LIST_URL + "?v=" + Math.floor(Date.now() / 9e5), true);
        req.timeout = 15000;
        req.onreadystatechange = function () {
            if (req.readyState !== 4) { return; }
            if (req.status < 200 || req.status >= 300) { callback("HTTP " + req.status); return; }
            try { list = JSON.parse(req.responseText); } catch (e) { callback("Invalid JSON"); return; }
            var titles = {};
            for (var g = 0; g < list.groups.length; g++) { titles[list.groups[g].id] = list.groups[g].title; }
            for (var i = 0; i < list.channels.length; i++) {
                list.channels[i].position = i;
                list.channels[i].group_title = titles[list.channels[i].group] || "";
            }
            callback(null, list);
        };
        req.ontimeout = function () { callback("Request timeout"); };
        req.onerror = function () { callback("Network error"); };
        req.send(null);
    }

    function find(key) {
        if (!list) { return null; }
        for (var i = 0; i < list.channels.length; i++) {
            var ch = list.channels[i];
            if (ch.id === key || (ch.number && ch.number === +key)) { return ch; }
        }
        return null;
    }

    function getFavorites() {
        var ids = [];
        try {
            ids = Lampa.Storage.get(FAV_KEY, []);
            if (typeof ids === "string") { ids = JSON.parse(ids); }
        } catch (e) { ids = []; }
        return Object.prototype.toString.call(ids) === "[object Array]" ? ids : [];
    }

    function toggleFavorite(id) {
        var ids = getFavorites();
        var at = ids.indexOf(id);
        if (at >= 0) { ids.splice(at, 1); } else { ids.push(id); }
        Lampa.Storage.set(FAV_KEY, ids);
        return at < 0;
    }

    /* ------------------------------------------------------------------ */
    /* Playback                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Many free streams are plain http. Old webOS/Tizen engines play those
     * inside this https page, but Chromium 81+ upgrades mixed-content video to
     * https and the stream then fails — so there, take an https one when the
     * channel has it. Android hands the URL to an external player, which
     * doesn't care.
     */
    function streamUrl(ch) {
        if (!ch.streams.length) { return ""; }
        var httpOk = location.protocol !== "https:" || Lampa.Platform.is("android") ||
            !Lampa.Platform.chromeVersion() || Lampa.Platform.chromeVersion() < 81;
        for (var i = 0; i < ch.streams.length; i++) {
            if (httpOk || ch.streams[i].url.indexOf("https:") === 0) { return ch.streams[i].url; }
        }
        return ch.streams[0].url;
    }

    function playerChannel(ch) {
        return {
            name: (ch.number ? ch.number + ". " : "") + ch.name,
            group: ch.group_title,
            logo: ch.logo || "",
            url: streamUrl(ch),
            tv_id: ch.id
        };
    }

    function play(ch) {
        /* Federal channels with no working stream are kept in the list so the
           numbers line up with the remote's digits; they just can't start it. */
        if (!ch.streams.length) {
            Lampa.Noty.show(ch.name + ": " + t("tv_no_stream"));
            return;
        }
        var channels = list.channels;
        Lampa.Player.iptv({
            title: ch.name,
            url: streamUrl(ch),
            tv: true,
            /* Free servers rarely send CORS headers, which hls.js needs and the
               TV's own HLS player doesn't. */
            hls_type: "native",
            position: ch.position,
            total: channels.length,
            onGetChannel: function (position) {
                return playerChannel(channels[position]);
            },
            onGetProgram: function (channel, position, container) {
                container.empty().append($('<div class="player-panel-iptv-item__prog-load"></div>').text(t("tv_no_program")));
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                              */
    /* ------------------------------------------------------------------ */

    function channelCard(ch) {
        var html = $('<div class="card selector layer--visible tv-card">' +
            '<div class="card__view">' +
                '<img class="tv-card__logo" alt="">' +
                '<div class="tv-card__text"></div>' +
            '</div>' +
            '<div class="card__title"></div>' +
        '</div>');

        html.find(".card__title").text(ch.name);
        html.find(".tv-card__text").text(ch.name);
        if (!ch.streams.length) {
            html.addClass("tv-card--off");
            html.find(".card__view").append($('<div class="tv-card__off"></div>').text(t("tv_no_stream")));
        }
        if (ch.number) {
            html.find(".card__view").append($('<div class="tv-card__number"></div>').text(ch.number));
        }

        var img = html.find(".tv-card__logo");
        var requested = false;
        img.on("load", function () { html.addClass("tv-card--logo"); });
        img.on("error", function () { img.remove(); });
        html.loadLogo = function () {
            if (requested || !ch.logo) { return; }
            requested = true;
            img.attr("src", ch.logo);
        };

        html.on("hover:enter", function () { play(ch); });
        html.on("hover:long", function () {
            Lampa.Noty.show(toggleFavorite(ch.id) ? t("tv_fav_added") : t("tv_fav_removed"));
        });
        return html;
    }

    function emptyCard(text) {
        var html = $('<div class="card selector layer--visible tv-card tv-card--empty">' +
            '<div class="card__view"><div class="tv-card__text"></div></div>' +
        '</div>');
        html.find(".tv-card__text").text(text);
        return html;
    }

    /* ------------------------------------------------------------------ */
    /* Horizontal line (one per group)                                    */
    /* ------------------------------------------------------------------ */

    function Line(data) {
        var content = Lampa.Template.get("items_line", { title: data.title });
        var body = content.find(".items-line__body");
        var scroll = new Lampa.Scroll({ horizontal: true, step: 300 });
        var items = [];
        var last;

        this.create = function () {
            scroll.render().find(".scroll__body").addClass("items-cards");
            content.find(".items-line__title").text(data.title);
            for (var i = 0; i < data.cards.length; i++) { this.append(data.cards[i]); }
            body.append(scroll.render());
        };

        this.append = function (card) {
            var index = items.length;
            card.on("hover:focus", function () {
                last = card[0];
                scroll.update(card, true);
                for (var k = index; k <= index + LOGOS_AHEAD && k < items.length; k++) {
                    if (items[k].loadLogo) { items[k].loadLogo(); }
                }
            });
            if (index < LOGOS_AHEAD && card.loadLogo) { card.loadLogo(); }
            scroll.append(card);
            items.push(card);
        };

        this.toggle = function () {
            Lampa.Controller.add("tv_line", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                right: function () {
                    Navigator.move("right");
                    Lampa.Controller.enable("tv_line");
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                down: this.onDown,
                up: this.onUp,
                back: this.onBack
            });
            Lampa.Controller.toggle("tv_line");
        };

        this.render = function () { return content; };

        this.destroy = function () {
            scroll.destroy();
            content.remove();
            items = null;
        };
    }

    /* ------------------------------------------------------------------ */
    /* Main component                                                     */
    /* ------------------------------------------------------------------ */

    function Main() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var items = [];
        var html = $('<div class="tv-main"></div>');
        var active = 0;

        this.create = function () {
            var self = this;
            this.activity.loader(true);
            scroll.minus();
            html.append(scroll.render());
            load(function (err, data) {
                if (err || !data.channels.length) { self.empty(t("tv_no_list")); return; }
                self.build(data);
            });
            return this.render();
        };

        this.appendLine = function (data) {
            if (!data || !data.cards || !data.cards.length) { return; }
            var item = new Line(data);
            item.create();
            item.onDown = this.down.bind(this);
            item.onUp = this.up.bind(this);
            item.onBack = this.back.bind(this);
            scroll.append(item.render());
            items.push(item);
        };

        this.build = function (data) {
            var favs = getFavorites();
            var favCards = [];
            for (var f = 0; f < favs.length; f++) {
                var fav = find(favs[f]);
                if (fav) { favCards.push(channelCard(fav)); }
            }
            this.appendLine({ title: t("tv_favorites"), cards: favCards });

            for (var g = 0; g < data.groups.length; g++) {
                var cards = [];
                for (var i = 0; i < data.channels.length; i++) {
                    if (data.channels[i].group === data.groups[g].id) { cards.push(channelCard(data.channels[i])); }
                }
                this.appendLine({ title: data.groups[g].title, cards: cards.length ? cards : [emptyCard(t("tv_no_list"))] });
            }

            this.activity.loader(false);
            this.activity.toggle();
        };

        this.empty = function (text) {
            var em = Lampa.Template.get("empty", { title: t("tv"), descr: text });
            html.append(em);
            this.start = function () {
                Lampa.Controller.add("content", {
                    toggle: function () { Lampa.Controller.collectionSet(html); },
                    left: function () { Lampa.Controller.toggle("menu"); },
                    back: this.back
                });
                Lampa.Controller.toggle("content");
            };
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.down = function () {
            active++;
            active = Math.min(active, items.length - 1);
            items[active].toggle();
            scroll.update(items[active].render());
        };

        this.up = function () {
            active--;
            if (active < 0) {
                active = 0;
                Lampa.Controller.toggle("head");
            } else {
                items[active].toggle();
                scroll.update(items[active].render());
            }
        };

        this.back = function () { Lampa.Activity.backward(); };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) { return; }
            Lampa.Controller.add("content", {
                toggle: function () {
                    if (items.length) { items[active].toggle(); }
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                back: this.back
            });
            Lampa.Controller.toggle("content");
        };

        this.render = function () { return html; };

        this.destroy = function () {
            for (var i = 0; i < items.length; i++) { items[i].destroy(); }
            scroll.destroy();
            html.remove();
            items = [];
        };
    }

    /* ------------------------------------------------------------------ */
    /* Wiring                                                             */
    /* ------------------------------------------------------------------ */

    function addLang() {
        Lampa.Lang.add({
            tv: { ru: "ТВ", en: "TV", uk: "ТБ" },
            tv_favorites: { ru: "Избранное", en: "Favorites", uk: "Обране" },
            tv_fav_added: {
                ru: "Добавлено в избранное ТВ",
                en: "Added to TV favorites",
                uk: "Додано до обраного ТБ"
            },
            tv_fav_removed: {
                ru: "Удалено из избранного ТВ",
                en: "Removed from TV favorites",
                uk: "Видалено з обраного ТБ"
            },
            tv_no_list: {
                ru: "Список каналов недоступен",
                en: "Channel list is not available",
                uk: "Список каналів недоступний"
            },
            tv_not_found: { ru: "Канал не найден", en: "Channel not found", uk: "Канал не знайдено" },
            tv_no_stream: { ru: "нет трансляции", en: "no stream", uk: "немає трансляції" },
            tv_no_program: { ru: "Нет программы передач", en: "No TV guide", uk: "Немає програми передач" }
        });
    }

    function openTv() {
        Lampa.Activity.push({ url: "", title: t("tv"), component: "tv_live", page: 1 });
    }

    /* Same reason as in plugins/baseball.js: Lampa's menu Editor re-applies the
       saved order and would push an unknown label to the end. */
    function pinMenuOrder(label, afterLabel) {
        try {
            var sort = Lampa.Storage.get("menu_sort", "[]");
            if (!sort || !sort.length) { return; }
            var at = sort.indexOf(label);
            if (at >= 0) { sort.splice(at, 1); }
            var after = afterLabel ? sort.indexOf(afterLabel) : -1;
            sort.splice(after >= 0 ? after + 1 : 0, 0, label);
            Lampa.Storage.set("menu_sort", sort);
        } catch (e) { }
    }

    function addMenu() {
        /* Not data-action="tv": Lampa's own "Series" item already uses that. */
        var button = $('<li class="menu__item selector" data-action="tv_live"><div class="menu__ico">' + ICON + '</div><div class="menu__text">' + t("tv") + "</div></li>");
        button.on("hover:enter", openTv);

        function place() {
            var menu = $(".menu .menu__list").eq(0);
            /* Below the other live sections: Baseball, else Kick, else Twitch. */
            var above = menu.find('[data-action="baseball"]');
            if (!above.length) { above = menu.find('[data-action="kick"]'); }
            if (!above.length) { above = menu.find('[data-action="twitch"]'); }
            if (above.length) { above.after(button); }
            else { menu.prepend(button); }
            var label = above.length ? above.find(".menu__text").text().trim() : null;
            pinMenuOrder(t("tv"), label);
        }
        place();
        /* After Baseball's own re-assert at 1800ms, so we stay below it. */
        setTimeout(place, 1950);
    }

    function startPlugin() {
        if (window.plugin_tv_ready) { return; }
        window.plugin_tv_ready = true;

        addLang();
        Lampa.Component.add("tv_live", Main);

        window.LampaTV = {
            version: VERSION,
            play: function (key) {
                load(function (err) {
                    var ch = err ? null : find(key);
                    if (ch) { play(ch); }
                    else { Lampa.Noty.show(t(err ? "tv_no_list" : "tv_not_found")); }
                });
            }
        };

        if (window.appready) { addMenu(); }
        else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { addMenu(); }
            });
        }
    }

    if (!window.plugin_tv_ready) { startPlugin(); }
})();
