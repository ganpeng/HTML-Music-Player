"use strict";

import { inherits, toFunction, ensuredStringField, ensuredIntegerField } from "util";
import EventEmitter from "events";

const TRANSITION_IN_DURATION = 300;
const TRANSITION_OUT_DURATION = 200;

function ActionMenuItem(root, spec, children, level) {
    this.root = root;
    this.parent = null;
    this.children = children;
    this.id = spec.id;
    this.divider = !!spec.divider;
    this.disabled = !!spec.disabled;
    this.handler = toFunction(spec.onClick);
    this.enabledPredicate = spec.enabledPredicate;

    this._preferredHorizontalDirection = "end";
    this._preferredVerticalDirection = "end";
    this._delayTimerId = -1;
    this._content = toFunction(spec.content);
    this._containerDom = this.page().NULL();
    this._domNode = this._createDom();

    if (this.disabled) this.$().addClass(this.root.disabledClass);

    this.itemMouseEntered = this.itemMouseEntered.bind(this);
    this.itemMouseLeft = this.itemMouseLeft.bind(this);
    this.containerMouseEntered = this.containerMouseEntered.bind(this);
    this.containerMouseLeft = this.containerMouseLeft.bind(this);
    this.itemClicked = this.itemClicked.bind(this);
    this.positionSubMenu = this.positionSubMenu.bind(this);
    this.itemTouchStarted = this.itemTouchStarted.bind(this);

    this.containerTouchedRecognizer = this.root.recognizerContext.createTouchdownRecognizer(this.containerMouseEntered);
    this.tapRecognizer = this.root.recognizerContext.createTapRecognizer(this.itemClicked);
    this.itemTouchedRecognizer = this.root.recognizerContext.createTouchdownRecognizer(this.itemTouchStarted);

    if (this.children) {
        this._containerDom = this._createContainerDom(level);
        this.children.forEach(function(child) {
            child.setParent(this);
        }, this);

        this.$().addEventListener("mouseenter", this.itemMouseEntered);
        this.$().addEventListener("mouseleave", this.itemMouseLeft);
        this.$container().addEventListener("mouseenter", this.containerMouseEntered);
        this.$container().addEventListener("mouseleave", this.containerMouseLeft);

        this.containerTouchedRecognizer.recognizeBubbledOn(this.$container());
    }

    if (!this.divider) {
        this.$().addEventListener("click", this.itemClicked);
        this.tapRecognizer.recognizeBubbledOn(this.$());
        this.itemTouchedRecognizer.recognizeBubbledOn(this.$());
    }
}

ActionMenuItem.prototype.page = function() {
    return this.root.page;
};

ActionMenuItem.prototype.destroy = function() {
    this._clearDelayTimer();
    this.$().remove();
    this.$container().remove();
};

ActionMenuItem.prototype._clearDelayTimer = function() {
    this.page().clearTimeout(this._delayTimerId);
    this._delayTimerId = -1;
};

ActionMenuItem.prototype.startHideTimer = function() {
    this._clearDelayTimer();
    var self = this;
    this._delayTimerId = this.page().setTimeout(function() {
        self._delayTimerId = -1;
        self.hideContainer();
    }, this.root.hideDelay);
};

ActionMenuItem.prototype.hideChildren = function(targetMenuItem) {
    for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i];
        if (child.children) {
            if (targetMenuItem && this.page().$(targetMenuItem).closest(child.$()).length) {
                continue;
            }
            child.startHideTimer();
            child.hideChildren();
        }
    }
};

ActionMenuItem.prototype.menuItemTouchStarted = function(child) {
    for (var i = 0; i < this.children.length; ++i) {
        var otherChild = this.children[i];
        if (child !== otherChild) {
            otherChild.removeActiveClass();
            otherChild.hideContainer();
        }
    }
};

ActionMenuItem.prototype.itemTouchStarted = function(e) {
    this.root.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY, null, this.zIndex() + 1);
    var parent = this.parent ? this.parent : this.root;
    parent.menuItemTouchStarted(this);
    if (this.children) {
        this.initSubMenuShowing(0);
    }
};

