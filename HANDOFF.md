# Learn GDScript Mobile — Project Handoff

**For a fresh Claude Code session.** Read this top to bottom before touching anything.
Owner: Alex (non-coder — plain English, explain jargon, check in often; see `/Users/Shared/Claude/CLAUDE.md`).

## What this project is

Alex is learning GDScript (for his game, Delta Zulu) using GDQuest's free open-source app **"Learn GDScript From Zero"**. The official web version is unusable on iPhone (no on-screen keyboard — upstream issue GDQuest/learn-gdscript#847 — and a desktop-only layout). Over one long session (2026-07-09) we built a mobile-friendly fork and shipped it. It is **live and working for reading lessons, quizzes, and typing code** at:

**https://ot-17.github.io/learn-gdscript/** (add `?diag` for a green diagnostic overlay)

The remaining major gap: the **practice screens** (the hands-on exercises) use a 3-column desktop layout that is unusable on a phone. That redesign is the next session's job — see "Next tasks."

## Where everything lives

All under `/Users/Shared/Claude/Personal/Projects/learn-gdscript-mobile/` (deliberately separate from the Delta Zulu repo):

| Path | What it is |
|---|---|
| `learn-gdscript/` | Fork clone (GitHub: **OT-17/learn-gdscript**, private-use fork of GDQuest/learn-gdscript). Work branch: **`mobile`** (all source changes). Branch **`gh-pages`** = the deployed site (orphan branch, force-pushed each deploy). |
| `learn-gdscript/build/web/` | The exported web build (what gets deployed). |
| `learn-gdscript/html_export/patch_web_export.sh` | **Critical.** Post-export engine patches (see below). Run after EVERY web export. |
| `godot-fork/` | Custom Godot engine source: Razoric480/godot, branch `nathan/learn-gdscript-custom-build-40` (= Godot **4.6.3** + GDQuest's modifications). The app CANNOT be opened in stock Godot. |
| `godot-fork/bin/godot.macos.editor.arm64` | The custom editor we compiled ourselves (`../.venv/bin/scons platform=macos arch=arm64 target=editor vulkan=no`). Used for all exports. |
| `godot-custom/` | GDQuest's prebuilt release assets (web export template zip etc. — no macOS editor exists upstream, which is why we compiled one). |
| `.venv/` | Python venv holding scons. **Homebrew is NOT writable on this Mac** — never use brew. |

`gh` CLI is authenticated as OT-17. License: MIT (code) + CC-BY (assets) — personal fork is fine.

## The build & deploy loop (memorize this)

```bash
cd "/Users/Shared/Claude/Personal/Projects/learn-gdscript-mobile/learn-gdscript"

# 1. Only if .gd / project.godot / scenes / index_template.html changed:
../godot-fork/bin/godot.macos.editor.arm64 --headless --export-debug "Web" build/web/index.html
./html_export/patch_web_export.sh          # ALWAYS after an export

# 2. Always: copy the static shell files
cp html_export/static/bootstrap.js html_export/static/style.css html_export/static/manifest.json build/web/

# 3. Version bump (Safari caches for 10 min — this is how we tell versions apart):
#    - bump ?v=N in html_export/index_template.html (2 places; requires re-export to reach build)
#    - bump the "mobile vN" badge string in html_export/static/bootstrap.js
# 4. Commit source to `mobile`, then redeploy gh-pages:
git add -A && git commit -m "..." && git push origin mobile
git branch -D gh-pages; git checkout --orphan gh-pages; git rm -rf --cached . -q
cd build/web && git --work-tree=. --git-dir=../../.git add -A && \
  git --work-tree=. --git-dir=../../.git commit -m "Deploy mobile vN" && \
  git push -f origin gh-pages && cd ../.. && git checkout -f mobile
# 5. Wait for GitHub Pages (1-3 min), verify:
#    curl -s "https://ot-17.github.io/learn-gdscript/bootstrap.js?v=N" | grep "mobile vN"
```

**Testing protocol with Alex:** he tests in a Safari **Private tab** and always confirms the corner **badge version** first ("mobile v11" etc.) — his phone has served stale mixed-version caches more than once. Current deployed version: **v11**.

## What we changed and why (the architecture)

1. **Keyboard** (`export_presets.cfg`): `html/experimental_virtual_keyboard=true`. Godot overlays a hidden HTML input/textarea; tapping a text field raises the iOS keyboard. This was the original showstopper — it works.
2. **Engine post-export patches** (`patch_web_export.sh`, sed/perl on `build/web/index.js`):
   - Engine measures **visualViewport** instead of `window.innerWidth/Height` → canvas tracks exactly the visible area, including when the keyboard opens (verified pixel-perfect via diag overlay).
   - Height also subtracts `window.GDQ_SAFE_BOTTOM` (home-indicator inset, measured in bootstrap.js).
   - **Focus-guard**: canvas `blur` events caused by the hidden keyboard box are suppressed so the engine doesn't think it lost focus.
3. **Page shell** (`html_export/static/bootstrap.js` + `style.css`): no 16:9 letterbox (canvas fills viewport), hidden VK elements pinned to an invisible 2px strip at top (kills stray caret + page scroll-away), page locked (`position:fixed`), `canvasResizePolicy=2` (adaptive), visualViewport resize → window resize forwarding + drift watchdog, "mobile vN" badge, `?diag` overlay (live size readout), `?uiscale=N` testing backdoor (forces mobile layout on desktop).
4. **In-app** (`autoload/MobileDisplay.gd`, registered in project.godot): on touch devices — `content_scale_aspect = EXPAND` (kills in-canvas letterbox), auto-computed `content_scale_factor` (portrait targets 800 virtual px width — Alex approved this density; landscape 950), orientation judged by physical screen (not window, which flips when keyboard opens), all TextEdits get solid/thick/forced carets, RichTextLabels get `selection_enabled=false`.
5. **PWA**: manifest + apple meta tags; "Add to Home Screen" gives a standalone app. Status bar style "black" (opaque) to avoid notch overlap.

## Verified state (Alex, on-device, v11)

WORKS: keyboard + typing, edge-to-edge layout portrait & landscape, reading density ("good"), quizzes with answers/Skip/Submit, scrolling via right-edge scrollbar, no more text-selection-on-drag, home-screen install.

## Next tasks (priority order)

1. **Practice-screen mobile layout — THE BIG ONE.** The practice screen (Run/Pause/Reset/Solution/Output/Continue) is 3 desktop columns (instructions | code editor | game view + output); on the phone both orientations collapse into unusable slivers (Alex confirmed with screenshots). Plan: on touch/narrow screens restack vertically — instructions top (collapsible), editor full-width, button row, game view + output below or tabbed. Find the scene under `ui/screens/` (grep for the Run/Solution buttons). Real UI work; budget a full session; test via `?uiscale=1` on desktop + Alex on device.
2. **Caret invisible while keyboard is up.** Root cause identified: the hidden VK textarea behaves like an **IME composition session**, and TextEdit hides its caret during IME composition (caret reappears the moment the keyboard closes — Alex confirmed). Fix: engine patch around the IME path, or app-side fake caret (draw a 3px line at `get_caret_draw_pos()` from CodeEditorEnhancer/SliceEditorOverlay when touchscreen).
3. **Touch-drag doesn't pan the lesson scroll** (selection fix landed; panning still dead). The lesson scroll appears custom (scrollbar-driven; see SliceEditor's scrollbar wiring and the lesson screen's ScrollContainer setup). Teach it InputEventScreenDrag panning.
4. Smaller: slow lesson loads (~30-60s — debug-only web template; a release template build needs emscripten/emsdk), loading progress bar off-screen at scale (looks frozen), strip badge/diag for a "final" version, consider upstreaming the keyboard fix to GDQuest (#847).

## Gotchas / hard-won lessons

- **Never trust a test without the badge check** — Safari mixes cached versions.
- The custom engine is **Godot 4.6.3-based**; docs elsewhere referencing "Godot 3" branches are stale. Always use the `-40` branch.
- The exported `index.js` is regenerated from the template on every export → patches must be re-applied (the script does it; just never skip it).
- Loading screens can take 30-60s with an invisible progress bar — not frozen.
- **iPhone Mirroring**: taps do NOT reach the Godot canvas (scroll + native iOS UI work). Watch-only for this app, and it disconnects while Alex physically uses the phone. Remote debugging = diag overlay + Alex's screenshots + desktop `?uiscale=1` preview (a Browser-pane launch config `learn-gdscript-web`, port 8899, exists in the Delta Zulu project's `.claude/launch.json`).
- Alex's Delta Zulu game project (`/Users/Shared/Claude/Personal/Projects/Delta Zulu GDD`) is untouched by all of this and must stay that way.
