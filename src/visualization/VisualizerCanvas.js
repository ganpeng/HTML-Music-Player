"use strict";

import { addLegacyListener, inherits } from "util";
import { canvasToImage } from "platform/dom/util";
import { Int16Array, Float32Array } from "platform/platform";
import Default2dImageRenderer from "visualization/Default2dImageRenderer";
import WebGl2dImageRenderer from "visualization/WebGl2dImageRenderer";
import EventEmitter from "events";

const SHADOW_BLUR = 2;
const SHADOW_COLOR = "rgb(11,32,53)";

const LATENCY_POPUP_HTML = "<div class='settings-container latency-popup-content-container'>            \
            <div class='section-container'>                                                             \
                <div class='inputs-container'>                                                          \
                    <div class='label overhead-label'>                                                  \
                        Increase this value if the visualization is too early or                        \
                        decrease this value if it is too late                                           \
                    </div>                                                                              \
                    <div class='latency-slider slider horizontal-slider unlabeled-slider'>              \
                        <div class='slider-knob'></div>                                                 \
                        <div class='slider-background'>                                                 \
                            <div class='slider-fill'></div>                                             \
                        </div>                                                                          \
                    </div>                                                                              \
                    <div class='latency-value slider-value-indicator'></div>                            \
                </div>                                                                                  \
                <div class='inputs-container'>                                                          \
                    <div class='label overhead-label'>Changes are effective in real time</div>          \
                </div>                                                                                  \
            </div>                                                                                      \
        </div>";


function TransitionInfo(visualizerCanvas) {
    this.duration = -1;
    this.capStarted = -1;
    this.peakSample = -1;
    this.visualizerCanvas = visualizerCanvas;
}

TransitionInfo.prototype.getCapPosition = function(now) {
    if (this.capStarted === -1) return 0;
    var elapsed = now - this.capStarted;
    var duration = this.duration;
    if (elapsed >= duration) {
        this.capStarted = -1;
    }

    if (elapsed < 95) return this.peakSample;

    elapsed -= 95;
    duration -= 95;

    return (1 - this.visualizerCanvas.capInterpolator(elapsed, duration)) * this.peakSample;
};

TransitionInfo.prototype.inProgress = function() {
    return this.capStarted !== -1;
};

TransitionInfo.prototype.reset = function() {
    this.capStarted = -1;
    this.peakSample = -1;
    this.duration = -1;
};

TransitionInfo.prototype.start = function(peakSample, now) {
    this.capStarted = now;
    this.peakSample = peakSample;
    var mul = 1 - Math.max(0.36, peakSample);
    this.duration = (1 - (mul * mul)) * this.visualizerCanvas.capDropTime;
};

