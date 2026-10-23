#!/usr/bin/env bash
# Builds two double-clickable macOS apps:
#   Fighter.app       — starts the local server if needed, opens the game
#   Stop Fighter.app  — stops the server
# Apps land in ~/Desktop/Games. The project path is baked in at build time —
# rerun this script if you move or rename the project folder.
#
# NOTE: the project must NOT live under ~/Desktop, ~/Documents or ~/Downloads —
# macOS TCC silently blocks custom apps from reading files there, so the server
# can't start. That is why this project sits at ~/fighter, not in ai-work.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
APPS_DIR="$HOME/Desktop/Games"
# 8000 belongs to Sideline. Do not reuse it.
PORT=8010

case "$PROJECT_DIR" in
  "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*)
    echo "WARNING: project lives in a macOS-protected folder ($PROJECT_DIR)." >&2
    echo "The launcher app will NOT be able to start the server from there." >&2
    ;;
esac

mkdir -p "$APPS_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Rendering icons…"
# Purple ground with the two fighters' colours, so these read differently from
# Sideline's navy-and-green icons at a glance in the Dock.
/usr/bin/python3 scripts/make_icon.py "$TMP/play_1024.png" --glyph play --accent e8553a --bg 2a1f3d
/usr/bin/python3 scripts/make_icon.py "$TMP/stop_1024.png" --glyph stop --accent 3a84e8 --bg 2a1f3d

make_icns() { # $1 = source png, $2 = out icns
  local iconset="$TMP/$(basename "$2" .icns).iconset"
  mkdir -p "$iconset"
  local sz
  for sz in 16 32 128 256 512; do
    sips -z "$sz" "$sz" "$1" --out "$iconset/icon_${sz}x${sz}.png" >/dev/null
    sips -z "$((sz * 2))" "$((sz * 2))" "$1" --out "$iconset/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$2"
}
make_icns "$TMP/play_1024.png" "$TMP/Fighter.icns"
make_icns "$TMP/stop_1024.png" "$TMP/Stop.icns"

write_plist() { # $1 = app dir, $2 = display name, $3 = bundle id
  cat > "$1/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>$2</string>
	<key>CFBundleDisplayName</key><string>$2</string>
	<key>CFBundleIdentifier</key><string>$3</string>
	<key>CFBundleVersion</key><string>1.0</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleExecutable</key><string>launcher</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>LSUIElement</key><true/>
	<key>LSArchitecturePriority</key><array><string>arm64</string><string>x86_64</string></array>
</dict>
</plist>
PLIST
}

# ----------------------------------------------------------------- Fighter.app
APP="$APPS_DIR/Fighter.app"
echo "Building $APP…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$TMP/Fighter.icns" "$APP/Contents/Resources/AppIcon.icns"
write_plist "$APP" "Fighter" "local.fighter.launcher"

cat > "$APP/Contents/MacOS/launcher" <<'LAUNCH'
#!/bin/bash
PROJECT_DIR="__PROJECT_DIR__"
PORT=__PORT__
URL="http://127.0.0.1:$PORT"

notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"Fighter\"" >/dev/null 2>&1; }
fail() {
  # "giving up after" so a dialog nobody is around to click cannot hang forever.
  /usr/bin/osascript -e "display dialog \"$1\" with title \"Fighter\" buttons {\"OK\"} default button 1 with icon stop giving up after 120" >/dev/null 2>&1
  exit 1
}

# Is OUR game already serving? Checking for a 200 alone is not enough: any other
# service on this port would pass, and we would open the wrong thing. Match a
# string only this project serves. (-f makes curl fail on 404 instead of
# "succeeding" with an error page.)
is_ours() {
  /usr/bin/curl -fsS --max-time 1 "$URL/package.json" 2>/dev/null | /usr/bin/grep -q '"name": "fighter"'
}

# Something is listening but it is not us — bail out loudly rather than opening
# whatever else happens to be on this port.
port_busy() {
  /usr/bin/curl -s -o /dev/null --max-time 1 "$URL" 2>/dev/null
}

if ! is_ours; then
  if port_busy; then
    fail "Port $PORT is already in use by something else, so Fighter cannot start. Quit whatever is using it and try again."
  fi

  notify "Starting Fighter…"
  cd "$PROJECT_DIR" || fail "Could not find the game at $PROJECT_DIR. It may have been moved or renamed."

  # Binds all interfaces so an iPhone on the same wifi can reach it too. Only
  # this folder's game files are served; use Stop Fighter to shut it off.
  /usr/bin/nohup /usr/bin/python3 -m http.server "$PORT" \
    >> "$PROJECT_DIR/server.log" 2>&1 &

  started=""
  for _ in $(/usr/bin/seq 1 40); do
    if is_ours; then started=1; break; fi
    /bin/sleep 0.25
  done
  [ -z "$started" ] && fail "Fighter could not start. Check server.log inside the fighter folder."
fi

# Tell the player what to type on the Xbox or phone (same wifi). en0 is wifi on
# most Macs; en1 covers the rest.
LAN_IP="$(/usr/sbin/ipconfig getifaddr en0 2>/dev/null || /usr/sbin/ipconfig getifaddr en1 2>/dev/null)"
if [ -n "$LAN_IP" ]; then
  notify "Running. On Xbox or phone open http://$LAN_IP:$PORT"
  # The page shows a QR code for this address, for scanning with a phone.
  /usr/bin/open "$URL/?lan=$LAN_IP"
else
  notify "Running. (Not on wifi, so only this Mac can play.)"
  /usr/bin/open "$URL"
fi
LAUNCH
/usr/bin/sed -i '' -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__PORT__|$PORT|g" \
  "$APP/Contents/MacOS/launcher"
chmod +x "$APP/Contents/MacOS/launcher"

# ------------------------------------------------------------ Stop Fighter.app
STOP_APP="$APPS_DIR/Stop Fighter.app"
echo "Building $STOP_APP…"
rm -rf "$STOP_APP"
mkdir -p "$STOP_APP/Contents/MacOS" "$STOP_APP/Contents/Resources"
cp "$TMP/Stop.icns" "$STOP_APP/Contents/Resources/AppIcon.icns"
write_plist "$STOP_APP" "Stop Fighter" "local.fighter.stop"

cat > "$STOP_APP/Contents/MacOS/launcher" <<'STOPSCRIPT'
#!/bin/bash
PORT=__PORT__
# Matches only this game's server, so Sideline and anything else are untouched.
if /usr/bin/pgrep -f "http.server $PORT" >/dev/null 2>&1; then
  /usr/bin/pkill -f "http.server $PORT"
  /usr/bin/osascript -e 'display notification "Game stopped." with title "Fighter"' >/dev/null 2>&1
else
  /usr/bin/osascript -e 'display notification "Fighter was not running." with title "Fighter"' >/dev/null 2>&1
fi
STOPSCRIPT
/usr/bin/sed -i '' -e "s|__PORT__|$PORT|g" "$STOP_APP/Contents/MacOS/launcher"
chmod +x "$STOP_APP/Contents/MacOS/launcher"

# ad-hoc codesign so macOS can attribute the apps and show any one-time
# permission prompt (unsigned apps can be silently denied)
codesign --force --deep -s - "$APP"
codesign --force --deep -s - "$STOP_APP"

# refresh LaunchServices so Finder picks up the icons promptly
LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
[ -x "$LSREG" ] && { "$LSREG" -f "$APP" || true; "$LSREG" -f "$STOP_APP" || true; }

echo "Done:"
echo "  $APP"
echo "  $STOP_APP"
