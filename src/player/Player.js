"use strict";

import ApplicationDependencies from "ApplicationDependencies";
import AudioPlayer from "audio/AudioPlayerAudioBufferImpl";
import AudioManager from "audio/AudioManager";
import EventEmitter from "events";
import { inherits } from "util";
import Track from "tracks/Track";

const MINIMUM_DURATION = 3;

const VOLUME_KEY = "volume";
const MUTED_KEY = "muted";
const LATENCY_KEY = "audio-hardware-latency";

export default function Player(opts, deps) {
    var self = this;
    EventEmitter.call(this);
    opts = Object(opts);
    this.env = deps.env;
    this.page = deps.page;
    this.globalEvents = deps.globalEvents;
    this.recognizerContext = deps.recognizerContext;
    this.db = deps.db;
    this.dbValues = deps.dbValues;
    this.rippler = deps.rippler;
    this.crossfadingPreferences = deps.crossfadingPreferences;
    this.effectPreferences = deps.effectPreferences;
    this.applicationPreferences = deps.applicationPreferences;
    this.gestureEducator = deps.gestureEducator;
    this.tooltipContext = deps.tooltipContext;
    this.playlist = deps.playlist;

    this._domNode = this.page.$(opts.target);

    this._playButtonDomNode = this.$().find(opts.playButtonDom);
    this._previousButtonDomNode = this.$().find(opts.previousButtonDom);
    this._nextButtonDomNode = this.$().find(opts.nextButtonDom);

    this.audioManagers = [];
    this.visualizerCanvas = null;
    this.currentAudioManager = null;
    this.volume = 0.15;
    this.isStopped = true;
    this.isPaused = false;
    this.isPlaying = false;
    this.isMutedValue = false;
    this.implicitLoading = false;
    this.queuedNextTrackImplicitly = false;
    this.pictureManager = null;
    this.audioPlayer = new AudioPlayer({
        src: opts.src
    }, new ApplicationDependencies({
        page: this.page,
        env: this.env,
        db: this.db,
        dbValues: this.dbValues,
        crossfadingPreferences: this.crossfadingPreferences,
        effectPreferences: this.effectPreferences,
        applicationPreferences: this.applicationPreferences
    }));

    this.nextTrackChanged = this.nextTrackChanged.bind(this);
    this.$play().addEventListener("click", this.playButtonClicked.bind(this));
    this.$next().addEventListener("click", this.nextButtonClicked.bind(this));
    this.$previous().addEventListener("click", this.prevButtonClicked.bind(this));
    this.recognizerContext.createTapRecognizer(this.playButtonClicked.bind(this)).recognizeBubbledOn(this.$play());
    this.recognizerContext.createTapRecognizer(this.nextButtonClicked.bind(this)).recognizeBubbledOn(this.$next());
    this.recognizerContext.createTapRecognizer(this.prevButtonClicked.bind(this)).recognizeBubbledOn(this.$previous());

    this._playTooltip = this.tooltipContext.createTooltip(this.$play(), function() {
        return self.isPlaying ? "Pause playback"
                            : self.isPaused ? "Resume playback" : "Start playback";
    });

    this._nextTooltip = this.tooltipContext.createTooltip(this.$next(), "Next track");
    this._previousTooltip = this.tooltipContext.createTooltip(this.$previous(), "Previous track");

    this.playlist.on("currentTrackChange", this.loadTrack.bind(this));
    this.playlist.on("playlistEmpty", this.stop.bind(this));
    this.playlist.on("nextTrackChange", this.nextTrackChanged);
    this.playlist.on("historyChange", this.historyChanged.bind(this));

    if (VOLUME_KEY in this.dbValues) {
        this.setVolume(this.dbValues[VOLUME_KEY]);
    }

    if (MUTED_KEY in this.dbValues) {
        if (this.dbValues[MUTED_KEY]) {
            this.toggleMute();
        }
    }

    if (LATENCY_KEY in this.dbValues) {
        this.setAudioHardwareLatency(+this.dbValues[LATENCY_KEY]);
    }

    var self = this;
    this.ready = this.audioPlayer.ready.then(function() {
        self.ready = null;
    });

    this.audioPlayer.on("audioContextReset", this.audioContextReset.bind(this));
    this.effectPreferences.on("change", this.effectPreferencesChanged.bind(this));
    this.crossfadingPreferences.on("change", this.crossfadingPreferencesChanged.bind(this));
    this.applicationPreferences.on("change", this.applicationPreferencesChanged.bind(this));
    deps.ensure();
}
inherits(Player, EventEmitter);

