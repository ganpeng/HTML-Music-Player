"use strict";

import { inherits } from "util";
import Snackbar from "ui/Snackbar";
import EventEmitter from "events";

const UPDATE_INTERVAL = 15 * 60 * 1000;
const tabId = Math.floor(Date.now() + Math.random() * Date.now());

export default function ServiceWorkerManager(deps) {
    EventEmitter.call(this);
    this._page = deps.page;
    this._globalEvents = deps.globalEvents;
    this._env = deps.env;
    this._snackbar = deps.snackbar;

    this._registration = null;
    this._started = false;

    this._updateAvailableNotified = false;
    this._lastUpdateChecked = Date.now();
    this._currentUpdateCheck = null;
    this._updateAvailable = this._updateAvailable.bind(this);
    this._updateFound = this._updateFound.bind(this);
    this._messaged = this._messaged.bind(this);
    this._foregrounded = this._foregrounded.bind(this);
    this._backgrounded = this._backgrounded.bind(this);
    this._updateChecker = this._updateChecker.bind(this);
    this._appClosed = this._appClosed.bind(this);

    this._updateCheckInterval = this._page.setInterval(this._updateChecker, 10000);
    this._globalEvents.on("foreground", this._foregrounded);
    this._globalEvents.on("background", this._backgrounded);
    this._globalEvents.on("shutdown", this._appClosed);
    deps.ensure();
}
inherits(ServiceWorkerManager, EventEmitter);

ServiceWorkerManager.prototype._appClosed = function() {
    if (this._page.navigator().serviceWorker &&
        this._page.navigator().serviceWorker.controller) {
        try {
            this._page.navigator().serviceWorker.controller.postMessage({
                action: "closeNotifications",
                tabId: tabId
            });
        } catch (e) {}
    }
};

ServiceWorkerManager.prototype._updateChecker = function() {
    if (this._registration &&
        Date.now() - this._lastUpdateChecked > UPDATE_INTERVAL &&
        !this._updateAvailableNotified &&
        !this._currentUpdateCheck) {
        this._checkForUpdates();
    }
};

ServiceWorkerManager.prototype._backgrounded = function() {
    this._page.clearInterval(this._updateCheckInterval);
    this._updateCheckInterval = -1;
};

ServiceWorkerManager.prototype._foregrounded = function() {
    this._updateCheckInterval = this._page.setInterval(this._updateChecker, 10000);
    this._updateChecker();
};

ServiceWorkerManager.prototype._checkForUpdates = function() {
    this._lastUpdateChecked = Date.now();
    var self = this;
    this._currentUpdateCheck = this._registration.then(function(reg) {
        return reg.update();
    }).finally(function() {
        self._currentUpdateCheck = null;
    }).catch(function() {});
};

ServiceWorkerManager.prototype.checkForUpdates = function() {
    if (this._registration &&
        !this._updateAvailableNotified &&
        this._currentUpdateCheck) {
        return this._checkForUpdates();
    }
    return Promise.resolve();
};

ServiceWorkerManager.prototype._updateAvailable = function(worker, nextAskTimeout) {
    this._updateAvailableNotified = true;
    var self = this;
    if (!nextAskTimeout) nextAskTimeout = 60 * 1000;

    this._snackbar.show("New version available", {
        action: "refresh",
        visibilityTime: 15000
    }).then(function(outcome) {
        switch (outcome) {
            case Snackbar.ACTION_CLICKED:
                worker.postMessage({action: 'skipWaiting'}).catch(function() {});
                return;
            case Snackbar.DISMISSED:
                worker.postMessage({action: 'skipWaiting'}).catch(function() {});
                return;
            case Snackbar.TIMED_OUT:
                self._page.setTimeout(function() {
                    self._updateAvailable(worker, nextAskTimeout * 3);
                }, nextAskTimeout);
                break;
            default:
                return;
        }
    }).catch(function(e) {
        return self._snackbar.show(e.message);
    });
};

