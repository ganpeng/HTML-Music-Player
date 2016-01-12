"use strict";

const TOUCH_START = "touchstart";
const TOUCH_END = "touchend";
const TOUCH_MOVE = "touchmove";
const TOUCH_CANCEL = "touchcancel";
const TAP_TIME = 270;
const LONG_TAP_TIME = 475;

const SWIPE_LENGTH = 0.0875;
const SWIPE_VELOCITY = 0.512;
const VERTICAL_SCROLL_MAX_HORIZONTAL_VELOCITY = 1.024;
const TWO_FINGER_TAP_MINIMUM_DISTANCE = 0.0625;
const TAP_MAX_MOVEMENT = 0.015625;
const PINCER_MINIMUM_MOVEMENT = 0.015625;
const DOUBLE_TAP_MINIMUM_MOVEMENT = 0.015625;

const jsUtil = require("./util");

const Promise = require("../lib/bluebird");
const base64 = require("../lib/base64");

function ActiveTouchList() {
    this.activeTouches = [];
}

ActiveTouchList.prototype.length = function() {
    return this.activeTouches.length;
};

ActiveTouchList.prototype.nth = function(i) {
    return this.activeTouches[i];
};

ActiveTouchList.prototype.first = function() {
    return this.activeTouches[0];
};

ActiveTouchList.prototype.clear = function() {
    this.activeTouches.length = 0;
};

ActiveTouchList.prototype.contains = function(touch) {
    if (!touch) return false;
    for (var i = 0; i < this.activeTouches.length; ++i) {
        if (this.activeTouches[i].identifier === touch.identifier) {
            return true;
        }
    }
    return false;
};

ActiveTouchList.prototype.update = function(e, changedTouches) {
    var activeTouches = this.activeTouches;
    var addedTouches = [];

    if (e.type === TOUCH_START) {
        for (var i = 0; i < changedTouches.length; ++i) {
            var touch = changedTouches[i];
            var unique = true;
            for (var j = 0; j < activeTouches.length; ++j) {
                if (activeTouches[j].identifier === touch.identifier) {
                    unique = false;
                }
            }

            if (unique) {
                activeTouches.push(touch);
                addedTouches.push(touch);
            }
        }
    } else if (e.type === TOUCH_END) {
        for (var i = 0; i < changedTouches.length; ++i) {
            var touch = changedTouches[i];
            var id = touch.identifier;
            for (var j = 0; j < activeTouches.length; ++j) {
                if (activeTouches[j].identifier === id) {
                    activeTouches.splice(j, 1);
                    break;
                }
            }
        }       
    }
    return addedTouches;
};

var util = {};

const approxPhysical = (function() {
    var stride = 5;
    var map = [];
    var indices = [];
    var dpi;

    for (var i = 1; i < ((600/stride) + stride); ++i) {
        var min = i * stride;
        var max = (i + 1) * stride;
        var query = matchMedia("(min-resolution: "+min+"dpi) and (max-resolution: "+max+"dpi)");
        map[max] = query;
        indices.push(max);
    }

    var dimension;

    function refreshValues() {
        dimension = Math.min(screen.width, screen.height);
        dpi = undefined;

        for (var i = 0; i < indices.length; ++i) {
            var max = indices[i];
            var query = map[max];
            if (query.matches) {
                dpi = max - stride;
                break;
            }
        }

        if (dpi === undefined) dpi = map[indices[indices.length - 1]];
    }



    $(window).on("resize", jsUtil.throttle(function() {
        refreshValues();
    }, 350));

    refreshValues();

    return function(relativeValue) {
        return ((relativeValue * dimension / (1 / (dpi / 96)))|0);
    };
})();

util.canvasToImage = function(canvas) {
    return new Promise(function(resolve) {
        var data = canvas.toDataURL("image/png").split("base64,")[1];
        resolve(new Blob([base64.toByteArray(data)], {type: "image/png"}));
    }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var image = new Image();
        image.src = url;
        return new Promise(function (resolve, reject) {
            if (image.complete) return resolve(image);

            function cleanup() {
                image.onload = image.onerror = null;
            }

            image.onload = function() {
                cleanup();
                resolve(image);
            };
            image.onerror = function() {
                cleanup();
                reject(new Error("cannot load image"));
            };
        });
    });
};

