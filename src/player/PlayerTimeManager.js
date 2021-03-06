"use strict";

import { toTimeString } from "util";

const DISPLAY_ELAPSED = 0;
const DISPLAY_REMAINING = 1;

const TIME_DISPLAY_PREFERENCE_KEY = "time-display";

export default function PlayerTimeManager(opts, deps) {
    opts = Object(opts);

    this.page = deps.page;
    this.recognizerContext = deps.recognizerContext;
    this.db = deps.db;
    this.rippler = deps.rippler;
    this.player = deps.player;

    this._domNode = this.page.$(opts.target).eq(0);
    this.displayMode = DISPLAY_REMAINING;
    this.seeking = false;
    this.totalTime = 0;
    this.currentTime = 0;
    this.seekSlider = deps.sliderContext.createSlider({
        target: opts.seekSlider,
        updateDom: false
    });
    this._displayedTimeRight = this._displayedTimeLeft = -1;
    this._transitionEnabled = false;
    this._totalTimeDomNode = this.$().find(opts.totalTimeDom);
    this._currentTimeDomNode = this.$().find(opts.currentTimeDom);
    this._timeContainerDomNode = this.$().find(opts.timeContainerDom);
    this._timeProgressDomNode = this.$().find(opts.timeProgressDom);
    this._timeSeparatorDomNode = this.$().find(opts.timeSeparatorDom);
    this._updateProgress = this._updateProgress.bind(this);
    this.hidden = true;
    this.frameId = -1;

    this.slideBegun = this.slideBegun.bind(this);
    this.slideEnded = this.slideEnded.bind(this);
    this.slided = this.slided.bind(this);
    this.playerTimeProgressed = this.playerTimeProgressed.bind(this);
    this.containerClicked = this.containerClicked.bind(this);
    this.newTrackLoaded = this.newTrackLoaded.bind(this);
    this._updateTimeText = this._updateTimeText.bind(this);

    this.seekSlider.on("slideBegin", this.slideBegun);
    this.seekSlider.on("slideEnd", this.slideEnded);
    this.seekSlider.on("slide", this.slided);
    this.player.on("progress", this.playerTimeProgressed);
    this.player.on("newTrackLoad", this.newTrackLoaded);

    this.$totalTime().addEventListener("click", this.containerClicked);
    this.recognizerContext.createTapRecognizer(this.containerClicked).recognizeBubbledOn(this.$totalTime());

    var currentTimeDom = this.$currentTime()[0];
    var totalTimeDom = this.$totalTime()[0];
    var width = this.$currentTime()[0].clientWidth * this.page.devicePixelRatio() | 0;
    var height = this.$currentTime()[0].clientHeight * this.page.devicePixelRatio() | 0;

    this.timeDisplayWidth = width;
    this.timeDisplayHeight = height;
    totalTimeDom.width = currentTimeDom.width = width;
    totalTimeDom.height = currentTimeDom.height = height;


    this.currentTimeCtx = currentTimeDom.getContext("2d");
    this.totalTimeCtx = totalTimeDom.getContext("2d");
    this.totalTimeCtx.font = this.currentTimeCtx.font = ((14 * this.page.devicePixelRatio())|0) + "px Droid Sans";
    this.totalTimeCtx.fillStyle = this.currentTimeCtx.fillStyle = "#7a7a7a";
    this.totalTimeCtx.textAlign = this.currentTimeCtx.textAlign = "center";
    this.totalTimeCtx.textBaseline = this.currentTimeCtx.textBaseline = "bottom";

    if (TIME_DISPLAY_PREFERENCE_KEY in deps.dbValues) {
        var val = +deps.dbValues[TIME_DISPLAY_PREFERENCE_KEY];
        if (val === DISPLAY_REMAINING || val === DISPLAY_ELAPSED) {
            this.displayMode = val;
        }
    }

    this._scheduleUpdate();
    deps.ensure();
}


PlayerTimeManager.prototype.$timeSeparator = function() {
    return this._timeSeparatorDomNode;
};

PlayerTimeManager.prototype.$timeProgress = function() {
    return this._timeProgressDomNode;
};

PlayerTimeManager.prototype.$timeContainer = function() {
    return this._timeContainerDomNode;
};

PlayerTimeManager.prototype.$currentTime = function() {
    return this._currentTimeDomNode;
};

PlayerTimeManager.prototype.$totalTime = function() {
    return this._totalTimeDomNode;
};

PlayerTimeManager.prototype.$ = function() {
    return this._domNode;
};

PlayerTimeManager.prototype.enableSeeking = function() {
    this.seeking = true;
};

PlayerTimeManager.prototype.disableSeeking = function() {
    this.seeking = false;
};

PlayerTimeManager.prototype.slideBegun = function() {
    this.enableSeeking();
};

