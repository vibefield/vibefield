# Agent profile usage meters

Inspected 2026-09-24 in VibeField and the linked `../puppeteer` checkout.

## Data path and ownership

- `packages/field-app/src/panels/SettingsPanel.tsx` subscribes to the profile sets.
  `panels/agents/ProfilesSection.tsx` joins those sets to provider/install inventory
  and `agents.usage.subscribe`. `ProfilesView.tsx` renders the meters.
- `panels/agents/profiles-model.ts` matches a reading by provider and persona ID
  (with an unkeyed fallback for native accounts). A shared plan card uses the
  reading of the persona named by `plan.namedBy`; it does not add together the
  usage of agents sharing that subscription. An unidentified sign-in or an agent
  without a usage capability cannot supply a meter merely because it can log in.
- `packages/fieldd/src/agent-usage.ts` owns one shared usage monitor per daemon.
  It projects normalized readings into `packages/contracts/src/agent-usage.ts`:
  percentages, labels, timestamps, credits, and failure/retry information.
  Credentials and native response bodies stay in the daemon/adapter process.
- Puppeteer's `packages/runtime/src/services/account-usage-monitor.ts` owns the
  per-provider/per-profile polling schedule, retained readings, backoff, and pushes.
  `runtime.ts` resolves the profile, coalesces account fetches, and calls the
  adapter's account-usage service. Managed accounts bind each read to that
  agent's own profile root; native accounts use the adapter's default credential
  lookup. Native CLIs continue to own token renewal.

## Automatic polling

These are the adapter defaults in
`../puppeteer/packages/adapter-*/src/services/account-usage.ts`, not advertised
vendor request quotas:

| Agent | Normal interval | Source |
| --- | --- | --- |
| Codex | 1 minute | A short-lived `codex app-server`; `account/rateLimits/read` |
| Claude | 30 minutes | OAuth `GET https://api.anthropic.com/api/oauth/usage`; native status-line pushes when present |
| Kimi | 5 minutes | The managed-platform `/usages` endpoint with the profile's OAuth credential |
| Grok | 15 minutes | ACP `_x.ai/billing` / `GetGrokCreditsConfig` |
| Antigravity | 5 minutes | Structured print commands for `/usage` and `/credits` |

Other built-in agents currently do not advertise an account-usage capability.
Signing in to a service through another harness does not automatically add a
second meter implementation.

Polling starts with the first usage subscriber and stops when the last leaves.
Settings and Godview share that work; opening another window does not create a
second schedule in the same daemon. Rows are still separate per registered
profile, even when two profiles happen to hold the same vendor account.

The scheduler checks due rows on a timer whose default interval is the fastest
provider interval (currently one minute). A read schedules its next attempt
from completion, so timer alignment and transport time can make actual reads
later than the nominal interval. UI timeline clocks also tick once a minute;
that changes elapsed/reset displays without fetching the provider.

A successful Claude status-line push updates the meter immediately and defers
the OAuth poll by 30 minutes when it can be assigned to an account. The current
Claude status-line adapter does not stamp a profile ID: with multiple registered
Claude accounts, the monitor keeps that push in an unkeyed row rather than
overwriting one of them. Managed profile meters then still rely on their own
polls. Account-scoped Claude pushes are another useful freshness improvement.
A failure retains the last good reading as stale.
Retryable failures back off using the provider interval, then 2x, 4x, etc., capped
at 30 minutes. A future provider `retryAt` takes precedence, including waits
longer than 30 minutes. Claude and Kimi parse `Retry-After`; Grok recognizes rate
limit failures. Codex and Antigravity currently fall back to generic failure
backoff rather than carrying a provider-specific retry timestamp.

## Explicit refresh

Previously `agents.usage` only returned the cached snapshot. The service's
unexposed `refresh()` also only fetched rows whose normal polling time was due.

The profile and agent pages now offer **Refresh usage**, calling:

```ts
client.request("agents.usage", { refresh: true, profileIds: [persona.profileId] });
```

The profile page sends all its persona IDs; the agent page sends its one ID.
The daemon reconciles the registry without starting an unrequested poll, waits
for eligible target reads, and returns the full projected batch. The regular
subscription also receives it. The controller shows loading/refusal feedback,
disables repeated clicks, applies the response immediately, and lets newer
subscription frames replace it.

While a refresh is pending, named plan cards with no reading show softly
shimmering meter placeholders instead of an unavailable sentence. The meter
area reserves its space, including wrapped messages, so toggling refresh does
not change card height. Existing readings stay visible with a small pulsing
indicator on the plan icon, with status text available to screen readers;
expired or unnamed sign-ins keep their explanation. The same treatment appears
on an agent's subscription page and uses static placeholders under reduced
motion. Both initial loading and refreshing with cached usage are available in
the Agent Profiles design catalog.

Opening a profile or agent settings page also requests a refresh once its
accounts are known. While that page remains open, returning focus to the app
window or restoring its visibility requests another refresh. Paired focus and
visibility events are combined; moving focus between controls does not refresh.
These automatic requests update the meters without clearing other notices or
adding a success notice. Listeners are removed when the page closes. A page
opened while another profile is refreshing waits, then refreshes its own accounts.

On This Mac, the same refresh also asks `agents.profileSets.list` to refresh
native identities. Those reads are coalesced by the daemon and arrive through
the profiles feed. This recovers a missing plan card after a failed startup
identity read even when the separate usage read already succeeded. Usage waits
for its plan card while an identity is unread; it does not move into the agent
row. The refresh indicator stays active while native identities are being read.

Puppeteer's manual refresh bypasses a successful reading's normal interval,
reuses readings completed or pushed within 30 seconds, coalesces concurrent
work, and preserves failure backoff and `Retry-After`. The 30-second guard is our
own policy, not a vendor promise. Cached reads remain available through
`agents.usage {}`. Both modes require the existing local `agent.usage` scope.
Opening the page and returning to the window use the same cooldown/backoff
rules; they do not change the background polling intervals.

## Faster updates and external limits

Automatic intervals remain unchanged. No published numeric request-per-minute
quota for these particular meter-reading endpoints was established in the
official documentation checked. Model/token usage allowances are a different
limit from how often their meters can be read.

Claude's adapter explicitly describes its OAuth endpoint as heavily rate
limited. A [report in Anthropic's issue tracker](https://github.com/anthropics/claude-code/issues/77477)
describes concurrent pollers receiving 429s and long retry delays; this is a user
report, not a published service guarantee. Faster blanket polling is therefore
not a reliable way to improve Claude freshness.

Prefer native updates where available:

- [Claude's official status-line documentation](https://code.claude.com/docs/en/statusline)
  documents subscription `rate_limits` fields. Puppeteer already ingests them
  when the native status-line bridge supplies them.
- [OpenAI's App Server documentation](https://learn.chatgpt.com/docs/app-server)
  documents both `account/rateLimits/read` and `account/rateLimits/updated`.
  The current Codex usage service only performs the one-shot read; adding
  account-scoped push delivery is a separate improvement from this refresh fix.

Focused regression coverage lives in VibeField's `profiles-settings.test.tsx`,
`agent-usage.test.ts` (contracts and fieldd), and Puppeteer's
`account-usage-monitor.test.ts`. The tests use fake providers, not local secrets
or real subscription requests.