ActionMenuItem.prototype.initSubMenuShowing = function(delay) {
    this.addActiveClass();
    this.root.clearDelayTimer();
    this._clearDelayTimer();
    if (this.disabled) return;
    if (this.isShown()) {
        this.hideChildren();
        return;
    }
    var self = this;
    this._delayTimerId = this.page().setTimeout(function() {
        self._delayTimerId = -1;
        self.showContainer();
    }, delay);
};

ActionMenuItem.prototype.itemMouseEntered = function() {
    this.initSubMenuShowing(this.root.showDelay);
};

ActionMenuItem.prototype.itemMouseLeft = function(e) {
    this._clearDelayTimer();
    if (this.disabled) return;
    if (!this.page().$(e.relatedTarget).closest(this.$container()).length) {
        this.removeActiveClass();
        this.startHideTimer();
    }
};

ActionMenuItem.prototype.zIndex = function() {
    var container = this.parent ? this.parent.$container() : this.root.$();
    return +container.style().zIndex;
};

ActionMenuItem.prototype.containerMouseLeft = function(e) {
    if (this.disabled) return;
    this._clearDelayTimer();
    var $related = this.page().$(e.relatedTarget);
    if ($related.closest(this.$()).length) {
        return;
    }

    var container = this.parent ? this.parent.$container() : this.root.$();

    if ($related.closest(container).length) {
        this.startHideTimer();
        return;
    }
    this.root.startHideTimer();
};

ActionMenuItem.prototype.containerMouseEntered = function(e) {
    if (this.disabled) return;
    this.root.clearDelayTimer();
    this._clearDelayTimer();
    this.addActiveClass();
    if (this.isShown()) {
        this.hideChildren(e.target);
    }
};

ActionMenuItem.prototype.itemClicked = function(e) {
    if (this.disabled) {
        this.root.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY, null, this.zIndex() + 1);
        return;
    }
    if (this.children) {
        this._clearDelayTimer();
        if (!this.isShown()) {
            this.showContainer();
        }
    } else {
        var prevented = false;
        try {
            this.handler({preventDefault: function() {prevented = true;}});
        } finally {
            if (!prevented) {
                this.root.hideContainer();
                this.root.emit("itemClick", this.id);
            } else {
                this.root.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY, null, this.zIndex() + 1);
            }
        }
    }
};

ActionMenuItem.prototype.$ = function() {
    return this._domNode;
};

ActionMenuItem.prototype.$container = function() {
    return this._containerDom;
};

ActionMenuItem.prototype._createContainerDom = function(level) {
    var levelClass = level <= 5 ? "action-menu-level-" + level
                                : "action-menu-level-too-deep";

    return this.page().createElement("div", {
        class: this.root.containerClass + " " + levelClass
    }).setStyles({
        position: "absolute",
        zIndex: Math.max(50, level * 100000)
    });
};

ActionMenuItem.prototype._createDom = function() {
    if (this.divider) {
        var node = this.page().createElement("div", {class: this.root.dividerClass});
        if (typeof this.divider === "function" && !this.divider()) {
            node.hide();
        }
        return node;
    } else {
        var content = this._content(this);
        var node = this.page().createElement("div", {class: this.root.itemClass});
        if (typeof content === "string") {
            node.setHtml(content);
        } else if (content == null) {
            node.hide();
        } else {
            node.empty().append(content);
        }
        return node;
    }
};

ActionMenuItem.prototype.refresh = function() {
    if (!this.isShown()) return;

    if (this.divider) {
        if (typeof this.divider === "function") {
            if (this.divider()) {
                this.$().show();
            } else {
                this.$().hide();
            }
        }
        return;
    }

    var content = this._content(this);

    if (typeof content === "string") {
        this.$().setHtml(content).show();
    } else if (content == null) {
        this.$().empty().hide();
    } else {
        this.$().show().empty().append(content);
    }
    if (this.parent) this.parent.positionSubMenu();
};

ActionMenuItem.prototype.setParent = function(parent) {
    this.parent = parent;
    this.$().appendTo(this.parent.$container());
    this.parent.$().addClass("action-menu-sub-menu-item");
};

ActionMenuItem.prototype.setEnabledStateFromPredicate = function(args) {
    if (typeof this.enabledPredicate === "function") {
        var enabled = this.enabledPredicate.apply(null, args);
        if (enabled) {
            this.enable();
        } else {
            this.disable();
        }
    }
};

ActionMenuItem.prototype.enable = function() {
    if (!this.disabled) return;
    this.disabled = false;
    this.$().removeClass(this.root.disabledClass);
};

