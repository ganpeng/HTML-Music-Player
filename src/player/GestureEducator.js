"use strict";

import Snackbar from "ui/Snackbar";

const GESTURE_EDUCATION_KEY = "gesture-education";

const gestureEducationMessages = {
    "playpause": "Tap the screen with two fingers to toggle play/pause",
    "next": "Swipe right with two fingers to play the next track",
    "previous": "Swip left with two fingers to play the previous track"
};

export default function GestureEducator(deps) {
    this.page = deps.page;
    this.snackbar = deps.snackbar;
    this.db = deps.db;
    this.dbValues = deps.dbValues;
    this.store = Object(this.dbValues[GESTURE_EDUCATION_KEY]);

    deps.ensure();
}

GestureEducator.prototype.educate = function(gesture) {
    var msg = gestureEducationMessages[gesture];
    if (!msg) return;
    var tag = gesture + "-gesture-education";

    if (this.store[gesture] === true) return Promise.resolve();
    var self = this;

    return this.snackbar.show(msg, {
        action: "got it",
        visibilityTime: 6500,
        tag: tag
    }).then(function(outcome) {
        if (outcome === Snackbar.ACTION_CLICKED ||
            outcome === Snackbar.DISMISSED) {
            self.store[gesture] = true;
            return self.db.set(GESTURE_EDUCATION_KEY, self.store);
        }
    });
};