Player.prototype.MINIMUM_DURATION = MINIMUM_DURATION;

Player.prototype.audioContextReset = function() {
    if (this.currentAudioManager) {
        this.currentAudioManager.audioContextReset();
    }
};

Player.prototype.effectPreferencesChanged = function() {
    this.forEachAudioManager(function(am) {
        am.effectsChanged(this.effectPreferences);
    }, this);
};

Player.prototype.crossfadingPreferencesChanged = function() {
    this.forEachAudioManager(function(am) {
        am.crossfadingChanged(this.crossfadingPreferences);
    });
};

Player.prototype.applicationPreferencesChanged = function() {

};

Player.prototype.setVisualizerCanvas = function(value) {
    this.visualizerCanvas = value;
};

Player.prototype.setPictureManager = function(pictureManager) {
    this.pictureManager = pictureManager;
};

Player.prototype.$allButtons = function() {
    return this.$play().add(this.$previous(), this.$next());
};

Player.prototype.$ = function() {
    return this._domNode;
};

Player.prototype.$play = function() {
    return this._playButtonDomNode;
};

Player.prototype.$previous = function() {
    return this._previousButtonDomNode;
};

Player.prototype.$next = function() {
    return this._nextButtonDomNode;
};

Player.prototype.historyChanged = function() {
    this.checkButtonState();
};

Player.prototype.getPictureManager = function() {
    return this.pictureManager;
};

Player.prototype.nextTrackChanged = function() {
    this.checkButtonState();
};

Player.prototype.audioManagerDestroyed = function(audioManager) {
    var index = this.audioManagers.indexOf(audioManager);
    if (index >= 0) {
        this.audioManagers.splice(index, 1);
    }
    if (audioManager === this.currentAudioManager) {
        this.currentAudioManager = null;
        if (!this.playlist.getCurrentTrack() &&
            !this.playlist.getNextTrack() &&
            this.isPlaying) {
            this.stop();
        }
    }
};

Player.prototype.nextTrackImplicitly = function() {
    if (this.isPaused) {
        if (this.queuedNextTrackImplicitly) return;
        this.queuedNextTrackImplicitly = true;
        var playId = this.playlist.getCurrentPlayId();
        var self = this;
        // Queue the next track load when the player resumes.
        this.once("trackPlaying", function() {
            this.queuedNextTrackImplicitly = false;
            // If it was exactly the same track playthrough that was resumed.
            if (!self.isPaused && self.playlist.getCurrentPlayId() === playId) {
                self.nextTrackImplicitly();
            }
        });
        return;
    }

    this.implicitLoading = true;
    if (!this.playlist.next(false)) {
        this.implicitLoading = false;
    }
};

Player.prototype.audioManagerErrored = function(audioManager, e) {
    if (audioManager.track) {
        var trackError;
        if (e.name === "NotFoundError" || e.name === "NotReadableError") {
            trackError = Track.FILESYSTEM_ACCESS_ERROR;
        } else {
            trackError = Track.DECODE_ERROR;
        }
        audioManager.track.setError(trackError);
    }
    this.destroyAudioManagers();
    this.currentAudioManager = null;
    this.nextTrackImplicitly();
};

Player.prototype.getProgress = function() {
    if (!this.currentAudioManager) return -1;
    var duration = this.currentAudioManager.getDuration();
    if (!duration) return -1;
    var currentTime = this.currentAudioManager.getCurrentTime();
    return Math.round((currentTime / duration) * 100) / 100;
};