ActionMenuItem.prototype.disable = function() {
    if (this.disabled) return;
    this.disabled = true;
    this.$().addClass(this.root.disabledClass);
    this.hideContainer();
};

ActionMenuItem.prototype.isShown = function() {
    if (this.$container() !== this.page().NULL()) {
        return this.$container().parent().length > 0;
    }
    return this.$().parent().length > 0;
};

ActionMenuItem.prototype.getHorizontalDirection = function() {
    return this.parent ? this.parent._preferredHorizontalDirection
                       : this._preferredHorizontalDirection;
};

ActionMenuItem.prototype.getVerticalDirection = function() {
    return this.parent ? this.parent._preferredVerticalDirection
                       : this._preferredVerticalDirection;
};

ActionMenuItem.prototype.positionInDimension = function(preferredDirection,
                                                        coordStart,
                                                        coordEnd,
                                                        dimensionValue,
                                                        maxValue) {
    var roomOnEnd = maxValue - (coordEnd - 3 + dimensionValue);
    var roomOnStart = coordStart + 3 - dimensionValue;
    var ret = -1;

    // Doesn't fit anywhere.
    if (roomOnStart < 0 && roomOnEnd < 0) {
        if (roomOnStart > roomOnEnd) {
            preferredDirection = "end";
            ret = Math.min(maxValue, coordStart + 3) - dimensionValue;
            ret = Math.max(0, Math.min(maxValue - dimensionValue, ret));
        } else {
            preferredDirection = "start";
            ret = Math.max(0, coordEnd - 3);
            ret = Math.max(0, Math.min(maxValue - dimensionValue, ret));
        }
    } else {
        while (ret < 0 || ret + dimensionValue > maxValue) {
            if (preferredDirection === "end") {
                ret = Math.max(0, coordEnd - 3);

                if (ret + dimensionValue > maxValue) {
                    ret = Math.min(maxValue, coordStart + 3) - dimensionValue;
                    ret = Math.max(0, Math.min(maxValue - dimensionValue, ret));

                    preferredDirection = "start";
                }
            } else {
                ret = Math.min(maxValue, coordStart + 3) - dimensionValue;
                ret = Math.min(maxValue - dimensionValue, ret);

                if (ret < 0) {
                    ret = Math.max(0, coordEnd - 3);
                    ret = Math.max(0, Math.min(maxValue - dimensionValue, ret));
                    preferredDirection = "end";
                }
            }
        }
    }

    return {
        coordStart: ret,
        preferredDirection: preferredDirection
    };
};

ActionMenuItem.prototype.positionSubMenu = function() {
    if (!this.isShown()) return;
    var itemBox = this.$()[0].getBoundingClientRect();
    var containerBox = this.$container()[0].getBoundingClientRect();
    var xMax = this.page().width();
    var yMax = this.page().height();

    var origin = {x: 0, y: 0};
    var left = -1;
    var top = -1;

    var preferredDirection = this.getHorizontalDirection();
    var positionResult =
        this.positionInDimension(preferredDirection, itemBox.left, itemBox.right, containerBox.width, xMax);
    left = positionResult.coordStart;
    this._preferredHorizontalDirection = positionResult.preferredDirection;

    preferredDirection = this.getVerticalDirection();
    positionResult =
        this.positionInDimension(preferredDirection, itemBox.top + 3, itemBox.top + 3, containerBox.height, yMax);
    top = positionResult.coordStart;
    this._preferredVerticalDirection = positionResult.preferredDirection;

    this.$container().setStyles({
        top: top + "px",
        left: left + "px"
    });

    origin.x = left > itemBox.left + 3 ? 0 : containerBox.width;
    origin.y = top > itemBox.top + 3 ? 0 : Math.max(itemBox.top - top, 0);

    return origin;
};

ActionMenuItem.prototype.addActiveClass = function() {
    if (this.disabled) return;
    this.$().addClass(this.root.activeSubMenuClass);
};

ActionMenuItem.prototype.removeActiveClass = function() {
    this.$().removeClass(this.root.activeSubMenuClass);
};

