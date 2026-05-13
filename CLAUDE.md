@AGENTS.md

Dev server rule: when a local Next.js dev server is started for verification, do not kill it at session end unless the user explicitly requests shutdown. Preserve the PID and log path for the next verification turn.