function GraphicsSource(visualizerCanvas) {
    var page = visualizerCanvas.page;
    var document = page.document();
    var gapWidth = visualizerCanvas.gapWidth;
    var highestBinHeight = visualizerCanvas.getHighestBinHeight();
    var binsNeeded = (highestBinHeight + 1);
    var binWidthPixels = visualizerCanvas.binWidthSourcePixels();
    var binHeightPixels = visualizerCanvas.binHeightSourcePixels();
    var capWidthPixels = (16 * page.devicePixelRatio() + 2 + binWidthPixels) | 0;
    var totalWidth = binsNeeded * binWidthPixels + capWidthPixels;
    var width = Math.min(Math.pow(2, Math.ceil(Math.log(totalWidth) * Math.LOG2E)), 1024);
    var rows = 1;
    var columns = (width / binWidthPixels)|0;
    while (totalWidth > width) {
        totalWidth -= width;
        rows++;
    }
    var height = Math.pow(2, Math.ceil(Math.log(binHeightPixels * rows) * Math.LOG2E));
    var canvas = document.createElement("canvas");
    canvas.height = height;
    canvas.width = width;


    var context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.shadowColor = "transparent";

    var col = 0;
    var row = 0;

    this.binPositions = new Int16Array(highestBinHeight * 2);

    var positions = this.binPositions;
    var positionIndex = 0;
    var width = visualizerCanvas.binWidth;
    for (var i = 0; i <= highestBinHeight; i++) {
        var height = i;
        var x = col * binWidthPixels;
        var y = (row * binHeightPixels + ((SHADOW_BLUR * page.devicePixelRatio())|0)) + (highestBinHeight - height);
        var gradient = context.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0.0, 'rgb(250, 250, 250)');
        gradient.addColorStop(0.7, "rgb(189, 196, 204)");
        gradient.addColorStop(1, "rgb(183, 190, 198)");

        //context.fillStyle = "rgba(99, 113, 126, 255)";
        context.fillStyle = gradient; //"rgba(183, 190, 198, 255)";
        context.fillRect(x - gapWidth, y, width + gapWidth * 2, height + gapWidth);

        gradient = context.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0.0, 'rgb(250, 250, 250)');
        gradient.addColorStop(0.2, "rgb(219, 241, 251)");
        gradient.addColorStop(0.8, "rgb(184, 228, 246)");
        gradient.addColorStop(1, 'rgb(166, 202, 238)');
        context.fillStyle = gradient;
        context.fillRect(x, y, width, height);


        positions[positionIndex++] = x - gapWidth;
        positions[positionIndex++] = y;

        col++;
        if (col >= columns - 1) {
            col = 1;
            row++;
        }
    }

    col++;
    if (col >= columns - 1) {
        col = 1;
        row++;
    }

    context.shadowBlur = (SHADOW_BLUR * page.devicePixelRatio())|0;
    context.shadowColor = SHADOW_COLOR;
    context.globalAlpha = 1;
    context.fillStyle = visualizerCanvas.capStyle;
    var x = col * binWidthPixels + visualizerCanvas.binWidth + 5;
    var y = (row * binHeightPixels + ((SHADOW_BLUR * page.devicePixelRatio())|0)) + (16 * page.devicePixelRatio())|0;
    context.fillRect(x, y, visualizerCanvas.binWidth, visualizerCanvas.capHeight);

    this.capX = x;
    this.capY = y;
    this.image = null;
    this.ready = canvasToImage(canvas, page).then(function(image) {
        this.image = image;
        canvas.width = canvas.height = 0;
    }.bind(this));
}

GraphicsSource.prototype.isReady = function() {
    return this.image !== null;
};

export default function VisualizerCanvas(opts, deps) {
    EventEmitter.call(this);

    this.page = deps.page;
    this.snackbar = deps.snackbar;
    this.recognizerContext = deps.recognizerContext;
    this.sliderContext = deps.sliderContext;
    this.menuContext = deps.menuContext;
    this.rippler = deps.rippler;
    this.animationContext = deps.animationContext;
    this.applicationPreferences = deps.applicationPreferences;
    this.globalEvents = deps.globalEvents;
    this.player = deps.player;
    this.player.setVisualizerCanvas(this);
    this.webglSupported = WebGl2dImageRenderer.isSupported(this.page.document());
    this.canvasSupported = true;

    this.needToDraw = true;
    this.canvas = this.page.$(opts.target).get(0);
    this.width = -1;
    this.height = -1;
    this.binWidth = opts.binWidth * this.page.devicePixelRatio() | 0;
    this.gapWidth = opts.gapWidth * this.page.devicePixelRatio() | 0;
    this.capHeight = opts.capHeight * this.page.devicePixelRatio() | 0;
    this.capSeparator = opts.capSeparator * this.page.devicePixelRatio() | 0;
    this.capStyle = opts.capStyle;
    this.targetFps = opts.targetFps;
    this.sectionContainerSelector = opts.sectionContainerSelector || ".visualizer-section-container";
    this.capInterpolator = null;
    this.setCapInterpolator(opts.capInterpolator || "ACCELERATE_QUAD");
    this.ghostOpacity = opts.ghostOpacity || 0.25;
    this.capDropTime = opts.capDropTime;
    this.currentCapPositions = null;
    this.emptyBins = null;
    this.transitionInfoArray = null;
    this.enabledMediaMatcher = opts.enabledMediaMatcher || null;
    this.emptyBinDrawerFrameId = -1;


    this.binSizeMediaMatchChanged = this.binSizeMediaMatchChanged.bind(this);
    this.enabledMediaMatchChanged = this.enabledMediaMatchChanged.bind(this);
    this.latencyPopupOpened = this.latencyPopupOpened.bind(this);
    this.playerStopped = this.playerStopped.bind(this);
    this.playerStarted = this.playerStarted.bind(this);
    this.emptyBinDraw = this.emptyBinDraw.bind(this);
    this.latencyPopup = deps.popupContext.makePopup("Playback latency", LATENCY_POPUP_HTML, ".synchronize-with-audio");

    this.applicationPreferences.on("change", this.applicationPreferencesChanged.bind(this));

    this.enabled = true;
    this.shown = true;
    this.source = null;
    this.renderer = null;
    this.contextMenu = null;
    deps.ensure();
}
inherits(VisualizerCanvas, EventEmitter);