const copyTouchProps = function(e, touch) {
    e.clientX = touch.clientX;
    e.clientY = touch.clientY;
    e.pageX = touch.pageX;
    e.pageY = touch.pageY;
    e.screenX = touch.screenX;
    e.screenY = touch.screenY;
    return e;
};

util.touchDownHandler =  function(fn) {
    var actives = new ActiveTouchList();

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        var newTouches = actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            for (var i = 0; i < newTouches.length; ++i) {
                var touch = newTouches[i];
                copyTouchProps(e, touch);
                e.isFirst = touch.identifier === actives.first().identifier;
                fn.call(this, e);
            }
        }
    };
};

util.hoverHandler = function(fnStart, fnEnd) {
    var actives = new ActiveTouchList();
    var currentTouch = null;

    function end(self, e, touch) {
        if (currentTouch !== null) {
            copyTouchProps(e, touch || currentTouch)
            currentTouch = null;
            fnEnd.call(self, e);
        }
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            if (actives.length() === 1 && currentTouch === null) {
                currentTouch = actives.first();
                copyTouchProps(e, currentTouch);
                fnStart.call(this, e);
            } else {
                end(this, e);
            }
        } else if (e.type === TOUCH_END) {
            if (actives.length() !== 0 || currentTouch === null) {
                end(this, e);
                return;
            }
            end(this, e, changedTouches[0]);
        } else if (e.type === TOUCH_MOVE) {
            if (currentTouch === null || actives.length() !== 1) {
                end(this, e, changedTouches[0]);
                return;
            }

            var touch = changedTouches[0];
            var yDelta = Math.abs(touch.clientY - currentTouch.clientY);
            var xDelta = Math.abs(touch.clientX - currentTouch.clientX);

            if (yDelta > 25 || xDelta > 25) {
                end(this, e, touch);
            }
        }
    };
};

util.tapHandler = function(fn) {
    var actives = new ActiveTouchList();
    var currentTouch = null;
    var started = -1;

    function clear() {
        currentTouch = null;
        started = -1;
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        actives.update(e, changedTouches);

        if (actives.length() > 1) {
            clear();
            return;
        }

        if (e.type === TOUCH_START) {
            if (actives.length() <= 1) {
                started = Date.now();
                currentTouch = actives.first();
            } else {
                clear();
            }

        } else if (e.type === TOUCH_END) {
            if (actives.length() !== 0 || currentTouch === null) {
                clear();
                return;
            }
            var touch = changedTouches[0];
            var yDelta = Math.abs(touch.clientY - currentTouch.clientY);
            var xDelta = Math.abs(touch.clientX - currentTouch.clientX);
            var elapsed = Date.now() - started;

            if (elapsed > 20 && elapsed < TAP_TIME && xDelta <= 5 && yDelta <= 5) {
                copyTouchProps(e, touch);
                fn.call(this, e);
            }
            clear();
        }
    };
};