PlayerTimeManager.prototype.slideEnded = function(percentage) {
    this.disableSeeking();
    if (this.player.isStopped) return;
    var duration = this.player.getDuration();
    if (duration) {
        this.setTimes(duration * percentage, null);
        this.player.seek(duration * percentage);
    }
};

PlayerTimeManager.prototype.slided = function(percentage) {
    if (this.player.isStopped) return;
    var duration = this.player.getDuration();
    if (duration) {
        this.setTimes(duration * percentage, null);
    }
};

PlayerTimeManager.prototype.playerTimeProgressed = function(playedTime, totalTime) {
    if (this.seeking) return;
    this.setTimes(playedTime, totalTime);
};

PlayerTimeManager.prototype._updateTimeText = function() {
    this.currentTimeCtx.clearRect(0, 0, this.timeDisplayWidth, this.timeDisplayHeight);
    this.totalTimeCtx.clearRect(0, 0, this.timeDisplayWidth, this.timeDisplayHeight);
    this.currentTimeCtx.fillText(toTimeString(this._displayedTimeLeft),
                                ((this.timeDisplayWidth - 1 * this.page.devicePixelRatio()) / 2)|0,
                                (this.timeDisplayHeight + 2 * this.page.devicePixelRatio())|0);
    this.totalTimeCtx.fillText(toTimeString(this._displayedTimeRight),
                                ((this.timeDisplayWidth - 1 * this.page.devicePixelRatio()) / 2)|0,
                                (this.timeDisplayHeight + 2 * this.page.devicePixelRatio())|0);
};

PlayerTimeManager.prototype.setTimes = function(currentTime, totalTime) {
    this._scheduleUpdate();
    if (totalTime !== null) {
        this.checkVisibility(totalTime);
        if (this.displayMode === DISPLAY_ELAPSED) {
            var totalTimeFloored = Math.floor(totalTime);
            if (this._displayedTimeRight !== totalTimeFloored) {
                this._displayedTimeRight = totalTimeFloored;
                this.page.changeDom(this._updateTimeText);
            }
        }

        this.totalTime = totalTime;
    }

    if (currentTime !== null) {
        var currentTimeFloored = Math.floor(currentTime);

        if (this._displayedTimeLeft !== currentTimeFloored) {
            this._displayedTimeLeft = currentTimeFloored;
            this.page.changeDom(this._updateTimeText);

            if (this.displayMode === DISPLAY_REMAINING) {
                this._displayedTimeRight = -(Math.floor(Math.max(0, this.totalTime - currentTime)));
            }
        }
        this.currentTime = currentTime;
    }
};

PlayerTimeManager.prototype._updateProgress = function() {
    this.frameId = -1;
    var percentage;
    if (this.currentTime === 0 || this.totalTime === 0) {
        percentage = 0;
    } else {
        percentage = this.currentTime / this.totalTime * 100;
    }
    this.$timeProgress().setTransform("translate3d(" + (percentage - 100) + "%,0,0)");
};

PlayerTimeManager.prototype._scheduleUpdate = function() {
    if (this.frameId === -1) {
        this.frameId = this.page.requestAnimationFrame(this._updateProgress);
    }
};

PlayerTimeManager.prototype.forceUpdate = function() {
    var currentTime = this.currentTime;
    var totalTime = this.totalTime;
    this._displayedTimeRight = this._displayedTimeLeft = -1;
    this.currentTime = currentTime + 1;
    this.totalTime = totalTime + 1;
    this.setTimes(currentTime, totalTime);
    this._scheduleUpdate();
};

PlayerTimeManager.prototype.toggleDisplayMode = function() {
    if (this.displayMode === DISPLAY_ELAPSED) {
        this.displayMode = DISPLAY_REMAINING;
    } else {
        this.displayMode = DISPLAY_ELAPSED;
    }
    this.db.set(TIME_DISPLAY_PREFERENCE_KEY, this.displayMode);
    this.forceUpdate();
};

PlayerTimeManager.prototype.containerClicked = function(e) {
    this.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY);
    this.toggleDisplayMode();
};

PlayerTimeManager.prototype.hide = function() {
    if (this.hidden) return;
    this.hidden = true;
    this.$currentTime().parent().addClass("hidden");
    this.$totalTime().parent().addClass("hidden");
};

PlayerTimeManager.prototype.show = function() {
    if (!this.hidden) return;
    this.hidden = false;
    this.$currentTime().parent().removeClass("hidden");
    this.$totalTime().parent().removeClass("hidden");
};

PlayerTimeManager.prototype.checkVisibility = function(duration) {
    if (duration === 0) {
        this.hide();
    } else {
        this.show();
    }
};

PlayerTimeManager.prototype.newTrackLoaded = function() {
    if (this.seeking) return;
    this._displayedTimeRight = this._displayedTimeLeft = -1;
    var duration = Math.max(this.player.getProbableDuration() || 0, 0);
    this.checkVisibility(duration);
    this.currentTime = -1;
    this.setTimes(0, duration);
    this._scheduleUpdate();
};