ServiceWorkerManager.prototype._updateFound = function(worker) {
    var self = this;
    worker.addEventListener("statechange", function() {
        if (worker.state === "installed") {
            self._updateAvailable(worker);
        }
    });
};

ServiceWorkerManager.prototype.start = function() {
    if (this._started || !this._page.navigator().serviceWorker) return;
    this._started = true;
    var self = this;
    this._registration = Promise.resolve(this._page.navigator().serviceWorker.register("/sw.js").then(function(reg) {
        if (!self._page.navigator().serviceWorker.controller) return;

        if (reg.waiting) {
            self._updateAvailable(reg.waiting);
        } else if (reg.installing) {
            self._updateFound(reg.installing);
        } else {
            reg.addEventListener("updatefound", function() {
                self._updateFound(reg.installing);
            });
        }

        self._page.navigator().serviceWorker.addEventListener("message", self._messaged);
        self._page.navigator().serviceWorker.addEventListener("ServiceWorkerMessageEvent", self._messaged);
        self._page.addWindowListener("message", self._messaged);
        self._page.addWindowListener("ServiceWorkerMessageEvent", self._messaged);
        return reg;
    }));

    var reloading = false;
    self._page.navigator().serviceWorker.addEventListener("controllerchange", function() {
        if (reloading) return;
        reloading = true;
        self._globalEvents.disableBeforeUnloadHandler();
        self._page.location().reload();
    });
};

const rTagStrip = new RegExp("\\-"+tabId+"$");
ServiceWorkerManager.prototype._messaged = function(e) {
    if (e.data.data.tabId !== tabId || e.data.eventType !== "swEvent") return;
    var data = e.data;
    var tag = data.tag || null;

    if (tag) {
        tag = (tag + "").replace(rTagStrip, "");
    } else {
        tag = "";
    }

    var eventArg = data.data;
    var eventName = null;

    if (data.type === "notificationClick") {
        eventName = "action" + data.action + "-" + tag;
    } else if (data.type === "notificationClose") {
        eventName = "notificationClose-" + tag;
    }

    if (eventName) {
        this.emit(eventName, eventArg);
    }
};

ServiceWorkerManager.prototype.hideNotifications = function(tag) {
    if (tag) {
        tag = tag + "-" + tabId;
    } else {
        tag = tabId;
    }
    return this._registration.then(function(reg) {
        return Promise.resolve(reg.getNotifications({tag: tag})).then(function(notifications) {
            notifications.forEach(function(notification) {
                try {
                    notification.close();
                } catch (e) {}
            });
        });
    });
};

var notificationId = (Date.now() * Math.random())|0;
ServiceWorkerManager.prototype.showNotification = function(title, options) {
    if (!this._started) return Promise.resolve();
    if (!options) options = Object(options);
    var id = ++notificationId;
    options.data = {
        notificationId: id,
        tabId: tabId
    };

    var tag;
    if (!options.tag) {
        tag = options.tag = tabId;
    } else {
        tag = options.tag = options.tag + "-" + tabId;
    }

    var self = this;
    return this._registration.then(function(reg) {
        var preReq = Promise.resolve();
        if (self._env.isMobile()) {
            preReq = Promise.resolve(reg.getNotifications()).then(function(notifications) {
                notifications.forEach(function(notification) {
                    try { notification.close(); } catch (e) {}
                });
            });
        }

        return preReq.then(function() {
            return reg.showNotification(title, options);
        }).then(function() {
            var opts = {tag: tag};
            return Promise.resolve(reg.getNotifications(opts)).then(function(notifications) {
                var theNotification = notifications.filter(function(n) {
                    return n.data.notificationId === id && n.data.tabId === tabId;
                })[0];

                // GC possible hanging around notifications explicitly.
                notifications.filter(function(n) {
                    return n.data.notificationId !== id && n.data.tabId === tabId;
                }).forEach(function(n) {
                    try { n.close(); } catch (e) {}
                });

                if (theNotification) {
                    return theNotification;
                } else {
                    return null;
                }
            });
        });
    });
};
