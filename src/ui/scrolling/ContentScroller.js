"use strict";

import Scroller from "scroller";
import Scrollbar from "ui/scrolling/Scrollbar";
import ApplicationDependencies from "ApplicationDependencies";
import { ensuredObjectField } from "util";

export default function ContentScroller(opts, deps) {
    opts = Object(opts);
    this._page = deps.page;

    this._domNode = this._page.$(ensuredObjectField(opts, "target")).eq(0);
    this._contentContainer = this._page.$(ensuredObjectField(opts, "contentContainer")).eq(0);

    this._scrollTop = 0;
    this._frameId = -1;

    this._containerHeight = 0;
    this._containerPadding = 0;
    this._top = this._left = 0;
    this._clearWillChangeTimerId = -1;
    this._willChangeSet = false;

    this._renderScroller = this._renderScroller.bind(this);
    this._renderScrollTop = this._renderScrollTop.bind(this);
    this._clearWillChange = this._clearWillChange.bind(this);

    this._scroller = new Scroller(this._renderScroller, ensuredObjectField(opts, "scrollerOpts"));
    var scrollbarOpts = ensuredObjectField(opts, "scrollbarOpts");
    scrollbarOpts.scrollerInfo = this;
    this._scrollbar = new Scrollbar(scrollbarOpts, new ApplicationDependencies({
        page: this._page
    }));
    this._scrollerEventBinding = deps.scrollEvents.createBinding({
        target: this.$contentContainer(),
        scroller: this._scroller,
        scrollbar: this._scrollbar,
        shouldScroll: opts.shouldScroll
    });
    this.refresh();
    deps.ensure();
}

ContentScroller.prototype.$ = function() {
    return this._domNode;
};

ContentScroller.prototype.$contentContainer = function() {
    return this._contentContainer;
};

ContentScroller.prototype.getTopLeft = function() {
    return this.$()[0].getBoundingClientRect();
};

ContentScroller.prototype.refresh = function() {
    this._containerHeight = this.$()[0].clientHeight;
    this._containerPadding = this._containerHeight - this.$().innerHeight();
};

ContentScroller.prototype.physicalHeight = function() {
    return this.$contentContainer()[0].clientHeight;
};

ContentScroller.prototype.contentHeight = function() {
    return this.$().innerHeight();
};

ContentScroller.prototype._scheduleRender = function() {
    if (this._frameId === -1) {
        this._clearWillChangeTimer();
        this._setWillChange();
        this._frameId = this._page.requestAnimationFrame(this._renderScrollTop);
    }
};

ContentScroller.prototype._renderScrollTop = function() {
    this._clearWillChangeTimerId = this._page.setTimeout(this._clearWillChange, 500);
    this._frameId = -1;
    var y = -this._scrollTop;
    this.$contentContainer().setTransform("translate3d(0px, "+y+"px, 0px)");
    this._scrollbar.render(this._scrollTop);
};


ContentScroller.prototype._clearWillChangeTimer = function() {
    this._page.clearTimeout(this._clearWillChangeTimerId);
    this._clearWillChangeTimerId = -1;
};

ContentScroller.prototype._clearWillChange = function() {
    if (!this._willChangeSet) return;
    this._willChangeSet = false;
    this.$contentContainer().setStyle("willChange", "");
};

ContentScroller.prototype._setWillChange = function() {
    if (this._willChangeSet) return;
    this._willChangeSet = true;
    this.$contentContainer().setStyle("willChange", "transform");
};

ContentScroller.prototype._renderScroller = function(left, top) {
    if (!this.needScrollbar()) top = 0;
    this._scrollTop = top;
    this._scheduleRender();
};

ContentScroller.prototype.needScrollbar = function() {
    return this.physicalHeight() > this.contentHeight();
};

ContentScroller.prototype.scrollToUnsnapped = function(top, animate) {
    top = Math.max(0, Math.min(this.maxTop(), +top));
    if (!this.needScrollbar()) top = 0;
    this._scrollTop = top;
    this._scroller.scrollTo(null, top, !!animate);
};

ContentScroller.prototype.maxTop = function() {
    return this.physicalHeight() - this.contentHeight();
};

ContentScroller.prototype.scrollBy = function(amount) {
    if (amount === 0) return;
    var maxTop = this.maxTop();
    var top = this.settledScrollTop() + amount;
    top = Math.max(0, Math.min(Math.round(top), maxTop));
    this._scrollTop = top;
    this._scroller.scrollTo(null, top, false);
};

ContentScroller.prototype.resize = function() {
    var topLeft = this.getTopLeft();
    this._left = topLeft.left;
    this._top = topLeft.top;
    var width = this.$().innerWidth();
    var maxTop = this.maxTop();
    var top = this.needScrollbar() ? Math.min(maxTop, Math.max(0, this._scrollTop)) : 0;
    this._scrollTop = top;
    this._scrollbar.resize();
    this._scroller.setPosition(this._left, this._top);
    this._scroller.setDimensions(width, this.contentHeight(), width, this.physicalHeight());
    this._scroller.scrollTo(null, top, false);
};

ContentScroller.prototype.loadScrollTop = function(top) {
    this._scrollTop = top;
    this.resize();
};

ContentScroller.prototype.settledScrollTop = function() {
    if (!this.needScrollbar()) return 0;
    return this._scrollTop|0;
};

ContentScroller.prototype.scrollIntoView = function(elem, animate) {
    var scrollTop = this.settledScrollTop();
    var height = this.contentHeight();
    var rect = elem.getBoundingClientRect();
    var elemStart = rect.top - this._top + scrollTop;
    var elemEnd = rect.bottom - this._top + scrollTop;

    var visibleStart = scrollTop;
    var visibleEnd = scrollTop + height;

    if (elemStart >= visibleStart && elemEnd <= visibleEnd) {
        return;
    }

    var pos = elemEnd < visibleStart ? elemStart : elemEnd;

    this.scrollToUnsnapped(pos / this.physicalHeight() * this.maxTop(), !!animate);
};
