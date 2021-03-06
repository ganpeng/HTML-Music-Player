"use strict";

import EventEmitter from "events";
import { inherits, noop, ensuredStringField, ensuredIntegerField } from "util";

const NO_TAG = {};

function SnackbarInstance(snackbar, message, opts) {
    EventEmitter.call(this);
    opts = Object(opts);
    this.outcome = Snackbar.NO_OUTCOME;
    this.tag = opts.tag || NO_TAG;
    this.visibilityTime = opts.visibilityTime || snackbar.visibilityTime || 5000;

    this._exiting = false;
    this._visible = !snackbar.globalEvents.isWindowBackgrounded();
    this._snackbar = snackbar;
    this._startedShowing = this._visible ? Date.now() : -1;
    this._initialShowing = Date.now();
    this._isHovering = false;

    this._actionDom = null;
    this._titleDom = null;
    this._domNode = null;
    this._initDom(message, opts);

    this._visibilityChanged = this._visibilityChanged.bind(this);
    this._clicked = this._clicked.bind(this);
    this._timeoutChecker = this._timeoutChecker.bind(this);
    this._mouseEntered = this._mouseEntered.bind(this);
    this._mouseLeft = this._mouseLeft.bind(this);
    this._resized = this._resized.bind(this);


    this.$().addEventListener("click", this._clicked);
    this.$().addEventListener("mouseenter", this._mouseEntered);
    this.$().addEventListener("mouseleave", this._mouseLeft);
    this._snackbar.globalEvents.on("resize", this._resized);
    this._snackbar.globalEvents.on("visibilityChange", this._visibilityChanged);

    snackbar.recognizerContext.createTapRecognizer(this._clicked).recognizeBubbledOn(this.$());
    this._checkerTimerId = this.page().setTimeout(this._timeoutChecker, this.visibilityTime);

    if (this._snackbar.transitionInClass) {
        this.$().addClass([this._snackbar.transitionInClass, "initial"]);
        this.$().setStyle("willChange", "transform");
        this.$().appendTo("body");
        this._resized();
        this.$().detach();
        this.$().appendTo("body");
        this.$().forceReflow();
        this._snackbar.beforeTransitionIn(this.$());
        var self = this;
        this.page().changeDom(function() {
            self.$().removeClass("initial");
            self.page().setTimeout(function() {
                self.$().setStyle("willChange", "");
            }, 500);
        });
    } else {
        this.$().appendTo("body");
        this._resized();
    }
}
inherits(SnackbarInstance, EventEmitter);

SnackbarInstance.prototype._resized = function() {
    var box = this.$()[0].getBoundingClientRect();
    var maxWidth = this.page().width();
    this.$().setStyles({
        left: (Math.max(0, maxWidth - box.width) / 2) + "px",
        height: box.height + "px"
    });
};

SnackbarInstance.prototype.$ = function() {
    return this._domNode;
};

SnackbarInstance.prototype.$action = function() {
    return this._actionDom;
};

SnackbarInstance.prototype.$title = function() {
    return this._titleDom;
};

SnackbarInstance.prototype._clearTimer = function() {
    this.page().clearTimeout(this._checkerTimerId);
    this._checkerTimerId = -1;
};

SnackbarInstance.prototype._initDom = function(message, opts) {
    var action = this.page().$();
    if (opts.action) {
        action = this.page().createElement("div", {class: this._snackbar.actionClass});

        var actionTextContainer = this.page().createElement("div", {
            class: this._snackbar.textContainerClass
        });
        var actionText = this.page().createElement("div", {
            class: this._snackbar.textClass
        });

        actionTextContainer.append(actionText);
        actionText.setText(opts.action + "").appendTo(actionTextContainer);
        action.append(actionTextContainer);

        this._actionDom = action;
    }

    var title = this.page().createElement("div", {
        class: this._snackbar.titleClass
    }).setText(message);

    this._titleDom = title;

    var snackbar = this.page().createElement("div", {
        class: this._snackbar.containerClass
    }).append(title).append(action);

    this._domNode = snackbar;
};

SnackbarInstance.prototype.replace = function(message) {
    var self = this;
    this.$title().setText(message + "");
    this._startedShowing = Date.now();
    return new Promise(function(resolve) {
        self.once("hide", function() {
            resolve(self.outcome);
        });
    });
};

SnackbarInstance.prototype._mouseEntered = function() {
    this._clearTimer();
    this._isHovering = true;
};

SnackbarInstance.prototype._mouseLeft = function() {
    this._clearTimer();
    this._startedShowing = Date.now();
    this._isHovering = false;
    this._checkerTimerId = this.page().setTimeout(this._timeoutChecker, this.visibilityTime);
};

SnackbarInstance.prototype._timeoutChecker = function() {
    this._checkerTimerId = -1;
    if (this._exiting) return;
    var visibilityTime = this.visibilityTime;
    var shownTime = this._startedShowing === -1 ? 0 : Date.now() - this._startedShowing;

    if (!this._snackbar.globalEvents.isWindowBackgrounded() && !this._isHovering) {
        if (shownTime > visibilityTime) {
            this.outcome = Snackbar.TIMED_OUT;
            this._hide();
        } else {
            this._checkerTimerId = this.page().setTimeout(this._timeoutChecker, Math.max(0, visibilityTime - shownTime));
        }
    }
};

SnackbarInstance.prototype._visibilityChanged = function() {
    this._clearTimer();
    this._startedShowing = Date.now();
    this._checkerTimerId = this.page().setTimeout(this._timeoutChecker, this.visibilityTime);
};

