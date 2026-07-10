//@ts-check
/// <reference path="./bootstrap.d.ts"/>
"use strict";

window.GDQUEST = ((/** @type {GDQuestLib} */ GDQUEST) => {
  const canvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById("canvas")
  );
  const canvasContainer = /** @type {HTMLDivElement} */ (
    document.getElementById("canvas-frame")
  );

  // The engine (canvasResizePolicy 2) is patched at build time to measure the
  // visualViewport (see html_export/patch_web_export.sh), so it tracks the
  // area the on-screen keyboard and browser bars leave visible. Forward
  // visualViewport resizes as window resize events for immediate reaction,
  // and run a watchdog: if the canvas drifts from the visible size (iOS
  // sometimes reports sizes late), nudge the engine with a resize event.
  // Also measure the bottom safe-area (iPhone home indicator) so the build
  // patch can subtract it from the engine's height.
  {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:1px;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const measureSafeBottom = () => {
      window.GDQ_SAFE_BOTTOM = probe.getBoundingClientRect().height || 0;
    };
    measureSafeBottom();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        measureSafeBottom();
        window.dispatchEvent(new Event("resize"));
      });
    }

    setInterval(() => {
      measureSafeBottom();
      const vv = window.visualViewport;
      if (!vv) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const targetH = vv.height - (window.GDQ_SAFE_BOTTOM || 0);
      if (
        Math.abs(rect.width - vv.width) > 2 ||
        Math.abs(rect.height - targetH) > 2
      ) {
        window.dispatchEvent(new Event("resize"));
      }
    }, 500);
  }

  const noOp = () => { };

  const throttle = (callback, limit = 50) => {
    let waiting = false;
    const resetWaiting = () => (waiting = false);
    return (...args) => {
      if (!waiting) {
        callback(...args);
        waiting = true;
        setTimeout(resetWaiting, limit);
      }
    };
  };

  const aspectRatio =
    (maxW = 0, maxH = 0) =>
      (currentWidth = window.innerWidth, currentHeight = window.innerHeight) => {
        const ratioW = currentWidth / maxW;
        const ratioH = currentHeight / maxH;
        const ratio = Math.min(ratioW, ratioH);
        const width = maxW * ratio;
        const height = maxH * ratio;
        return { width, height, ratio };
      };

  /**
   * Returns a proxied console that can be turned off and on by appending
   * `?debug` to the URL. Specific modules can be turned on and off by using
   * `?debug=modulea,moduleb`.
   * This is not to be mistaken with the other log module below, which logs
   * _user traces_ from the app to localStorage.
   */
  const makeLogger = (() => {
    const consoleMethods = [
      "log",
      "error",
      "info",
      "warn",
      "assert",
      "trace",
      "table",
    ];

    const fakeLogger = /** @type {Console} */ ({});
    consoleMethods.forEach((k) => (fakeLogger[k] = noOp));

    const params = new URLSearchParams(window.location.search);
    const isDebugMode = params.has("debug");

    if (isDebugMode) {
      document.body.classList.add("debug");
    }

    const modules = (() => {
      const modules = /**@type {Record<string, true>} */ ({});
      if (!isDebugMode) {
        return { app: true };
      }
      const modulesList = (params.get("debug") || "")
        .split(",")
        .filter(Boolean);
      if (modulesList.length == 0) {
        return { "*": true };
      }
      modulesList.map((k) => (modules[k] = true));
      return modules;
    })();

    return (/**@type {string} **/ title) => {
      const prepared = [`%c[${title}]`, `color:#5b5bdf;`];
      const logger = /** @type {Console} */ ({});
      if (modules["*"] || modules[title]) {
        consoleMethods.forEach(
          (k) => (logger[k] = (...args) => console[k](...prepared, ...args))
        );
      } else {
        return fakeLogger;
      }
      return logger;
    };
  })();

  GDQUEST.makeLogger = makeLogger;

  const makeSignal = () => {
    const listeners = new Set();
    /**
     * @param {(...args) => void } fn
     * @returns
     */
    const disconnect = (fn) => listeners.delete(fn);
    /**
     * @param {(...args) => void } fn
     */
    const connect = (fn) => {
      listeners.add(fn);
      return () => disconnect(fn);
    };
    const once = (fn) => {
      const wrapped = (...args) => {
        disconnect(wrapped);
        fn(...args);
      };
      return connect(wrapped);
    };
    const emit = (...args) => listeners.forEach((fn) => fn(...args));
    /** @type { Signal } */
    const signal = { disconnect, connect, emit, once };
    return signal;
  };

  GDQUEST.events = {
    onError: makeSignal(),
    onGodotLoaded: makeSignal(),
    onResize: makeSignal(),
  };

  resize: {
    // Size against the visual viewport when available: on mobile it shrinks
    // when the on-screen keyboard opens, so the whole app rescales into the
    // visible strip above the keyboard and you can see what you type.
    // The canvas fills the viewport with NO forced 16:9 letterbox: on a
    // portrait phone the old widescreen band wasted most of the screen. The
    // app itself (stretch: canvas_items + MobileDisplay.gd) adapts to any
    // aspect ratio.
    const onResize = () => {
      const vv = window.visualViewport;
      const width = vv ? vv.width : window.innerWidth;
      const height = vv ? vv.height : window.innerHeight;
      canvasContainer.style.setProperty(`width`, `${width}px`);
      canvasContainer.style.setProperty(`height`, `${height}px`);
      document.documentElement.style.setProperty(
        "--scale",
        `${Math.min(width / 1920, height / 1080)}`
      );
      const keyboardOpen = vv && window.innerHeight - vv.height > 80;
      document.body.classList.toggle("vk-open", !!keyboardOpen);
    };
    window.addEventListener("resize", throttle(GDQUEST.events.onResize.emit));
    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        "resize",
        throttle(GDQUEST.events.onResize.emit)
      );
      // If Safari still nudges the page toward the hidden input, snap back.
      window.visualViewport.addEventListener("scroll", () =>
        window.scrollTo(0, 0)
      );
    }
    GDQUEST.events.onResize.connect(onResize);
    onResize();
  }

  loadingControl: {
    const debug = makeLogger("loader");
    let is_done = false;

    // these class names get added to document.body
    // css controls what is visible through that mechanism
    const StatusMode = {
      DONE: "mode-done",
      PROGRESS: "mode-progress",
      INDETERMINATE: "mode-indeterminate",
      NOTICE: "mode-notice",
    };

    const allModes = Object.values(StatusMode);

    let currentStatusMode;

    /**
     * Sets a status mode (class name) on the body element.
     * if `is_done` is `true`, the function no-ops
     * @param {string} mode one of the `StatusMode`s
     * @returns
     */
    const setStatusMode = (mode = StatusMode.INDETERMINATE) => {
      if (currentStatusMode === mode || is_done) {
        return;
      }
      document.body.classList.remove(...allModes);
      if (allModes.includes(mode)) {
        document.body.classList.add(mode);
        currentStatusMode = mode;
      } else {
        throw new Error(`Invalid status mode : ${mode}`);
      }
    };

    /**
     * Shows an error to the user
     * @param {Error|string} err
     */
    const displayFailureNotice = (err) => {
      var msg = err instanceof Error ? err.message : err;
      console.error(msg);
      setStatusMode(StatusMode.NOTICE);
      const statusNotice = document.getElementById("notices");
      statusNotice &&
        msg.split("\n").forEach((line) => {
          statusNotice.appendChild(document.createTextNode(line));
          statusNotice.appendChild(document.createElement("br"));
        });
      is_done = true;
    };

    const loaderElement = document.getElementById("loader");
    /**
     * Grows the visual loading bar
     * @param {number} percentage
     * @returns
     */
    const displayPercentage = (percentage = 0) =>
      loaderElement &&
      loaderElement.style.setProperty("--progress", percentage * 100 + "%");

    /**
     * Callback used during the loading of the engine and packages
     * @param {number} current the current amount of bytes loaded
     * @param {number} total the total amount of bytes loaded
     */
    const onProgress = (current, total) => {
      if (total > 0) {
        setStatusMode(StatusMode.PROGRESS);
        displayPercentage(current / total);
        if (current === total) {
          onPackageLoaded();
        }
      } else {
        setStatusMode(StatusMode.INDETERMINATE);
      }
    };

    /**
     * Called once Godot loaded everything.
     * All of the operations no-op if `onPackageLoaded` has already been called,
     * so it's safe to call several times.
     */
    const onPackageLoaded = () => {
      displayPercentage(1);
      debug.info("package loaded");
      setTimeout(() => {
        setStatusMode(StatusMode.DONE);
        is_done = true;
        GDQUEST.events.onGodotLoaded.emit();
      }, 200);
    };

    const onPrintError = (/** @type {any[]} */ ...args) => {
      if (args[0] instanceof Error) {
        const { message } = args[0];
        if (/Maximum call stack size exceeded/.test(message)) {
          GDQUEST.events.onError.emit("RECURSIVE");
        }
      } else if (typeof args[0] === "string") {
        if (/Maximum call stack size exceeded/.test(args[0])) {
          GDQUEST.events.onError.emit("RECURSIVE");
        }
      } else {
        debug.error(...args);
      }
    };

    /**
     * Instanciates the engine, starts the package
     */
    const load = () => {
      setStatusMode(StatusMode.INDETERMINATE);
      // 2 = adaptive: the engine resizes its drawing buffer to the browser
      // window continuously. Required for phones: with the old value (0) the
      // buffer stayed at the hardcoded 1920x1080 desktop size forever.
      GODOT_CONFIG.canvasResizePolicy = 2;
      GODOT_CONFIG.onPrintError = onPrintError;
      const engine = new Engine(GODOT_CONFIG);
      engine
        .startGame({ onProgress })
        .then(onPackageLoaded)
        .catch(displayFailureNotice);
    };

    /**
     * Entry point, this is run once the page loads
     */
    const startLoading = () => {
      setStatusMode(StatusMode.INDETERMINATE);

      if (!Engine.isWebGLAvailable()) {
        displayFailureNotice("WebGL not available");
      } else {
        load();
      }
    };

    GDQUEST.startLoading = startLoading;
    GDQUEST.displayFailureNotice = displayFailureNotice;
  }

  virtualKeyboardHardening: {
    // Visible build tag so remote testers can confirm which version they run.
    const badge = document.createElement("div");
    badge.id = "version";
    badge.textContent = "mobile v8";
    document.body.appendChild(badge);

    // Live diagnostic readout, enabled with ?diag in the URL: shows what the
    // phone reports vs what the engine drew. For remote debugging via
    // screenshots.
    if (new URLSearchParams(window.location.search).has("diag")) {
      const diag = document.createElement("div");
      diag.style.cssText =
        "position:fixed;top:0;left:0;z-index:99999;background:rgba(0,0,0,0.75);" +
        "color:#3dff6e;font:11px monospace;padding:4px 6px;pointer-events:none;" +
        "white-space:pre;text-align:left;";
      document.body.appendChild(diag);
      setInterval(() => {
        const vv = window.visualViewport;
        const rect = canvas.getBoundingClientRect();
        diag.textContent =
          `vv: ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) + " scale " + vv.scale.toFixed(2) + " top " + Math.round(vv.offsetTop) : "none"}\n` +
          `inner: ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}\n` +
          `buffer: ${canvas.width}x${canvas.height}\n` +
          `canvas css: ${Math.round(rect.width)}x${Math.round(rect.height)} at y ${Math.round(rect.top)}\n` +
          `safeBottom: ${window.GDQ_SAFE_BOTTOM || 0} standalone: ${window.navigator.standalone === true}`;
      }, 500);
    }

    // Testing backdoor: ?uiscale=1 activates the app's mobile layout on any
    // device (auto-computed scale); ?uiscale=1.6 forces that exact scale.
    // Read by autoload/MobileDisplay.gd.
    const uiscaleParam = new URLSearchParams(window.location.search).get(
      "uiscale"
    );
    if (uiscaleParam && Number(uiscaleParam) > 0) {
      window.FORCE_UI_SCALE = true;
      if (Number(uiscaleParam) > 0.5 && Number(uiscaleParam) !== 1) {
        window.MOBILE_UI_SCALE_OVERRIDE = Number(uiscaleParam);
      }
    }

    // Godot's virtual keyboard creates a hidden <input>/<textarea> next to the
    // canvas and calls .focus() on tap. Safari scrolls the focused element
    // into view, yanking the app around. Wrap focus with preventScroll and
    // clamp any scroll that slips through.
    const patchFocus = (el) => {
      if (!el.matches || !el.matches("input, textarea")) {
        return;
      }
      const nativeFocus = el.focus.bind(el);
      el.focus = () => nativeFocus({ preventScroll: true });
    };
    new MutationObserver((mutations) =>
      mutations.forEach((m) => m.addedNodes.forEach(patchFocus))
    ).observe(canvasContainer, { childList: true });

    document.addEventListener("focusin", () =>
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      })
    );
  }

  mobileHandling: {
    const KEY = "force-mobile";

    const forceAppOnMobile = () => {
      document.body.classList.add(KEY);
      localStorage.setItem(KEY, "true");
    };

    const mobileWarningButton = document.getElementById(
      "mobile-warning-dismiss-button"
    );

    mobileWarningButton &&
      mobileWarningButton.addEventListener("click", forceAppOnMobile);

    const currentValue = JSON.parse(localStorage.getItem(KEY) || "false");

    if (currentValue === true) {
      forceAppOnMobile();
    }
  }

  logging: {
    const debug = makeLogger("app");
    const KEY = "log";
    const LEVELS = {
      TRACE: 10,
      DEBUG: 20,
      INFO: 30,
      WARN: 40,
      ERROR: 50,
      FATAL: 60,
    };

    const generateDownloadableFile = (filename = "", text = "") => {
      var element = document.createElement("a");
      element.setAttribute(
        "href",
        "data:text/plain;charset=utf-8," + encodeURIComponent(text)
      );
      element.setAttribute("download", filename);

      element.style.display = "none";
      document.body.appendChild(element);

      element.click();

      document.body.removeChild(element);
    };

    /** @type { Log['get'] } */
    const get = () => JSON.parse(localStorage.getItem(KEY) || "[]");

    const log_lines = get();

    /**
     * Gets the size of a localstorage slot.
     * @param {string} key
     * @returns the size of the data in kilobytes
     */
    const getLocalStorageSizeOf = (key) => () =>
      (((localStorage.getItem(key) || "").length + key.length) * 2) / 1024;

    const getLocalStorageSize = getLocalStorageSizeOf(KEY);

    /** @type { Log['download'] } */
    const download = () =>
      generateDownloadableFile(
        `gdquest-${Date.now()}.log`,
        localStorage.getItem(KEY) || ""
      );

    const makeLogFunction =
      (level = LEVELS.INFO) =>
        /** @type {LogFunction} */
        (anything, msg = "") => {
          if (typeof anything === "string" || typeof anything === "number") {
            msg = String(anything);
            anything = null;
          }

          const time = Date.now();
          /** @type {LogLine} */
          const log_line = { time, level, msg, ...(anything || {}) };
          log_lines.push(log_line);
          localStorage.setItem(KEY, JSON.stringify(log_lines));

          if (level < 30) {
            if (anything) {
              debug.log(msg, anything);
            } else {
              debug.log(msg);
            }
          } else if (level < 40) {
            if (anything) {
              debug.info(msg, anything);
            } else {
              debug.info(msg);
            }
          } else if (level < 50) {
            if (anything) {
              debug.warn(msg, anything);
            } else {
              debug.warn(msg);
            }
          } else {
            if (anything) {
              debug.error(msg, anything);
            } else {
              debug.error(msg);
            }
          }
        };

    /** @type { Log['display'] } */
    const display = () => console.table(get());

    /** @type { Log['clear'] } */
    const clear = () => {
      localStorage.removeItem(KEY);
      console.info("log cleared");
    };

    /** @type { Log['trimIfOverLimit'] } */
    const trimIfOverLimit = (maxKiloBytes = 1000) => {
      let response = false;
      while (getLocalStorageSize() > maxKiloBytes) {
        log_lines.shift();
        localStorage.setItem(KEY, JSON.stringify(log_lines));
        response = true;
      }
      return response;
    };

    const logSystemInfoIfLogIsEmpty = (additionalData = {}) => {
      if (log_lines.length == 0) {
        const { userAgent, vendor } = navigator;
        const { width, height } = screen;
        const { innerHeight, innerWidth } = window;
        const {
          build_date,
          build_date_iso,
          build_date_unix,
          git_branch,
          git_commit,
          version,
        } = GDQUEST_ENVIRONMENT || {};
        const data = {
          userAgent,
          vendor,
          width,
          height,
          innerHeight,
          innerWidth,
          build_date,
          build_date_iso,
          build_date_unix,
          git_branch,
          git_commit,
          version,
          ...additionalData,
        };
        makeLogFunction(LEVELS.TRACE)(data, `INIT`);
      }
    };

    /** @type { Log } */
    // @ts-ignore
    const log = {
      display,
      clear,
      get,
      trimIfOverLimit,
      download,
      logSystemInfoIfLogIsEmpty,
    };
    Object.keys(LEVELS).forEach(
      (key) => (log[key.toLowerCase()] = makeLogFunction(LEVELS[key]))
    );

    GDQUEST.log = log;
  }

  fullscreen: {
    /*
     * Create a button with a label.
     */
    const makeFullscreenButton = (className, onClick = () => { }) => {
      const button = document.createElement("button");
      button.classList.add(className);
      button.addEventListener("click", onClick);

      const label = document.createElement("span");
      label.textContent = "toggle Fullscreen";
      button.appendChild(label);
      return button;
    }

    /**
     * Create a button with the proper classes; change class when
     * fullscreen event happens
     */
    const fullscreenOnButton = makeFullscreenButton("button-fullscreen-on", () => document.documentElement.requestFullscreen());
    const fullscreenOffButton = makeFullscreenButton("button-fullscreen-off", () => {
      document.exitFullscreen().catch((err) => err.name !== "TypeError" && console.error(err));
    });

    /**
     * Only add the button if Godot has loaded, and only on platforms that
     * support the Fullscreen API at all (iPhone Safari does not).
     */
    GDQUEST.events.onGodotLoaded.once(() => {
      if (!document.documentElement.requestFullscreen) {
        return;
      }
      canvasContainer.appendChild(fullscreenOnButton);
      canvasContainer.appendChild(fullscreenOffButton);
    });

    document.addEventListener("keydown", (event) => {
      if (event.code === "F11") {
        event.preventDefault();
        if (getComputedStyle(fullscreenOnButton).display !== "none") {
          fullscreenOnButton.click();
        } else if (getComputedStyle(fullscreenOffButton).display !== "none") {
          fullscreenOffButton.click();
        }
      }
    });
  }

  return GDQUEST;
  // @ts-ignore
})(window.GDQUEST || {});

window.GDQUEST.startLoading();