Player.prototype.setProgress = function(p) {
    if (!this.currentAudioManager || !this.currentAudioManager.isSeekable()) return;
    p = Math.min(Math.max(p, 0), 1);
    var duration = this.currentAudioManager.getDuration();
    if (!duration) return;
    return this.seek(p * duration);
};

Player.prototype.seekIntent = function(p) {
    if (!this.currentAudioManager) return;
    p = Math.min(Math.max(p, 0), 1);
    var duration = this.currentAudioManager.getDuration();
    if (!duration) return;
    return this.seek(p * duration, true);
};

Player.prototype.getFadeInTimeForNextTrack = function() {
    var preferences = this.crossfadingPreferences.preferences();
    var fadeInTime = preferences.getInTime();
    if (fadeInTime <= 0 || !preferences.getInEnabled()) return 0;

    var audioManager = this.currentAudioManager;

    if (!audioManager) return 0;

    var nextTrack = this.playlist.getNextTrack();
    if (!nextTrack) return 0;
    if (!preferences.getShouldAlbumCrossFade() &&
        audioManager.track.comesBeforeInSameAlbum(nextTrack)) {
        return 0;
    }

    var duration = nextTrack.getBasicInfo().duration;

    return isNaN(duration) ? fadeInTime
                           : Math.max(Math.min(duration - MINIMUM_DURATION - preferences.getOutTime(), fadeInTime), 0);
};

Player.prototype.audioManagerSeekIntent = function(audioManager, time) {
    if (audioManager === this.currentAudioManager) {
        this.emit("progress", time, audioManager.getDuration());
    }
};

Player.prototype.trackFinished = function() {
    this.playlist.trackPlayedSuccessfully();
    this.nextTrackImplicitly();
};

Player.prototype.audioManagerEnded = function(audioManager, haveGaplessPreloadPending) {
    if (audioManager === this.currentAudioManager) {
        var alreadyFinished = haveGaplessPreloadPending && !audioManager.sourceNode.hasGaplessPreload();
        if (!haveGaplessPreloadPending) {
            audioManager.destroy();
        }

        if (!alreadyFinished) {
            this.trackFinished();
        }
    } else {
        audioManager.destroy();
    }
};

Player.prototype.audioManagerProgressed = function(audioManager) {
    if (audioManager === this.currentAudioManager) {
        var currentTime = audioManager.getCurrentTime();
        var totalTime = audioManager.getDuration();
        var fadeInTime = this.getFadeInTimeForNextTrack();

        if ((currentTime >= totalTime && totalTime > 0 && currentTime > 0) ||
            (fadeInTime > 0 && totalTime > 0 && currentTime > 0 && (totalTime - currentTime > 0) &&
            (totalTime - currentTime <= fadeInTime))) {
            this.trackFinished();
        } else if (this.isPlaying && !this.globalEvents.isWindowBackgrounded()) {
            this.emit("progress", currentTime, totalTime);
        }
    }
};

Player.prototype.getSampleRate = function() {
    var track = this.playlist.getCurrentTrack();
    if (!track) return 44100;
    var tagData = track.getTagData();
    if (!tagData) return 44100;
    return tagData.basicInfo.sampleRate;
};

Player.prototype.getImage = function(pictureManager) {
    if (this.currentAudioManager) {
        return this.currentAudioManager.getImage(pictureManager);
    }
    return Promise.resolve(pictureManager.defaultImage());
};

Player.prototype.pause = function() {
    if (!this.isPlaying) return this;
    this.isPaused = true;
    this.isStopped = false;
    this.isPlaying = false;
    this.forEachAudioManager(function(am) {
        am.pause();
    });
    this.pausedPlay();
};

Player.prototype.resume = function() {
    if (this.isPaused) {
        this.emit("trackPlaying");
        this.play();
    }
};

