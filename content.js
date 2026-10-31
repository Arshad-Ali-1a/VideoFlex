(function () {
  "use strict";

  // Map to store active controllers for discovered videos
  const activeControllers = new Map();
  let extensionEnabled = true;

  chrome.storage.local.get(["extensionEnabled"], (result) => {
    extensionEnabled = result.extensionEnabled !== false;
    activeControllers.forEach((controller) => {
      controller.setEnabled(extensionEnabled);
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.extensionEnabled) return;
    extensionEnabled = changes.extensionEnabled.newValue !== false;
    activeControllers.forEach((controller) => {
      controller.setEnabled(extensionEnabled);
    });
  });

  // Default values
  const DEFAULTS = {
    scale: 100, // percentage
    brightness: 100,
    contrast: 100,
    saturate: 100,
    sepia: 0,
    speed: 1.0,
    audioLevel: 100,
    equalizerEnabled: false,
    equalizerPreset: "Flat",
    bass: 0,
    mid: 0,
    treble: 0,
  };
  const EQUALIZER_PRESETS = {
    Flat: { bass: 0, mid: 0, treble: 0 },
    "Bass Boost": { bass: 8, mid: 1, treble: 0 },
    Vocal: { bass: -2, mid: 4, treble: 3 },
    "Treble Boost": { bass: -1, mid: 0, treble: 7 },
  };
  const TEMPORARY_BOOST_DELAY = 1000;

  // Global Key listeners for shortcuts
  document.addEventListener(
    "keydown",
    (e) => {
      if (!extensionEnabled) return;

      // Skip shortcut processing if user is typing in form inputs/editable elements
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      const targetVideo = getTargetVideo();
      if (!targetVideo) return;
      const controller = activeControllers.get(targetVideo);
      if (!controller) return;

      if (e.code === "Space") {
        e.preventDefault();
        controller.setTemporaryBoost("space", true);
        return;
      }

      // Alt + V: Toggle overlay menu
      if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        controller.toggleMenu();
        return;
      }

      // [ : Scale down (-5%)
      if (e.key === "[") {
        e.preventDefault();
        controller.adjustValue("scale", -5);
        controller.showTemporaryToast(
          `Scale decreased: ${controller.state.scale}%`,
        );
      }
      // ] : Scale up (+5%)
      else if (e.key === "]") {
        e.preventDefault();
        controller.adjustValue("scale", 5);
        controller.showTemporaryToast(
          `Scale increased: ${controller.state.scale}%`,
        );
      }
      // \ : Reset scale (100%)
      else if (e.key === "\\") {
        e.preventDefault();
        controller.setValue("scale", 100);
        controller.showTemporaryToast("Scale reset: 100%");
      }
      // Shift + [ : Speed Down (-0.25x)
      else if (e.shiftKey && e.key === "{") {
        e.preventDefault();
        controller.adjustValue("speed", -0.1);
        controller.showTemporaryToast(
          `Speed decreased: ${controller.state.speed}x`,
        );
      }
      // Shift + ] : Speed Up (+0.1x)
      else if (e.shiftKey && e.key === "}") {
        e.preventDefault();
        controller.adjustValue("speed", 0.1);
        controller.showTemporaryToast(
          `Speed increased: ${controller.state.speed}x`,
        );
      }
      // Alt + B : Reset all filters
      else if (e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        controller.resetAll();
        controller.showTemporaryToast("All video controls reset");
      }
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (e) => {
      if (e.code === "Space") {
        activeControllers.forEach((controller) => {
          controller.setTemporaryBoost("space", false);
        });
      }
    },
    true,
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!extensionEnabled || e.button !== 0) return;
      const targetVideo = getTargetVideo();
      const controller = activeControllers.get(targetVideo);
      if (controller) {
        controller.applyAudioSettings(true);
        controller.setTemporaryBoost("left-click", true);
      }
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (e.button !== 0) return;
      activeControllers.forEach((controller) => {
        controller.setTemporaryBoost("left-click", false);
      });
    },
    true,
  );

  window.addEventListener("blur", () => {
    activeControllers.forEach((controller) => controller.clearTemporaryBoost());
  });

  function getTargetVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    const visibleVideos = videos.filter((video) => {
      const rect = video.getBoundingClientRect();
      const style = window.getComputedStyle(video);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    });

    return (
      visibleVideos.find((video) => video.matches(":hover")) ||
      visibleVideos.find((video) => video.matches(".jw-video")) ||
      visibleVideos.find((video) => !video.paused && !video.ended) ||
      visibleVideos[0] ||
      null
    );
  }

  function initVideoController(video) {
    if (!extensionEnabled) return;
    if (activeControllers.has(video)) return;
    const controller = new VideoController(video);
    activeControllers.set(video, controller);
  }

  class VideoController {
    constructor(video) {
      this.video = video;
      this.state = { ...DEFAULTS };
      this.menuOpen = false;
      this.activeSubmenu = null; // 'scale', 'brightness', 'contrast', 'saturate', 'sepia', 'speed'
      this.toastTimeout = null;
      this.temporaryBoostSources = new Set();
      this.temporaryBoostTimers = new Map();
      this.enabled = true;
      this.originalStyles = {
        transform: video.style.transform,
        transformOrigin: video.style.transformOrigin,
        filter: video.style.filter,
      };
      this.originalPlaybackRate = video.playbackRate;
      this.audioContext = null;
      this.audioGain = null;
      this.audioCompressor = null;
      this.equalizerFilters = null;
      this.audioProcessingError = false;
      this.audioUnavailable = false;

      this.hostname = window.location.hostname;
      this.handleFullscreenChange = () => this.syncFullscreenHost();
      this.handleViewportChange = () => this.updateHostPosition();
      this.buildUI();
      this.loadSettings().then(() => {
        this.applySettings();
      });

      document.addEventListener(
        "fullscreenchange",
        this.handleFullscreenChange,
      );
      window.addEventListener("resize", this.handleViewportChange);
      window.addEventListener("scroll", this.handleViewportChange, true);

      // Track playbackRate changes to override page scripts if they attempt to change it
      this.video.addEventListener("ratechange", () => {
        const effectiveSpeed = this.getEffectiveSpeed();
        if (Math.abs(this.video.playbackRate - effectiveSpeed) > 0.01) {
          this.video.playbackRate = effectiveSpeed;
        }
      });
      this.video.addEventListener("play", () => {
        if (navigator.userActivation?.isActive) {
          this.applyAudioSettings(true);
        }
      });
      this.video.addEventListener("emptied", () => {
        if (!this.audioContext) {
          this.audioUnavailable = false;
          this.audioProcessingError = false;
        }
      });
    }

    async loadSettings() {
      return new Promise((resolve) => {
        chrome.storage.local.get([this.hostname], (result) => {
          if (result && result[this.hostname]) {
            this.state = { ...DEFAULTS, ...result[this.hostname] };
          }
          this.state.speed = Math.max(
            0.1,
            Math.min(5.0, Number(this.state.speed) || 1),
          );
          this.state.audioLevel = Math.max(
            100,
            Math.min(300, Number(this.state.audioLevel) || 100),
          );
          this.state.equalizerEnabled = this.state.equalizerEnabled === true;
          if (
            this.state.equalizerPreset !== "Custom" &&
            !EQUALIZER_PRESETS[this.state.equalizerPreset]
          ) {
            this.state.equalizerPreset = "Flat";
          }
          for (const band of ["bass", "mid", "treble"]) {
            this.state[band] = Math.max(
              -12,
              Math.min(12, Number(this.state[band]) || 0),
            );
          }
          resolve();
        });
      });
    }

    saveSettings() {
      chrome.storage.local.set({ [this.hostname]: this.state });
    }

    applySettings() {
      if (!this.enabled) return;

      // 1. Transform / Scale
      this.video.style.transform = `scale(${this.state.scale / 100})`;
      this.video.style.transformOrigin = "center center";

      // 2. Filters
      const filters = [
        `brightness(${this.state.brightness}%)`,
        `contrast(${this.state.contrast}%)`,
        `saturate(${this.state.saturate}%)`,
        `sepia(${this.state.sepia}%)`,
      ].join(" ");
      this.video.style.filter = filters;

      // 3. Playback Speed
      const effectiveSpeed = this.getEffectiveSpeed();
      if (this.video.playbackRate !== effectiveSpeed) {
        this.video.playbackRate = effectiveSpeed;
      }

      this.applyAudioSettings();
      this.updateUI();
    }

    ensureAudioGraph() {
      if (this.audioContext) return;

      if (this.video.mediaKeys) {
        throw new Error("Audio processing is unavailable for DRM-protected video.");
      }

      const sourceUrl = this.video.currentSrc || this.video.src;
      if (!sourceUrl && !this.video.srcObject) {
        throw new Error("Start the video before enabling audio processing.");
      }

      if (sourceUrl) {
        const mediaUrl = new URL(sourceUrl, window.location.href);
        if (
          mediaUrl.origin !== window.location.origin &&
          !this.video.crossOrigin
        ) {
          throw new Error("This video does not permit audio processing (CORS).");
        }
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio is not supported in this browser.");
      }

      const context = new AudioContextClass();
      let source;
      try {
        source = context.createMediaElementSource(this.video);
        const bass = context.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 160;
        const mid = context.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.8;
        const treble = context.createBiquadFilter();
        treble.type = "highshelf";
        treble.frequency.value = 5000;
        const gain = context.createGain();
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -3;
        compressor.knee.value = 6;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        source.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(gain);
        gain.connect(compressor);
        compressor.connect(context.destination);

        this.audioContext = context;
        this.audioGain = gain;
        this.audioCompressor = compressor;
        this.equalizerFilters = { bass, mid, treble };
      } catch (error) {
        if (source) {
          try {
            source.connect(context.destination);
          } catch {
            // The media element will remain subject to browser audio restrictions.
          }
        }
        context.close().catch(() => {});
        throw error;
      }
    }

    applyAudioSettings(initialize = false, forceNeutral = false) {
      if (!this.enabled && !forceNeutral) return;

      const audioLevel = forceNeutral ? 100 : this.state.audioLevel;
      const equalizerEnabled = forceNeutral
        ? false
        : this.state.equalizerEnabled;
      const requiresAudioGraph = audioLevel !== 100 || equalizerEnabled;

      if (
        !this.audioContext &&
        !this.audioUnavailable &&
        initialize &&
        requiresAudioGraph
      ) {
        try {
          this.ensureAudioGraph();
          this.audioProcessingError = false;
        } catch (error) {
          this.audioUnavailable = true;
          if (!this.audioProcessingError) {
            this.showTemporaryToast(error.message);
            this.audioProcessingError = true;
          }
          return;
        }
      }

      if (!this.audioContext) return;

      const now = this.audioContext.currentTime;
      this.audioGain.gain.setTargetAtTime(audioLevel / 100, now, 0.015);
      const isBoosted = audioLevel > 100;
      this.audioCompressor.threshold.setTargetAtTime(
        isBoosted ? -3 : 0,
        now,
        0.015,
      );
      this.audioCompressor.knee.setTargetAtTime(isBoosted ? 6 : 0, now, 0.015);
      this.audioCompressor.ratio.setTargetAtTime(isBoosted ? 4 : 1, now, 0.015);
      for (const band of ["bass", "mid", "treble"]) {
        this.equalizerFilters[band].gain.setTargetAtTime(
          equalizerEnabled ? this.state[band] : 0,
          now,
          0.015,
        );
      }
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume().catch(() => {});
      }
    }

    setAudioValue(key, value) {
      if (key === "equalizerEnabled") {
        this.state[key] = value === true;
      } else if (key === "equalizerPreset") {
        const preset = EQUALIZER_PRESETS[value];
        if (!preset) return;
        this.state.equalizerPreset = value;
        Object.assign(this.state, preset);
        this.state.equalizerEnabled = true;
      } else {
        const bounds = key === "audioLevel" ? [100, 300] : [-12, 12];
        this.state[key] = Math.max(
          bounds[0],
          Math.min(bounds[1], Number(value)),
        );
        if (["bass", "mid", "treble"].includes(key)) {
          this.state.equalizerPreset = "Custom";
        }
      }
      this.applyAudioSettings(true);
      this.saveSettings();
    }

    getEffectiveSpeed() {
      return this.temporaryBoostSources.size > 0 ? 2 : this.state.speed;
    }

    setTemporaryBoost(source, active) {
      if (active) {
        if (
          !this.enabled ||
          this.temporaryBoostSources.has(source) ||
          this.temporaryBoostTimers.has(source)
        ) {
          return;
        }

        const timer = setTimeout(() => {
          this.temporaryBoostTimers.delete(source);
          if (!this.enabled) return;

          const wasBoosted = this.temporaryBoostSources.size > 0;
          this.temporaryBoostSources.add(source);
          if (!wasBoosted) {
            this.applySettings();
            this.showTemporaryToast("2x speed", 0);
          }
        }, TEMPORARY_BOOST_DELAY);
        this.temporaryBoostTimers.set(source, timer);
        return;
      }

      const timer = this.temporaryBoostTimers.get(source);
      if (timer) {
        clearTimeout(timer);
        this.temporaryBoostTimers.delete(source);
      }

      if (!this.temporaryBoostSources.delete(source)) return;
      if (this.temporaryBoostSources.size > 0) return;
      this.applySettings();
      this.hideToast();
    }

    clearTemporaryBoost() {
      this.temporaryBoostTimers.forEach((timer) => clearTimeout(timer));
      this.temporaryBoostTimers.clear();
      if (this.temporaryBoostSources.size === 0) return;
      this.temporaryBoostSources.clear();
      this.applySettings();
      this.hideToast();
    }

    adjustValue(key, delta) {
      if (key === "speed") {
        this.setValue(
          key,
          Math.max(0.1, Math.min(5.0, this.state.speed + delta)),
        );
      } else {
        const bounds = key === "sepia" ? [0, 100] : [50, 300];
        this.setValue(
          key,
          Math.max(bounds[0], Math.min(bounds[1], this.state[key] + delta)),
        );
      }
    }

    setValue(key, val) {
      if (key === "speed") {
        this.state[key] = parseFloat(parseFloat(val).toFixed(2));
      } else {
        this.state[key] = Math.round(val);
      }
      this.applySettings();
      this.saveSettings();
    }

    resetAll() {
      this.state = { ...DEFAULTS };
      this.applySettings();
      this.saveSettings();
    }

    setEnabled(enabled) {
      if (this.enabled === enabled && (enabled ? this.host : !this.host)) {
        return;
      }

      this.enabled = enabled;
      if (!enabled) {
        this.clearTemporaryBoost();
        this.applyAudioSettings(false, true);
        this.menuOpen = false;
        this.video.style.transform = this.originalStyles.transform;
        this.video.style.transformOrigin = this.originalStyles.transformOrigin;
        this.video.style.filter = this.originalStyles.filter;
        this.video.playbackRate = this.originalPlaybackRate;
        if (this.host) {
          this.host.remove();
          this.host = null;
        }
        return;
      }

      this.buildUI();
      this.applySettings();
    }

    toggleMenu() {
      this.menuOpen = !this.menuOpen;
      if (this.menuOpen) {
        this.container.classList.add("visible");
        this.triggerBtn.classList.add("active");
        this.activeSubmenu = null;
        this.renderMainMenu();
      } else {
        this.container.classList.remove("visible");
        this.triggerBtn.classList.remove("active");
      }
    }

    showTemporaryToast(message, duration = 1500) {
      if (!this.toast) return;
      if (this.temporaryBoostSources.size > 0 && message !== "2x speed") return;
      this.toast.textContent = message;
      this.toast.style.display = "block";
      this.toast.classList.add("visible");

      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }

      if (duration > 0) {
        this.toastTimeout = setTimeout(() => this.hideToast(), duration);
      }
    }

    hideToast() {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
      if (!this.toast) return;
      this.toast.classList.remove("visible");
      this.toast.style.display = "none";
    }

    buildUI() {
      if (this.host) return;

      // Create Shadow DOM host container
      this.host = document.createElement("div");
      this.host.className = "vsc-shadow-host";
      this.host.style.position = "fixed";
      this.host.style.top = "0px";
      this.host.style.left = "0px";
      this.host.style.width = "0px";
      this.host.style.height = "0px";
      this.host.style.pointerEvents = "none";
      this.host.style.zIndex = "2147483647"; // Highest possible z-index to stay on top

      // Append container inside video parent to support fullscreen natively
      const parent = this.video.parentElement;
      if (parent) {
        parent.appendChild(this.host);
      }

      this.shadow = this.host.attachShadow({ mode: "open" });

      // CSS styles for overlay menu, triggers, and range inputs
      const style = document.createElement("style");
      style.textContent = `
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        
        /* Floating Indicator/Trigger Button on Hover */
        .vsc-trigger-btn {
          position: absolute;
          top: 15px;
          right: 15px;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgba(20, 20, 20, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          pointer-events: auto;
          opacity: 0;
          transition: opacity 0.3s, background 0.2s, transform 0.2s;
          z-index: 100;
        }
        :host(:hover) .vsc-trigger-btn,
        .vsc-trigger-btn.active {
          opacity: 1;
        }
        .vsc-trigger-btn:hover {
          background: rgba(30, 30, 30, 0.95);
          transform: scale(1.05);
        }
        .vsc-trigger-btn svg {
          width: 18px;
          height: 18px;
          fill: #ffffff;
        }

        /* Settings Overlay Panel */
        .vsc-menu-panel {
          position: absolute;
          bottom: 20px;
          right: 20px;
          width: 250px;
          background: rgba(18, 18, 18, 0.92);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          color: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          pointer-events: auto;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.2s, transform 0.2s;
          display: none;
          overflow: hidden;
          z-index: 200;
          padding: 8px 0;
        }
        .vsc-menu-panel.visible {
          display: block;
          opacity: 1;
          transform: translateY(0);
        }

        /* Menu Rows */
        .vsc-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 11px 16px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
          user-select: none;
        }
        .vsc-row:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .vsc-row-val {
          color: rgba(255, 255, 255, 0.6);
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .vsc-row-val::after {
          content: '›';
          font-size: 18px;
          line-height: 1;
          color: rgba(255, 255, 255, 0.4);
        }

        /* Submenu Header */
        .vsc-header {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          font-size: 14px;
          font-weight: 600;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          margin-bottom: 10px;
          cursor: pointer;
        }
        .vsc-header-back {
          font-size: 18px;
          margin-right: 10px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1;
        }
        .vsc-header:hover .vsc-header-back {
          color: #ffffff;
        }

        /* Slider Controls */
        .vsc-slider-box {
          padding: 10px 16px;
        }
        .vsc-slider-info {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 8px;
        }
        .vsc-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: #667085;
          border: 1px solid rgba(255, 255, 255, 0.35);
          outline: none;
          margin-bottom: 16px;
        }
        .vsc-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #38bdf8;
          border: 2px solid #ffffff;
          box-shadow: 0 0 4px rgba(0,0,0,0.5);
          cursor: pointer;
          transition: transform 0.1s;
        }
        .vsc-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        /* Quick Action Presets inside submenus */
        .vsc-presets {
          display: flex;
          gap: 6px;
          margin-top: 10px;
        }
        .vsc-btn {
          flex: 1;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 12px;
          padding: 6px 0;
          cursor: pointer;
          transition: background 0.15s;
        }
        .vsc-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .vsc-select {
          width: 100%;
          margin: 4px 0 12px;
          padding: 7px 8px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 5px;
          background: #20242b;
          color: #ffffff;
          font-size: 12px;
        }
        .vsc-audio-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0 12px;
          font-size: 13px;
        }
        .vsc-audio-toggle input {
          width: 16px;
          height: 16px;
          accent-color: #38bdf8;
        }
        .vsc-eq-band {
          margin: 8px 0 2px;
        }
        .vsc-eq-band.disabled {
          opacity: 0.45;
        }
        .vsc-eq-band .vsc-slider-info {
          margin-bottom: 2px;
        }

        /* Speed Options */
        .vsc-speed-list {
          display: flex;
          flex-direction: column;
        }
        .vsc-speed-item {
          padding: 10px 16px;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vsc-speed-item:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .vsc-speed-item.active {
          color: #38bdf8;
          font-weight: bold;
        }
        .vsc-speed-item.active::after {
          content: '✓';
          font-size: 12px;
        }

        /* HUD / Toast Notification for Quick Changes */
        .vsc-toast {
            position: fixed;
            top: 50%;
          left: 50%;
            transform: translateX(-50%) translateY(calc(-50% - 10px));
          background: rgba(0, 0, 0, 0.85);
          color: #ffffff;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
          opacity: 0;
          display: none;
          pointer-events: none;
          transition: opacity 0.2s, transform 0.2s;
          border: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 300;
        }
        .vsc-toast.visible {
          opacity: 1;
          transform: translateX(-50%) translateY(-50%);
        }
      `;
      this.shadow.appendChild(style);

      // Create Trigger button
      this.triggerBtn = document.createElement("div");
      this.triggerBtn.className = "vsc-trigger-btn";
      // Inline beautiful settings/filter icon (matching the screenshot theme)
      this.triggerBtn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M12,18C9.79,18 8,16.21 8,14C8,11.79 9.79,10 12,10C14.21,10 16,11.79 16,14C16,16.21 14.21,18 12,18M20,15.31L23.31,12L20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31Z" />
        </svg>
      `;
      this.triggerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMenu();
      });
      this.shadow.appendChild(this.triggerBtn);

      // Create Container panel
      this.container = document.createElement("div");
      this.container.className = "vsc-menu-panel";
      this.shadow.appendChild(this.container);

      // Create Toast overlay
      this.toast = document.createElement("div");
      this.toast.className = "vsc-toast";
      this.shadow.appendChild(this.toast);

      this.syncFullscreenHost();

      // Dismiss menu if clicking anywhere outside the shadow tree
      document.addEventListener("click", (e) => {
        if (this.menuOpen && !this.host.contains(e.target)) {
          this.toggleMenu();
        }
      });

      this.renderMainMenu();
    }

    syncFullscreenHost() {
      if (!this.host) return;

      const fullscreenElement = document.fullscreenElement;
      const target =
        fullscreenElement && fullscreenElement.contains(this.video)
          ? fullscreenElement
          : document.body;

      if (!target || this.host.parentElement === target) return;

      target.appendChild(this.host);
      this.updateHostPosition();
    }

    updateHostPosition() {
      if (!this.host) return;

      const rect = this.video.getBoundingClientRect();
      this.host.style.top = `${rect.top}px`;
      this.host.style.left = `${rect.left}px`;
      this.host.style.width = `${rect.width}px`;
      this.host.style.height = `${rect.height}px`;
    }

    renderMainMenu() {
      this.container.innerHTML = `
        <div class="vsc-row" data-sub="scale">
          <span>Scale</span>
          <span class="vsc-row-val">${this.state.scale}%</span>
        </div>
        <div class="vsc-row" data-sub="brightness">
          <span>Brightness</span>
          <span class="vsc-row-val">${this.state.brightness}%</span>
        </div>
        <div class="vsc-row" data-sub="contrast">
          <span>Contrast</span>
          <span class="vsc-row-val">${this.state.contrast}%</span>
        </div>
        <div class="vsc-row" data-sub="saturate">
          <span>Saturate</span>
          <span class="vsc-row-val">${this.state.saturate}%</span>
        </div>
        <div class="vsc-row" data-sub="sepia">
          <span>Sepia</span>
          <span class="vsc-row-val">${this.state.sepia}%</span>
        </div>
        <div class="vsc-row" data-sub="speed">
          <span>Speed</span>
          <span class="vsc-row-val">${this.state.speed === 1.0 ? "Normal" : this.state.speed + "x"}</span>
        </div>
        <div class="vsc-row" data-sub="audio-level">
          <span>Volume Boost</span>
          <span class="vsc-row-val">${this.state.audioLevel}%</span>
        </div>
        <div class="vsc-row" data-sub="equalizer">
          <span>Equalizer</span>
          <span class="vsc-row-val">${this.state.equalizerEnabled ? "On" : "Off"}</span>
        </div>
      `;

      // Attach row listeners
      this.container.querySelectorAll(".vsc-row").forEach((row) => {
        row.addEventListener("click", () => {
          this.activeSubmenu = row.getAttribute("data-sub");
          this.renderSubmenu();
        });
      });
    }

    renderSubmenu() {
      const sub = this.activeSubmenu;
      if (!sub) return;

      const capitalized = sub.charAt(0).toUpperCase() + sub.slice(1);

      if (sub === "audio-level") {
        this.container.innerHTML = `
          <div class="vsc-header">
            <span class="vsc-header-back">‹</span> Volume Boost
          </div>
          <div class="vsc-slider-box">
            <div class="vsc-slider-info">
              <span>Range: 100% - 300%</span>
              <span class="vsc-current-display">${this.state.audioLevel}%</span>
            </div>
            <input type="range" class="vsc-slider" min="100" max="300" step="5" value="${this.state.audioLevel}">
            <div class="vsc-presets">
              <button class="vsc-btn" data-level="100">100%</button>
              <button class="vsc-btn" data-level="150">150%</button>
              <button class="vsc-btn" data-level="200">200%</button>
              <button class="vsc-btn" data-level="300">300%</button>
            </div>
          </div>
        `;
        this.container
          .querySelector(".vsc-header")
          .addEventListener("click", () => {
            this.activeSubmenu = null;
            this.renderMainMenu();
          });

        const slider = this.container.querySelector(".vsc-slider");
        const display = this.container.querySelector(".vsc-current-display");
        const updateVolumeUI = () => {
          display.textContent = `${this.state.audioLevel}%`;
          slider.value = this.state.audioLevel;
        };
        slider.addEventListener("input", (event) => {
          this.setAudioValue("audioLevel", event.target.value);
          updateVolumeUI();
        });
        this.container.querySelectorAll("[data-level]").forEach((button) => {
          button.addEventListener("click", () => {
            this.setAudioValue("audioLevel", button.dataset.level);
            updateVolumeUI();
          });
        });
        return;
      }

      if (sub === "equalizer") {
        const bands = ["bass", "mid", "treble"];
        const bandLabels = { bass: "Bass", mid: "Mid", treble: "Treble" };
        this.container.innerHTML = `
          <div class="vsc-header">
            <span class="vsc-header-back">‹</span> Equalizer
          </div>
          <div class="vsc-slider-box">
            <label class="vsc-audio-toggle" for="vsc-eq-enabled">
              <span>Equalizer enabled</span>
              <input id="vsc-eq-enabled" type="checkbox" ${this.state.equalizerEnabled ? "checked" : ""}>
            </label>
            <div class="vsc-slider-info"><span>Preset</span></div>
            <select class="vsc-select" aria-label="Equalizer preset">
              ${this.state.equalizerPreset === "Custom" ? '<option value="Custom" selected>Custom</option>' : ""}
              ${Object.keys(EQUALIZER_PRESETS)
                .map(
                  (preset) =>
                    `<option value="${preset}" ${this.state.equalizerPreset === preset ? "selected" : ""}>${preset}</option>`,
                )
                .join("")}
            </select>
            ${bands
              .map(
                (band) => `
                  <div class="vsc-eq-band ${this.state.equalizerEnabled ? "" : "disabled"}">
                    <div class="vsc-slider-info">
                      <span>${bandLabels[band]}</span>
                      <span data-display="${band}">${this.state[band]} dB</span>
                    </div>
                    <input type="range" class="vsc-slider" data-band="${band}" min="-12" max="12" step="1" value="${this.state[band]}" ${this.state.equalizerEnabled ? "" : "disabled"}>
                  </div>
                `,
              )
              .join("")}
          </div>
        `;
        this.container
          .querySelector(".vsc-header")
          .addEventListener("click", () => {
            this.activeSubmenu = null;
            this.renderMainMenu();
          });
        this.container
          .querySelector("#vsc-eq-enabled")
          .addEventListener("change", (event) => {
            this.setAudioValue("equalizerEnabled", event.target.checked);
            this.renderSubmenu();
          });
        this.container
          .querySelector(".vsc-select")
          .addEventListener("change", (event) => {
            this.setAudioValue("equalizerPreset", event.target.value);
            this.renderSubmenu();
          });
        this.container.querySelectorAll("[data-band]").forEach((slider) => {
          slider.addEventListener("input", (event) => {
            const band = event.target.dataset.band;
            this.setAudioValue(band, event.target.value);
            const presetSelect = this.container.querySelector(".vsc-select");
            if (!presetSelect.querySelector('option[value="Custom"]')) {
              const customOption = document.createElement("option");
              customOption.value = "Custom";
              customOption.textContent = "Custom";
              presetSelect.prepend(customOption);
            }
            presetSelect.value = "Custom";
            this.container.querySelector(`[data-display="${band}"]`).textContent = `${this.state[band]} dB`;
          });
        });
        return;
      }

      if (sub === "speed") {
        this.container.innerHTML = `
          <div class="vsc-header">
            <span class="vsc-header-back">‹</span> Speed
          </div>
          <div class="vsc-slider-box">
            <div class="vsc-slider-info">
              <span>Range: 0.1x - 5x</span>
              <span class="vsc-current-display">${this.state.speed}x</span>
            </div>
            <input type="range" class="vsc-slider" min="0.1" max="5" step="0.1" value="${this.state.speed}">
            <div class="vsc-presets">
              <button class="vsc-btn" id="btn-dec">- 0.1x</button>
              <button class="vsc-btn" id="btn-inc">+ 0.1x</button>
              <button class="vsc-btn" id="btn-reset">Normal</button>
            </div>
          </div>
        `;

        this.container
          .querySelector(".vsc-header")
          .addEventListener("click", () => {
            this.activeSubmenu = null;
            this.renderMainMenu();
          });

        const slider = this.container.querySelector(".vsc-slider");
        const display = this.container.querySelector(".vsc-current-display");
        const updateSpeedUI = () => {
          display.textContent = `${this.state.speed}x`;
          slider.value = this.state.speed;
        };

        slider.addEventListener("input", (e) => {
          this.setValue("speed", e.target.value);
          updateSpeedUI();
        });
        this.container
          .querySelector("#btn-dec")
          .addEventListener("click", () => {
            this.adjustValue("speed", -0.1);
            updateSpeedUI();
          });
        this.container
          .querySelector("#btn-inc")
          .addEventListener("click", () => {
            this.adjustValue("speed", 0.1);
            updateSpeedUI();
          });
        this.container
          .querySelector("#btn-reset")
          .addEventListener("click", () => {
            this.setValue("speed", 1);
            updateSpeedUI();
          });
        return;
      }

      // Slider based controls
      let min = 50,
        max = 300,
        resetVal = 100;
      if (sub === "sepia") {
        min = 0;
        max = 100;
        resetVal = 0;
      }

      this.container.innerHTML = `
        <div class="vsc-header">
          <span class="vsc-header-back">‹</span> ${capitalized}
        </div>
        <div class="vsc-slider-box">
          <div class="vsc-slider-info">
            <span>Range: ${min}% - ${max}%</span>
            <span class="vsc-current-display">${this.state[sub]}%</span>
          </div>
          <input type="range" class="vsc-slider" min="${min}" max="${max}" value="${this.state[sub]}">
          <div class="vsc-presets">
            <button class="vsc-btn" id="btn-dec">- 5%</button>
            <button class="vsc-btn" id="btn-inc">+ 5%</button>
            <button class="vsc-btn" id="btn-reset">Reset</button>
          </div>
        </div>
      `;

      // Back navigation
      this.container
        .querySelector(".vsc-header")
        .addEventListener("click", () => {
          this.activeSubmenu = null;
          this.renderMainMenu();
        });

      const slider = this.container.querySelector(".vsc-slider");
      const display = this.container.querySelector(".vsc-current-display");

      const updateUIStates = () => {
        display.textContent = `${this.state[sub]}%`;
        slider.value = this.state[sub];
      };

      slider.addEventListener("input", (e) => {
        this.setValue(sub, e.target.value);
        display.textContent = `${this.state[sub]}%`;
      });

      this.container.querySelector("#btn-dec").addEventListener("click", () => {
        this.adjustValue(sub, -5);
        updateUIStates();
      });

      this.container.querySelector("#btn-inc").addEventListener("click", () => {
        this.adjustValue(sub, 5);
        updateUIStates();
      });

      this.container
        .querySelector("#btn-reset")
        .addEventListener("click", () => {
          this.setValue(sub, resetVal);
          updateUIStates();
        });
    }

    updateUI() {
      if (!this.container) return;
      if (this.activeSubmenu) {
        this.renderSubmenu();
      } else if (this.menuOpen) {
        this.renderMainMenu();
      }
    }
  }

  // Start discovery only after VideoController has been initialized.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === "VIDEO") {
          initVideoController(node);
        } else if (node.querySelectorAll) {
          node
            .querySelectorAll("video")
            .forEach((video) => initVideoController(video));
        }
      });
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  document
    .querySelectorAll("video")
    .forEach((video) => initVideoController(video));

  // Handle messages from the extension popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "set_enabled") {
      extensionEnabled = message.enabled === true;
      chrome.storage.local.set({ extensionEnabled });
      activeControllers.forEach((controller) => {
        controller.setEnabled(extensionEnabled);
      });
      sendResponse({ enabled: extensionEnabled });
      return;
    }

    if (message && message.action === "reset_styles") {
      activeControllers.forEach((controller) => {
        controller.resetAll();
        controller.showTemporaryToast("All video filters & scale reset");
      });
      sendResponse({ status: "ok" });
    }
  });
})();