VisualizerCanvas.prototype.initialize = function() {
    var width = this.canvas.clientWidth * this.page.devicePixelRatio() | 0;
    var height = this.canvas.clientHeight * this.page.devicePixelRatio() | 0;
    this.width = width;
    this.height = height;
    this.currentCapPositions = new Float32Array(this.getNumBins());
    this.emptyBins = new Float32Array(this.getNumBins());
    this.transitionInfoArray = new Array(this.getNumBins());
    this.canvas.width = width;
    this.canvas.height = height;

    for (var i = 0; i < this.transitionInfoArray.length; ++i) {
        this.transitionInfoArray[i] = new TransitionInfo(this);
    }

    if (this.enabledMediaMatcher) {
        addLegacyListener(this.enabledMediaMatcher, "change", this.enabledMediaMatchChanged);
        this.enabledMediaMatchChanged();
    }

    this.globalEvents.on("resize", this.binSizeMediaMatchChanged);
    this.latencyPopup.on("open", this.latencyPopupOpened);
    this.player.on("stop", this.playerStopped);
    this.player.on("play", this.playerStarted);

    this.source = new GraphicsSource(this);
    this.source.ready.then(function onSourceReady() {
        if (this.canUseHardwareRendering()) {
            this.renderer = new WebGl2dImageRenderer(this.source.image, this);
        } else {
            this.snackbar.show("Hardware acceleration disabled");
        }

        if (!this.renderer) {
            this.resetCanvas();
            this.renderer = new Default2dImageRenderer(this.source.image, this);
        }

        try {
            this.renderer.init(this.width, this.height);
        } catch (e) {
            this.snackbar.show(e.message);
            if (this.canUseHardwareRendering()) {
                this.webglSupported = false;
                this.renderer = null;
                return onSourceReady.call(this);
            } else {
                this.canvasSupported = false;
                this.hide();
            }
        }
        this.drawIdleBins(Date.now());
        this.refreshContextMenu();
    }.bind(this));

    this.enabled = this.applicationPreferences.preferences().getEnableVisualizer();
    this.setupCanvasContextMenu();
};

VisualizerCanvas.prototype.refreshContextMenu = function() {
    if (this.contextMenu) {
        this.contextMenu.refreshAll();
    }
};

VisualizerCanvas.prototype.applyVisibility = function() {
    if (this.enabled) {
        this.show();
    } else {
        this.hide();
    }
};

VisualizerCanvas.prototype.applicationPreferencesChanged = function() {
    if (this.enabled !== this.applicationPreferences.preferences().getEnableVisualizer()) {
        this.enabled = !this.enabled;
        this.refreshContextMenu();
        this.applyVisibility();
    }
};

VisualizerCanvas.prototype.setupCanvasContextMenu = function() {
    this.destroyCanvasContextMenu();
    var factory = this.menuContext;
    var self = this;
    this.contextMenu = factory.createContextMenu({
        target: this.canvas,
        menu: [{
            id: "hardware-acceleration",
            disabled: true,
            onClick: function(e) {
                e.preventDefault();
            },
            content: function() {
                return factory.createMenuItem("Hardware acceleration",
                                              self.isHardwareRendering() ? "glyphicon glyphicon-ok" : null);
            }
        }, {
            divider: true
        }, {
            id: "hardware-latency",
            content: factory.createMenuItem("Synchronize with audio..."),
            onClick: function() {
                self.latencyPopup.open();
            }
        }, {
            id: "visualizer-enabled",
            content: function() {
                return factory.createMenuItem("Enabled", self.isEnabled() ? "glyphicon glyphicon-ok" : null);
            },
            onClick: function(e) {
                e.preventDefault();
                self.enabled = !self.enabled;
                self.applicationPreferences.setVisualizerEnabled(self.enabled);
                self.refreshContextMenu();
                self.applyVisibility();
            }
        }]
    });
};

