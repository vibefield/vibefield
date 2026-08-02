# VibeField — Roadmap

> **Status:** the living now/next file — the corpus's single answer to "where are we, what's
> next." REWRITTEN in place at each milestone (never appended); history goes to `LANDED.md`,
> decision status to `DECISIONS.md`, petition status to `draft/petitions/README.md`, law
> stays in the design docs + specs. Last rewritten: **2026-08-02** (HEAD 0632699 — GT-2d +
> the settings panel redesign).
>
> Lives in main-tracked `docs/` (moved from `draft/` 2026-08-02). Corpus citations here
> (`specs/…`, `thinking-…`, `predesign-…`, `research/…`, `petitions/…`) resolve under
> `draft/`, which stays dev-local-only.

## Where the project stands

The P0 exit criterion — *real daily agent work, sessions surviving app restarts* — is half
held: the board survives daemon restarts (B3), PTYs survive everything up to field-native (the
NF kill matrix), docs sync across the mesh (C6), and the plugin/settings/logging/distribution
rails are in. **The missing half is the agents themselves** — the AR track, running over the
landed native floor, watched from the GT deck.

## Tracks

| Track | State | Law lives in | Next / gate |
|---|---|---|---|
| A — shell & spine | walking skeleton + ESR COMPLETE | design-03 · `specs/electron-shell-refactor.md` | follow-on slice: lazy widget factories + on-demand settings/diagnostics (§5.4.4-sanctioned) |
| B — canvas & docs | B1–B4 landed; persistence half of P0 holds since B3 | design-03 · 03·A | — |
| PLUG — plugins | P0–P7 COMPLETE; the spec is governing law | `specs/plugin-architecture.md` | dogfood blocked on products existing (AR/GT); public index repo = James's op |
| C — mesh | C1–C6 + T1 COMPLETE; the P2 mesh chapter closed | design-04 · `thinking-c6-meshdata.md` | doc-existence replication (named follow-up) · CAS pull root (gate: consumers — 03·A C-5, §27.11) |
| D — widgetlab port | COMPLETE (code) | `thinking-widgetlab-port.md` | visual fidelity pass = James's eyeball (§5 checklist) |
| LOG — logging/diagnostics/audit | L0–L6 + post-L6 hardening COMPLETE (§23: 31/32 accepted) | `specs/logging-and-diagnostics.md` | LOG-39 packaged multi-platform CI · LOG-V5/V7/V8 decisions |
| NF — native floor | NF-0…7 COMPLETE and hardened | `specs/native-floor.md` | NF-remote rides GT-4 |
| IOS — companion | IOS-0/2/2f + IOS-EL8 landed | `thinking-ios-app.md` · `research/ios-app-design.md` | daily-driver features gated on desktop tracks; attach = GT-5 |
| GT — Godview terminal | **IN FLIGHT** — GT-0/1/2 + 2b/c/d landed | `specs/godview-terminal.md` | **GT-3** restore manifest → GT-4 remote floor → GT-5 iOS attach |
| EDP/ESP — distribution & packaging | specs ready (EDP v0.3 · ESP v0.2 · plan v0.2); WP3 icons + WP6 tray/single-window landed | the three `specs/electron-*.md` | WP ladder toward WP10 = first signed macOS beta (EDP §16.1); ops first: Immutable Releases toggle + Azure signing eligibility (`thinking-auto-update.md` §next-actions) |
| AR — agent runtime | **NOT STARTED** — the other half of the P0 exit | design-04 (D33/D37/D38) · predesign-04 | chopsticks-in-fieldd over the NF seam; consumes petition C7 (implemented upstream); correlator = fieldd-side ancestor walk (NF resolution) |

## In flight now

**GT.** The control room is open: ⌘G, the deck is real product UI, sessions outlive their
panes; GT-2b/c/d closed the dev-parity traps James hit running `pnpm dev`. Next slice
**GT-3**: restore manifest in the settings doc + consent prompt + `onRehydratePane` (dead ⇒
free shell at cwd) + detach-vs-kill affordances; the deck-mount test fixture is named GT-3
work too.

## Next up — the options on the table (James's call)

- **AR** — the agent tracks; the reason everything else exists.
- **GT-3 → GT-4 → GT-5** — restore, the remote floor, the phone attaches.
- **Packaging WPs** — the ladder toward the signed macOS beta (WP10).
- **LOG-39 packaged CI** — also carries NF's 24h-soak gate.
- **ESR follow-on** bundle slice.

## Open debts (dated, sourced)

- **F-C6-21 audit-integration flake** — struck 3× under full-suite load, green in isolation;
  "the track's oldest debt" (C6-6, 2026-07-28). The mcp EPIPE flake is separate and PAID
  (`37cce3b`).
- **fleet-v3 gate** — delete the C5 hello-claim fallback once every sidecar speaks v3+
  (C6-T1, 2026-07-28).
- **Doc existence does not replicate** — the doc registry is a local JSON file, not a
  SyncedStore slice; a peer's unknown doc shows honest "not held here" (C6-4 corpus
  correction, 2026-07-28).
- **CAS blob store / deny-by-default pull root** — its own contracts+Rust slice, gated on a
  consumer existing (canvas blob refs 03·A C-5 · peer-CAS §27.11) (C6-6).
- **ESR follow-on** — lazy widget factories, settings/diagnostics on-demand, open-doc-only
  preview reveal gating (ESR close, review finding 4).
- **Per-section undo, ⌘Z, timeline** — D29′ residue (P7, 2026-07-24).
- **Sideload** — post first-party publishing (P7).
- **R2 `host:"process"`** — the plugin process-isolation rung (P4/P6 deferral).
- **I1/I4 ICE input arbitration** — implementation gated on James reading ICE `design-007`.
- **I5 ICE in-band rename migration** — needed before replica-everywhere (C2, 2026-07-23).
- **`terminal.list` lags for readers** — GT-1 fixed create, not list; assertions poll past
  the window (GT-2 finding 6).

## Eyeballs owed (James's standing visual passes)

- Widgetlab visual fidelity vs the original (thinking-widgetlab-port §5) — the D-track
  acceptance.
- Open an old board once; watch the C2 id-migration log line.
- Settings Plugins section (P2) · toggle widgetlab → placeholders swap LIVE + tray thins (P3).
- Mesh sync rows + the file pill's standing-state dot, both themes (C6-4).

## Upstream / sibling pins (the EL8 watch)

truffle `=0.7.11` (exact crates-io) · ghosttea `=0.8.0` on all planes · chopsticks 0.1.4 ·
strata 0.10.0 (via ICE) · `@vibecook/ice` 0.2.0 (registry pin). G7/G8/G9 consumed at NF-7;
C7 implemented upstream, consumption rides AR. Full petition status: `petitions/README.md`.
