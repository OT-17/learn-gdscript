#!/bin/bash
# Post-export patch for the web build (run after every Godot web export).
#
# Makes the engine's adaptive canvas sizing (canvasResizePolicy 2) measure the
# *visualViewport* instead of window.innerWidth/innerHeight. On iOS Safari the
# on-screen keyboard and browser bars only shrink the visualViewport, so
# without this the canvas is sized to the full window: content hides under the
# keyboard and gets clipped top/bottom. The engine re-checks size every frame,
# so this alone keeps the app inside the truly visible area at all times.
set -euo pipefail
cd "$(dirname "$0")/../build/web"

sed -i '' \
  -e 's/window\.innerWidth/(window.visualViewport?window.visualViewport.width:window.innerWidth)/g' \
  -e 's/window\.innerHeight/((window.visualViewport?window.visualViewport.height:window.innerHeight)-(window.GDQ_SAFE_BOTTOM||0))/g' \
  index.js

# When the virtual keyboard's hidden <input>/<textarea> (siblings of the
# canvas) grab browser focus, the canvas fires 'blur' and the engine treats it
# as the window losing focus, hiding text carets. Suppress that one case;
# genuine focus losses still pass through.
perl -0pi -e 's/\QGodotEventListeners.add(canvas,evt_name,function(){func(notif[idx])},true)\E/GodotEventListeners.add(canvas,evt_name,function(ev){if(evt_name==="blur"&&ev&&ev.relatedTarget&&ev.relatedTarget.parentElement===canvas.parentElement&&(ev.relatedTarget.tagName==="INPUT"||ev.relatedTarget.tagName==="TEXTAREA"))return;func(notif[idx])},true)/' index.js

echo "Patched index.js: $(grep -c 'visualViewport?window.visualViewport.width' index.js) width site(s), $(grep -c 'visualViewport?window.visualViewport.height' index.js) height site(s), $(grep -c 'ev.relatedTarget.parentElement===canvas.parentElement' index.js) focus-guard site(s)"
