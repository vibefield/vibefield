# Ids

`ids.json` records patterns, the ten adapter ids, and the five monitor view ids. It does not list the model state inventory or the field tree. Those stay in the model slice at `49fc12da0fadc34e25c227fa2f03dcce2e09dbaa`.

Adapter halves are alphabetical by suffix, first `ceil(n/2)` to GV-AUDIT3. At this pin that is `acp`, `antigravity`, `claude`, `codex`, `copilot`, then `grok`, `hermes`, `kimi`, `opencode`, `pi`.

View order here follows the model document: list, rain, swarm, spend, timeline. Puppeteer's `MONITOR_VIEWS` registry order is a separate source fact in `plan/topology.json`.