util.twoFingerTapHandler = function(fn) {
    var actives = new ActiveTouchList();
    var currentATouch = null;
    var currentBTouch = null;
    var started = -1;

    function clear() {
        currentATouch = currentBTouch = null;
        started = -1;
    }

    function maybeStart() {
        var deltaX = Math.abs(currentATouch.clientX - currentBTouch.clientX);
        var deltaY = Math.abs(currentATouch.clientY - currentBTouch.clientY);
        // Fingers are too close together.
        if (deltaX > approxPhysical(TWO_FINGER_TAP_MINIMUM_DISTANCE) ||
            deltaY > approxPhysical(TWO_FINGER_TAP_MINIMUM_DISTANCE)) {
            if (started === -1) {
                started = Date.now();
            }
        } else {
            clear();
        }
    }

    function checkDelta(changedTouches) {
        for (var i = 0; i < changedTouches.length; ++i) {
            var touch = changedTouches[i];
            if (touch.identifier === currentATouch.identifier) {
                var yDelta = Math.abs(touch.clientY - currentATouch.clientY);
                var xDelta = Math.abs(touch.clientX - currentATouch.clientX);
                // First finger moved too much while tapping.
                if (xDelta > approxPhysical(TAP_MAX_MOVEMENT) ||
                    yDelta > approxPhysical(TAP_MAX_MOVEMENT)) {
                    clear();
                    return false;
                }
            } else if (touch.identifier === currentBTouch.identifier) {
                var yDelta = Math.abs(touch.clientY - currentBTouch.clientY);
                var xDelta = Math.abs(touch.clientX - currentBTouch.clientX);
                // Second finger moved too much while tapping.
                if (xDelta > approxPhysical(TAP_MAX_MOVEMENT) ||
                    yDelta > approxPhysical(TAP_MAX_MOVEMENT)) {
                    clear();
                    return false;
                }
            }
        }
        return true;
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            if (actives.length() <= 2) {
                currentATouch = actives.first() || null;
                if (actives.length() > 1) {
                    currentBTouch = actives.nth(1) || null;
                }
            } else {
                clear();
            }

            if (currentATouch !== null && currentBTouch === null) {
                started = Date.now();
            } else if (currentATouch !== null && currentBTouch !== null) {
                maybeStart();
            }
        } else if (e.type === TOUCH_END) {
            if (currentATouch === null || currentBTouch === null) {
                clear();
                return;
            }

            if (actives.length() <= 1 && !checkDelta(changedTouches)) {
                return;
            } else if (actives.length() > 1) {
                clear();
                return;
            }

            if (actives.length() !== 0) return;

            var elapsed = (e.timeStamp || e.originalEvent.timeStamp) - started;
            if (elapsed > 20 && elapsed < TAP_TIME) {
                fn.call(this, currentATouch, currentBTouch);
            }
            clear();
        }
    };
};

util.dragHandler = function(fnMove, fnEnd) {
    var actives = new ActiveTouchList();
    var currentTouch = null;

    function end(self, e, touch) {
        if (currentTouch !== null) {
            copyTouchProps(e, touch || currentTouch);
            currentTouch = null;
            fnEnd.call(self, e);
        }
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            currentTouch = actives.first();
        } else if (e.type === TOUCH_END) {
            if (actives.length() > 0) {
                currentTouch = actives.first();
            } else {
                end(this, e, currentTouch);
                currentTouch = null;
            }
        } else if (e.type === TOUCH_MOVE) {
            if (!actives.contains(currentTouch) || actives.length() > 1) {
                return;
            }

            var touch = changedTouches[0];
            var yDelta = Math.abs(touch.clientY - currentTouch.clientY);
            var xDelta = Math.abs(touch.clientX - currentTouch.clientX);

            if (yDelta > 2 || xDelta > 2) {
                currentTouch = touch;
                copyTouchProps(e, currentTouch);
                fnMove.call(this, e);
            }
        }
    };
};

util.verticalPincerSelectionHandler = function(fn) {
    var started = -1;
    var currentATouch = null;
    var currentBTouch = null;
    var callback = fn;
    var aChanged = false;
    var bChanged = false;
    var actives = new ActiveTouchList();

    function clear() {
        currentATouch = currentBTouch = null;
        aChanged = bChanged = false;
        started = -1;
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        var selecting = false;

        actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            if (actives.length() <= 2) {
                currentATouch = actives.first() || null;
                if (actives.length() > 1) {
                    currentBTouch = actives.nth(1) || null;
                }
            }
            started = currentATouch !== null && currentBTouch !== null ? (e.timeStamp || e.originalEvent.timeStamp) : -1;
        } else if (e.type === TOUCH_END) {
            if (!actives.contains(currentATouch) || !actives.contains(currentBTouch)) {
                clear();
            }
        } else if (e.type === TOUCH_MOVE) {
            if (actives.length() !== 2 || !actives.contains(currentATouch) || !actives.contains(currentBTouch)) {
                return;
            }

            if (!aChanged || !bChanged) {
                for (var i = 0; i < changedTouches.length; ++i) {
                    var touch = changedTouches[i];

                    if (touch.identifier === currentATouch.identifier) {
                        aChanged = true;
                        currentATouch = touch;
                    } else if (touch.identifier === currentBTouch.identifier) {
                        bChanged = true;
                        currentBTouch = touch;
                    }

                    if (aChanged && bChanged) {
                        break;
                    }
                }
            }

            if (aChanged && bChanged &&
                started !== -1 &&
                ((e.timeStamp || e.originalEvent.timeStamp) - started) > TAP_TIME) {
                aChanged = bChanged = false;
                var start, end;

                if (currentATouch.clientY > currentBTouch.clientY) {
                    start = currentBTouch;
                    end = currentATouch;
                } else {
                    start = currentATouch;
                    end = currentBTouch;
                }
                callback(start.clientY, end.clientY);
            }
        }
    };
};

