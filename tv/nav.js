/*
 * Spatial (remote-friendly) focus navigation for the self-rendered TV app.
 * Geometry based: arrow keys move focus to the nearest ".focusable" element
 * in the pressed direction. ES5 only (old webOS/Tizen browsers).
 */
var Nav = (function () {
    "use strict";

    var current = null;
    var scope = document;   /* limit focusables to this element (e.g. a dialog) */
    var changeCb = null;    /* fired whenever focus actually moves to a new element */

    function isVisible(el) {
        if (!el) { return false; }
        if (el.offsetWidth <= 0 && el.offsetHeight <= 0) { return false; }
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function focusables() {
        var list = (scope || document).querySelectorAll(".focusable");
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.getAttribute("data-disabled") === "1") { continue; }
            if (isVisible(el)) { out.push(el); }
        }
        return out;
    }

    function center(el) {
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r };
    }

    function scrollIntoView(el) {
        try {
            if (el.scrollIntoView) { el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
        } catch (e) {
            try { el.scrollIntoView(false); } catch (e2) { }
        }
    }

    function setScope(el) { scope = el || document; }

    function setFocus(el) {
        if (el == null || el === current) {
            if (el && el === current) { scrollIntoView(el); }
            return;
        }
        if (current) { current.className = current.className.replace(/\bfocused\b/g, "").replace(/\s+$/, ""); }
        current = el;
        if (current.className.indexOf("focused") < 0) { current.className += " focused"; }
        scrollIntoView(current);
        if (changeCb) { try { changeCb(current); } catch (e) { } }
    }

    function focusFirst() {
        var f = focusables();
        if (f.length) { setFocus(f[0]); return true; }
        current = null;
        return false;
    }

    /* Re-focus a valid element if the current one vanished (after a re-render) */
    function refocus() {
        if (current && isVisible(current) && (scope || document).contains(current)) {
            if (current.className.indexOf("focused") < 0) { current.className += " focused"; }
            return;
        }
        focusFirst();
    }

    function move(dir) {
        var all = focusables();
        if (all.length === 0) { current = null; return; }
        if (!current || !isVisible(current)) { setFocus(all[0]); return; }

        var cc = center(current);
        var best = null, bestScore = Infinity;

        for (var i = 0; i < all.length; i++) {
            if (all[i] === current) { continue; }
            var c = center(all[i]);
            var dx = c.x - cc.x;
            var dy = c.y - cc.y;
            var inDir =
                (dir === "left" && dx < -2) ||
                (dir === "right" && dx > 2) ||
                (dir === "up" && dy < -2) ||
                (dir === "down" && dy > 2);
            if (!inDir) { continue; }

            var primary, cross;
            if (dir === "left" || dir === "right") { primary = Math.abs(dx); cross = Math.abs(dy); }
            else { primary = Math.abs(dy); cross = Math.abs(dx); }

            /* Prefer aligned elements: weight the cross-axis distance heavily. */
            var score = primary + cross * 4;
            if (score < bestScore) { bestScore = score; best = all[i]; }
        }
        if (best) { setFocus(best); }
        return best != null;
    }

    return {
        move: move,
        setFocus: setFocus,
        focusFirst: focusFirst,
        refocus: refocus,
        setScope: setScope,
        focusables: focusables,
        onChange: function (fn) { changeCb = fn; },
        current: function () { return current; }
    };
})();
