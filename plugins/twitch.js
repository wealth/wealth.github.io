/*
 * Twitch section for this Lampa fork.
 * Reuses js/twitch.js (GQL), js/auth.js (device login) and js/chat.js (overlay).
 * ES5: old webOS / Tizen browsers.
 */
(function () {
    "use strict";

    var VERSION = "1.0.1";
    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M2.15 0L.69 3.87v16.26h5.54V24h3.11l2.94-3.87h4.5L23.31 12V0H2.15zm19.46 11.08l-3.46 3.61h-5.54l-2.94 3.87v-3.87H4.73V1.73h16.88v9.35z"/><path d="M18.15 4.76h-1.73v5.2h1.73v-5.2zm-4.85 0H11.57v5.2h1.73v-5.2z"/></svg>';

    function t(key) {
        return Lampa.Lang.translate(key);
    }

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function fmtNum(n) {
        n = n || 0;
        if (n >= 1000000) { return (n / 1000000).toFixed(1).replace(".0", "") + "M"; }
        if (n >= 1000) { return (n / 1000).toFixed(1).replace(".0", "") + "K"; }
        return String(n);
    }

    function fmtDuration(sec) {
        sec = sec || 0;
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        function p(v) { return v < 10 ? "0" + v : String(v); }
        return h > 0 ? h + ":" + p(m) + ":" + p(s) : m + ":" + p(s);
    }

    function loggedIn() {
        return typeof TwitchAuth !== "undefined" && TwitchAuth.isLoggedIn();
    }

    function getFavorites() {
        var list = [];
        try {
            list = Lampa.Storage.get("twitch_favorites", []);
            if (typeof list === "string") { list = JSON.parse(list); }
        } catch (e) { list = []; }
        return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
    }

    function setFavorites(list) {
        Lampa.Storage.set("twitch_favorites", list);
    }

    function isFavorite(login) {
        var list = getFavorites();
        for (var i = 0; i < list.length; i++) {
            if (list[i] === login) { return true; }
        }
        return false;
    }

    function toggleFavorite(login) {
        var list = getFavorites();
        var out = [];
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i] === login) { found = true; } else { out.push(list[i]); }
        }
        if (!found) { out.push(login); }
        setFavorites(out);
        return !found;
    }

    function imgSrc(url) {
        return url || "./img/img_load.svg";
    }

    function openTwitch(params) {
        var data = {
            url: "",
            title: t("twitch"),
            component: "twitch",
            page: 1
        };
        Lampa.Arrays.extend(data, params || {}, true);
        Lampa.Activity.push(data);
    }

    function openList(params) {
        var data = {
            url: "",
            component: "twitch_list",
            page: 1
        };
        Lampa.Arrays.extend(data, params || {}, true);
        Lampa.Activity.push(data);
    }

    function setBackground() {
        Lampa.Background.immediately("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAZCAYAAABD2GxlAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSU0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHASURBVHgBlZaLrsMgDENXxAf3/9XHFdXNZLm2YZHQymPk4CS0277v9+ffrut62nEcn/M8nzb69cxj6le1+75f/RqrZ9fatm3F9wwMR7yhawilNke4Gis/7j9srQbdaVFBnkcQ1WrfgmIIBcTrvgqqsKiTzvpOQbUnAykVW4VVqZXyyDllYFSKx9QaVrO7nGJIB63g+FAq/xhcHWBYdwCsmAtvFZUKE0MlVZWCT4idOlyhTp3K35R/6Nzlq0uBnsKWlEzgSh1VGJxv6rmpXMO7EK+XWUPnDFRWqitQFeY2UyZVryuWlI8ulLgGf19FooAUwC9gCWLcwzWPb7Wa60qdlZxjx6ooUuUqVQsK+y1VoAJyBeJAVsLJeYmg/RIXdG2kPhwYPBUQQyYF0XC8lwP3MTCrYAXB88556peCbUUZV7WccwkUQfCZC4PXdA5hKhSVhythZqjZM0J39w5m8BRadKAcrsIpNZsLIYdOqcZ9hExhZ1MH+QL+ciFzXzmYhZr/M6yUUwp2dp5U4naZDwAF5JRSefdScJZ3SkU0nl8xpaAy+7ml1EqvMXSs1HRrZ9bc3eZUSXmGa/mdyjbmqyX7A9RaYQa9IRJ0AAAAAElFTkSuQmCC");
    }

    function openChannel(login) {
        Lampa.Activity.push({
            url: "",
            title: login,
            component: "twitch_channel",
            login: login,
            page: 1
        });
    }

    /* ------------------------------------------------------------------ */
    /* Playback                                                           */
    /* ------------------------------------------------------------------ */

    function playReady(item) {
        Lampa.Loading.stop();
        Lampa.Player.play(item);
        Lampa.Player.playlist([item]);
    }

    function qualityMap(text) {
        var variants = Twitch.parseMaster(text);
        var map = {};
        var i;
        for (i = 0; i < variants.length; i++) {
            var name = variants[i].name || (variants[i].height ? variants[i].height + "p" : "src");
            if (variants[i].url) { map[name] = variants[i].url; }
        }
        return { variants: variants, map: map };
    }

    /* Applies the picked variant + the quality menu from a master playlist. */
    function applyMaster(item, text, pick) {
        var parsed = qualityMap(text);
        var chosen = Twitch.pickVariant(parsed.variants, pick);
        if (chosen) { item.url = chosen; }
        if (parsed.variants.length > 1) { item.quality = parsed.map; }
    }

    function playLive(stream) {
        if (!stream || !stream.broadcaster) { return; }
        var channel = stream.broadcaster.login;
        var title = stream.title || stream.broadcaster.displayName || channel;
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        Twitch.playbackToken(channel, null, function (err, token) {
            if (err) {
                Lampa.Loading.stop();
                Lampa.Noty.show(err);
                return;
            }
            var adblock = String(Lampa.Storage.get("twitch_adblock", "off"));
            var pref = String(Lampa.Storage.get("twitch_quality", "auto"));
            var direct = Twitch.liveUrl(channel, token);
            var proxied = adblock !== "off";
            var item = {
                title: title,
                url: proxied ? Twitch.liveUrlProxy(channel, adblock) : direct,
                tv: true,
                twitch_channel: channel,
                twitch_cid: stream.broadcaster.id
            };

            /* Read the master playlist (if needed) and hand the result to the player. */
            function finish(masterUrl, pick) {
                if (!pick) { playReady(item); return; }
                Twitch.fetchText(masterUrl, function (e2, text) {
                    if (!e2 && text) { applyMaster(item, text, pick); }
                    playReady(item);
                });
            }

            if (!proxied) {
                finish(direct, pref !== "auto" ? pref : null);
                return;
            }

            /*
             * Ad-block on: fetching the proxy's master playlist doubles as a
             * liveness probe. A healthy proxy always answers with
             * "Access-Control-Allow-Origin: *", so ANY failure here — HTTP
             * error, timeout, or the header-less error page a dead proxy
             * returns — means it cannot serve this stream. These public
             * proxies rotate and go down without notice, so fall back to
             * direct usher: playing with ads beats a black screen.
             */
            Twitch.fetchText(item.url, function (e2, text) {
                if (!e2 && text) {
                    applyMaster(item, text, pref === "auto" ? "source" : pref);
                    playReady(item);
                    return;
                }
                item.url = direct;
                Lampa.Noty.show(t("twitch_adblock_down"));
                finish(direct, pref !== "auto" ? pref : null);
            });
        });
    }

    function playVod(vod) {
        if (!vod || !vod.id) { return; }
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        Twitch.playbackToken(null, vod.id, function (err, token) {
            if (err) {
                Lampa.Loading.stop();
                Lampa.Noty.show(err);
                return;
            }
            var url = Twitch.vodUrl(vod.id, token);
            var pref = String(Lampa.Storage.get("twitch_quality", "auto"));
            var item = {
                title: vod.title || t("twitch_video"),
                url: url,
                twitch_vod: vod.id
            };
            if (pref === "auto") {
                playReady(item);
                return;
            }
            Twitch.fetchText(url, function (e2, text) {
                if (!e2 && text) { applyMaster(item, text, pref); }
                playReady(item);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                              */
    /* ------------------------------------------------------------------ */

    function bindImg(img, src) {
        img.on("error", function () {
            img.attr("src", "./img/img_broken.svg");
        });
        img.attr("src", imgSrc(src));
    }

    function streamCard(node) {
        var b = node.broadcaster || {};
        var name = b.displayName || b.login || "";
        var game = node.game && node.game.displayName ? node.game.displayName : "";
        var html = $('<div class="card selector layer--visible twitch-card">' +
            '<div class="card__view">' +
                '<img class="card__img" src="./img/img_load.svg" alt="">' +
                '<div class="twitch-card__live">LIVE</div>' +
                '<div class="twitch-card__viewers"></div>' +
            '</div>' +
            '<div class="card__title"></div>' +
            '<div class="twitch-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(name);
        html.find(".twitch-card__meta").text(node.title || game || "");
        html.find(".twitch-card__viewers").text(fmtNum(node.viewersCount) + (game ? " · " + game : ""));
        bindImg(html.find(".card__img"), node.previewImageURL);
        html.on("hover:enter", function () { playLive(node); });
        html.on("hover:long", function () {
            if (b.login) { openChannel(b.login); }
        });
        return html;
    }

    function gameCard(node) {
        var html = $('<div class="card selector layer--visible twitch-card twitch-game">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="twitch-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(node.displayName || node.name || "");
        html.find(".twitch-card__meta").text(node.viewersCount ? fmtNum(node.viewersCount) + " " + t("twitch_viewers") : "");
        bindImg(html.find(".card__img"), node.boxArtURL);
        html.on("hover:enter", function () {
            openList({
                title: node.displayName || node.name,
                section: "game",
                game_name: node.name
            });
        });
        return html;
    }

    function vodCard(node) {
        var html = $('<div class="card selector layer--visible twitch-card">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="twitch-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(node.title || t("twitch_video"));
        html.find(".twitch-card__meta").text(fmtDuration(node.lengthSeconds) + " · " + fmtNum(node.viewCount));
        bindImg(html.find(".card__img"), node.previewThumbnailURL);
        html.on("hover:enter", function () { playVod(node); });
        return html;
    }

    function moreCard(onEnter) {
        var html = $('<div class="card selector layer--visible twitch-card twitch-more">' +
            '<div class="card__view"><div class="twitch-more__label"></div></div>' +
            '<div class="card__title"></div>' +
        '</div>');
        html.find(".twitch-more__label").text(t("twitch_more"));
        html.find(".card__title").text(t("twitch_more"));
        html.on("hover:enter", onEnter);
        return html;
    }

    function actionCard(label, onEnter) {
        var html = $('<div class="card selector layer--visible twitch-card twitch-action">' +
            '<div class="card__view"><div class="twitch-action__label"></div></div>' +
            '<div class="card__title"></div>' +
        '</div>');
        html.find(".twitch-action__label").text(label);
        html.find(".card__title").text(label);
        html.on("hover:enter", onEnter);
        return html;
    }

    function offlineCard(user) {
        var html = $('<div class="card selector layer--visible twitch-card">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="twitch-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(user.displayName || user.login || "");
        html.find(".twitch-card__meta").text(t("twitch_offline"));
        bindImg(html.find(".card__img"), user.profileImageURL);
        html.on("hover:enter", function () {
            if (user.login) { openChannel(user.login); }
        });
        return html;
    }

    /* ------------------------------------------------------------------ */
    /* Horizontal line                                                    */
    /* ------------------------------------------------------------------ */

    function Line(data) {
        var content = Lampa.Template.get("items_line", { title: data.title });
        var body = content.find(".items-line__body");
        var scroll = new Lampa.Scroll({ horizontal: true, step: 300 });
        var items = [];
        var active = 0;
        var last;

        this.create = function () {
            scroll.render().find(".scroll__body").addClass("items-cards");
            content.find(".items-line__title").text(data.title);
            var i;
            for (i = 0; i < data.cards.length; i++) {
                this.append(data.cards[i]);
            }
            if (data.onMore) { this.append(moreCard(data.onMore)); }
            body.append(scroll.render());
        };

        this.append = function (card) {
            var self = this;
            card.on("hover:focus", function () {
                last = card[0];
                active = items.indexOf(card);
                scroll.update(card, true);
            });
            scroll.append(card);
            items.push(card);
        };

        this.toggle = function () {
            var self = this;
            Lampa.Controller.add("twitch_line", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                right: function () {
                    Navigator.move("right");
                    Lampa.Controller.enable("twitch_line");
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                down: this.onDown,
                up: this.onUp,
                back: this.onBack
            });
            Lampa.Controller.toggle("twitch_line");
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
        var network = true;
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var items = [];
        var html = $('<div class="twitch-main"></div>');
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
            var bag = {};
            var need = ["top", "games"];
            if (loggedIn()) {
                need.push("following");
                need.push("recommended");
            }
            if (getFavorites().length) { need.push("favorites"); }
            var left = need.length;

            function finish() {
                left--;
                if (left > 0) { return; }
                self.appendLine({
                    title: t("twitch"),
                    cards: actionCards()
                });
                if (bag.following && bag.following.items && bag.following.items.length) {
                    self.appendLine({
                        title: t("twitch_following"),
                        cards: mapStreams(bag.following.items),
                        onMore: function () { openList({ title: t("twitch_following"), section: "following" }); }
                    });
                }
                if (bag.recommended && bag.recommended.items && bag.recommended.items.length) {
                    self.appendLine({
                        title: t("twitch_recommended"),
                        cards: mapStreams(bag.recommended.items),
                        onMore: function () { openList({ title: t("twitch_recommended"), section: "recommended" }); }
                    });
                }
                if (bag.top && bag.top.items && bag.top.items.length) {
                    self.appendLine({
                        title: t("twitch_top"),
                        cards: mapStreams(bag.top.items),
                        onMore: function () { openList({ title: t("twitch_top"), section: "streams" }); }
                    });
                }
                if (bag.games && bag.games.items && bag.games.items.length) {
                    self.appendLine({
                        title: t("twitch_games"),
                        cards: mapGames(bag.games.items),
                        onMore: function () { openList({ title: t("twitch_games"), section: "games" }); }
                    });
                }
                if (bag.favorites && bag.favorites.length) {
                    self.appendLine({
                        title: t("twitch_favorites"),
                        cards: mapUsers(bag.favorites),
                        onMore: function () { openList({ title: t("twitch_favorites"), section: "favorites" }); }
                    });
                }
                if (Lampa.Layer) {
                    Lampa.Layer.update(html);
                    Lampa.Layer.visible(html);
                }
                self.activity.loader(false);
                self.activity.toggle();
            }

            function fail() { bag[arguments[0]] = null; finish(); }

            var i;
            for (i = 0; i < need.length; i++) {
                (function (key) {
                    if (key === "top") {
                        Twitch.topStreams(null, function (err, page) { bag.top = err ? null : page; finish(); });
                    } else if (key === "games") {
                        Twitch.topGames(null, function (err, page) { bag.games = err ? null : page; finish(); });
                    } else if (key === "following") {
                        Twitch.followedStreams(null, function (err, page) { bag.following = err ? null : page; finish(); });
                    } else if (key === "recommended") {
                        Twitch.recommendedStreams(function (err, page) { bag.recommended = err ? null : page; finish(); });
                    } else if (key === "favorites") {
                        Twitch.usersByLogins(getFavorites(), function (err, users) { bag.favorites = err ? null : users; finish(); });
                    }
                })(need[i]);
            }
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
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
            setBackground();
            var self = this;
            Lampa.Controller.add("content", {
                toggle: function () {
                    if (items.length) { items[active].toggle(); }
                    else {
                        Lampa.Controller.collectionSet(html);
                        Lampa.Controller.collectionFocus(false, html);
                    }
                },
                left: function () { Lampa.Controller.toggle("menu"); },
                up: function () { Lampa.Controller.toggle("head"); },
                back: self.back
            });
            Lampa.Controller.toggle("content");
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            var i;
            for (i = 0; i < items.length; i++) { items[i].destroy(); }
            scroll.destroy();
            html.remove();
            items = [];
        };
    }

    function mapStreams(list) {
        var out = [];
        var i;
        for (i = 0; i < list.length && i < 12; i++) { out.push(streamCard(list[i])); }
        return out;
    }

    function mapGames(list) {
        var out = [];
        var i;
        for (i = 0; i < list.length && i < 12; i++) { out.push(gameCard(list[i])); }
        return out;
    }

    function mapUsers(users) {
        var live = [];
        var offline = [];
        var i;
        for (i = 0; i < users.length; i++) {
            if (!users[i]) { continue; }
            if (users[i].stream) {
                live.push(streamCard({
                    title: users[i].stream.title,
                    viewersCount: users[i].stream.viewersCount,
                    previewImageURL: users[i].stream.previewImageURL,
                    game: users[i].stream.game,
                    broadcaster: { id: users[i].id, login: users[i].login, displayName: users[i].displayName }
                }));
            } else {
                offline.push(offlineCard(users[i]));
            }
        }
        return live.concat(offline).slice(0, 12);
    }

    function actionCards() {
        var cards = [];
        cards.push(actionCard(t("twitch_search"), function () {
            Lampa.Input.edit({
                title: t("twitch_search"),
                value: "",
                free: true,
                nosave: true,
                nomic: true
            }, function (value) {
                if (value) {
                    openList({ title: t("twitch_search") + ": " + value, section: "search", query: value });
                }
            });
        }));
        if (loggedIn()) {
            cards.push(actionCard(TwitchAuth.displayName() || t("twitch_account"), function () {
                Lampa.Activity.push({ url: "", title: t("twitch_account"), component: "twitch_login", page: 1 });
            }));
        } else {
            cards.push(actionCard(t("twitch_connect"), function () {
                Lampa.Activity.push({ url: "", title: t("twitch_connect"), component: "twitch_login", page: 1 });
            }));
        }
        cards.push(actionCard(t("twitch_favorites"), function () {
            openList({ title: t("twitch_favorites"), section: "favorites" });
        }));
        return cards;
    }

    /* ------------------------------------------------------------------ */
    /* List / grid                                                        */
    /* ------------------------------------------------------------------ */

    function List(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var grid = $('<div class="twitch-grid category-full"></div>');
        var cursor = null;
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

        this.appendCard = function (card) {
            card.on("hover:focus", function () {
                last = card[0];
                scroll.update(card, true);
            });
            grid.append(card);
        };

        this.fetch = function (first) {
            var self = this;
            if (loading) { return; }
            loading = true;
            var section = object.section || "streams";

            function done(err, page) {
                loading = false;
                if (first) { self.activity.loader(false); }
                if (err) {
                    if (first) {
                        var empty = new Lampa.Empty({ title: t("twitch"), descr: String(err) });
                        html.empty().append(empty.render());
                        self.start = empty.start.bind(empty);
                    } else {
                        Lampa.Noty.show(err);
                    }
                    self.activity.toggle();
                    return;
                }
                var i;
                if (section === "games") {
                    for (i = 0; i < page.items.length; i++) { self.appendCard(gameCard(page.items[i])); }
                } else if (section === "search") {
                    for (i = 0; i < page.channels.length; i++) {
                        var u = page.channels[i];
                        if (u.stream) {
                            self.appendCard(streamCard({
                                title: u.stream.title,
                                viewersCount: u.stream.viewersCount,
                                previewImageURL: u.stream.previewImageURL,
                                game: u.stream.game,
                                broadcaster: { id: u.id, login: u.login, displayName: u.displayName }
                            }));
                        } else {
                            self.appendCard(offlineCard(u));
                        }
                    }
                    for (i = 0; i < page.games.length; i++) { self.appendCard(gameCard(page.games[i])); }
                    hasNext = false;
                    cursor = null;
                } else if (section === "favorites") {
                    var live = [];
                    var off = [];
                    for (i = 0; i < page.length; i++) {
                        if (!page[i]) { continue; }
                        if (page[i].stream) { live.push(page[i]); } else { off.push(page[i]); }
                    }
                    live.sort(function (a, b) { return b.stream.viewersCount - a.stream.viewersCount; });
                    for (i = 0; i < live.length; i++) {
                        self.appendCard(streamCard({
                            title: live[i].stream.title,
                            viewersCount: live[i].stream.viewersCount,
                            previewImageURL: live[i].stream.previewImageURL,
                            game: live[i].stream.game,
                            broadcaster: { id: live[i].id, login: live[i].login, displayName: live[i].displayName }
                        }));
                    }
                    for (i = 0; i < off.length; i++) { self.appendCard(offlineCard(off[i])); }
                    hasNext = false;
                    cursor = null;
                } else {
                    for (i = 0; i < page.items.length; i++) { self.appendCard(streamCard(page.items[i])); }
                    cursor = page.cursor;
                    hasNext = !!page.hasNext;
                }
                if (first && grid.children().length === 0) {
                    var empty2 = new Lampa.Empty({ title: object.title || t("twitch"), descr: t("twitch_empty") });
                    html.empty().append(empty2.render());
                    self.start = empty2.start.bind(empty2);
                }
                if (Lampa.Layer) {
                    Lampa.Layer.update(html);
                    Lampa.Layer.visible(html);
                }
                self.activity.toggle();
            }

            if (section === "streams") { Twitch.topStreams(cursor, done); }
            else if (section === "games") { Twitch.topGames(cursor, done); }
            else if (section === "following") { Twitch.followedStreams(cursor, done); }
            else if (section === "recommended") { Twitch.recommendedStreams(done); }
            else if (section === "game") { Twitch.gameStreams(object.game_name, cursor, done); }
            else if (section === "search") { Twitch.search(object.query, done); }
            else if (section === "favorites") {
                var logins = getFavorites();
                if (!logins.length) { done(null, []); return; }
                Twitch.usersByLogins(logins, done);
            } else {
                done(t("twitch_empty"), null);
            }
        };

        this.start = function () {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
            setBackground();
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
    /* Channel                                                            */
    /* ------------------------------------------------------------------ */

    function Channel(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var last;

        this.create = function () {
            this.activity.loader(true);
            scroll.minus();
            html.append(scroll.render());
            var self = this;
            Twitch.channel(object.login, function (err, user) {
                if (err || !user) {
                    var empty = new Lampa.Empty({ title: object.login, descr: String(err || t("twitch_empty")) });
                    html.empty().append(empty.render());
                    self.start = empty.start.bind(empty);
                    self.activity.loader(false);
                    self.activity.toggle();
                    return;
                }
                self.build(user);
                self.activity.loader(false);
                self.activity.toggle();
            });
            return this.render();
        };

        this.build = function (user) {
            var live = user.stream != null;
            var box = $('<div class="twitch-channel"></div>');
            var hero = $('<div class="twitch-channel__hero"></div>');
            var preview = $('<div class="card selector twitch-channel__preview"><img src="./img/img_load.svg" alt=""></div>');
            bindImg(preview.find("img"), live ? user.stream.previewImageURL : (user.offlineImageURL || user.profileImageURL));
            if (live) {
                preview.on("hover:enter", function () {
                    playLive({
                        title: user.stream.title,
                        viewersCount: user.stream.viewersCount,
                        previewImageURL: user.stream.previewImageURL,
                        game: user.stream.game,
                        broadcaster: { id: user.id, login: user.login, displayName: user.displayName }
                    });
                });
            }
            var info = $('<div class="twitch-channel__info"></div>');
            info.append($('<div class="twitch-channel__name"></div>').text(user.displayName || user.login));
            if (live && user.stream.title) {
                info.append($('<div class="twitch-channel__title"></div>').text(user.stream.title));
            }
            var meta = [];
            if (live) {
                meta.push(fmtNum(user.stream.viewersCount) + " " + t("twitch_viewers"));
                if (user.stream.game && user.stream.game.displayName) { meta.push(user.stream.game.displayName); }
            } else {
                meta.push(t("twitch_offline"));
            }
            if (user.followers) { meta.push(fmtNum(user.followers.totalCount) + " " + t("twitch_followers")); }
            info.append($('<div class="twitch-channel__meta"></div>').text(meta.join(" · ")));
            if (!live && user.description) {
                info.append($('<div class="twitch-channel__desc"></div>').text(user.description));
            }
            var actions = $('<div class="twitch-channel__actions"></div>');
            var watch = $('<div class="twitch-channel__btn selector"></div>').text(live ? t("twitch_watch") : t("twitch_offline"));
            if (live) {
                watch.on("hover:enter", function () {
                    playLive({
                        title: user.stream.title,
                        viewersCount: user.stream.viewersCount,
                        previewImageURL: user.stream.previewImageURL,
                        game: user.stream.game,
                        broadcaster: { id: user.id, login: user.login, displayName: user.displayName }
                    });
                });
            }
            var fav = $('<div class="twitch-channel__btn selector"></div>');
            function favLabel() {
                fav.text(isFavorite(user.login) ? t("twitch_unfav") : t("twitch_fav"));
            }
            favLabel();
            fav.on("hover:enter", function () {
                var added = toggleFavorite(user.login);
                favLabel();
                Lampa.Noty.show(added ? t("twitch_fav_added") : t("twitch_fav_removed"));
            });
            actions.append(watch).append(fav);
            info.append(actions);
            hero.append(preview).append(info);
            box.append(hero);

            var vods = [];
            if (user.videos && user.videos.edges) {
                var i;
                for (i = 0; i < user.videos.edges.length; i++) {
                    if (user.videos.edges[i] && user.videos.edges[i].node) { vods.push(user.videos.edges[i].node); }
                }
            }
            if (vods.length) {
                box.append($('<div class="twitch-channel__vods-title"></div>').text(t("twitch_videos")));
                var grid = $('<div class="twitch-grid"></div>');
                for (var v = 0; v < vods.length; v++) { grid.append(vodCard(vods[v])); }
                box.append(grid);
            }

            box.find(".selector").on("hover:focus", function () {
                last = this;
                scroll.update($(this), true);
            });

            scroll.append(box);
            if (Lampa.Layer) {
                Lampa.Layer.update(html);
                Lampa.Layer.visible(html);
            }
        };

        this.start = function () {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
            setBackground();
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
                down: function () { Navigator.move("down"); },
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
    /* Login                                                              */
    /* ------------------------------------------------------------------ */

    function Login() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var last;

        this.create = function () {
            scroll.minus();
            html.append(scroll.render());
            if (loggedIn()) { this.signedIn(); }
            else { this.begin(); }
            return this.render();
        };

        this.paint = function (inner) {
            scroll.clear();
            var box = $('<div class="twitch-login"></div>').append(inner);
            box.find(".selector").on("hover:focus", function () { last = this; });
            scroll.append(box);
            if (Lampa.Layer) { Lampa.Layer.update(html); }
            this.activity.toggle();
        };

        this.signedIn = function () {
            var name = TwitchAuth.displayName() || "Twitch";
            var inner = $('<div></div>');
            inner.append($('<div class="twitch-channel__name"></div>').text(name));
            inner.append($('<div class="twitch-login__hint"></div>').text(t("twitch_signed_in")));
            var out = $('<div class="twitch-login__btn selector"></div>').text(t("twitch_logout"));
            out.on("hover:enter", function () {
                TwitchAuth.logout();
                Lampa.Noty.show(t("twitch_logged_out"));
                Lampa.Activity.backward();
            });
            inner.append(out);
            this.paint(inner);
        };

        this.begin = function () {
            var self = this;
            var inner = $('<div></div>');
            inner.append($('<div class="twitch-channel__name"></div>').text(t("twitch_connect")));
            inner.append($('<div class="twitch-login__hint"></div>').text(t("twitch_login_wait")));
            this.paint(inner);
            TwitchAuth.startDeviceLogin(function (info) {
                var next = $('<div></div>');
                next.append($('<div class="twitch-login__hint"></div>').text(t("twitch_login_hint")));
                next.append($('<div class="twitch-login__code"></div>').text(info.user_code || ""));
                next.append($('<div class="twitch-login__hint"></div>').text((info.verification_uri || "https://www.twitch.tv/activate").replace("https://www.", "")));
                self.paint(next);
            }, function (status) {
                if (status === "success") {
                    Lampa.Noty.show(t("twitch_signed_in") + " " + (TwitchAuth.displayName() || ""));
                    Lampa.Activity.backward();
                } else {
                    var fail = $('<div></div>');
                    fail.append($('<div class="twitch-login__hint"></div>').text(status === "expired" ? t("twitch_login_expired") : t("twitch_login_error")));
                    var again = $('<div class="twitch-login__btn selector"></div>').text(t("twitch_retry"));
                    again.on("hover:enter", function () { self.begin(); });
                    fail.append(again);
                    self.paint(fail);
                }
            });
        };

        this.start = function () {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
            setBackground();
            Lampa.Controller.add("content", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () { Lampa.Controller.toggle("menu"); },
                up: function () { Lampa.Controller.toggle("head"); },
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
    /* Settings / menu / player                                           */
    /* ------------------------------------------------------------------ */

    function addLang() {
        Lampa.Lang.add({
            twitch: { ru: "Twitch", en: "Twitch", uk: "Twitch" },
            twitch_top: { ru: "Топ стримы", en: "Top streams", uk: "Топ стріми" },
            twitch_games: { ru: "Игры", en: "Games", uk: "Ігри" },
            twitch_following: { ru: "Подписки", en: "Following", uk: "Підписки" },
            twitch_recommended: { ru: "Рекомендации", en: "Recommended", uk: "Рекомендації" },
            twitch_favorites: { ru: "Избранное", en: "Favorites", uk: "Обране" },
            twitch_search: { ru: "Поиск", en: "Search", uk: "Пошук" },
            twitch_connect: { ru: "Войти в Twitch", en: "Connect account", uk: "Увійти в Twitch" },
            twitch_account: { ru: "Аккаунт", en: "Account", uk: "Акаунт" },
            twitch_more: { ru: "Ещё", en: "More", uk: "Ще" },
            twitch_viewers: { ru: "зрителей", en: "viewers", uk: "глядачів" },
            twitch_followers: { ru: "фолловеров", en: "followers", uk: "фоловерів" },
            twitch_offline: { ru: "Офлайн", en: "Offline", uk: "Офлайн" },
            twitch_watch: { ru: "Смотреть", en: "Watch live", uk: "Дивитися" },
            twitch_fav: { ru: "В избранное", en: "Add favorite", uk: "В обране" },
            twitch_unfav: { ru: "Убрать из избранного", en: "Remove favorite", uk: "Прибрати з обраного" },
            twitch_fav_added: { ru: "Добавлено в избранное", en: "Added to favorites", uk: "Додано в обране" },
            twitch_fav_removed: { ru: "Удалено из избранного", en: "Removed from favorites", uk: "Видалено з обраного" },
            twitch_videos: { ru: "Недавние видео", en: "Recent videos", uk: "Недавні відео" },
            twitch_video: { ru: "Видео", en: "Video", uk: "Відео" },
            twitch_empty: { ru: "Ничего нет", en: "Nothing here right now.", uk: "Нічого немає" },
            twitch_adblock_down: { ru: "Прокси блокировки рекламы недоступен — играем напрямую", en: "Ad-block proxy unavailable — playing direct", uk: "Проксі блокування реклами недоступний — граємо напряму" },
            twitch_login_hint: { ru: "Откройте twitch.tv/activate и введите код", en: "Open twitch.tv/activate and enter this code", uk: "Відкрийте twitch.tv/activate і введіть код" },
            twitch_login_wait: { ru: "Запрашиваем код…", en: "Requesting a code…", uk: "Запитуємо код…" },
            twitch_login_expired: { ru: "Код истёк. Попробуйте снова.", en: "The code expired. Try again.", uk: "Код сплив. Спробуйте знову." },
            twitch_login_error: { ru: "Не удалось войти. Попробуйте снова.", en: "Could not sign in. Try again.", uk: "Не вдалося увійти. Спробуйте знову." },
            twitch_signed_in: { ru: "Вы вошли", en: "Signed in", uk: "Ви увійшли" },
            twitch_logout: { ru: "Выйти", en: "Log out", uk: "Вийти" },
            twitch_logged_out: { ru: "Вы вышли", en: "Logged out", uk: "Ви вийшли" },
            twitch_retry: { ru: "Повторить", en: "Try again", uk: "Повторити" },
            twitch_settings: { ru: "Twitch", en: "Twitch", uk: "Twitch" },
            twitch_set_chat: { ru: "Чат поверх видео", en: "Chat overlay", uk: "Чат поверх відео" },
            twitch_set_chatpos: { ru: "Позиция чата", en: "Chat position", uk: "Позиція чату" },
            twitch_set_chatheight: { ru: "Высота чата", en: "Chat height", uk: "Висота чату" },
            twitch_set_chatwidth: { ru: "Ширина чата", en: "Chat width", uk: "Ширина чату" },
            twitch_set_chatsize: { ru: "Размер текста чата", en: "Chat text size", uk: "Розмір тексту чату" },
            twitch_set_quality: { ru: "Качество", en: "Stream quality", uk: "Якість" },
            twitch_set_adblock: { ru: "Блок рекламы (прокси)", en: "Block ads (proxy)", uk: "Блок реклами (проксі)" },
            twitch_set_account: { ru: "Аккаунт Twitch", en: "Twitch account", uk: "Акаунт Twitch" }
        });
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: "twitch",
            icon: ICON,
            name: t("twitch_settings")
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { type: "button" },
            field: { name: t("twitch_set_account") },
            onChange: function () {
                Lampa.Activity.push({ url: "", title: t("twitch_account"), component: "twitch_login", page: 1 });
            }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_chat", type: "select", values: { on: t("settings_param_yes") || "On", off: t("settings_param_no") || "Off" }, default: "on" },
            field: { name: t("twitch_set_chat") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_chatpos", type: "select", values: { l: "Left", r: "Right" }, default: "l" },
            field: { name: t("twitch_set_chatpos") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_chatheight", type: "select", values: { full: "Full", h75: "75%", h50: "50%", h25: "25%" }, default: "h50" },
            field: { name: t("twitch_set_chatheight") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_chatwidth", type: "select", values: { w30: "30%", w25: "25%", w20: "20%", w15: "15%", w10: "10%" }, default: "w30" },
            field: { name: t("twitch_set_chatwidth") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_chatsize", type: "select", values: { s: "S", m: "M", l: "L" }, default: "m" },
            field: { name: t("twitch_set_chatsize") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_quality", type: "select", values: { auto: "Auto", source: "Source", "720": "720p", "480": "480p", "360": "360p", audio_only: "Audio" }, default: "auto" },
            field: { name: t("twitch_set_quality") }
        });
        Lampa.SettingsApi.addParam({
            component: "twitch",
            param: { name: "twitch_adblock", type: "select", values: { off: "Off", eu: "Europe", eu2: "Europe 2", na: "North America", as: "Asia" }, default: "off" },
            field: { name: t("twitch_set_adblock") }
        });
    }

    function addMenu() {
        function open() {
            openTwitch({ title: t("twitch") });
        }
        if (Lampa.Menu && Lampa.Menu.addButton) {
            Lampa.Menu.addButton(ICON, t("twitch"), open);
            return;
        }
        var button = $('<li class="menu__item selector" data-action="twitch"><div class="menu__ico">' + ICON + '</div><div class="menu__text">' + t("twitch") + "</div></li>");
        button.on("hover:enter", open);
        $(".menu .menu__list").eq(0).append(button);
    }

    var statsTimer = null;

    function hookPlayer() {
        if (!Lampa.Player || !Lampa.Player.listener) { return; }
        Lampa.Player.listener.follow("start", function (data) {
            if (!data || !data.twitch_channel) { return; }
            if (typeof StvChat !== "undefined") {
                StvChat.init(data.twitch_channel, data.twitch_cid);
            }
            if (statsTimer) { clearInterval(statsTimer); }
            function tick() {
                Twitch.streamStats(data.twitch_channel, function (err, s) {
                    if (err || !s) { return; }
                    if (typeof StvChat !== "undefined") { StvChat.setViewers(s.viewersCount); }
                });
            }
            tick();
            statsTimer = setInterval(tick, 60000);
        });
        Lampa.Player.listener.follow("destroy", function () {
            if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
            if (typeof StvChat !== "undefined") {
                try { StvChat.dispose(); } catch (e) { }
            }
        });
    }

    function startPlugin() {
        if (window.plugin_twitch_ready) { return; }
        window.plugin_twitch_ready = true;

        if (typeof Twitch === "undefined") {
            console.log("Twitch plugin", "js/twitch.js is not loaded");
            return;
        }

        Lampa.Manifest.plugins = {
            type: "video",
            version: VERSION,
            name: "Twitch",
            description: "Live streams, games, VODs and chat",
            component: "twitch"
        };

        addLang();
        Lampa.Component.add("twitch", Main);
        Lampa.Component.add("twitch_list", List);
        Lampa.Component.add("twitch_channel", Channel);
        Lampa.Component.add("twitch_login", Login);
        addSettings();
        hookPlayer();

        if (window.appready) { addMenu(); }
        else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { addMenu(); }
            });
        }
    }

    if (!window.plugin_twitch_ready) { startPlugin(); }
})();