util.horizontalSwipeHandler = function(fn, direction) {
    var startX = -1;
    var lastX = -1;
    var previousTime = -1;
    var elapsedTotal = 0;

    const clear = function() {
        previousTime = -1;
        startX = -1;
        lastX = -1;
        elapsedTotal = 0;
    };

    return util.dragHandler(function(e) {
        if (startX === -1) {
            startX = e.clientX;
        } else {
            var now = (e.timeStamp || e.originalEvent.timeStamp);
            elapsedTotal += (now - previousTime);
            if ((direction < 0 && e.clientX - lastX > 0) ||
                (direction > 0 && e.clientX - lastX < 0)) {
                clear();
            }
        }
        lastX = e.clientX;
        previousTime = e.timeStamp || e.originalEvent.timeStamp;
    }, function(e) {
        if (startX !== -1 && elapsedTotal > 10) {
            var diff = e.clientX - startX;
            var absDiff = Math.abs(diff);
            var minSwipeLength = approxPhysical(SWIPE_LENGTH);
            var velocity = (absDiff / elapsedTotal * 1000)|0;

            if (absDiff > minSwipeLength &&
                velocity > approxPhysical(SWIPE_VELOCITY) &&
                (diff < 0 && direction < 0 ||
                diff > 0 && direction > 0)) {
                fn.call(this, e);
            }
        }
        clear();
    });
};

util.longTapHandler = function(fn) {
    var actives = new ActiveTouchList();
    var currentTouch = null;
    var timeoutId = -1;

    function clear() {
        if (timeoutId !== -1) {
            clearTimeout(timeoutId);
            timeoutId = -1;
        }
        currentTouch = null;
    }

    return function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        actives.update(e, changedTouches);

        if (e.type === TOUCH_START) {
            if (actives.length() === 1 && currentTouch === null) {
                currentTouch = actives.first();
                timeoutId = setTimeout(function() {
                    var touch = currentTouch;
                    copyTouchProps(e, touch);
                    clear();
                    fn.call(self, e);
                }, LONG_TAP_TIME);
            } else {
                clear();
            }
        } else if (e.type === TOUCH_MOVE) {
            var touch = changedTouches[0];
            if (actives.length() !== 1 || !actives.contains(currentTouch) || !actives.contains(touch)) {
                clear();
                return;
            }
            var yDelta = Math.abs(touch.clientY - currentTouch.clientY);
            var xDelta = Math.abs(touch.clientX - currentTouch.clientX);
            currentTouch = touch;

            if (xDelta > 2 || yDelta > 2) {
                clear();
            }
        } else if (e.type === TOUCH_END) {
            clear();
        }
    };
};

util.doubleTapHandler = function(fn) {
    var lastTap = -1;
    var lastTouch;
    return util.tapHandler(function(e) {
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;

        var now = Date.now();
        if (lastTap === -1) {
            lastTap = now;
            lastTouch = changedTouches[0];
        } else if (now - lastTap < TAP_TIME) {
            var touch = lastTouch;
            lastTouch = null;
            var yDelta = Math.abs(touch.clientY - changedTouches[0].clientY);
            var xDelta = Math.abs(touch.clientX - changedTouches[0].clientX);
            lastTap = -1;
            if (yDelta < approxPhysical(DOUBLE_TAP_MINIMUM_MOVEMENT) &&
                xDelta < approxPhysical(DOUBLE_TAP_MINIMUM_MOVEMENT)) {
                return fn.apply(this, arguments);
            }
        } else {
            lastTouch = changedTouches[0];
            lastTap = now;
        }
    });
};