ActionMenuItem.prototype.showContainer = function() {
    this.addActiveClass();
    this.$container().setStyle("willChange", "transform")
                    .removeClass(["transition-out", "transition-in", "initial"])
                    .appendTo("body");
    var origin = this.positionSubMenu();
    this.$container().setTransformOrigin(origin.x + "px " + origin.y + "px 0px")
                    .detach()
                    .removeClass("transition-out")
                    .addClass(["initial", "transition-in"])
                    .appendTo("body")
                    .forceReflow();
    var self = this;
    this.page().changeDom(function() {
        self.$container().removeClass("initial");
        self.page().setTimeout(function() {
            self.$container().setStyle("willChange", "");
        }, TRANSITION_IN_DURATION);
    });
};

ActionMenuItem.prototype.hideContainer = function() {
    this._preferredVerticalDirection = "end";
    this._preferredHorizontalDirection = "end";
    this._clearDelayTimer();
    this.$container().setStyle("willChange", "transform")
                    .removeClass("transition-in")
                    .addClass(["initial", "transition-out"])
                    .forceReflow();
    var self = this;
    this.page().changeDom(function() {
        self.$container().removeClass("initial");
        self._delayTimerId = self.page().setTimeout(function() {
            self._delayTimerId = -1;
            self.$container().detach().setStyle("willChange", "");
        }, TRANSITION_OUT_DURATION);
    });
    this.removeActiveClass();
    if (this.children) {
        this.children.forEach(function(child) {
            child.hideContainer();
        });
    }
};

function createMenuItem(root, spec, level) {
    var children = null;
    if (spec.children) {
        if (spec.divider) throw new Error("divider cannot have children");
        var children = spec.children.map(function(childSpec) {
            return createMenuItem(root, childSpec, level + 1);
        });
    }
    return new ActionMenuItem(root, spec, children, level);
}

export default function ActionMenu(opts, deps) {
    EventEmitter.call(this);
    opts = Object(opts);
    this.page = deps.page;
    this.globalEvents = deps.globalEvents;
    this.rippler = deps.rippler;
    this.recognizerContext = deps.recognizerContext;

    this.rootClass = ensuredStringField(opts, "rootClass");
    this.containerClass = ensuredStringField(opts, "containerClass");
    this.itemClass = ensuredStringField(opts, "itemClass");
    this.disabledClass = ensuredStringField(opts, "disabledClass");
    this.dividerClass = ensuredStringField(opts, "dividerClass");
    this.activeSubMenuClass = ensuredStringField(opts, "activeSubMenuClass");
    this.showDelay = Math.min(1000, Math.max(0, ensuredIntegerField(opts, "subMenuShowDelay")));
    this.hideDelay = Math.min(3000, Math.max(0, ensuredIntegerField(opts, "subMenuHideDelay")));

    this._delayTimerId = -1;
    this._domNode = this.page.createElement("div", {
        class: this.rootClass
    });

    this._menuItems = opts.menu.map(function(spec) {
        return createMenuItem(this, spec, opts._initialLevel || 1);
    }, this);

    this._menuItems.forEach(function(item) {
        item.$().appendTo(this.$());
    }, this);

    this._idToItem = {};
    this.forEach(function(item) {
        if (item.divider) return;
        if (!item.id) {
            throw new Error("unique id is required for menu item");
        }
        var id = item.id + "";

        if (this._idToItem[id]) {
            throw new Error("unique id is required for menu item. " + id + " is duplicate.");
        }

        this._idToItem[id] = item;
    }, this);
    deps.ensure();
}
inherits(ActionMenu, EventEmitter);

ActionMenu.prototype.setEnabledStateFromPredicate = function() {
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; ++i) {
        args[i] = arguments[i];
    }

    this.forEach(function(item) {
        if (item.divider) return;
        item.setEnabledStateFromPredicate(args);
    });
};

ActionMenu.prototype.destroy = function() {
    this.clearDelayTimer();
    this.forEach(function(child) { child.destroy(); });
    this.hideContainer();
    this.$().remove();
    this.removeAllListeners();
};

ActionMenu.prototype.menuItemTouchStarted = function(child) {
    for (var i = 0; i < this._menuItems.length; ++i) {
        var otherChild = this._menuItems[i];
        if (child !== otherChild) {
            otherChild.removeActiveClass();
            otherChild.hideContainer();
        }
    }
};

ActionMenu.prototype.$containers = function() {
    var ret = this.$();
    this.forEach(function(item) {
        if (item.children && item.isShown())  {
            ret = ret.add(item.$container()[0]);
        }
    });
    return ret;
};

