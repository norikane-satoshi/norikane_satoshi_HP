# HP 41238 launchd supervisor

This documents the local supervisor for the persistent HP verification server.
The committed script is `scripts/hp-41238-dev.sh`. The user-specific plist is
not committed because it contains absolute local paths.

## Plist template

Install as `__HOME__/Library/LaunchAgents/com.norikane.hp41238.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.norikane.hp41238</string>
  <key>ProgramArguments</key>
  <array>
    <string>__HOME__/projects/norikane_satoshi_HP/.codex-worktrees/staging/scripts/hp-41238-dev.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__HOME__/projects/norikane_satoshi_HP/.codex-worktrees/staging</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>__HOME__</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:__HOME__/.local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>__HOME__/.local/share/hp-41238/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/.local/share/hp-41238/logs/launchd.err.log</string>
</dict>
</plist>
```

## Commands

```bash
plutil -lint __HOME__/Library/LaunchAgents/com.norikane.hp41238.plist
launchctl bootout gui/$(id -u)/com.norikane.hp41238 2>/dev/null || true
launchctl bootstrap gui/$(id -u) __HOME__/Library/LaunchAgents/com.norikane.hp41238.plist
launchctl kickstart -k gui/$(id -u)/com.norikane.hp41238
launchctl print gui/$(id -u)/com.norikane.hp41238
/usr/sbin/lsof -nP -iTCP:41238 -sTCP:LISTEN
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:41238/
```

Logs:

- `__HOME__/.local/share/hp-41238/logs/dev.log`
- `__HOME__/.local/share/hp-41238/logs/launchd.out.log`
- `__HOME__/.local/share/hp-41238/logs/launchd.err.log`
