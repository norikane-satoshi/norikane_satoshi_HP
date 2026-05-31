# Tier 1 Notion AI Chrome LaunchAgent

This LaunchAgent runs `scripts/chatbot/tier1-ensure-chrome-launchd.sh` on login and every 120 seconds. The wrapper exits after the existing bounded ensure command completes; it does not run a foreground server or follow logs.

## Plist Template

Replace every `<ABS_...>` value with an absolute path. Do not use `~` in the plist.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>studio.norikane.tier1-ensure-chrome</string>

  <key>ProgramArguments</key>
  <array>
    <string><ABS_REPO>/scripts/chatbot/tier1-ensure-chrome-launchd.sh</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>StartInterval</key>
  <integer>120</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string><ABS_HOME></string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>

  <key>StandardOutPath</key>
  <string><ABS_LOG_DIR>/tier1-ensure-chrome.out.log</string>

  <key>StandardErrorPath</key>
  <string><ABS_LOG_DIR>/tier1-ensure-chrome.err.log</string>
</dict>
</plist>
```

## Install

The plist contains machine-specific absolute paths, so commit only the wrapper and this document.

```bash
PLIST="$HOME/Library/LaunchAgents/studio.norikane.tier1-ensure-chrome.plist"
LABEL="studio.norikane.tier1-ensure-chrome"

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL"
```

`login-redirect` is not a success state. When the ensure command reports `manual-reauth-required`, re-authenticate manually in the dedicated Chrome profile and rerun the one-shot health check.
