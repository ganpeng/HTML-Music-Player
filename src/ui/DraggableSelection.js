"use strict";

import { inherits, ensuredObjectField, ensuredStringField } from "util";
import Selectable from "ui/Selectable";
import EventEmitter from "events";

const DRAG_START_DELAY_MS = 300;

export default function DraggableSelection(opts, deps) {
    EventEmitter.call(this);
    opts = Object(opts);
    this._page = deps.page;
    this._recognizerContext = deps.recognizerContext;
    this._globalEvents = deps.globalEvents;

    this._mustMatchSelector = ensuredStringField(opts, "mustMatchSelector");
    this._mustNotMatchSelector = ensuredStringField(opts, "mustNotMatchSelector");
    this._fixedItemListScroller = ensuredObjectField(opts, "scroller");
    this._domNode = this._page.$(ensuredObjectField(opts, "target")).eq(0);
    this._listView = ensuredObjectField(opts, "listView");
    this._selection = null;
    this._previousRawY = -1;
    this._currentReferenceItemView = -1;
    this._dragStartDelayId = -1;
    this._holdingStartedY = -1;
    this._draggableDirections = {down: false, up: false};
    this._startDragFromTimeout = this._startDragFromTimeout.bind(this);
    this._onMovement = this._onMovement.bind(this);
    this._onMouseRelease = this._onMouseRelease.bind(this);
    this._onItemViewMouseDown = this._onItemViewMouseDown.bind(this);
    this._onReLayout = this._onReLayout.bind(this);
    this._restart = this._restart.bind(this);
    this._onTouchmove = this._onTouchmove.bind(this);
    this._onTouchend = this._onTouchend.bind(this);
    this._dragRecognizer = this._recognizerContext.createModifierDragRecognizer(this._onTouchmove, this._onTouchend);
    this._touchdownRecognizer = this._recognizerContext.createModifierTouchdownRecognizer(this._onItemViewMouseDown);
    this._isDragging = false;
    this._dragStartFired = false;
    this._scroll = this._scroll.bind(this);
    this._scrollIntervalId = -1;
    this._justStoppedDragging = false;
    deps.ensure();
}
inherits(DraggableSelection, EventEmitter);

DraggableSelection.prototype.recentlyStoppedDragging = function() {
    return this._justStoppedDragging;
};

DraggableSelection.prototype.bindEvents = function() {
    this._touchdownRecognizer.recognizeBubbledOn(this.$());
    this.$().addEventListener("mousedown", this._onItemViewMouseDown);
    this.$().addEventListener("selectstart", this._page.preventDefaultHandler);
};

DraggableSelection.prototype.isDragging = function() {
    return this._isDragging;
};

DraggableSelection.prototype._clearScrollInterval = function() {
    this._page.clearInterval(this._scrollIntervalId);
    this._scrollIntervalId = -1;
};

DraggableSelection.prototype._startDragFromTimeout = function() {
    var yMoved = Math.abs(this._holdingStartedY - this._previousRawY);
    this._dragStartDelayId = -1;
    if (yMoved > this._fixedItemListScroller.itemHeight()) {
        this._onMouseRelease();
    } else {
        this._fireDragStart();
    }
};

DraggableSelection.prototype._startDragStartDelay = function() {
    this._justStoppedDragging = false;
    this._clearDragStartDelay();
    this._dragStartDelayId = this._page.setTimeout(this._startDragFromTimeout, DRAG_START_DELAY_MS);
};

DraggableSelection.prototype._clearDragStartDelay = function() {
    this._page.clearTimeout(this._dragStartDelayId);
    this._dragStartDelayId = -1;
};

DraggableSelection.prototype._scroll = function() {
    var edge = this._fixedItemListScroller.getEdgeByCoordinateWithinMargin(this._previousRawY,
                                                                           this._fixedItemListScroller.itemHeight());
    this._fixedItemListScroller.scrollBy(edge * this._fixedItemListScroller.itemHeight());

    if (edge !== 0) {
        this._onMovement({clientY: this._previousRawY, type: "scroll", which: 1});
    }
};

DraggableSelection.prototype.$ = function() {
    return this._domNode;
};

DraggableSelection.prototype._onReLayout = function() {
    this._currentReferenceItemView = this._fixedItemListScroller.indexByYCoordinate(this._previousRawY);
};

DraggableSelection.prototype._onTouchmove = function(e) {
    return this._onMovement(e);
};

DraggableSelection.prototype._onTouchend = function(e) {
    return this._onMouseRelease(e);
};

DraggableSelection.prototype._onMouseRelease = function() {
    this._clearDragStartDelay();
    if (!this._isDragging) return;
    var dragStartWasFired = this._dragStartFired;
    this._dragStartFired = false;
    this._isDragging = false;
    this.$().removeEventListener("scroll", this._onMovement);

    this._page.removeDocumentListener("mousemove", this._onMovement);
    this._page.removeDocumentListener("mouseup", this._onMouseRelease);
    this._globalEvents.removeListener("resize", this._onReLayout);
    this._dragRecognizer.unrecognizeBubbledOn(this._page.document());

    this._listView.removeListener("tracksSelected", this._restart);
    this._listView.removeListener("lengthChange", this._restart);
    this._listView.removeListener("trackOrderChange", this._restart);

    this._holdingStartedY = this._currentReferenceItemView = this._previousRawY = -1;
    this._clearScrollInterval();
    if (dragStartWasFired) {
        for (var i = 0; i < this._selection.length; ++i) {
            this._selection[i].stopDragging();
        }
    }
    this._selection = null;
    this.emit("dragEnd");

    if (dragStartWasFired) {
        var self = this;
        this._justStoppedDragging = true;
        this._dragStartDelayId = this._page.setTimeout(function() {
            self._justStoppedDragging = false;
        }, 13);
    }
};