Player.prototype.play = function() {
    if (this.isPlaying) return this;

    if (!this.playlist.getCurrentTrack()) {
        this.playlist.playFirst();
        return this;
    }

    this.emit("trackPlaying");
    this.isPaused = false;
    this.isStopped = false;
    this.isPlaying = true;
    this.forEachAudioManager(function(am) {
        am.updateSchedules();
        am.resume();
    });
    this.startedPlay();
};

Player.prototype.stop = function() {
    if (this.isStopped) return this;
    this.isStopped = true;
    this.isPaused = false;
    this.isPlaying = false;
    this.currentAudioManager = null;
    this.destroyAudioManagers();
    this.playlist.stop();
    this.emit("progress", 0, 0);
    this.stoppedPlay();
};

var loadId = 0;
Player.prototype.loadTrack = function(track, isUserInitiatedSkip) {
    if (this.ready) {
        var self = this;
        var id = ++loadId;
        this.ready = this.ready.then(function() {
            if (id === loadId) {
                self.loadTrack(track, isUserInitiatedSkip);
            }
        });
        return;
    }
    ++loadId;

    if (isUserInitiatedSkip &&
        this.currentAudioManager &&
        !this.currentAudioManager.hasPlaythroughBeenTriggered()) {

        if (this.currentAudioManager.track) {
            this.currentAudioManager.track.recordSkip();
        }
    }

    this.isStopped = false;
    this.isPlaying = true;
    this.isPaused = false;

    var implicit = this.implicitLoading;
    if (implicit) {
        this.implicitLoading = false;
    } else {
        this.destroyAudioManagers(this.currentAudioManager);
    }

    // Should never be true but there are too many moving parts to figure it out.
    if (this.currentAudioManager && this.currentAudioManager.destroyed) {
        this.currentAudioManager = null;
    }

    if (this.currentAudioManager &&
        (!implicit || this.currentAudioManager.hasGaplessPreload())) {
        this.currentAudioManager.replaceTrack(track);
        this.startedPlay();
        this.emit("trackPlaying");
        this.emit("newTrackLoad");
        return;
    }

    if (this.currentAudioManager) {
        this.currentAudioManager.background();
    }
    this.currentAudioManager = new AudioManager(this, track, implicit);
    this.audioManagers.push(this.currentAudioManager);
    this.currentAudioManager.trackPictureUpdated();
    this.startedPlay();
    this.emit("trackPlaying");
    this.emit("newTrackLoad");
    this.currentAudioManager.start();
};

Player.prototype.nextButtonClicked = function(e) {
    this.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY);
    this.playlist.next(true);
    if (this.page.isTouchEvent(e)) {
        this.gestureEducator.educate("next");
    }
};

Player.prototype.prevButtonClicked = function(e) {
    this.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY);
    this.playlist.prev();
    if (this.page.isTouchEvent(e)) {
        this.gestureEducator.educate("previous");
    }
};

Player.prototype.playButtonClicked = function(e) {
    this.rippler.rippleElement(e.currentTarget, e.clientX, e.clientY);
    if (this.isPlaying) {
        this.pause();
    } else {
        this.play();
    }
    if (this.page.isTouchEvent(e)) {
        this.gestureEducator.educate("playpause");
    }
};

Player.prototype.checkButtonState = function() {
    this.$allButtons().addClass("disabled");

    if (this.playlist.getNextTrack()) {
        this.$next().removeClass("disabled");

        if (this.playlist.hasHistory()) {
            this.$previous().removeClass("disabled");
        }
    }

    if (!this.isStopped) {
        this.$play().removeClass("disabled");
        if (this.isPlaying) {
            this.$play()
                .find(".play-pause-morph-icon")
                .removeClass("play")
                .addClass("pause");
        } else if (this.isPaused) {
            this.$play()
                .find(".play-pause-morph-icon")
                .removeClass("pause")
                .addClass("play");
        }
    } else {
        this.$play().removeClass("active")
                .find(".play-pause-morph-icon")
                .removeClass("pause")
                .addClass("play");

        if (this.playlist.getNextTrack()) {
            this.$play().removeClass("disabled");
        }
    }

    this._playTooltip.refresh();
};

