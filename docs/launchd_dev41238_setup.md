# LaunchAgent for local 41238 validation

This repo keeps chatbot and booking-calendar validation on `http://localhost:41238/`.
Production release still requires local 41238 verification and Satoshi approval.

The user LaunchAgent is installed outside the repo:

- Label: `com.norikane.tier2-dev-41238`
- Plist: `__HOME__/Library/LaunchAgents/com.norikane.tier2-dev-41238.plist`
- Wrapper: `__WORKTREE__/scripts/dev41238-launchd.sh`
- Working directory: `__WORKTREE__`
- App log: `__HOME__/.local/share/norikane-hosted-worker/logs/dev41238.log`
- launchd stdout: `__HOME__/Library/Logs/com.norikane.tier2-dev-41238.out`
- launchd stderr: `__HOME__/Library/Logs/com.norikane.tier2-dev-41238.err`

Install or refresh:

```sh
plutil -lint "__HOME__/Library/LaunchAgents/com.norikane.tier2-dev-41238.plist"
launchctl bootout "gui/$(id -u)/com.norikane.tier2-dev-41238" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "__HOME__/Library/LaunchAgents/com.norikane.tier2-dev-41238.plist"
launchctl kickstart -k "gui/$(id -u)/com.norikane.tier2-dev-41238"
```

Stop explicitly only when directed:

```sh
launchctl bootout "gui/$(id -u)/com.norikane.tier2-dev-41238"
```

Readiness check:

```sh
curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:41238/
```