ActionMenu.prototype.$ = function() {
    return this._domNode;
};

ActionMenu.prototype.clearDelayTimer = function() {
    this.page.clearTimeout(this._delayTimerId);
    this._delayTimerId = -1;
};

ActionMenu.prototype.startHideTimer = function() {
    this.clearDelayTimer();
    var self = this;
    this._delayTimerId = this.page.setTimeout(function() {
        self._delayTimerId = -1;
        self.hideContainer();
    }, this.hideDelay);
};

ActionMenu.prototype.hideContainer = function() {
    this._menuItems.forEach(function(item) {
        item.hideContainer();
    });
};

ActionMenu.prototype.forEach = function(fn, ctx) {
    var items = this._menuItems.slice();
    var index = 0;

    while (items.length > 0) {
        var item = items.shift();

        if (item.children) {
            items.push.apply(items, item.children);
        }

        if (fn.call(ctx || item, item, index) === false) return;
        index++;
    }
};

ActionMenu.prototype.refreshAll = function() {
    this.forEach(ActionMenuItem.prototype.refresh);
};

ActionMenu.prototype.disableAll = function() {
    this.forEach(ActionMenuItem.prototype.disable);
    this.emit("activationChange", this);
};

ActionMenu.prototype.enableAll = function() {
    this.forEach(ActionMenuItem.prototype.enable);
    this.emit("activationChange", this);
};

ActionMenu.prototype.disable = function(actions) {
    if (!Array.isArray(actions)) {
        actions = [actions];
    }

    actions.forEach(function(action) {
        this._idToItem[action].disable();
    }, this);
    this.emit("activationChange", this);
};

ActionMenu.prototype.enable = function(actions) {
    if (!Array.isArray(actions)) {
        actions = [actions];
    }
    actions.forEach(function(action) {
        this._idToItem[action].enable();
    }, this);
    this.emit("activationChange", this);
};

export function ContextMenu(opts, deps) {
    EventEmitter.call(this);
    opts = Object(opts);
    opts._initialLevel = 2;
    opts.rootClass = ensuredStringField(opts, "rootClass") + " action-menu-context-root";
    this._menu = new ActionMenu(opts, deps);
    this._domNode = this._menu.$().setStyles({
        position: "absolute",
        zIndex: 50
    });
    this._shown = false;
    this._targetDom = this.page().$(opts.target);
    this._x = 0;
    this._y = 0;
    this._xMax = 0;
    this._yMax = 0;
    this._delayTimerId = -1;

    this.documentClicked = this.documentClicked.bind(this);
    this.hide = this.hide.bind(this);
    this.rightClicked = this.rightClicked.bind(this);
    this.keypressed = this.keypressed.bind(this);
    this.position = this.position.bind(this);

    this.longTapRecognizer = this._menu.recognizerContext.createLongTapRecognizer(this.rightClicked);
    this.documentTouchedRecognizer = this._menu.recognizerContext.createTouchdownRecognizer(this.documentClicked);
    this.preventDefault = this.page().preventDefaultHandler;

    this.$target().addEventListener("contextmenu", this.rightClicked);
    this.page().addDocumentListener("mousedown", this.documentClicked, true);
    this.page().addDocumentListener("keydown", this.keypressed, true);
    this.longTapRecognizer.recognizeBubbledOn(this.$target());
    this.documentTouchedRecognizer.recognizeCapturedOn(this.page().document());

    this._menu.on("itemClick", this.hide);
    this._menu.globalEvents.on("resize", this.position);
    this._menu.globalEvents.on("visibilityChange", this.hide);
}
inherits(ContextMenu, EventEmitter);

ContextMenu.prototype.page = function() {
    return this._menu.page;
};

ContextMenu.prototype.destroy = function() {
    this.hide();
    this._menu.removeListener("itemClick", this.hide);
    this._menu.globalEvents.removeListener("resize", this.position);
    this._menu.globalEvents.removeListener("visibilityChange", this.hide);
    this.page().removeDocumentListener("mousedown", this.documentClicked, true);
    this.page().removeDocumentListener("keydown", this.keypressed, true);
    this.$target().removeEventListener("contextmenu", this.rightClicked);
    this.longTapRecognizer.unrecognizeBubbledOn(this._targetDom);
    this.documentTouchedRecognizer.unrecognizeCapturedOn(this.page().document());
    this.removeAllListeners();
    this._menu.destroy();
};