VisualizerCanvas.prototype.latencyPopupOpened = function(popup, needsInitialization) {
    var latency = (this.player.getAudioHardwareLatency() * 1000)|0;
    var maxLatency = (this.player.getMaximumAudioHardwareLatency() * 1000)|0;
    var minLatency = 0;
    var self = this;

    if (needsInitialization) {
        var sliderValue = this.latencyPopup.$().find(".latency-value");
        var slider = this.sliderContext.createSlider({
            target: this.latencyPopup.$().find(".latency-slider")
        });
        slider.setValue((latency + minLatency) / (maxLatency - minLatency));
        sliderValue.setText(latency + "ms");
        popup.on("open", function() {
            slider.setValue((latency + minLatency) / (maxLatency - minLatency));
            sliderValue.setText(latency + "ms");
        });

        slider.on("slide", function(p) {
            var latency = Math.round(p * (maxLatency - minLatency) + minLatency);
            sliderValue.setText(latency + "ms");
            self.player.setAudioHardwareLatency(latency / 1000);
        });
    }
};

VisualizerCanvas.prototype.destroyCanvasContextMenu = function() {
    if (this.contextMenu) {
        this.contextMenu.destroy();
        this.contextMenu = null;
    }
};

VisualizerCanvas.prototype.resetCanvas = function() {
    this.destroyCanvasContextMenu();
    var canvas = this.page.createElement("canvas").get(0);
    canvas.className = this.canvas.className;
    canvas.width = this.width;
    canvas.height = this.height;
    this.canvas.parentNode.replaceChild(canvas, this.canvas);
    this.emit("canvasChange", canvas, this.canvas);
    this.canvas = canvas;
    this.setupCanvasContextMenu();
};

VisualizerCanvas.prototype.useSoftwareRendering = function() {
    if (this.renderer) {
        if (!this.renderer.usesHardwareAcceleration()) return;
        if (this.renderer instanceof Default2dImageRenderer) return;
        this.renderer.destroy();
    }
    this.resetCanvas();
    this.renderer = new Default2dImageRenderer(this.source.image, this);
    this.snackbar.show("Hardware acceleration disabled");
};

VisualizerCanvas.prototype.useHardwareRendering = function() {
    if (this.renderer.usesHardwareAcceleration() || !this.webglSupported) return;
};

VisualizerCanvas.prototype.canUseHardwareRendering = function() {
    return this.webglSupported;
};

VisualizerCanvas.prototype.isHardwareRendering = function() {
    if (!this.renderer) return false;
    return this.renderer.usesHardwareAcceleration();
};

VisualizerCanvas.prototype.enabledMediaMatchChanged = function() {
    this.binSizeMediaMatchChanged();
    this.refreshContextMenu();
    if (this.source && this.source.isReady()) {
        this.drawIdleBins(Date.now());
    }
};

VisualizerCanvas.prototype.binSizeMediaMatchChanged = function() {
    if (!this.shown) return;
    var width = this.canvas.clientWidth * this.page.devicePixelRatio() | 0;
    if (width !== this.width) {
        this.width = width;
        this.canvas.width = width;

        this.currentCapPositions = new Float32Array(this.getNumBins());
        this.emptyBins = new Float32Array(this.getNumBins());
        this.transitionInfoArray = new Array(this.getNumBins());

        for (var i = 0; i < this.transitionInfoArray.length; ++i) {
            this.transitionInfoArray[i] = new TransitionInfo(this);
        }

        this.resetCaps();

        if (this.renderer) {
            this.renderer.setDimensions(this.width, this.height);
        }

        if (!this.needToDraw) {
            this.needToDraw = true;
            this.drawIdleBins(Date.now());
        }

    }
};

VisualizerCanvas.prototype.isEnabled = function() {
    return this.enabled;
};

VisualizerCanvas.prototype.isSupported = function() {
    return this.enabledMediaMatcher.matches && this.canvasSupported;
};

VisualizerCanvas.prototype.resetCaps = function() {
    for (var i = 0; i < this.transitionInfoArray.length; ++i) {
        this.transitionInfoArray[i].reset();
    }
};

VisualizerCanvas.prototype.binWidthSourcePixels = function() {
    return this.binWidth + this.gapWidth;
};

VisualizerCanvas.prototype.binHeightSourcePixels = function() {
    return (this.height + (SHADOW_BLUR * this.page.devicePixelRatio())|0);
};