util.bindScrollerEvents = function(target, scroller, shouldScroll) {
    if (!shouldScroll) shouldScroll = function() {return true; };
    var events = "touchstart touchend touchmove mousedown mouseup mousemove".split(" ").map(function(v) {
        return v + ".scrollerns";
    }).join(" ");

    var actives = new ActiveTouchList();
    var scrollerTouch = null;
    var mousedown = false;
    var prevTimestamp = 0;
    var previousDeltaX = 0;
    target.on(events, function(e) {
        if (!shouldScroll()) return;
        var changedTouches = e.changedTouches || e.originalEvent.changedTouches;
        var timeStamp = e.timeStamp || e.originalEvent.timeStamp;
        var elapsed = timeStamp - prevTimestamp;
        prevTimestamp = timeStamp;

        actives.update(e, changedTouches);
    
        switch (e.type) {
        case "touchstart":
            if (actives.length() === 1) {
                scrollerTouch = actives.first();
                return scroller.doTouchStart([scrollerTouch], timeStamp);
            }
            return;
        case "touchend":
            if (scrollerTouch !== null && !actives.contains(scrollerTouch)) {
                scroller.doTouchEnd(timeStamp);
                scrollerTouch = null;
            }
            return;
        case "touchmove":
            if (actives.length() !== 1 || !actives.contains(scrollerTouch)) return;
            var touch;
            for (var i = 0; i < changedTouches.length; ++i) {
                var cTouch = changedTouches[i];
                if (cTouch.identifier === scrollerTouch.identifier) {
                    touch = cTouch
                    break;
                }
            }
            if (touch) {
                var deltaX = Math.abs(scrollerTouch.clientX - touch.clientX);
                var deltaDeltaX = Math.abs(deltaX - previousDeltaX);
                var velocityX = Math.round(deltaDeltaX / elapsed * 1000);
                previousDeltaX = deltaX;
                if (velocityX < approxPhysical(VERTICAL_SCROLL_MAX_HORIZONTAL_VELOCITY)) {
                    return scroller.doTouchMove([touch], timeStamp, e.scale || e.originalEvent.scale);
                }
            }
            return;
        case "mousedown":
            mousedown = true;
            scroller.doTouchStart([{pageX: e.pageX, pageY: e.pageY}], timeStamp);
            return;
        case "mouseup":
            if (mousedown) {
                mousedown = false;
                scroller.doTouchEnd(timeStamp);
            }
            return;
        case "mousemove":
            if (!mousedown) return;
            if (e.which !== 1) {
                mousedown = false;
                scroller.doTouchEnd(timeStamp);
                return;
            }
            scroller.doTouchMove([{pageX: e.pageX, pageY: e.pageY}], timeStamp);
            return;
        }
    });
};

util.unbindScrollerEvents = function(target, scroller) {
    target.off(".scrollerns");
};


var rtouchevent = /^(?:touchstart|touchend|touchcancel|touchmove)$/;
util.isTouchEvent = function(e) {
    return rtouchevent.test(e.type);
};

if (typeof window !== "undefined" && window.DEBUGGING) {
    console.log("SWIPE_LENGTH", approxPhysical(SWIPE_LENGTH));
    console.log("SWIPE_VELOCITY", approxPhysical(SWIPE_VELOCITY));
    console.log("TWO_FINGER_TAP_MINIMUM_DISTANCE", approxPhysical(TWO_FINGER_TAP_MINIMUM_DISTANCE));
    console.log("TAP_MAX_MOVEMENT", approxPhysical(TAP_MAX_MOVEMENT));
    console.log("PINCER_MINIMUM_MOVEMENT", approxPhysical(PINCER_MINIMUM_MOVEMENT));
    console.log("DOUBLE_TAP_MINIMUM_MOVEMENT", approxPhysical(DOUBLE_TAP_MINIMUM_MOVEMENT));
    console.log("VERTICAL_SCROLL_MAX_HORIZONTAL_VELOCITY", approxPhysical(VERTICAL_SCROLL_MAX_HORIZONTAL_VELOCITY));
}

module.exports = util;