ContextMenu.prototype.$target = function() {
    return this._targetDom;
};

ContextMenu.prototype.$ = function() {
    return this._domNode;
};

ContextMenu.prototype.position = function() {
    if (!this._shown) return;
    var x = this._x;
    var y = this._y;
    var box = this.$()[0].getBoundingClientRect();
    var xMax = this.page().width();
    var yMax = this.page().height();

    var positionChanged = false;
    if (xMax !== this._xMax || yMax !== this._yMax) {
        x = x * (xMax / this._xMax);
        y = y * (yMax / this._yMax);
        this._x = x;
        this._y = y;
        this._xMax = xMax;
        this._yMax = yMax;
        positionChanged = true;
    }

    var origin = {x: 0, y: 0};

    if (x + box.width > xMax) {
        positionChanged = true;
        x = Math.max(0, xMax - box.width);
        origin.x = Math.max(0, this._x - x);
    }

    if (y + box.height > yMax) {
        positionChanged = true;
        y = Math.max(0, yMax - box.height);
        origin.y = Math.max(0, this._y - y);
    }

    this.$().setStyles({left: x + "px", top: y + "px"});

    if (positionChanged) {
        this._menu.forEach(function(child) {
            if (child.children) {
                child.positionSubMenu();
            }
        });
    }
    return origin;
};

ContextMenu.prototype.rightClicked = function(e) {
    this.hide();
    var defaultPrevented = false;
    var ev = {
        preventDefault: function() {defaultPrevented = true;},
        originalEvent: e
    };
    this.emit("beforeOpen", ev);
    if (defaultPrevented) return;
    this.show(e);
    if (this._shown) {
        e.preventDefault();
    }
};

ContextMenu.prototype.show = function(e) {
    if (this._shown) return;
    this.page().clearTimeout(this._delayTimerId);
    this._delayTimerId = -1;

    var prevented = false;
    this.preventDefault = function() {prevented = true;};
    this.emit("willShowMenu", e, this);
    if (prevented) return;
    this._shown = true;
    this.$().removeClass(["transition-out", "transition-in", "initial"]).appendTo("body");
    this._x = e.clientX;
    this._y = e.clientY;
    this._xMax = this.page().width();
    this._yMax = this.page().height();
    var origin = this.position();
    this.$().setTransformOrigin(origin.x + "px " + origin.y + "px 0px");

    // Transition from desktop right click feels weird so only do it on touch.
    if (this.page().isTouchEvent(e)) {
        this.$().detach()
                .addClass(["initial", "transition-in"])
                .appendTo("body")
                .forceReflow();
        var self = this;
        this.page().changeDom(function() {
            self.$().removeClass("initial");
        });
    }

    this.emit("didShowMenu", e, this);
};

ContextMenu.prototype.hide = function() {
    if (!this._shown) return;
    this.emit("willHideMenu", this);
    this._shown = false;
    this.$().removeClass("transition-in")
            .addClass(["initial", "transition-out"])
            .forceReflow();

    var self = this;
    this.page().changeDom(function() {
        self.$().removeClass("initial");
        self._delayTimerId = self.page().setTimeout(function() {
            self._delayTimerId = -1;
            self.$().detach();
        }, TRANSITION_OUT_DURATION);
    });
    this._menu.hideContainer();
    this.emit("didHideMenu", this);
};

["disable", "enable", "disableAll", "enableAll", "refreshAll", "setEnabledStateFromPredicate",
"forEach"].forEach(function(methodName) {
    var menuMethod = ActionMenu.prototype[methodName];
    ContextMenu.prototype[methodName] = function()  {
        return menuMethod.apply(this._menu, arguments);
    };
});

ContextMenu.prototype.documentClicked = function(e) {
    if (!this._shown) return;

    var $target = this.page().$(e.target);
    var containerClicked = false;
    this._menu.$containers().forEach(function(elem) {
        if ($target.closest(elem).length > 0) {
            containerClicked = true;
            return false;
        }
    });

    if (!containerClicked) {
        this.hide();
    }
};

ContextMenu.prototype.keypressed = function() {
    if (!this._shown) return;
    this.hide();
};
