/*
 * Baseball section for this Lampa fork — free live games, grouped by league.
 * Uses js/soop.js (SOOP API via worker/soop-proxy.js).
 * ES5: old webOS / Tizen browsers.
 *
 * Only KBO is wired up, because it is the only league we found streaming live
 * games free worldwide (SOOP holds the global rights through 2026). The layout
 * is one horizontal line per league, so adding a league is a matter of adding
 * it to SOOP.LEAGUES — nothing here needs to change.
 *
 * Below the live line come the replays — every finished game, in full, newest
 * first — and then the fixture list, one line per day, so the tab still answers
 * "when is the next game" on a rest day. All times are rendered in the viewer's
 * own timezone: KBO's 18:30 first pitch is Korean wall clock, which is a
 * different hour — sometimes a different day — everywhere else.
 */
(function () {
    "use strict";

    var VERSION = "1.2.0";

    /* Days of fixtures to show, today included. */
    var SCHEDULE_DAYS = 7;
    /* Replays on the main page; the rest is behind "More", a screenful a time. */
    var REPLAY_CARDS = 10;
    var REPLAY_PAGE = 20;
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

    /*
     * A finished game. Not "tv": it has a length, so it gets the timeline, and
     * with four hours of it Lampa's own resume — it remembers where the viewer
     * stopped and offers to continue — is most of what makes a replay usable.
     */
    function playReplay(replay) {
        var cancelled = false;
        Lampa.Loading.start(function () { cancelled = true; Lampa.Loading.stop(); });
        SOOP.replayFiles(replay.id, function (err, files) {
            if (cancelled) { return; }
            Lampa.Loading.stop();
            if (err || !files.length) {
                /* A Worker deployed before /vod existed answers 404 — say that
                   rather than "not available". */
                Lampa.Noty.show(String(err).indexOf("404") >= 0 ? t("baseball_replay_worker") : (err || t("baseball_unavailable")));
                return;
            }
            var list = [];
            for (var i = 0; i < files.length; i++) {
                var item = {
                    title: replayTitle(replay) + " · " + dayTitle(replay.start) +
                        (files.length > 1 ? " · " + (i + 1) + "/" + files.length : ""),
                    url: files[i].url,
                    timeline: Lampa.Timeline.view(Lampa.Utils.hash("soop_vod_" + replay.id + "_" + i))
                };
                if (files[i].quality) { item.quality = files[i].quality; }
                list.push(item);
            }
            Lampa.Player.play(list[0]);
            Lampa.Player.playlist(list);
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

    /* ------------------------------------------------------------------ */
    /* Schedule cards                                                     */
    /* ------------------------------------------------------------------ */

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    /* Local calendar day, as a string that sorts and compares by value. */
    function dayKey(date) {
        return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    }

    /* "Today" / "Tomorrow" / "Yesterday" / "Fri, 5 Sep", in the UI language. */
    function dayTitle(date) {
        var now = new Date();
        var from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var to = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var diff = Math.round((to.getTime() - from.getTime()) / 86400000);
        if (diff === 0) { return t("baseball_today"); }
        if (diff === 1) { return t("baseball_tomorrow"); }
        if (diff === -1) { return t("baseball_yesterday"); }
        var parsed = Lampa.Utils.parseTime(date);
        return parsed.week + ", " + parsed["short"];
    }

    function localTime(date) {
        return Lampa.Utils.parseTime(date).time;
    }

    function leagueTitle(league) {
        return (league.country ? league.country + " " : "") + league.name;
    }

    /* Emblems are plain images off Naver's CDN; hide one that fails rather than
       removing it, so the two sides of the card stay balanced. */
    function setLogo(img, url) {
        if (!url) { img.css("visibility", "hidden"); return; }
        img.on("error", function () { img.css("visibility", "hidden"); });
        img.attr("src", url);
    }

    function scheduleCard(game) {
        var html = $('<div class="card selector layer--visible baseball-card baseball-sched">' +
            '<div class="card__view">' +
                '<div class="baseball-sched__teams">' +
                    '<img class="baseball-sched__logo" src="" alt="">' +
                    '<div class="baseball-sched__score"></div>' +
                    '<img class="baseball-sched__logo" src="" alt="">' +
                '</div>' +
            '</div>' +
            '<div class="card__title"></div>' +
            '<div class="baseball-card__meta"></div>' +
        '</div>');

        var logos = html.find(".baseball-sched__logo");
        setLogo(logos.eq(0), game.awayLogo);
        setLogo(logos.eq(1), game.homeLogo);

        /* The middle of the card carries whichever number matters: the score
           once there is one, otherwise the start time, which is the whole
           reason to look at a fixture list. */
        var score = game.awayScore + " : " + game.homeScore;
        html.find(".baseball-sched__score").text(game.scored ? score : localTime(game.start));
        html.find(".card__title").text(game.away + " — " + game.home);
        html.find(".baseball-card__meta").text(game.scored ? localTime(game.start) : "");

        var tag = null;
        if (game.state === "live") { tag = { text: "LIVE", cls: "baseball-card__tag--live" }; }
        else if (game.state === "final") { tag = { text: t("baseball_final"), cls: "baseball-card__tag--muted" }; }
        else if (game.state === "cancelled") { tag = { text: t("baseball_cancelled"), cls: "baseball-card__tag--muted" }; }
        if (tag) {
            html.find(".card__view").append($('<div class="baseball-card__tag"></div>').addClass(tag.cls).text(tag.text));
        }

        /* Nothing to open for a fixture, so acknowledge the press with the one
           thing the card had to abbreviate: the full day, time and score. */
        html.on("hover:enter", function () {
            Lampa.Noty.show(game.away + " — " + game.home + " · " + dayTitle(game.start) +
                " " + localTime(game.start) + (game.scored ? " · " + score : ""));
        });
        return html;
    }

    function fmtDuration(sec) {
        return Math.floor(sec / 3600) + ":" + pad2(Math.floor((sec % 3600) / 60)) + ":" + pad2(sec % 60);
    }

    var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>';

    /* Named like the fixture cards when the teams are known. */
    function replayTitle(replay) {
        return replay.away ? replay.away + " — " + replay.home : replay.title;
    }

    /*
     * Drawn as a fixture card — the two emblems — with a play mark where the
     * fixture has its score. Deliberately no score here, though the schedule
     * knows it: the point of a replay is a game whose result you have not
     * seen. A game with no pairing to draw falls back to SOOP's thumbnail.
     */
    function replayCard(replay) {
        var html = $('<div class="card selector layer--visible baseball-card baseball-sched">' +
            '<div class="card__view"></div>' +
            '<div class="card__title"></div>' +
            '<div class="baseball-card__meta"></div>' +
        '</div>');
        var view = html.find(".card__view");

        if (replay.away) {
            view.append('<div class="baseball-sched__teams">' +
                '<img class="baseball-sched__logo" src="" alt="">' +
                '<div class="baseball-sched__score baseball-sched__play">' + PLAY_ICON + '</div>' +
                '<img class="baseball-sched__logo" src="" alt="">' +
            '</div>');
            var logos = view.find(".baseball-sched__logo");
            setLogo(logos.eq(0), replay.awayLogo);
            setLogo(logos.eq(1), replay.homeLogo);
        } else {
            var img = $('<img class="card__img" src="./img/img_load.svg" alt="">');
            img.on("error", function () { img.attr("src", "./img/img_broken.svg"); });
            if (replay.thumb) { img.attr("src", replay.thumb); }
            view.append(img);
        }

        html.find(".card__title").text(replayTitle(replay));
        html.find(".baseball-card__meta").text(dayTitle(replay.start) + " · " + fmtDuration(replay.duration));
        html.on("hover:enter", function () { playReplay(replay); });
        return html;
    }

    function moreCard(onEnter) {
        var html = $('<div class="card selector layer--visible baseball-card baseball-card--more">' +
            '<div class="card__view"><div class="baseball-card__label"></div></div>' +
            '<div class="card__title"></div>' +
        '</div>');
        html.find(".baseball-card__label").text(t("baseball_more"));
        html.find(".card__title").text(t("baseball_more"));
        html.on("hover:enter", onEnter);
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

        /* Live state and the fixture list are independent upstreams behind the
           same Worker, and the replay list is read from SOOP directly, so fetch
           all three at once and let any one fail alone. */
        this.load = function () {
            var self = this;
            var pending = 3;
            var live = { err: null, groups: null };
            var sched = { err: null, games: null };
            var replays = { err: null, page: null };

            function done() {
                if (--pending > 0) { return; }
                self.build(live, sched, replays);
            }
            SOOP.allGames(function (err, groups) { live.err = err; live.groups = groups; done(); });
            SOOP.kboSchedule(SCHEDULE_DAYS, function (err, games) { sched.err = err; sched.games = games; done(); });
            SOOP.replayFeed().next(REPLAY_CARDS, function (err, page) { replays.err = err; replays.page = page; done(); });
        };

        this.build = function (live, sched, replays) {
            /* Neither half answered: that is the Worker itself, not one feed.
               The SOOP API is origin-locked, so without the proxy every call
               fails at the browser. */
            if (live.err && sched.err) {
                this.empty(t("baseball_no_proxy"));
                return;
            }

            if (live.err) {
                this.appendLine({
                    title: leagueTitle(SOOP.LEAGUES[0]) + " · " + t("baseball_live_now"),
                    cards: [emptyCard(t("baseball_no_proxy"))]
                });
            } else {
                for (var i = 0; i < live.groups.length; i++) {
                    var g = live.groups[i];
                    var cards = [];
                    for (var k = 0; k < g.games.length; k++) {
                        cards.push(gameCard(g.games[k], g.league));
                    }
                    this.appendLine({
                        title: leagueTitle(g.league) + " · " + t("baseball_live_now"),
                        cards: cards.length ? cards : [emptyCard(t("baseball_none_live"))]
                    });
                }
            }

            /* Above the fixture list: these are something to watch, the list is
               something to read. */
            if (replays.err || !replays.page.items.length) {
                this.appendLine({ title: t("baseball_replays"), cards: [emptyCard(t("baseball_no_replays"))] });
            } else {
                var recent = [];
                for (var r = 0; r < replays.page.items.length; r++) { recent.push(replayCard(replays.page.items[r])); }
                if (replays.page.hasNext) { recent.push(moreCard(openReplays)); }
                this.appendLine({ title: t("baseball_replays"), cards: recent });
            }

            if (sched.err) {
                /* A Worker deployed before /schedule existed answers 404 — say
                   that rather than blaming the network. */
                var msg = String(sched.err).indexOf("404") >= 0 ? t("baseball_schedule_worker") : t("baseball_no_schedule");
                this.appendLine({ title: t("baseball_schedule"), cards: [emptyCard(msg)] });
            } else if (!sched.games.length) {
                this.appendLine({ title: t("baseball_schedule"), cards: [emptyCard(t("baseball_no_games"))] });
            } else {
                this.appendSchedule(sched.games);
            }

            this.activity.loader(false);
            this.activity.toggle();
        };

        /* One line per calendar day, today first. The window from the API is
           padded either side of the local one, so drop anything already past. */
        this.appendSchedule = function (games) {
            var today = dayKey(new Date());
            var order = [];
            var byDay = {};

            for (var i = 0; i < games.length; i++) {
                var key = dayKey(games[i].start);
                if (key < today) { continue; }
                if (!byDay[key]) { byDay[key] = []; order.push(key); }
                byDay[key].push(games[i]);
            }

            for (var d = 0; d < order.length && d < SCHEDULE_DAYS; d++) {
                var list = byDay[order[d]];
                var cards = [];
                for (var k = 0; k < list.length; k++) { cards.push(scheduleCard(list[k])); }
                this.appendLine({ title: dayTitle(list[0].start), cards: cards });
            }
        };

        this.empty = function (text) {
            /* Lampa's empty template fills {title} and {descr} -- passing "desc"
               left the literal "{descr}" on screen. */
            var em = Lampa.Template.get("empty", {
                title: t("baseball"),
                descr: text || t("baseball_none_live")
            });
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
    /* Replays — the full archive, as a grid                              */
    /* ------------------------------------------------------------------ */

    function Replays() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var grid = $('<div class="baseball-grid category-full"></div>');
        var feed = SOOP.replayFeed();
        var hasNext = false;
        var loading = false;
        var last;

        this.create = function () {
            this.activity.loader(true);
            scroll.minus();
            scroll.append(grid);
            html.append(scroll.render());
            this.fetch(true);
            return this.render();
        };

        this.fetch = function (first) {
            var self = this;
            if (loading) { return; }
            loading = true;
            feed.next(REPLAY_PAGE, function (err, page) {
                loading = false;
                if (first) { self.activity.loader(false); }
                if (err || (first && !page.items.length)) {
                    if (first) {
                        var empty = new Lampa.Empty({ title: t("baseball_replays"), descr: t("baseball_no_replays") });
                        html.empty().append(empty.render());
                        self.start = empty.start.bind(empty);
                    } else {
                        Lampa.Noty.show(err);
                    }
                    self.activity.toggle();
                    return;
                }
                for (var i = 0; i < page.items.length; i++) { self.appendCard(replayCard(page.items[i])); }
                hasNext = page.hasNext;
                if (Lampa.Layer) {
                    Lampa.Layer.update(html);
                    Lampa.Layer.visible(html);
                }
                self.activity.toggle();
            });
        };

        this.appendCard = function (card) {
            card.on("hover:focus", function () {
                last = card[0];
                scroll.update(card, true);
            });
            grid.append(card);
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) { return; }
            var self = this;
            Lampa.Controller.add("content", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                right: function () { Navigator.move("right"); },
                up: function () {
                    if (Navigator.canmove("up")) { Navigator.move("up"); }
                    else { Lampa.Controller.toggle("head"); }
                },
                down: function () {
                    if (Navigator.canmove("down")) { Navigator.move("down"); }
                    else if (hasNext) { self.fetch(false); }
                },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle("content");
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            scroll.destroy();
            html.remove();
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
            baseball_live_now: { ru: "Сейчас в эфире", en: "Live now", uk: "Зараз в ефірі" },
            baseball_schedule: { ru: "Расписание", en: "Schedule", uk: "Розклад" },
            baseball_today: { ru: "Сегодня", en: "Today", uk: "Сьогодні" },
            baseball_tomorrow: { ru: "Завтра", en: "Tomorrow", uk: "Завтра" },
            baseball_final: { ru: "Завершён", en: "Final", uk: "Завершено" },
            baseball_cancelled: { ru: "Отменён", en: "Cancelled", uk: "Скасовано" },
            baseball_no_games: { ru: "Игр не запланировано", en: "No games scheduled", uk: "Ігор не заплановано" },
            baseball_no_schedule: { ru: "Расписание недоступно", en: "Schedule unavailable", uk: "Розклад недоступний" },
            baseball_yesterday: { ru: "Вчера", en: "Yesterday", uk: "Вчора" },
            baseball_replays: { ru: "Записи матчей", en: "Replays", uk: "Записи матчів" },
            baseball_more: { ru: "Ещё", en: "More", uk: "Ще" },
            baseball_no_replays: { ru: "Записи недоступны", en: "Replays unavailable", uk: "Записи недоступні" },
            baseball_replay_worker: {
                ru: "Для записей нужен обновлённый worker/soop-proxy.js",
                en: "Replays need the updated worker/soop-proxy.js",
                uk: "Для записів потрібен оновлений worker/soop-proxy.js"
            },
            baseball_schedule_worker: {
                ru: "Расписание требует обновлённого worker/soop-proxy.js",
                en: "Schedule needs the updated worker/soop-proxy.js",
                uk: "Розклад потребує оновленого worker/soop-proxy.js"
            },
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

    function openReplays() {
        Lampa.Activity.push({ url: "", title: t("baseball_replays"), component: "baseball_replays", page: 1 });
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
        Lampa.Component.add("baseball_replays", Replays);

        if (window.appready) { addMenu(); }
        else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { addMenu(); }
            });
        }
    }

    if (!window.plugin_baseball_ready) { startPlugin(); }
})();
