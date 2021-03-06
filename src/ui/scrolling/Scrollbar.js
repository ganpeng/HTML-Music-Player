"use strict";

export default function Scrollbar(opts, deps) {
    opts = Object(opts);
    this._page = deps.page;
    this._domNode = this._page.$(opts.target).eq(0);
    this._rail = this.$().find(opts.railSelector);
    this._knob = this.$().find(opts.knobSelector);
    this._rect = this.$()[0].getBoundingClientRect();
    this._knobRect = this.$knob()[0].getBoundingClientRect();
    this._scrollerInfo = opts.scrollerInfo;
    this._scrolling = false;
    this._timerId = -1;
    this._anchorDistance = -1;
    this._hasScroll = false;

    this._stopScrolling = this._stopScrolling.bind(this);
    this._railMousedowned = this._railMousedowned.bind(this);
    this._knobMousedowned = this._knobMousedowned.bind(this);
    this._knobMousereleased = this._knobMousereleased.bind(this);
    this._knobMousemoved = this._knobMousemoved.bind(this);
    this._rebindRailmouseDowned = this._rebindRailmouseDowned.bind(this);
    this._clicked = this._clicked.bind(this);
    this._restoreClicks = this._restoreClicks.bind(this);
    this.resize();

    this.$knob().addEventListener("mousedown", this._knobMousedowned);
    this.$knob().addEventListener("click", this._clicked, true);
    this.$rail().addEventListener("click", this._clicked, true);
    this._page.addDocumentListener("mouseup", this._rebindRailmouseDowned);
    this._rebindRailmouseDowned();
    deps.ensure();
}

Scrollbar.prototype.willScroll = function() {
    this.$knob().setStyle("willChange", "transform");
};

Scrollbar.prototype.willStopScrolling = function() {
    this.$knob().setStyle("willChange", "");
};

Scrollbar.prototype.determineScrollInversion = function(delta) {
    return delta;
};

Scrollbar.prototype.$ = function() {
    return this._domNode;
};

Scrollbar.prototype.$rail = function() {
    return this._rail;
};

Scrollbar.prototype.$knob = function() {
    return this._knob;
};

Scrollbar.prototype._restoreClicks = function() {
    this._page.removeDocumentListener("click", this._clicked, true);
    this._page.removeDocumentListener("dblclick", this._clicked, true);
};

Scrollbar.prototype._rebindRailmouseDowned = function() {
    this._page.setTimeout(this._restoreClicks, 0);
    this.$rail().removeEventListener("mousedown", this._railMousedowned)
                .addEventListener("mousedown", this._railMousedowned);
};

Scrollbar.prototype._scrollByCoordinate = function(y, animate) {
    y = Math.min(this._rect.height, Math.max(0, y - this._rect.top));
    var percentage = y / this._rect.height;
    var px = Math.round(percentage * this._scrollerInfo.physicalHeight());
    this._scrollerInfo.scrollToUnsnapped(px, animate);
};

Scrollbar.prototype._railMousedowned = function(e) {
    if (!this._hasScroll) return;
    if (this._page.$(e.target).closest(this.$knob()).length > 0) return;
    if (e.which !== 1) return;
    this.willScroll();
    e.stopImmediatePropagation();
    this._scrollByCoordinate(e.clientY, false);
    this.$rail().removeEventListener("mousedown", this._railMousedowned);
    this._page.addDocumentListener("click", this._clicked, true);
    this._page.addDocumentListener("dblclick", this._clicked, true);
};

Scrollbar.prototype._knobMousedowned = function(e) {
    if (!this._hasScroll) return;
    if (e.which !== 1) return;
    this.willScroll();
    e.stopImmediatePropagation();
    this._rect = this.$()[0].getBoundingClientRect();
    this._knobRect = this.$knob()[0].getBoundingClientRect();
    this._anchorDistance = e.clientY - this._knobRect.top;

    this._page.addDocumentListener("mousemove", this._knobMousemoved);
    this._page.addDocumentListener("mouseup", this._knobMousereleased);
    this._page.addDocumentListener("click", this._clicked, true);
    this._page.addDocumentListener("dblclick", this._clicked, true);
};

Scrollbar.prototype._knobMousereleased = function() {
    this._page.removeDocumentListener("mousemove", this._knobMousemoved);
    this._page.removeDocumentListener("mouseup", this._knobMousereleased);
    this._page.setTimeout(this._restoreClicks, 0);
    this.willStopScrolling();
};

Scrollbar.prototype._clicked = function(e) {
    e.stopPropagation();
    e.preventDefault();
};

Scrollbar.prototype._stopScrolling = function() {
    this._page.clearTimeout(this._timerId);
    this._scrolling = false;
    this.$().removeClass("scrolling");
    this._timerId = -1;
    this.willStopScrolling();
};

Scrollbar.prototype._knobMousemoved = function(e) {
    if (e.which !== 1 || !this._hasScroll) {
        return this._knobMousereleased();
    }
    this._scrollByCoordinate(Math.max(0, e.clientY - this._anchorDistance), false);
};

Scrollbar.prototype.render = function(y, dimensionsChanged) {
    if (!dimensionsChanged && !this._hasScroll) return;
    var percentage;
    var physicalHeight = Math.max(this._scrollerInfo.physicalHeight() - this._scrollerInfo.contentHeight(), 0);
    if (physicalHeight === 0) {
        percentage = 0;
    } else {
        percentage = y / physicalHeight;
    }
    percentage = Math.min(1, Math.max(0, percentage));
    var room = this._rect.height - this._knobRect.height;
    var px = Math.round(room * percentage);

    if (!dimensionsChanged) {
        if (!this._scrolling) {
            this._scrolling = true;
            this.$().addClass("scrolling");
        }
        this._page.clearTimeout(this._timerId);
        this._timerId = this._page.setTimeout(this._stopScrolling, 450);
    }

    this.$knob().setTransform("translate3d(0, " + px + "px, 0)");
};

Scrollbar.prototype.resize = function() {
    var physicalHeight = this._scrollerInfo.physicalHeight();
    var rect = this._rect = this.$()[0].getBoundingClientRect();

    if (rect.height >= physicalHeight) {
        this.$knob().setStyle("height", "0px");
        this._hasScroll = false;
        this._stopScrolling();
    } else {
        var percentage = rect.height / physicalHeight;
        var pxHeight = Math.max(20, percentage * rect.height|0);
        this.$knob().setStyle("height", pxHeight + "px");
        this._hasScroll = true;
    }

    this._knobRect = this.$knob()[0].getBoundingClientRect();
    this.render(this._scrollerInfo.settledScrollTop(), true);
};