DraggableSelection.prototype._fireDragStart = function() {
    if (!this._dragStartFired && this._isDragging) {
        this._dragStartFired = true;
        this.emit("dragStart");
        for (var i = 0; i < this._selection.length; ++i) {
            this._selection[i].startDragging();
        }
    }
};

DraggableSelection.prototype._onMovement = function(e) {
    if (!this._page.isTouchEvent(e) && e.which !== 1) {
        return this._onMouseRelease();
    }

    var clientY = typeof e.clientY === "number" ? e.clientY : this._previousRawY;
    this._previousRawY = clientY;

    if (!this._dragStartFired) {
        return;
    }

    if (this._scrollIntervalId === -1) {
        this._scrollIntervalId = this._page.setInterval(this._scroll, 100);
    }

    var itemHeight = this._fixedItemListScroller.itemHeight();

    var y = this._fixedItemListScroller.mapYCoordinate(clientY);
    var selection = this._selection;
    var itemViews = this._listView.getTrackViews();
    var referenceY = this._currentReferenceItemView * itemHeight;

    var changed = false;
    if (y < referenceY && this._draggableDirections.up) {
        var distance = Math.floor((referenceY - y) / itemHeight) + 1;
        this._currentReferenceItemView = Math.max(0, this._currentReferenceItemView - distance);
        Selectable.moveSelectedItemViewsUpBy(itemViews, selection, distance);
        changed = true;
        referenceY = this._currentReferenceItemView * itemHeight;
    } else if (y > (referenceY + itemHeight) && this._draggableDirections.down) {
        var distance = Math.floor((y - (referenceY + itemHeight)) / itemHeight) + 1;
        this._currentReferenceItemView = Math.min(this._listView.length - 1, this._currentReferenceItemView + distance);
        Selectable.moveSelectedItemViewsDownBy(itemViews, selection, distance);
        changed = true;
        referenceY = this._currentReferenceItemView * itemHeight;
    }

    for (var i = 0; i < selection.length; ++i) {
        selection[i].setOffset(y - referenceY);
    }

    if (changed) {
        this._determineDraggableDirections(selection);
        this._listView.trackIndexChanged();
    }
};

DraggableSelection.prototype._restart = function() {
    var oldSelection = this._selection.slice();
    this._selection = this._listView.getSelection();

    if (this._dragStartFired) {
        for (var i = 0; i < oldSelection.length; ++i) {
            var itemView = oldSelection[i];

            if (!this._listView.isSelected(itemView)) {
                itemView.stopDragging();
            }
        }

        for (var i = 0; i < this._selection.length; ++i) {
            this._selection[i].startDragging();
        }

        this._determineDraggableDirections(this._selection);
    }

    if (!this._selection.length) {
        return this._onMouseRelease();
    }
    this._onReLayout();
};

DraggableSelection.prototype._determineDraggableDirections = function(selection) {
    if (selection.length > 0) {
        this._draggableDirections.down = selection[selection.length - 1].getIndex() < this._listView.length - 1;
        this._draggableDirections.up = selection[0].getIndex() > 0;
    } else {
        this._draggableDirections.down = this._draggableDirections.up = false;
    }
};

DraggableSelection.prototype._onItemViewMouseDown = function(e) {
    if (this._isDragging) {
        return;
    }

    var $target = this._page.$(e.target);
    if (this._mustMatchSelector && !$target.closest(this._mustMatchSelector).length) {
        return;
    }

    if (this._mustNotMatchSelector && $target.closest(this._mustNotMatchSelector).length) {
        return;
    }

    if (!this._listView.getSelectedItemViewCount()) {
        return;
    }

    if (this._page.isTouchEvent(e) &&
        (!this._listView.selectionContainsAnyItemViewsBetween(e.clientY, e.clientY) ||
        e.isFirst === false)) {
        return;
    }

    var selection = this._listView.getSelection();
    this._determineDraggableDirections(selection);
    this._selection = selection;

    this._startDragStartDelay();
    this._isDragging = true;
    this._previousRawY = e.clientY;
    this._holdingStartedY = e.clientY;

    this._onReLayout();

    this._page.addDocumentListener("mousemove", this._onMovement);
    this._page.addDocumentListener("mouseup", this._onMouseRelease);
    this._globalEvents.on("resize", this._onReLayout);
    this._dragRecognizer.recognizeBubbledOn(this._page.document());
    this._listView.on("tracksSelected", this._restart);
    this._listView.on("lengthChange", this._restart);
    this._listView.on("trackOrderChange", this._restart);
};
