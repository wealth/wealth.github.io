/*
 * Baseball section for this Lampa fork — free live games, grouped by league.
 * Uses js/soop.js (SOOP API via worker/soop-proxy.js).
 * ES5: old webOS / Tizen browsers.
 *
 * Only KBO is wired up, because it is the only league we found streaming live
 * games free worldwide (SOOP holds the global rights through 2026). The layout
 * is one horizontal line per league, so adding a league is a matter of adding
 * it to SOOP.LEAGUES — nothing here needs to change.
 */
(function () {
    "use strict";

    var VERSION = "1.0.0";
    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.2"/><path d="M5.2 5.4c2.6 2 4.2 4.9 4.5 8.1.2 2.3-.3 4.1-.9 5.6"/><path d="M18.8 5.4c-2.6 2-4.2 4.9-4.5 8.1-.2 2.3.3 4.1.9 5.6"/></svg>';

    function t(key) {
        return Lampa.Lang.translate(key);
    }

    /* ------------------------------------------------------------------ */
    /* Playback                                                           */
    /* ------------------------------------------------------------------ */

    function playGame(game, league) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        SOOP.streamUrl(game, "original", function (err, url) {
            Lampa.Loading.stop();
            if (err || !url) {
                Lampa.Noty.show(err || t("baseball_unavailable"));
                return;
            }
            var item = {
                title: (league ? league.name + " · " : "") + game.title,
                url: url,
                tv: true,
                soop_bid: game.bid
            };
            Lampa.Player.play(item);
            Lampa.Player.playlist([item]);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                              */
    /* ------------------------------------------------------------------ */

    function gameCard(game, league) {
        var html = $('<div class="card selector layer--visible baseball-card">' +
            '<div class="card__view">' +
                '<img class="card__img" src="./img/img_load.svg" alt="">' +
                '<div class="baseball-card__live">LIVE</div>' +
            '</div>' +
            '<div class="card__title"></div>' +
            '<div class="baseball-card__meta"></div>' +
        '</div>');

        html.find(".card__title").text(game.title);

        var meta = [];
        if (game.resolution) { meta.push(game.resolution.split("x")[1] + "p"); }
        if (game.subtitles) { meta.push(t("baseball_subtitles")); }
        html.find(".baseball-card__meta").text(meta.join(" · "));

        var img = html.find(".card__img");
        img.on("error", function () { img.attr("src", "./img/img_broken.svg"); });
        img.attr("src", SOOP.thumb(game.bno));

        html.on("hover:enter", function () { playGame(game, league); });
        return html;
    }

    function emptyCard(text) {
        var html = $('<div class="card selector layer--visible baseball-card baseball-card--empty">' +
            '<div class="card__view"><div class="baseball-card__note"></div></div>' +
        '</div>');
        html.find(".baseball-card__note").text(text);
        return html;
    }

    /* ------------------------------------------------------------------ */
    /* Horizontal line (one per league)                                   */
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
            card.on("hover:focus", function () {
                last = card[0];
                scroll.update(card, true);
            });
            scroll.append(card);
            items.push(card);
        };

        this.toggle = function () {
            var self = this;
            Lampa.Controller.add("baseball_line", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                right: function () {
                    Navigator.move("right");
                    Lampa.Controller.enable("baseball_line");
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                down: this.onDown,
                up: this.onUp,
                back: this.onBack
            });
            Lampa.Controller.toggle("baseball_line");
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
        var html = $('<div class="baseball-main"></div>');
        var active = 0;

        this.create = function () {
            this.activity.loader(true);
            scroll.minus();
            html.append(scroll.render());
            this.load();
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

        this.load = function () {
            var self = this;
            SOOP.allGames(function (err, groups) {
                if (err) {
                    self.activity.loader(false);
                    /* Almost always the Worker: the SOOP API is origin-locked,
                       so without the proxy every call fails at the browser. */
                    self.empty(t("baseball_no_proxy"));
                    return;
                }
                var any = false;
                for (var i = 0; i < groups.length; i++) {
                    var g = groups[i];
                    var title = (g.league.country ? g.league.country + " " : "") + g.league.name;
                    if (g.games.length) {
                        any = true;
                        var cards = [];
                        for (var k = 0; k < g.games.length; k++) {
                            cards.push(gameCard(g.games[k], g.league));
                        }
                        self.appendLine({ title: title, cards: cards });
                    } else {
                        self.appendLine({ title: title, cards: [emptyCard(t("baseball_none_live"))] });
                    }
                }
                self.activity.loader(false);
                if (!any) { self.activity.toggle(); }
                else { self.activity.toggle(); }
            });
        };

        this.empty = function (text) {
            var em = Lampa.Template.get("empty", { desc: text || t("baseball_none_live") });
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
            baseball: { ru: "Бейсбол", en: "Baseball", uk: "Бейсбол" },
            baseball_none_live: {
                ru: "Сейчас нет прямых трансляций",
                en: "No games live right now",
                uk: "Зараз немає прямих трансляцій"
            },
            baseball_unavailable: {
                ru: "Трансляция недоступна",
                en: "Stream is not available",
                uk: "Трансляція недоступна"
            },
            baseball_subtitles: { ru: "субтитры", en: "subtitles", uk: "субтитри" },
            baseball_no_proxy: {
                ru: "Нет связи с SOOP. Проверьте, что worker/soop-proxy.js развёрнут.",
                en: "Can't reach SOOP. Check that worker/soop-proxy.js is deployed.",
                uk: "Немає зв'язку з SOOP. Перевірте, що worker/soop-proxy.js розгорнуто."
            }
        });
    }

    function openBaseball() {
        Lampa.Activity.push({ url: "", title: t("baseball"), component: "baseball", page: 1 });
    }

    /*
     * Lampa's menu Editor keeps the sidebar order in Storage 'menu_sort' and
     * re-applies it ~500ms after the menu changes, pushing labels it has not
     * seen onto the END. A DOM insert alone is therefore undone on any profile
     * with a saved order, so write ourselves into that list as well — directly
     * below Twitch, matching where we put the element.
     */
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
        var button = $('<li class="menu__item selector" data-action="baseball"><div class="menu__ico">' + ICON + '</div><div class="menu__text">' + t("baseball") + "</div></li>");
        button.on("hover:enter", openBaseball);

        function place() {
            var list = $(".menu .menu__list").eq(0);
            /* Sit directly under Twitch when it is present, else lead the list. */
            var twitch = list.find('[data-action="twitch"]');
            if (twitch.length) { twitch.after(button); }
            else { list.prepend(button); }
            /* Anchor by the Twitch entry's own label so this works in any UI language. */
            var label = twitch.length ? twitch.find(".menu__text").text().trim() : null;
            pinMenuOrder(t("baseball"), label);
        }
        place();
        /* Runs after the Twitch plugin's own re-assert (1500ms) so we stay below it. */
        setTimeout(place, 1800);
    }

    function startPlugin() {
        if (window.plugin_baseball_ready) { return; }
        window.plugin_baseball_ready = true;

        if (typeof SOOP === "undefined") {
            console.log("Baseball plugin", "js/soop.js is not loaded");
            return;
        }

        addLang();
        Lampa.Component.add("baseball", Main);

        if (window.appready) { addMenu(); }
        else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { addMenu(); }
            });
        }
    }

    if (!window.plugin_baseball_ready) { startPlugin(); }
})();