Player.prototype.startedPlay = function() {
    this.checkButtonState();
    this.emit("play");
};

Player.prototype.stoppedPlay = function() {
    this.checkButtonState();
    this.emit("stop");
};

Player.prototype.pausedPlay = function() {
    this.checkButtonState();
    this.emit("pause");
};

Player.prototype.seek = function(seconds, intent) {
    if (!this.isPlaying && !this.isPaused) return this;
    if (!this.currentAudioManager || !this.currentAudioManager.isSeekable()) return;
    var maxSeek = this.currentAudioManager.getDuration();
    if (!isFinite(maxSeek)) return;
    seconds = Math.max(0, Math.min(seconds, maxSeek));

    if (intent) {
        this.currentAudioManager.seekIntent(seconds);
    } else {
        this.currentAudioManager.seek(seconds);
    }
};

Player.prototype.isMuted = function() {
    return this.isMutedValue;
};

Player.prototype.togglePlayback = function() {
    if (!this.isStopped) {
        if (this.isPlaying) {
            this.pause();
        } else if (this.isPaused) {
            this.resume();
        }
    }
};

Player.prototype.toggleMute = function() {
    this.isMutedValue = !this.isMutedValue;
    if (this.isMutedValue) {
        this.emit("muted", true);
        this.forEachAudioManager(function(am) {
            am.mute();
        });
        this.db.set(MUTED_KEY, true);
    } else {
        this.emit("muted", false);
        this.forEachAudioManager(function(am) {
            am.unmute();
        });
        this.db.set(MUTED_KEY, false);
    }
};

Player.prototype.getDuration = function() {
    if (!this.currentAudioManager)
            throw new Error("cannot get duration no audioManager");
    return this.currentAudioManager.getDuration();
};

Player.prototype.getProbableDuration = function() {
    if (!this.currentAudioManager)
            throw new Error("cannot get duration no audioManager");
    var ret = this.currentAudioManager.getDuration();
    if (ret) return ret;
    var track = this.playlist.getCurrentTrack();
    if (track.tagData && track.tagData.basicInfo) {
        return track.getSilenceAdjustedDuration(track.tagData.basicInfo.duration || 0);
    }
};

Player.prototype.getVolume = function() {
    return this.volume;
};

Player.prototype.setVolume = function(val) {
    val = Math.min(Math.max(0, val), 1);
    var volume = this.volume = val;
    this.forEachAudioManager(function(am) {
        am.updateVolume(volume);
    });
    this.emit("volumeChange");
    this.db.set(VOLUME_KEY, volume);
    return this;
};

Player.prototype.getAudioHardwareLatency = function() {
    return this.audioPlayer.getHardwareLatency();
};

Player.prototype.setAudioHardwareLatency = function(value) {
    this.audioPlayer.setHardwareLatency(+value);
    this.db.set(LATENCY_KEY, this.audioPlayer.getHardwareLatency());
};

Player.prototype.getMaximumAudioHardwareLatency = function() {
    return this.audioPlayer.getMaxLatency();
};

// Supports deletion mid-iteration.
Player.prototype.forEachAudioManager = function(fn) {
    var currentLength = this.audioManagers.length;
    for (var i = 0; i < this.audioManagers.length; ++i) {
        fn.call(this, this.audioManagers[i], i, this.audioManagers);
        // Deleted from the array.
        if (currentLength > this.audioManagers.length) {
            i -= (currentLength - this.audioManagers.length);
            currentLength = this.audioManagers.length;
        }
    }
};

Player.prototype.destroyAudioManagers = function(exceptThisOne) {
    this.forEachAudioManager(function(am) {
        if (am !== exceptThisOne) {
            am.destroy();
        }
    });
};

Player.prototype.getAudioContext = function() {
    return this.audioPlayer.getAudioContext();
};