VisualizerCanvas.prototype.setCapInterpolator = function(name) {
    if (typeof this.animationContext[name] !== "function") throw new Error(name + " is not a known interpolator");
    this.capInterpolator = this.animationContext[name];
};

VisualizerCanvas.prototype.getTargetFps = function() {
    return this.targetFps;
};

VisualizerCanvas.prototype.getMaxBins = function() {
    return Math.floor((762 * this.page.devicePixelRatio()) / (this.binWidth + this.gapWidth));
};

VisualizerCanvas.prototype.getNumBins = function() {
    return Math.floor(this.width / (this.binWidth + this.gapWidth));
};

VisualizerCanvas.prototype.getHighestBinHeight = function() {
    return this.height - (this.capSeparator + this.capHeight);
};

VisualizerCanvas.prototype.drawIdleBins = function(now) {
    if (this.needToDraw) {
        this.drawBins(now, this.emptyBins);
        var currentCapPositions = this.currentCapPositions;
        for (var i = 0; i < currentCapPositions.length; ++i) {
            if (currentCapPositions[i] !== -1) {
                return;
            }
        }

        this.needToDraw = false;
    }
};

VisualizerCanvas.prototype.objectsPerBin = function() {
    return 3;
};

VisualizerCanvas.prototype.needsToDraw = function() {
    return this.needToDraw || (this.isEnabled() && this.isSupported());
};

VisualizerCanvas.prototype.shouldHideWhenNothingToDraw = function() {
    return !this.applicationPreferences.preferences().getEnableVisualizer() || !this.isSupported();
};

VisualizerCanvas.prototype.emptyBinDraw = function(now) {
    this.emptyBinDrawerFrameId = -1;
    this.drawIdleBins(now);
    if (this.needToDraw) {
        this.emptyBinDrawerFrameId = this.page.requestAnimationFrame(this.emptyBinDraw);
    } else {
        this.hide();
    }
};

VisualizerCanvas.prototype.playerStarted = function() {
    this.page.cancelAnimationFrame(this.emptyBinDrawerFrameId);
    this.emptyBinDrawerFrameId = -1;
};

VisualizerCanvas.prototype.playerStopped = function() {
    this.needToDraw = true;
    this.emptyBinDrawerFrameId = this.page.requestAnimationFrame(this.emptyBinDraw);
};

VisualizerCanvas.prototype.show = function() {
    if (this.shown) return;
    if (!this.enabled || !this.isSupported()) {
        return this.hide();
    }
    this.shown = true;
    this.page.$(this.canvas).closest(this.sectionContainerSelector).show();
    this.binSizeMediaMatchChanged();
    this.globalEvents._triggerSizeChange();
};

VisualizerCanvas.prototype.hide = function() {
    if (!this.shown || !this.shouldHideWhenNothingToDraw()) return;
    this.shown = false;
    this.needToDraw = false;
    this.page.$(this.canvas).closest(this.sectionContainerSelector).hide();
    this.binSizeMediaMatchChanged();
    this.globalEvents._triggerSizeChange();
};

VisualizerCanvas.prototype.drawBins = function(now, bins) {
    if (bins.length !== this.getNumBins()) return;
    if (!this.source.isReady()) return;
    if (!this.isEnabled() || !this.isSupported()) {
        bins = this.emptyBins;
    }
    this.show();
    if (!this.shown) {
        return;
    }
    this.renderer.initScene(bins, 3);

    var currentCapPositions = this.currentCapPositions;
    var transitionInfoArray = this.transitionInfoArray;
    var anythingToDraw = false;

    for (var i = 0; i < bins.length; ++i) {
        var binValue = bins[i];
        var transitionInfo = transitionInfoArray[i];
        var currentCapBasePosition = -1;

        if (transitionInfo.inProgress()) {
            currentCapBasePosition = transitionInfo.getCapPosition(now);
        }

        if (binValue < currentCapBasePosition) {
            currentCapPositions[i] = currentCapBasePosition;
            anythingToDraw = true;
        } else {
            currentCapPositions[i] = -1;
            transitionInfo.start(binValue, now);
            if (binValue !== 0) {
                anythingToDraw = true;
            }
        }
    }

    this.needToDraw = anythingToDraw;
    if (anythingToDraw) {
        this.renderer.drawCaps(bins);
        this.renderer.drawBins(bins);
    }
    this.renderer.drawScene();
    if (!anythingToDraw) {
        this.hide();
    }
};