SnackbarInstance.prototype._clicked = function(e) {
    var hasBeenActiveMilliseconds = Date.now() - this._initialShowing;
    var dismissable = hasBeenActiveMilliseconds >
            (this._snackbar.initialUndismissableWindow + this._snackbar.nextDelay);


    var action = this.$action();
    if (action && this.page().$(e.target).closest(action).length > 0) {
        this.outcome = Snackbar.ACTION_CLICKED;
    } else if (dismissable) {
        this.outcome = Snackbar.DISMISSED;
    }

    if (this.outcome !== Snackbar.NO_OUTCOME) {
        this._hide();
    }
};

SnackbarInstance.prototype._hide = function() {
    if (this._exiting) return;
    this._exiting = true;
    this._removeListeners();
    if (this._snackbar.transitionOutClass) {
        this.$().detach();
        if (this._snackbar.transitionInClass) {
            this.$().removeClass([this._snackbar.transitionInClass, "initial"]);
        }
        this.$().setStyle("willChange", "transform");
        this.$().addClass([this._snackbar.transitionOutClass, "initial"]);
        this.$().appendTo("body");
        this.$().forceReflow();
        this._snackbar.beforeTransitionOut(this.$());
        var self = this;
        this.page().changeDom(function() {
            self.$().removeClass("initial");
        });
    }

    var self = this;
    function doHide() {
        self.emit("hide", self);
        self._destroy();
    }

    if (this.outcome !== Snackbar.ACTION_CLICKED) {
        this.page().setTimeout(doHide, this._snackbar.nextDelay);
    } else {
        doHide();
    }
};

SnackbarInstance.prototype._removeListeners = function() {
    this.$().removeEventListener("click", this._clicked);
    this._snackbar.globalEvents.removeListener("resize", this._resized);
    this._snackbar.globalEvents.removeListener("visibilityChange", this._visibilityChanged);
    this._clearTimer();
};

SnackbarInstance.prototype._destroy = function() {
    this._removeListeners();
    this.$().remove();
};

SnackbarInstance.prototype.page = function() {
    return this._snackbar.page;
};

export default function Snackbar(opts, deps) {
    opts = Object(opts);
    this.page = deps.page;
    this.globalEvents = deps.globalEvents;
    this.recognizerContext = deps.recognizerContext;

    this.containerClass = ensuredStringField(opts, "containerClass");
    this.actionClass = ensuredStringField(opts, "actionClass");
    this.titleClass = ensuredStringField(opts, "titleClass");
    this.textContainerClass = ensuredStringField(opts, "textContainerClass");
    this.textClass = ensuredStringField(opts, "textClass");
    this.transitionInClass = ensuredStringField(opts, "transitionInClass");
    this.transitionOutClass = ensuredStringField(opts, "transitionOutClass");
    this.beforeTransitionIn = opts.beforeTransitionIn || noop;
    this.beforeTransitionOut = opts.beforeTransitionOut || noop;
    this.nextDelay = ensuredIntegerField(opts, "nextDelay");
    this.visibilityTime = ensuredIntegerField(opts, "visibilityTime");
    this.initialUndismissableWindow = ensuredIntegerField(opts, "initialUndismissableWindow");

    this.maxLength = opts.maxLength || 3;

    this._currentInstance = null;
    this._queue = [];

    this._nextDelayId = -1;
    this._next = this._next.bind(this);

    deps.ensure();
}

Snackbar.prototype._next = function() {
    this.page.clearTimeout(this._nextDelayId);
    this._nextDelayId = -1;

    var self = this;
    this._nextDelayId = this.page.setTimeout(function() {
        self._currentInstance = null;
        if (self._queue.length) {
            var item = self._queue.shift();
            item.resolve(self.show(item.message, item.opts));
        }
    }, this.nextDelay);
};

Snackbar.prototype.removeByTag = function(tag) {
    var queue = this._queue;
    for (var i = 0; i < queue.length; ++i) {
        if (queue[i].opts.tag === tag) {
            queue.splice(i, 1);
            i--;
        }
    }

    if (this._currentInstance &&
        !this._currentInstance._exiting &&
        this._currentInstance.tag === tag) {
        this._currentInstance.outcome = Snackbar.DISMISSED;
        this._currentInstance._hide();
    }
};

Snackbar.prototype.show = function(message, opts) {
    opts = Object(opts);
    var self = this;

    if (opts.tag && self._currentInstance &&
        opts.tag === self._currentInstance.tag &&
        !self._currentInstance._exiting) {
        self._currentInstance.removeAllListeners("hide");
        return self._currentInstance.replace(message).finally(function() {
            self._next();
        });
    }

    var queue = self._queue;
    var resolve, promise;
    promise = new Promise(function() {
        resolve = arguments[0];
    });

    if (self._currentInstance) {
        if (opts.tag && queue.length) {
            for (var i = 0; i < queue.length; ++i) {
                if (queue[i].opts.tag === opts.tag) {
                    resolve(queue[i].promise);
                    queue[i].message = message;
                    return promise;
                }
            }
        }

        if (queue.length >= this.maxLength) {
            queue.pop();
        }

        queue.push({
            message: message,
            opts: opts,
            resolve: resolve,
            promise: promise
        });
        return promise;
    }
    var instance = new SnackbarInstance(self, message, opts);
    self._currentInstance = instance;
    instance.once("hide", function() {
        resolve(instance.outcome);
        self._next();
    });

    return promise;
};

Snackbar.NO_OUTCOME = -1;
Snackbar.ACTION_CLICKED = 0;
Snackbar.DISMISSED = 1;
Snackbar.TIMED_OUT = 2;
