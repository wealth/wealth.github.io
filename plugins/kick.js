/*
 * Kick section for this Lampa fork.
 * Uses js/kick.js (kick.com's own endpoints — no key, no Worker) and shares the
 * chat overlay with the Twitch section (js/chat.js).
 * ES5: old webOS / Tizen browsers.
 */
(function () {
    "use strict";

    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3 2h6v6h2V6h2V4h2V2h6v6h-2v2h-2v4h2v2h2v6h-6v-2h-2v-2h-2v-2H9v6H3z"/></svg>';

    /* Cards per line on the main page; the rest is behind "More". */
    var LINE_CARDS = 12;

    function t(key) {
        return Lampa.Lang.translate(key);
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

    /* ------------------------------------------------------------------ */
    /* Favorites — the stand-in for "following", which needs a Kick login */
    /* ------------------------------------------------------------------ */

    function getFavorites() {
        var list = [];
        try {
            list = Lampa.Storage.get("kick_favorites", []);
            if (typeof list === "string") { list = JSON.parse(list); }
        } catch (e) { list = []; }
        return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
    }

    function isFavorite(slug) {
        return getFavorites().indexOf(slug) >= 0;
    }

    function toggleFavorite(slug) {
        var list = getFavorites();
        var at = list.indexOf(slug);
        if (at >= 0) { list.splice(at, 1); } else { list.push(slug); }
        Lampa.Storage.set("kick_favorites", list);
        return at < 0;
    }

    /* ------------------------------------------------------------------ */
    /* Navigation                                                         */
    /* ------------------------------------------------------------------ */

    function openList(params) {
        var data = { url: "", component: "kick_list", page: 1 };
        Lampa.Arrays.extend(data, params || {}, true);
        Lampa.Activity.push(data);
    }

    function openChannel(slug, name) {
        Lampa.Activity.push({ url: "", title: name || slug, component: "kick_channel", slug: slug, page: 1 });
    }

    /* ------------------------------------------------------------------ */
    /* Playback                                                           */
    /* ------------------------------------------------------------------ */

    /*
     * Always re-read the channel at the moment of playing: the playlist URL is
     * only valid with the token that call returns, and a card that has been on
     * screen for a while may be showing a stream that has since ended.
     *
     * The URL goes to the player as it is. It is an IVS master playlist that
     * no other origin may read, so there is no picking a rendition up front
     * the way the Twitch section does through its proxy — the TV's own player
     * chooses.
     */
    function playLive(slug) {
        var cancelled = false;
        Lampa.Loading.start(function () { cancelled = true; Lampa.Loading.stop(); });
        Kick.channel(slug, function (err, ch) {
            if (cancelled) { return; }
            Lampa.Loading.stop();
            if (err) { Lampa.Noty.show(err); return; }
            if (!ch.live || !ch.playbackUrl) { Lampa.Noty.show(t("kick_not_live")); return; }
            var item = {
                title: ch.live.title || ch.name,
                url: ch.playbackUrl,
                tv: true,
                kick_channel: ch.slug,
                /* Chat history is keyed by channel id, 7TV emotes by user id. */
                kick_chat: ch.id,
                kick_user: ch.userId
            };
            Lampa.Player.play(item);
            Lampa.Player.playlist([item]);
        });
    }

    /*
     * A past broadcast. Its master playlist is open to every origin, so Lampa
     * reads the renditions itself and applies its own default-quality setting.
     * These run to twelve hours, hence the timeline: Lampa remembers where the
     * viewer stopped and offers to pick up from there.
     */
    function playVod(vod) {
        var item = {
            title: vod.title || t("kick_video"),
            url: vod.url,
            timeline: Lampa.Timeline.view(Lampa.Utils.hash("kick_vod_" + vod.id))
        };
        Lampa.Player.play(item);
        Lampa.Player.playlist([item]);
    }

    /* ------------------------------------------------------------------ */
    /* Cards                                                              */
    /* ------------------------------------------------------------------ */

    function bindImg(img, src) {
        img.on("error", function () { img.attr("src", "./img/img_broken.svg"); });
        img.attr("src", src || "./img/img_load.svg");
    }

    function streamCard(stream) {
        var html = $('<div class="card selector layer--visible kick-card">' +
            '<div class="card__view">' +
                '<img class="card__img" src="./img/img_load.svg" alt="">' +
                '<div class="kick-card__live">LIVE</div>' +
                '<div class="kick-card__viewers"></div>' +
            '</div>' +
            '<div class="card__title"></div>' +
            '<div class="kick-card__meta"></div>' +
        '</div>');
        var category = stream.category ? stream.category.name : "";
        html.find(".card__title").text(stream.name);
        html.find(".kick-card__meta").text(stream.title || category);
        html.find(".kick-card__viewers").text(fmtNum(stream.viewers) + (category ? " · " + category : ""));
        bindImg(html.find(".card__img"), stream.thumb);
        html.on("hover:enter", function () { playLive(stream.slug); });
        html.on("hover:long", function () { openChannel(stream.slug, stream.name); });
        return html;
    }

    /* A channel as returned by Kick.profile(), while it is live. */
    function liveCard(ch) {
        return streamCard({
            slug: ch.slug,
            name: ch.name,
            title: ch.live.title,
            viewers: ch.live.viewers,
            thumb: ch.live.thumb,
            category: ch.live.category
        });
    }

    /*
     * A channel with no stream to preview: offline, or a search hit. The card
     * is narrow, so the one line under the name goes to the follower count —
     * what tells two similarly named channels apart — and "offline" is said
     * only when there is no count; a live one wears the badge instead.
     */
    function userCard(user) {
        var html = $('<div class="card selector layer--visible kick-card kick-user">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="kick-card__meta"></div>' +
        '</div>');
        var meta = "";
        if (user.isLive) { html.find(".card__view").append('<div class="kick-card__live">LIVE</div>'); }
        if (user.followers) { meta = fmtNum(user.followers) + " " + t("kick_followers"); }
        else if (!user.isLive) { meta = t("kick_offline"); }
        html.find(".card__title").text(user.name);
        html.find(".kick-card__meta").text(meta);
        bindImg(html.find(".card__img"), user.avatar);
        html.on("hover:enter", function () { openChannel(user.slug, user.name); });
        return html;
    }

    function categoryCard(category) {
        var html = $('<div class="card selector layer--visible kick-card kick-category">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="kick-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(category.name);
        html.find(".kick-card__meta").text(category.viewers ? fmtNum(category.viewers) + " " + t("kick_viewers") : "");
        bindImg(html.find(".card__img"), category.image);
        html.on("hover:enter", function () {
            openList({ title: category.name, section: "category", slug: category.slug });
        });
        return html;
    }

    function vodCard(vod) {
        var html = $('<div class="card selector layer--visible kick-card">' +
            '<div class="card__view"><img class="card__img" src="./img/img_load.svg" alt=""></div>' +
            '<div class="card__title"></div>' +
            '<div class="kick-card__meta"></div>' +
        '</div>');
        html.find(".card__title").text(vod.title || t("kick_video"));
        html.find(".kick-card__meta").text(fmtDuration(vod.duration) + " · " + fmtNum(vod.views));
        bindImg(html.find(".card__img"), vod.thumb);
        html.on("hover:enter", function () { playVod(vod); });
        return html;
    }

    /* A card that is a button: "More", "Search", "Favorites". */
    function labelCard(label, cls, onEnter) {
        var html = $('<div class="card selector layer--visible kick-card">' +
            '<div class="card__view"><div class="kick-card__label"></div></div>' +
            '<div class="card__title"></div>' +
        '</div>');
        html.addClass(cls);
        html.find(".kick-card__label").text(label);
        html.find(".card__title").text(label);
        html.on("hover:enter", onEnter);
        return html;
    }

    /* Live channels first, busiest on top, then the offline ones. */
    function channelCards(channels) {
        var live = [];
        var offline = [];
        for (var i = 0; i < channels.length; i++) {
            if (!channels[i]) { continue; }
            if (channels[i].live) { live.push(channels[i]); } else { offline.push(channels[i]); }
        }
        live.sort(function (a, b) { return b.live.viewers - a.live.viewers; });
        var cards = [];
        for (i = 0; i < live.length; i++) { cards.push(liveCard(live[i])); }
        for (i = 0; i < offline.length; i++) { cards.push(userCard(offline[i])); }
        return cards;
    }

    function mapCards(list, card) {
        var out = [];
        for (var i = 0; i < list.length && i < LINE_CARDS; i++) { out.push(card(list[i])); }
        return out;
    }

    function searchPrompt() {
        Lampa.Input.edit({
            title: t("kick_search"),
            value: "",
            free: true,
            nosave: true,
            nomic: true
        }, function (value) {
            if (value) { openList({ title: t("kick_search") + ": " + value, section: "search", query: value }); }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Horizontal line                                                    */
    /* ------------------------------------------------------------------ */

    function Line(data) {
        var content = Lampa.Template.get("items_line", { title: data.title });
        var body = content.find(".items-line__body");
        var scroll = new Lampa.Scroll({ horizontal: true, step: 300 });
        var last;

        this.create = function () {
            scroll.render().find(".scroll__body").addClass("items-cards");
            content.find(".items-line__title").text(data.title);
            for (var i = 0; i < data.cards.length; i++) { this.append(data.cards[i]); }
            if (data.onMore) { this.append(labelCard(t("kick_more"), "kick-more", data.onMore)); }
            body.append(scroll.render());
        };

        this.append = function (card) {
            card.on("hover:focus", function () {
                last = card[0];
                scroll.update(card, true);
            });
            scroll.append(card);
        };

        this.toggle = function () {
            Lampa.Controller.add("kick_line", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                right: function () {
                    Navigator.move("right");
                    Lampa.Controller.enable("kick_line");
                },
                left: function () {
                    if (Navigator.canmove("left")) { Navigator.move("left"); }
                    else { Lampa.Controller.toggle("menu"); }
                },
                down: this.onDown,
                up: this.onUp,
                back: this.onBack
            });
            Lampa.Controller.toggle("kick_line");
        };

        this.render = function () { return content; };

        this.destroy = function () {
            scroll.destroy();
            content.remove();
        };
    }

    /* ------------------------------------------------------------------ */
    /* Main component                                                     */
    /* ------------------------------------------------------------------ */

    function Main() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var items = [];
        var html = $('<div class="kick-main"></div>');
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

        /* Every feed is independent; one that fails just leaves its line out. */
        this.load = function () {
            var self = this;
            var bag = {};
            var favorites = getFavorites();
            var left = favorites.length ? 4 : 3;

            function got(key) {
                return function (err, result) {
                    bag[key] = err ? null : result;
                    if (--left === 0) { self.build(bag); }
                };
            }

            Kick.featuredStreams(String(Lampa.Storage.get("language", "en")), got("featured"));
            Kick.topStreams(1, got("top"));
            Kick.categories(1, got("categories"));
            if (favorites.length) { Kick.profiles(favorites, got("favorites")); }
        };

        this.build = function (bag) {
            /* Nothing answered at all: say so instead of showing two buttons
               over an otherwise blank page. */
            if (!bag.featured && !bag.top && !bag.categories) {
                this.empty();
                return;
            }

            this.appendLine({
                title: t("kick"),
                cards: [
                    labelCard(t("kick_search"), "kick-action", searchPrompt),
                    labelCard(t("kick_favorites"), "kick-action", function () {
                        openList({ title: t("kick_favorites"), section: "favorites" });
                    })
                ]
            });
            if (bag.favorites) {
                var favs = channelCards(bag.favorites);
                this.appendLine({
                    title: t("kick_favorites"),
                    cards: favs.slice(0, LINE_CARDS),
                    onMore: favs.length > LINE_CARDS ? function () {
                        openList({ title: t("kick_favorites"), section: "favorites" });
                    } : null
                });
            }
            if (bag.featured) {
                this.appendLine({ title: t("kick_featured"), cards: mapCards(bag.featured.items, streamCard) });
            }
            if (bag.top) {
                this.appendLine({
                    title: t("kick_top"),
                    cards: mapCards(bag.top.items, streamCard),
                    onMore: function () { openList({ title: t("kick_top"), section: "streams" }); }
                });
            }
            if (bag.categories) {
                this.appendLine({
                    title: t("kick_categories"),
                    cards: mapCards(bag.categories.items, categoryCard),
                    onMore: function () { openList({ title: t("kick_categories"), section: "categories" }); }
                });
            }

            if (Lampa.Layer) {
                Lampa.Layer.update(html);
                Lampa.Layer.visible(html);
            }
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.empty = function () {
            var empty = new Lampa.Empty({ title: t("kick"), descr: t("kick_no_connection") });
            html.empty().append(empty.render());
            this.start = empty.start.bind(empty);
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
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
            var self = this;
            Lampa.Controller.add("content", {
                toggle: function () {
                    if (items.length) { items[active].toggle(); }
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
            for (var i = 0; i < items.length; i++) { items[i].destroy(); }
            scroll.destroy();
            html.remove();
            items = [];
        };
    }

    /* ------------------------------------------------------------------ */
    /* List / grid                                                        */
    /* ------------------------------------------------------------------ */

    function List(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div></div>');
        var grid = $('<div class="kick-grid category-full"></div>');
        var section = object.section || "streams";
        var page = 1;
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

        this.showEmpty = function (text) {
            var empty = new Lampa.Empty({ title: object.title || t("kick"), descr: text });
            html.empty().append(empty.render());
            this.start = empty.start.bind(empty);
        };

        this.fetch = function (first) {
            var self = this;
            if (loading) { return; }
            loading = true;

            function done(err, result) {
                loading = false;
                if (first) { self.activity.loader(false); }
                if (err) {
                    if (first) { self.showEmpty(String(err)); }
                    else { Lampa.Noty.show(err); }
                    self.activity.toggle();
                    return;
                }
                var cards = [];
                var i;
                if (section === "search") {
                    for (i = 0; i < result.channels.length; i++) { cards.push(userCard(result.channels[i])); }
                    for (i = 0; i < result.categories.length; i++) { cards.push(categoryCard(result.categories[i])); }
                } else if (section === "favorites") {
                    cards = channelCards(result);
                } else {
                    var card = section === "categories" ? categoryCard : streamCard;
                    for (i = 0; i < result.items.length; i++) { cards.push(card(result.items[i])); }
                    hasNext = result.hasNext;
                    page = result.page + 1;
                }
                for (i = 0; i < cards.length; i++) { self.appendCard(cards[i]); }
                if (first && !cards.length) { self.showEmpty(t("kick_empty")); }
                if (Lampa.Layer) {
                    Lampa.Layer.update(html);
                    Lampa.Layer.visible(html);
                }
                self.activity.toggle();
            }

            if (section === "streams") { Kick.topStreams(page, done); }
            else if (section === "categories") { Kick.categories(page, done); }
            else if (section === "category") { Kick.categoryStreams(object.slug, page, done); }
            else if (section === "search") { Kick.search(object.query, done); }
            else if (section === "favorites") { Kick.profiles(getFavorites(), done); }
            else { done(t("kick_empty"), null); }
        };

        this.start = function () {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) { return; }
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
            var self = this;
            var channel = null;
            var vods = [];
            var failed = null;
            var left = 2;

            this.activity.loader(true);
            scroll.minus();
            html.append(scroll.render());

            function ready() {
                if (--left > 0) { return; }
                if (channel) { self.build(channel, vods); }
                else {
                    var empty = new Lampa.Empty({ title: object.title || object.slug, descr: String(failed || t("kick_empty")) });
                    html.empty().append(empty.render());
                    self.start = empty.start.bind(empty);
                }
                self.activity.loader(false);
                self.activity.toggle();
            }

            Kick.profile(object.slug, function (err, ch) { failed = err; channel = ch; ready(); });
            /* A channel with recordings switched off just has no list. */
            Kick.videos(object.slug, function (err, list) { vods = err ? [] : list; ready(); });
            return this.render();
        };

        this.build = function (ch, vods) {
            var live = ch.live;
            var box = $('<div class="kick-channel"></div>');
            var hero = $('<div class="kick-channel__hero"></div>');
            var preview = $('<div class="card selector kick-channel__preview"><img src="./img/img_load.svg" alt=""></div>');
            bindImg(preview.find("img"), live ? live.thumb : (ch.banner || ch.avatar));

            var info = $('<div class="kick-channel__info"></div>');
            info.append($('<div class="kick-channel__name"></div>').text(ch.name));
            if (live && live.title) {
                info.append($('<div class="kick-channel__title"></div>').text(live.title));
            }
            var meta = [];
            if (live) {
                meta.push(fmtNum(live.viewers) + " " + t("kick_viewers"));
                if (live.category) { meta.push(live.category.name); }
            } else {
                meta.push(t("kick_offline"));
            }
            if (ch.followers) { meta.push(fmtNum(ch.followers) + " " + t("kick_followers")); }
            info.append($('<div class="kick-channel__meta"></div>').text(meta.join(" · ")));
            if (!live && ch.bio) {
                info.append($('<div class="kick-channel__desc"></div>').text(ch.bio));
            }

            var actions = $('<div class="kick-channel__actions"></div>');
            var watch = $('<div class="kick-channel__btn selector"></div>').text(live ? t("kick_watch") : t("kick_offline"));
            if (live) {
                preview.on("hover:enter", function () { playLive(ch.slug); });
                watch.on("hover:enter", function () { playLive(ch.slug); });
            }
            var fav = $('<div class="kick-channel__btn selector"></div>');
            function favLabel() {
                fav.text(isFavorite(ch.slug) ? t("kick_unfav") : t("kick_fav"));
            }
            favLabel();
            fav.on("hover:enter", function () {
                var added = toggleFavorite(ch.slug);
                favLabel();
                Lampa.Noty.show(added ? t("kick_fav_added") : t("kick_fav_removed"));
            });
            actions.append(watch).append(fav);
            info.append(actions);
            hero.append(preview).append(info);
            box.append(hero);

            if (vods.length) {
                box.append($('<div class="kick-channel__vods-title"></div>').text(t("kick_videos")));
                var grid = $('<div class="kick-grid"></div>');
                for (var i = 0; i < vods.length; i++) { grid.append(vodCard(vods[i])); }
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
    /* Wiring                                                             */
    /* ------------------------------------------------------------------ */

    function addLang() {
        Lampa.Lang.add({
            kick: { ru: "Kick", en: "Kick", uk: "Kick" },
            kick_featured: { ru: "Рекомендуемые", en: "Featured", uk: "Рекомендовані" },
            kick_top: { ru: "Топ стримы", en: "Top streams", uk: "Топ стріми" },
            kick_categories: { ru: "Категории", en: "Categories", uk: "Категорії" },
            kick_favorites: { ru: "Избранное", en: "Favorites", uk: "Обране" },
            kick_search: { ru: "Поиск", en: "Search", uk: "Пошук" },
            kick_more: { ru: "Ещё", en: "More", uk: "Ще" },
            kick_viewers: { ru: "зрителей", en: "viewers", uk: "глядачів" },
            kick_followers: { ru: "фолловеров", en: "followers", uk: "фоловерів" },
            kick_offline: { ru: "Офлайн", en: "Offline", uk: "Офлайн" },
            kick_watch: { ru: "Смотреть", en: "Watch live", uk: "Дивитися" },
            kick_fav: { ru: "В избранное", en: "Add favorite", uk: "В обране" },
            kick_unfav: { ru: "Убрать из избранного", en: "Remove favorite", uk: "Прибрати з обраного" },
            kick_fav_added: { ru: "Добавлено в избранное", en: "Added to favorites", uk: "Додано в обране" },
            kick_fav_removed: { ru: "Удалено из избранного", en: "Removed from favorites", uk: "Видалено з обраного" },
            kick_videos: { ru: "Недавние видео", en: "Recent videos", uk: "Недавні відео" },
            kick_video: { ru: "Видео", en: "Video", uk: "Відео" },
            kick_empty: { ru: "Ничего нет", en: "Nothing here right now.", uk: "Нічого немає" },
            kick_not_live: { ru: "Канал сейчас не в эфире", en: "This channel is not live right now", uk: "Канал зараз не в ефірі" },
            kick_no_connection: { ru: "Нет связи с Kick", en: "Can't reach Kick", uk: "Немає зв'язку з Kick" }
        });
    }

    /*
     * Same reason as in plugins/twitch.js: Lampa's menu Editor re-applies the
     * saved sidebar order ('menu_sort') and pushes labels it has not seen onto
     * the end, so the saved list has to be edited along with the DOM.
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
        var button = $('<li class="menu__item selector" data-action="kick"><div class="menu__ico">' + ICON + '</div><div class="menu__text">' + t("kick") + "</div></li>");
        button.on("hover:enter", function () {
            Lampa.Activity.push({ url: "", title: t("kick"), component: "kick", page: 1 });
        });

        function place() {
            var list = $(".menu .menu__list").eq(0);
            /* Directly under Twitch; Baseball in turn anchors itself under us. */
            var twitch = list.find('[data-action="twitch"]');
            if (twitch.length) { twitch.after(button); }
            else { list.prepend(button); }
            pinMenuOrder(t("kick"), twitch.length ? twitch.find(".menu__text").text().trim() : null);
        }
        place();
        /* Again once the Twitch plugin's own re-assert (1500ms) has run. */
        setTimeout(place, 1650);
    }

    /* ------------------------------------------------------------------ */
    /* Player: chat overlay + viewer count                                */
    /* ------------------------------------------------------------------ */

    var statsTimer = null;
    var watching = false;

    function hookPlayer() {
        if (!Lampa.Player || !Lampa.Player.listener) { return; }
        Lampa.Player.listener.follow("start", function (data) {
            if (!data || !data.kick_channel) { return; }
            watching = true;
            var chat = typeof StvChat !== "undefined" && StvChat.initKick ? StvChat : null;
            if (chat) {
                chat.initKick(data.kick_channel, data.kick_chat, data.kick_user);
                /* The panel button and colour keys live in the Twitch plugin. */
                if (window.StvChatControls) { window.StvChatControls.attach(); }
            }
            if (statsTimer) { clearInterval(statsTimer); }
            function tick() {
                Kick.viewers(data.kick_channel, function (err, count) {
                    if (!err && chat && watching) { chat.setViewers(count); }
                });
            }
            tick();
            statsTimer = setInterval(tick, 60000);
        });
        Lampa.Player.listener.follow("destroy", function () {
            if (!watching) { return; }
            watching = false;
            if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
            if (window.StvChatControls) { window.StvChatControls.detach(); }
            if (typeof StvChat !== "undefined") {
                try { StvChat.dispose(); } catch (e) { }
            }
        });
    }

    function startPlugin() {
        if (window.plugin_kick_ready) { return; }
        window.plugin_kick_ready = true;

        if (typeof Kick === "undefined") {
            console.log("Kick plugin", "js/kick.js is not loaded");
            return;
        }

        addLang();
        Lampa.Component.add("kick", Main);
        Lampa.Component.add("kick_list", List);
        Lampa.Component.add("kick_channel", Channel);
        hookPlayer();

        if (window.appready) { addMenu(); }
        else {
            Lampa.Listener.follow("app", function (e) {
                if (e.type === "ready") { addMenu(); }
            });
        }
    }

    if (!window.plugin_kick_ready) { startPlugin(); }
})();
