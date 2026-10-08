// Registries-as-code (design-01 §7, P8): ports, stores, namespaces, env prefixes,
// scopes, app id, socket names exist HERE and nowhere else.

export const APP_ID = "vibefield" as const;

/** Installed desktop identity. This deliberately differs from APP_ID, which is
 * the truffle mesh namespace and data-root slug. Windows shortcuts, taskbar
 * grouping, notifications, and the installer all use this frozen value. */
export const DESKTOP_APP_ID = "com.jamesyong.vibefield" as const;

/** Stable native status-item identity, frozen in the release-identity ledger.
 * macOS uses it in development and packaged builds so a user-selected menu-bar
 * position survives relaunches. Windows must wait for a signed package before
 * consuming the same identity (EDP §5.6). */
export const DESKTOP_TRAY_GUID = "c524c40e-05b6-4d89-bbb9-82ba4e97ea91" as const;

/** Development-only MessagePort handoff channels. The Electron Studio graph
 * consumes them, while production entries have no edge to that graph. */
export const STUDIO_PRODUCT_PORT_CHANNEL = "vibefield:studio:product-port:v1" as const;
export const STUDIO_PUBLISHER_PORT_CHANNEL = "vibefield:studio:publisher-port:v1" as const;

/** One place for every port VibeField binds or reserves. */
export const PORTS = {
  /** fieldd product API — renderer control plane (loopback WS, JSON-RPC text). D27.
   * UA-D12: LEGACY DEFAULT, documentation only — every pair binds ephemeral
   * (port 0) since UA-5 and product.json is the only discovery. */
  FIELDD_WS_CONTROL: 9410,
  /** fieldd product API — renderer data lanes (loopback WS, binary, D5 framing). D27.
   * UA-D12: LEGACY DEFAULT, documentation only — see FIELDD_WS_CONTROL. */
  FIELDD_WS_DATA: 9411,
  /** reserved by truffle's own WS bus — never bind. */
  TRUFFLE_WS_RESERVED: 9417,
  // RETIRED 2026-09-14 (TM-1): `GHOSTTEA_TSP1_QUIC` 9420 and `GHOSTTEA_TSP1_TCP`
  // 9421, the ghosttea-truffle TSP1 terminal mirror's two listeners. The floor's
  // in-process serve and its TSP1 adapter retired whole in that slice, so nothing
  // on this device binds either number any more.
  //
  // CORRECTED 2026-09-14 (TM-3): this note said the numbers stayed SPOKEN FOR
  // because "the phone's GhostteaKit still dials 9421 until TM-5". TM-5 landed
  // (`13120801`, `87d13ec9`) — the phone's attachment is a routed T1 client over
  // the sidecar's proxy now, and no VibeField code on any plane dials either
  // port. They are free. The design is `thinking-terminal-mesh-cells.md` (T,
  // ruled 2026-09-14); under it no fixed TSP1 port exists and the cells' proxy
  // listener is `TERMINAL_CELLS_SERVE` below.
  /** TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D2) — the tailnet listener
   * carrying ONE reverse-proxy route per live terminal cell,
   * `/cell/<cellBootId>/control|frames` → that cell's loopback T1 door. fieldd
   * declares it; the sidecar serves it; the floor is never in the byte path.
   *
   * ITS OWN PORT, not the product serve's, and the reason is truffle's API,
   * not taste: `Proxy` offers `add` and `remove` and NO update
   * (truffle-core 0.7.12 `src/proxy/mod.rs`), and a same-id add is
   * `PROXY_EXISTS` — so changing a serve's route list is remove-then-add,
   * which drops every live connection on that listener. Cell routes change
   * whenever a cell is born or exits; the product door is the channel a
   * dropped client would have to re-dial to get a replacement ticket, so
   * bouncing it on cell churn would break the recovery path itself. Confining
   * the churn here costs a terminal data leg a reconnect, which the routed
   * client already handles.
   *
   * ERRATUM 2026-09-14 (N-M3): this sentence used to end "(`STALE_ROUTE` →
   * re-ticket)", which names a mechanism that is UNBUILT. `STALE_ROUTE` (4000)
   * has no production caller — the cell's only raise is `Door::close_set`,
   * reached from tests alone (`field-native/src/tp/door.rs`, which carries the
   * same note and the reason it cannot simply be called). The reconnect this
   * paragraph describes is REAL, but a routed client observes it as a plain
   * TRANSPORT DEATH: the remove-then-add above happens in the sidecar and tears
   * the connections down there, so no cell-side close frame can precede it. The
   * kit's 4000 arm is recovery for an event nothing currently raises. */
  TERMINAL_CELLS_SERVE: 9422,
  /** UA-P-0e (D2) — the product door's TAILNET listener. Fixed, and the reason
   * is the account boundary rather than convenience.
   *
   * Under D2 nothing content-bearing rides the synced-store bus until truffle
   * can gate a store by login, so `field.devices.v1` carries no capability URL
   * any more — it carries nothing, because it is not published. A peer that
   * wants to reach another desktop's door therefore has to DERIVE where it is,
   * and a derivation needs a number that is the same on every device.
   *
   * The serve used to listen on whatever ephemeral port the LOOPBACK control
   * plane happened to bind (UA-D12), which made the port a published fact and
   * the publication the only way to learn it. The two planes are separate now:
   * loopback stays ephemeral, the tailnet listener is this.
   *
   * No host-level collision between two local users: each user's pair has its
   * OWN truffle node with its own tailnet address, and the sidecar's listener
   * binds there — the same reason `TERMINAL_CELLS_SERVE` above can be fixed. */
  FIELDD_PRODUCT_SERVE: 9423,
  /** SP-3 (thinking-sync-planes.md §5.4, §6; thinking-desktop-sync-plane.md
   * §6.4) — the tailnet listener carrying rosettad's loopback HTTP/WS: ONE serve
   * per desktop, the whole listener onto the daemon's ephemeral loopback port
   * with nothing stripped, so a client dials rosetta's own routes at the root
   * (`/ws/sessions/<id>` — the ticket template's second instance,
   * `RemoteIndexEndpointSet`). design-06 §8 named it and left the number to
   * DS-7; it is assigned at SP-3 so the template has a listener to name. Fixed
   * for the reason its two neighbours are: a peer DERIVES the coordinate.
   *
   * ITS OWN PORT for the cells' reason: truffle's proxy has `add` and `remove`
   * and no update, so re-aiming a serve is remove-then-add, and rosettad's port
   * moves on every restart. On 9422 that would drop every live terminal leg; on
   * 9423, every door.
   *
   * PUBLISHED ONLY BEHIND fieldd's `indexDirectPlane` flag, OFF: the pinned
   * rosettad verifies no credential (RO-1's bearer and RO-10's grants are built
   * on rosetta's `feat/direct-plane-grants`, unmerged), so until DS-7's pin
   * move a serve here would put every transcript one same-login node away. And
   * for the same reason NOT in `MESH_EGRESS.ROUTABLE_PORTS` (DS-L6: a loopback
   * egress route may target only a door that demands its own grant); it joins
   * that list at the pin move, in review. */
  INDEX_SERVE: 9424,
  /** FS-1b: the files worker binds an ephemeral loopback listener per generation. */
  WORKSPACE_SERVE: 0,
  /** doc-sync lanes over the mesh (QUIC, snapshot-per-stream). */
  DOC_SYNC_QUIC: 9440,
  /** presence + device heartbeats (UDP, lossy). */
  PRESENCE_UDP: 9441,
  /** push relay (Cloudflare Worker). */
  RELAY_HTTPS: 443,
} as const;

/** SyncedStore ids (device-owned slices unless noted). */
export const STORES = {
  // RETIRED 2026-09-14 (TM-1): `TERMINAL_HOSTS: "terminal.v1.hosts"`, the TSP1
  // adapter's advertisement store (title, cwd label, activity, `quicPort`,
  // `hostInstanceId`, re-advertised every 5 s). Its only publisher was
  // `ghosttea-truffle`, which left this floor with the in-process serve; no
  // consumer ever subscribed — the phone enumerates tailnet peers and dials each
  // one's `list-sessions` (`FieldStoreID.terminalHosts` is declared in the kit and
  // never subscribed, the phone lane's to retire at TM-5), and the deck's palette
  // stopped at GT-D17. Discovery under T is the ticket, not a store: the join
  // walks a fold row to `terminal.runtimeSessionId` and asks fieldd for a
  // `TerminalOpenTicket` (TM-D5).
  DOCS: "field.docs.v1",
  ARTIFACTS: "field.artifacts.v1",
  PUSH: "field.push.v1",
  DEVICES: "field.devices.v1",
  /** MF-1 (§10, D4's hybrid) — the content-free agent field, one slice per
   * device: replication, catch-up on join and removal on leave, with no
   * fieldd in a reader's path. The product API serves the SAME rows as
   * `agent.subscribe {projection: "field"}` for a reader that prefers the
   * door.
   *
   * RETIRED 2026-10-01 (DS-D14, RULED `retire` 2026-09-30; DS wave 3): no
   * daemon publishes this store and no phone reads it. The mesh board
   * (`agent.subscribe {scope: "mesh"}`, DS-3) carries every self desktop's
   * board through one door; the desktop's Godview reads it and the phone homes
   * to one desktop and reads the same door (DS-8, DS-D13). The id STAYS
   * because the floor's slice cap still names it (`MESH_CONTROL_LIMITS.
   * AGENT_FIELD_SLICE_BYTES`, `field-native` `mgmt/mesh.rs` — an older desktop
   * may still publish one) and fieldd's mock floor records writes to it (the
   * row that pins that nothing is written). Never a new reader or writer. */
  AGENT_FIELD: "field.agents.v1",
} as const;

/** Cross-plane bounds for the opaque SyncedStore → native mgmt → fieldd path
 * and its ProductAPI projection. Generated into Rust with the store names so
 * neither side can silently accept a larger trust envelope than the other. */
export const MESH_CONTROL_LIMITS = {
  REMOTE_ORIGINS: 256,
  OWNER_CHARS: 256,
  ARTIFACT_SLICE_BYTES: 256 * 1024,
  DEVICE_SLICE_BYTES: 64 * 1024,
  AGENT_FIELD_SLICE_BYTES: 64 * 1024,
  MGMT_FRAME_BYTES: 80 * 1024 * 1024,
  MGMT_QUEUED_BYTES: 96 * 1024 * 1024,
  MGMT_OUTBOX_MESSAGES: 64,
  /** P0-H2 (design-02 §2.7, the Phase 0 correction) — how many `native.mesh.*`
   * requests the floor holds for its one mesh worker before answering
   * `RESOURCE_EXHAUSTED`; the byte budget above still counts every one of them,
   * the in-flight request included. Enqueue never waits, so the socket reader
   * that answers the heartbeat is never behind a mesh listener that is. */
  MGMT_PENDING_MESH_REQUESTS: 32,
  PRODUCT_FRAME_BYTES: 128 * 1024 * 1024,
  PRODUCT_QUEUED_BYTES: 128 * 1024 * 1024,
} as const;

/** Per-CONNECTION bounds on the product API (EL7). A subscription is not a
 * read: it is WORK this daemon does on every tick for as long as the socket
 * lives, and the field projection makes that concrete — each subscriber costs a
 * list plus a JSON encode per row per flush, so the cost of one connection is
 * linear in the number of subscriptions it holds. Nothing bounded that, and a
 * single `agent.observe` holder (a phone left in a drawer, a plugin in a loop)
 * could buy the whole daemon's tick budget with one socket. TS-only on purpose:
 * this is the ProductAPI's own admission rule and the native plane has no
 * subscriptions of this kind. */
export const PRODUCT_API_LIMITS = {
  /** Generous for every real client — the desktop's busiest window holds a
   * handful — and small enough that a runaway is refused in the same second it
   * starts. A caller past it gets RESOURCE_EXHAUSTED and keeps everything it
   * already had: the refusal never disturbs live subscriptions. */
  SUBSCRIPTIONS_PER_CONNECTION: 32,
  /** SP-1 (SP-L4; design-06 §2.2) — the door's per-subscriber trailing-edge
   * floor for a WHOLE-VALUE stream (`subscription.shape: "stream"` in
   * `methods.ts`: the roster, the artifact catalog, the service registry, the
   * profile sets). Every frame of such a stream is the whole current value, so
   * coalescing loses nothing — the newest value stands — and a source that
   * churns costs one frame per window per subscriber instead of one per
   * change. The field board's number: a phone's radio budget, not a feeling. */
  STREAM_MIN_INTERVAL_MS: 250,
  /** SP-1 / SP-L7 (`thinking-sync-planes.md` §1.9 item 1) — the door's
   * keepalive: every hello'd connection, loopback and tailnet alike, hears a
   * `system.tick` notification this often (`methods.ts` PRODUCT_NOTIFICATIONS).
   * truffle's sidecar reaps a served WebSocket silent for ten minutes, and an
   * idle board sends nothing by design, so without it a quiet phone's door died
   * unseen. A client counts ANY inbound frame as liveness and calls a door
   * silent for 2.5 × the interval it was told dead — five minutes, well under
   * the reap. */
  TICK_INTERVAL_MS: 120_000,
  /** The largest frame the product door accepts INBOUND, in bytes (`ws`'s
   * `maxPayload`); a larger one closes the connection 1013. The outbound pair
   * lives in `MESH_CONTROL_LIMITS` (`PRODUCT_FRAME_BYTES`, `PRODUCT_QUEUED_BYTES`).
   * DS wave 3 landing (2026-10-01): it was a fieldd literal (`product-api.ts:62`)
   * that the corpus cited as a registry number — now it is one. */
  WS_MAX_INBOUND_BYTES: 4 * 1024 * 1024,
} as const;

/** SP-D13 (a), James, 2026-10-03 — the bound on a TAILNET caller's history.
 * Since that ruling `index.search` is in `TAILNET_SCOPES`, so a self phone may
 * search and list its own history, and every answer it gets from
 * `index.search` (either arm), `index.sessions`' listing, `index.projects` and
 * `index.recent` holds at most MAX_ROWS rows, however many it asked for.
 * fieldd clamps at the DOOR (`daemon.ts`, through `tailnet-rows.ts`), never in
 * the index service, which knows no principal: the effective limit is
 * `min(asked ?? the door's own default, MAX_ROWS)`, and the service sees only
 * that number — so a search that stopped there still says `clipped`, and a
 * listing still hands back its `cursor`. A bounded answer is a page, never a
 * silent cut.
 *
 * Why 100: a phone's page is tens of rows, and rosetta's own envelopes weigh
 * about 1 KB a row before any prose (`thinking-sync-planes.md` §1.9 item 8) —
 * so a window's default search of 300 hits is some 300 KB, a desktop's budget
 * and not a radio's. A window keeps every door's own limits, and so does a
 * self peer DAEMON (`peer-fieldd`): it asks on behalf of a window on another
 * desktop and carries that window's limits. TS-only: no native reader.
 *
 * AR-8b (2026-10-03): the same bound holds `index.project`'s one per-session
 * list, its contribution rows, which says `clipped` when it cut; the door's
 * other figures are bounded by the window the caller asked for (`sinceMs`). */
export const INDEX_TAILNET_LIMITS = {
  MAX_ROWS: 100,
} as const;

/** SP-3 / AR-8b — `index.openTicket`, the direct plane's door
 * (agent-index.ts `IndexOpenTicket`): the refusal vocabulary a reader branches
 * on — a contract string, never a sentence (`UnavailableDetails`, retryable
 * false: nothing a retry changes for the daemon's life) — and the life of the
 * grant a ticket carries. Moved here from agent-index.ts at AR-8b, when it
 * gained its number.
 *
 * STATE_UNBUILT: the half of the plane this desktop does not serve yet — a
 * ticket for a session on another desktop (`{device}`: DS-7, the egress
 * route at truffle's RFC 026) or for a caller across the tailnet (the phone:
 * SP-6, the set through the index serve). A reader falls back to the door's
 * own reads (SP-D5) instead of retrying.
 * STATE_OFF: the owner switched the plane off (`FielddConfig.indexDirectPlane`
 * set false) — built, and not served by this daemon.
 * TTL_MS (AR-8b, the plan's lean of 10 minutes): how long a minted grant
 * opens its session. An ESTABLISHMENT deadline — rosetta re-checks no open
 * socket (AUTH.md §3) — so a reader renews by asking again before it
 * reconnects, never by holding a long-lived grant. TS-only: no native reader. */
export const INDEX_TICKET = {
  /** `UnavailableDetails.service` on every refusal */
  SERVICE: "index",
  STATE_UNBUILT: "direct-plane-unbuilt",
  STATE_OFF: "direct-plane-off",
  TTL_MS: 10 * 60 * 1000,
} as const;

/** TC-D6(c) — per-class scrollback byte caps, enforced at the NATIVE create
 * seam (so they live in the genned registry, one authority both planes read).
 * This is a byte cap, not a row cap. The 2026-09-27 review corrects BASE-1's
 * plain-row estimate: at 120 columns both plain and styled rows cost roughly
 * 1–1.3 KiB; depth depends strongly on width. Agents < interactive. */
export const TERMINAL_SCROLLBACK_CLASS_BYTES = {
  AGENT: 2 * 1024 * 1024,
  INTERACTIVE: 10 * 1024 * 1024,
} as const;

/** MF-1 (§5, §10.1) — the field feed's cadences. ONE authority for fieldd's
 * two publishers (the subscription's per-subscriber floor and the store's
 * coalescer) and for every reader that ages a slice out.
 *
 * The floors are TRAILING-EDGE, like the fold's own 16 ms tick: a change is
 * never dropped, only delayed to the next window. 250 ms is the phone's
 * foreground number — the swarm's 30 Hz physics interpolates between states,
 * so a status flood needs no faster feed, and an idle board costs NOTHING at
 * any interval because an unchanged projection bumps no revision.
 *
 * The expiry pair is the store's honesty clause: a desktop that dies without
 * clearing its slice leaves rows behind, so the publisher stamps
 * `expiresAt = now + STORE_EXPIRY_MS` and refreshes it every
 * STORE_HEARTBEAT_MS while it has rows. EXPIRY ≥ 3 × HEARTBEAT so two lost
 * heartbeats do not blank a live desktop's field on a reader.
 * *Retired 2026-10-01 (DS-D14): the three STORE_* rows served the
 * `field.agents.v1` publisher, which is deleted (`STORES.AGENT_FIELD`'s note).
 * They stay, unread, as the record of what an older desktop's slice means.*
 *
 * DS-3 (the mesh board, DS-D4; design-06 §8 "the board's cadence floors") —
 * DESK_MIN_INTERVAL_MS is the desk projection's floor (windows; a caller may
 * ask slower, never faster); DESK_TEXT_CHARS bounds every text a desk row
 * carries (the reply line, a blocker's question). MESH_HEARTBEAT_MS is the
 * heartbeat the mesh board asks each peer's upstream for (an empty delta
 * after that long without a frame), and a peer unheard for MESH_STALE_BEATS
 * of them reads `stale`: the board's own cadence is quiet when nothing moves,
 * so without a beat an idle desktop and a dead stream would look alike.
 *
 * SP-1 (2026-10-01) — FULL_TICK_MS is the fold's own publish tick (PF5: one
 * whole-board frame per tick per subscriber, trailing-edge), moved here from a
 * fieldd constant so the registry can say what `agent.subscribe`'s full
 * projection costs a reader (`methods.ts`'s subscription descriptor). */
export const AGENT_FIELD = {
  MIN_INTERVAL_MS: 250,
  STORE_MIN_INTERVAL_MS: 250,
  STORE_HEARTBEAT_MS: 10_000,
  STORE_EXPIRY_MS: 30_000,
  DESK_MIN_INTERVAL_MS: 100,
  DESK_TEXT_CHARS: 280,
  MESH_HEARTBEAT_MS: 1_000,
  MESH_STALE_BEATS: 3,
  FULL_TICK_MS: 16,
} as const;

/** TL (2026-10-02, TL-D8) — the status ledger fieldd's fold keeps per run
 * (`agent-history.ts`). HORIZON_MS is how far back a run's record reaches and
 * how long an exited run's record is kept; MAX_CHANGES bounds a run that flips
 * often (its oldest changes go first); TEXT_CHARS bounds the two texts a change
 * carries, a blocker's words and a working span's last activity line. */
export const AGENT_HISTORY = {
  HORIZON_MS: 24 * 60 * 60 * 1000,
  MAX_CHANGES: 2000,
  TEXT_CHARS: 160,
} as const;

/** DS-L3 — the rows protocol's numbers (`rows.ts`; design-06 §8). A snapshot
 * above SNAPSHOT_PAGE_BYTES is paged with `more: true`; a source keeps a
 * journal of JOURNAL_DEPTH changed-key frames per table, below which a kept
 * cursor resumes and beyond which it resets; a reader compares a key digest
 * every DIGEST_INTERVAL_MS (DIGEST_ALGORITHM over the sorted keys) and resets
 * on a mismatch — never repairs. MIN_INTERVAL_MS is the default per-subscriber
 * floor on deltas; a table may set a slower one of its own. A reader holds at
 * most MAX_PENDING_DELTAS deltas for a paged snapshot still being assembled
 * (DS-6b, 2026-10-01): pages that stop arriving while deltas pile up are a
 * transfer that will not complete, so past the bound the half snapshot is
 * dropped and the reader resets. The pages follow the open answer at once, so
 * a healthy transfer holds a handful; 256 is minutes of a stalled one. */
export const ROWS = {
  SNAPSHOT_PAGE_BYTES: 256 * 1024,
  JOURNAL_DEPTH: 4096,
  MIN_INTERVAL_MS: 100,
  DIGEST_INTERVAL_MS: 60_000,
  DIGEST_ALGORITHM: "sha256",
  MAX_PENDING_DELTAS: 256,
} as const;

/** DS-6 — history across desktops (design-06 §5 "History", §8 "Limits"; the
 * catalog's own page, journal and digest numbers are ROWS'). rosetta's
 * `/ws/meta` has no resume and no removal event, so the follower re-takes a
 * fresh snapshot every META_RESNAPSHOT_MS — a session rosetta drops without a
 * word leaves the catalog within that cadence, never sooner — and folds the
 * stream's row upserts into one frame per table per META_BATCH_MS. A mesh
 * search waits SEARCH_FANOUT_TIMEOUT_MS for each awake desktop, then answers
 * with what it has (the silent one reads `timeout`, never "nothing found").
 * A replica asks its peer for deltas no faster than REPLICA_MIN_INTERVAL_MS
 * (history is not a live fold) and rewrites its file at most once per
 * PERSIST_INTERVAL_MS while it changes (a whole-table JSON file: a busy peer's
 * ~4 MB table rewritten per second would be gigabytes an hour; a crash loses
 * at most that window, which the next subscribe's catch-up or reset repairs),
 * and on shutdown. One that hears nothing — not even the digest heartbeat —
 * for STALE_AFTER_MS while its peer is on the roster reads `stale`. */
export const INDEX_MESH = {
  SEARCH_FANOUT_TIMEOUT_MS: 5_000,
  META_RESNAPSHOT_MS: 10 * 60 * 1000,
  META_BATCH_MS: 50,
  META_RECONNECT_MIN_MS: 500,
  META_RECONNECT_MAX_MS: 30_000,
  REPLICA_MIN_INTERVAL_MS: 1_000,
  PERSIST_INTERVAL_MS: 60_000,
  STALE_AFTER_MS: 150_000,
  REPLICA_RETRY_MIN_MS: 1_000,
  REPLICA_RETRY_MAX_MS: 60_000,
  PAGE_DEFAULT_LIMIT: 100,
  PAGE_MAX_LIMIT: 500,
  CHANGES_MIN_INTERVAL_MS: 500,
  /** SP-6 (2026-10-04) — the floor of ONE session's live tail over the door
   * (`index.session.subscribe`, a rows subscription): a frame per subscriber
   * at most this often while the session moves, nothing while it is still.
   * One second is a reader's pace for a transcript — rosetta's own room
   * coalesces at 16 ms for a desktop, and a radio has no use for that; the
   * page door (`index.timeline`) is how the rows before the tail arrive. */
  SESSION_TAIL_MIN_INTERVAL_MS: 1_000,
} as const;

/** SP-6 (2026-10-04; `thinking-sync-planes.md` §5.4 "until RO-1", SP-D5 (a))
 * — one session's transcript over the DOOR, as bounded pages and a tail,
 * until the ticket (SP-7) moves the bodies to rosetta's own socket.
 *
 * PAGE_DEFAULT_LIMIT / PAGE_MAX_LIMIT: `index.timeline`'s page when nothing is
 * asked, and the most a window may ask (rosetta's own default is 100 and its
 * ceiling 1,000; the door stops at 500, the catalog pager's own ceiling). A
 * `tailnet` caller's page is cut at INDEX_TAILNET_LIMITS.MAX_ROWS at the door
 * and says `clipped`, exactly as the listings are.
 *
 * TEXT_CHARS: the most of a row's TEXT a projected row carries — a prompt's
 * words, a reply paragraph, a thought, a notice's sentence — in UTF-16 code
 * units, `textClipped` saying when it was cut. rosetta already bounds an
 * oversized text upstream (a `member` text rides as a preview beside an asset,
 * and that asset never crosses this door — EL2); this bound is the page's: a
 * phone page of a hundred rows holds at most some 200 KB of prose, and a
 * reply longer than this is read whole in the room, which has the ticket.
 * OBJECT_CHARS: the most of a tool line's object (a command, a path, a query)
 * and of a failure's summary a row carries; the ladder draws one line.
 *
 * The tail itself carries rosetta's own snapshot (its newest 200 rows, the
 * socket's SNAPSHOT_LIMIT at the pin) and what the session appends after;
 * a tailnet subscriber's snapshot is cut to INDEX_TAILNET_LIMITS.MAX_ROWS, the
 * newest first to go — the rows before it are the page door's. TS-only: no
 * native reader. */
export const INDEX_TIMELINE = {
  PAGE_DEFAULT_LIMIT: 100,
  PAGE_MAX_LIMIT: 500,
  TEXT_CHARS: 2_000,
  OBJECT_CHARS: 200,
} as const;

/** PJ-1 (`thinking-project-places.md` §4, PJ-D1…D24 RULED (a) 2026-10-07;
 * `build-pj.md` L4, L5) — the project grouping is a LOCKSTEP event (PJ-L1):
 * every daemon computes the same projects from the same place facts, so
 * anything that changes which places join, or how a key or an ink is minted,
 * bumps GROUPING_VERSION. Version 1 is the evidence rule (the identity
 * remote, confirmed recent shared history, your links), the normalizer that
 * supersedes DS-D9's family (L4) and the UNKEYED project key (L5 — keying it
 * once a secret spans one person's desktops is a bump). Version 2 (PJ-2,
 * build-pj23.md D2/D3) reads the person's intents as the library keeps them:
 * a split bound to a record (`{place, notRecord}`, no longer global), links
 * and splits ordered by their act time (for a pair, the later act wins), a
 * dismissal bound to the pair of records, a record's places acted in.
 *
 * SAMPLE_DEPTHS: where a place samples its first-parent history — its tip,
 * then 1, 2, 4 … 512 commits back — and RECENT_DEPTH: the deepest sample
 * whose presence in another place's objects JOINS the two (§4.1 E2; deeper,
 * or only the first commit, is the related-history suggestion). INK_DEALS:
 * the range a record-less project's ink is dealt from its provisional anchor
 * (§4.3; a record's ink is dealt once and kept). TS-only: no native reader. */
export const GROUPING_VERSION = 2;
export const PROJECT_GROUPING = {
  SAMPLE_DEPTHS: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
  RECENT_DEPTH: 16,
  INK_DEALS: 997,
} as const;

/** FS-1a (`thinking-files-service.md` §3, §4; FS-D12 RULED (a), 2026-10-05)
 * — the files service's bounds (`workspace.ts`). The door tier answers in
 * pages: LIST_PAGE rows a `workspace.list` page holds at most (a window's
 * default and ceiling), TAILNET_PAGE for a caller that crossed the tailnet (a
 * self phone: the cut is the DOOR's, `clipped` and `nextCursor` say so), and
 * SEARCH_HITS a `workspace.search` answers at most. The attached tier's
 * numbers ride beside them for FS-1b, which mints them: TICKET_TTL_MS how long
 * a minted ticket may wait to be REDEEMED (R1, 2026-10-07 — a pair whose two
 * legs are not both serving by then is dropped; an established session
 * outlives it and ends only on close, either leg closing, root loss within
 * ATTACHED_ROOT_CHECK_MS, principal revocation, root withdrawal or a worker or
 * fieldd restart, so a client never re-attaches on a timer), MAX_FILE_BYTES
 * the most one read hands over, SESSIONS_PER_CLIENT / SESSIONS_PER_EXPORT the
 * attached sessions one client and one export hold (mille-truffle's defaults),
 * MAX_VIEWPORT_ROWS the most rows one attached session's tree viewport may
 * span — limit plus overscan on both sides — named in the policy the worker
 * hands mille (R6, 2026-10-07): mille clamps a larger request and warns
 * `VIEWPORT_CLAMPED`; 2 048 is mille's own `DEFAULT_REMOTE_MAX_VIEWPORT_ROWS`
 * at the pin (baa0de8), now OUR number rather than its silent default.
 *
 * The rest bound what a door asks the worker to do: PATH_CHARS the longest
 * relative path a request may name, NAME_CHARS the longest entry name an
 * answer carries, QUERY_CHARS the longest search query.
 *
 * SEARCH (the lead's ruling, 2026-10-05): a search walks the asked subtree
 * breadth-first ON DEMAND — until it has seen SEARCH_WALK_ENTRIES entries, or
 * for SEARCH_WALK_MS, whichever comes first, skipping a folder whose read does
 * not answer within READ_TIMEOUT_MS (an iCloud-evicted folder blocks a read
 * while it downloads; the same bound holds a page's child counts) — and says
 * `complete: false` when
 * any of those cut it: never an empty answer that reads as "no matches" for
 * folders it did not read. A narrower `path` covers deeper. The walk reads
 * NAMES from the filesystem, not into mille's engine (measured: mille's
 * hydration grows super-linearly — 22 000 entries took 15 s), keeps them
 * beside the export's engine for SEARCH_CACHE_MS so a reader typing asks
 * again for free, and hands mille only the hits (their ids).
 *
 * ENGINES: the worker holds one mille engine per export it was asked about
 * (mille refuses overlapping roots in one engine, and the home export holds
 * every place); an engine with no ask for HOST_IDLE_MS is disposed, and at
 * most HOSTS_MAX live at once — at the cap the least recently used idle one
 * goes, and an ask that finds every engine busy is refused RESOURCE_EXHAUSTED
 * (retryable). TS-only: no native reader. */
export const WORKSPACE_LIMITS = {
  LIST_PAGE: 200,
  TAILNET_PAGE: 100,
  SEARCH_HITS: 100,
  TICKET_TTL_MS: 600_000,
  MAX_FILE_BYTES: 16 * 1024 * 1024,
  MAX_VIEWPORT_ROWS: 2_048,
  SESSIONS_PER_CLIENT: 4,
  SESSIONS_PER_EXPORT: 16,
  PATH_CHARS: 4_096,
  NAME_CHARS: 1_024,
  QUERY_CHARS: 256,
  SEARCH_WALK_ENTRIES: 100_000,
  SEARCH_WALK_MS: 5_000,
  READ_TIMEOUT_MS: 2_000,
  SEARCH_CACHE_MS: 60_000,
  HOST_IDLE_MS: 300_000,
  HOSTS_MAX: 16,
  TICKETS_MAX: 256,
  SOCKETS_MAX: 128,
  ATTACH_TIMEOUT_MS: 10_000,
  ATTACHED_ROOT_CHECK_MS: 10_000,
  GIT_REQUEST_BYTES: 64 * 1024,
  GIT_REQUESTS_IN_FLIGHT: 8,
  SOCKET_BUFFER_BYTES: 32 * 1024 * 1024,
  RETRY_MIN_MS: 500,
  RETRY_MAX_MS: 10_000,
} as const;

/** FS-1a — the files service's honest refusal vocabulary
 * (`UnavailableDetails`): `service` on every UNAVAILABLE a `workspace.*` door
 * answers, and the worker's phases a reader branches on. STARTING: the first
 * generation is booting; RESTARTING: a generation died and the next is on its
 * backoff (retryable); OFF: the worker is switched off for this daemon (a
 * test-only knob, L6 — never a user setting); UNCONFIGURED: this daemon has no
 * worker to run (an embedded daemon with no bundle beside it); FAILED: the
 * restart intensity tripped, or the worker cannot be spawned at all; STOPPED:
 * the daemon is shutting down. TS-only: no native reader. */
export const WORKSPACE_SERVICE = {
  SERVICE: "workspace",
  STATE_STARTING: "starting",
  STATE_RESTARTING: "restarting",
  STATE_OFF: "off",
  STATE_UNCONFIGURED: "unconfigured",
  STATE_FAILED: "failed",
  STATE_STOPPED: "stopped",
} as const;

/** FS-1a (FS-D8 RULED (a), its interim; FS-D5 (a) read-only v1) — the git
 * port's protocol, rosetta's room convention (`{id, op, args}` →
 * `{id, ok, value | error}`, `clients/app/electron/fx-host.mjs`), pinned by
 * `fixtures/workspace-git-port.valid.json` until mille's own `GitService`
 * (the mille-git spec's PR 8) replaces the interim. READ_OPS answer; WRITE_OPS
 * are refused with READ_ONLY_ERROR whatever the caller holds; any other op
 * answers `unknown op: <op>`. DIFF_BYTES and LOG_LIMIT are rosetta's own
 * bounds, kept. TIMEOUT_MS is one invocation's default budget. CONCURRENCY
 * (PJ-1, L3, 2026-10-08): the most git (and `ssh -G`) processes the files
 * worker runs at once, across EVERY caller — the git port, `gitFacts` and the
 * place facts; the rest wait their turn, first come first served. TS-only: no
 * native reader. */
export const WORKSPACE_GIT = {
  READ_OPS: ["branch", "status", "log", "diff", "commitFiles"],
  WRITE_OPS: ["stage", "unstage", "discard", "commit", "commitAll", "amend"],
  READ_ONLY_ERROR: "read-only in v1",
  DIFF_BYTES: 8 * 1024 * 1024,
  LOG_LIMIT: 200,
  TIMEOUT_MS: 10_000,
  CONCURRENCY: 6,
} as const;

/** PJ-1 (`thinking-project-places.md` §4.1, §9; `build-pj.md` L1–L3) — place
 * facts: what this desktop reads of each folder its index names, through the
 * files worker's one git runner (`WORKSPACE_GIT`).
 *
 * Where a place samples its history is PROJECT_GROUPING.SAMPLE_DEPTHS (the
 * engine's word, above). GIT_TIMEOUT_MS: one place-facts invocation's
 * budget (the first-parent root walks the whole first-parent chain; one that
 * runs out leaves the root unsaid); SSH_TIMEOUT_MS: one `ssh -G <host>` (an
 * alias read, C10), whose answer the worker keeps SSH_CACHE_MS.
 * OP_BUDGET_MS: the most one `placeFacts` question works before it answers — a
 * place it did not reach comes back `skipped` and is asked again next pass, so
 * the answer lands inside the supervisor's own request budget. BATCH_PLACES:
 * places per question; PARALLEL_PLACES: places one question reads at once
 * (each reads its git calls in turn, so a scan holds at most this many of
 * WORKSPACE_GIT.CONCURRENCY's turns and an interactive git port is never
 * starved).
 *
 * The scanner (fieldd): SCAN_INTERVAL_MS is the throttled period that catches
 * what no event announces (a commit, a remote added, a volume unplugged);
 * CHANGE_SETTLE_MS the quiet a change (the catalog's project roots, a peer's
 * places) waits for before it scans, so a burst is one pass. A place cached
 * with an unchanged HEAD, config and worktree list costs one cheap read.
 * MAX_PLACES bounds the places one desktop scans (rosetta's roots plus the
 * worktrees `git worktree list` names); WORKTREES_MAX the worktrees one
 * checkout adds. REGROUP_SETTLE_MS (§4): the quiet the projects grouping
 * waits for after a change of its input — this desktop's rows, a peer's, an
 * act — before it runs the engine again (an equal input runs nothing). TS-only:
 * no native reader. */
export const PLACE_FACTS = {
  GIT_TIMEOUT_MS: 5_000,
  SSH_TIMEOUT_MS: 3_000,
  SSH_CACHE_MS: 5 * 60 * 1000,
  OP_BUDGET_MS: 12_000,
  BATCH_PLACES: 16,
  PARALLEL_PLACES: 2,
  SCAN_INTERVAL_MS: 5 * 60 * 1000,
  CHANGE_SETTLE_MS: 2_000,
  MAX_PLACES: 2_000,
  WORKTREES_MAX: 256,
  REGROUP_SETTLE_MS: 2_000,
} as const;

/** PJ-3 (`thinking-project-places.md` §9, PJ-D15 (a) RULED 2026-10-07;
 * `build-pj23.md` D8–D10; P1/P2 RULED (a) 2026-10-08) — the `project.*`
 * doors (`project-doors.ts`): this desktop's grouping, served to its own
 * windows and the person's phone, never to a peer daemon (DS-L4).
 *
 * SERVICE / STATE_*: the honest UNAVAILABLE a door answers —
 * STATE_GROUPING before the first grouping of this boot exists, and
 * STATE_RECORDS_UNBUILT from `project.intent` until PJ-2's records are wired
 * behind it. PAGE_DEFAULT_LIMIT / PAGE_MAX_LIMIT: `project.list`'s and
 * `project.sessions`' page when nothing is asked, and the most a window may
 * ask (a tailnet caller's page is cut at INDEX_TAILNET_LIMITS.MAX_ROWS at the
 * door). CHANGES_MIN_INTERVAL_MS: `project.subscribe`'s floor — the History
 * page's pace, `INDEX_MESH.CHANGES_MIN_INTERVAL_MS`'s twin. NAME_MAX: a
 * rename's longest name; QUERY_MAX: `project.list`'s `q`.
 *
 * The KEY JOURNAL (D9): a project's key moves when an anchor stops being
 * unique to its group, and at its first record (`p1:` → `r:`), so a reader
 * holding the old key is answered `movedTo`. fieldd remembers the last key
 * each place was seen in (at most JOURNAL_PLACES_MAX places, the least
 * recently seen dropped first) and the moves it inferred (at most
 * JOURNAL_MOVES_MAX, the oldest dropped first), persisted at
 * `LAYOUT.PROJECT_KEYS_FILE`; a `movedTo` follows at most MOVE_HOPS_MAX moves.
 * TS-only: no native reader. */
export const PROJECT_DOORS = {
  SERVICE: "projects",
  STATE_GROUPING: "grouping",
  STATE_RECORDS_UNBUILT: "records-unbuilt",
  PAGE_DEFAULT_LIMIT: 100,
  PAGE_MAX_LIMIT: 500,
  CHANGES_MIN_INTERVAL_MS: 500,
  NAME_MAX: 120,
  QUERY_MAX: 256,
  JOURNAL_PLACES_MAX: 4_096,
  JOURNAL_MOVES_MAX: 1_024,
  MOVE_HOPS_MAX: 16,
} as const;

/** DS-D15 / DS-2 — forwarded mutations (`forwarding.ts`). The owner journals
 * one receipt per idempotency key for RECEIPT_TTL_MS, at most
 * RECEIPT_JOURNAL_DEPTH of them; a forward cut mid-flight is recorded
 * `outcome-unknown` after FORWARD_TIMEOUT_MS and read back by the retry.
 * RESULT_CAP_BYTES (DS-2b, 2026-10-01 — it was a literal in fieldd's
 * forward-receipts.ts): the largest answer (or refusal details) a receipt
 * stores as JSON; a larger one is journaled `resultOmitted` and its retry
 * answers the receipt. An answer carrying a transport grant replays only
 * while that grant lives (TERMINAL_PIPELINE.TRANSPORT_GRANT_TTL_MS), whatever
 * the TTL above says. */
export const FORWARDING = {
  RECEIPT_JOURNAL_DEPTH: 1024,
  RECEIPT_TTL_MS: 24 * 60 * 60 * 1000,
  FORWARD_TIMEOUT_MS: 15_000,
  RESULT_CAP_BYTES: 64 * 1024,
} as const;

/** DS-5c — the Loro-level host's numbers (design-06 §4; the DS wave 1 review's
 * DS-5 list). Doc sync keeps a BEAT: every BEAT_MS it re-greets a peer whose
 * version named ops this desktop still lacks ANSWER_TIMEOUT_MS after it heard
 * it (the answer was lost), or that a send could not reach while the roster
 * calls it online — each retry of one (doc, peer) pair waiting twice as long
 * as the last, up to REGREET_MAX_MS. A lost answer used to wait for a liveness
 * flip that might never come. RESIDENCY: a hosted canvas with no open window,
 * nothing on its per-doc chain, no import pending its base and no lane or
 * window touching it for IDLE_MS is evicted from memory (its bytes on disk
 * ARE the host's state), swept every SWEEP_MS; the next VERSION, record or
 * open reloads it. The design's DOC_HOST_IDLE_MS is IDLE_MS. REASSEMBLY: the
 * declared bytes of CHUNKed transfers one peer may have in flight here (four
 * of the largest, DOC_SYNC_MAX_TRANSFER_BYTES — the old four-slot bound's own
 * worst case); a transfer past it is refused and asked for again, and none
 * already under way is ever evicted for it.
 *
 * DS-5d — COMPACTION (design-06 §4). A hosted canvas whose JOURNAL (the
 * records kept after its checkpoint) reaches COMPACT_RECORDS records or
 * COMPACT_JOURNAL_BYTES bytes is offered for an epoch bump: a Loro shallow
 * snapshot at the watermark becomes its base. The journal is the measure
 * because it is the history fieldd keeps and replays — one file read and one
 * Loro import per record on every host load and every window open — and
 * because it is where history piles up: a window's own checkpoints fold it,
 * so it grows on the desktop that hosts a canvas it does not have open, one
 * record per merged peer save, for as long as that lasts. 1024 records is a
 * long day of a peer's autosaves and keeps an open at ~1k small reads; 4 MiB
 * is MeshLaneLink's send watermark, the size past which one record already
 * crosses as CHUNKs, so a journal heavier than one send window is history
 * worth trimming. RETIREMENT_MS is DS-D17's thirty days: a holder unseen that
 * long is no longer waited for — the trim may pass what it acknowledged, and
 * it re-bootstraps (S4) when it returns. */
export const DOC_HOST = {
  BEAT_MS: 15_000,
  ANSWER_TIMEOUT_MS: 30_000,
  REGREET_MAX_MS: 10 * 60 * 1000,
  IDLE_MS: 10 * 60 * 1000,
  SWEEP_MS: 60_000,
  REASSEMBLY_BYTES_PER_PEER: 256 * 1024 * 1024,
  COMPACT_RECORDS: 1024,
  COMPACT_JOURNAL_BYTES: 4 * 1024 * 1024,
  RETIREMENT_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

/** TC-S2 — the floor's supervision budget for a `field-terminal-host` cell
 * (TC-D3's extraction; NO panic-abort until custody separates at TC-S4).
 * The shape mirrors NATIVE_SUPERVISION one level down. HELLO covers a cold
 * font discovery (the cell's slowest start step, measured seconds on a cold
 * cache); DRAIN mirrors upstream's own sweep budget (G7's 6s); EXIT_GRACE is
 * the gap between pipe-EOF and the kill escalation. Respawns are
 * intensity-bounded — a cell that cannot stay up is a fault to SURFACE, not
 * to hide behind infinite restarts. */
export const CELL_SUPERVISION = {
  HELLO_DEADLINE_MS: 15_000,
  DRAIN_BUDGET_MS: 6_000,
  EXIT_GRACE_MS: 2_000,
  RESPAWN_MAX: 3,
  RESPAWN_WINDOW_MS: 60_000,
} as const;

/** TC-S3/TC-D4 — spawn-isolation policy. An intensity breach whose window
 * holds an Exact-attributed offender (only Exact strikes count; Infrastructure
 * and Unknown blame NO session — row 13) flips the class to solo placement:
 * creates land on fresh single-session cells, so a recurring poison workload
 * can only crash itself. WINDOW bounds how long the class stays in that mode
 * (TC-S6's quarantine migration replaces the whole mechanism); MAX_SOLO_CELLS
 * is the TC-D6(f) bound — at the cap the newest solo cell becomes the shared
 * overflow target, logged, rather than unbounded process growth. */
export const CELL_ISOLATION = {
  ISOLATION_WINDOW_MS: 300_000,
  MAX_SOLO_CELLS: 8,
} as const;

/** TPv3 — the terminal pipeline's numbers (terminal-pipeline-v3 §5.1, §8; §20
 * item 5 "numeric limits with owners"). ONE authority for the cell (Rust, by
 * generation), fieldd (the grant TTLs) and the renderer. Every value is
 * PROVISIONAL until the post-S0 numeric ratification checkpoint (spec §15/§16)
 * — change it here, never in a consumer. Owners: the protocol version is the
 * wire's; heartbeat/pre-auth/connection caps are the CELL's door hygiene; the
 * grant validity bounds are shared by minter (fieldd) and verifier (cell); the
 * CELL_* receive caps bound what a worker may advertise (the leg's windows are
 * the MIN of both); the ProtocolLimits block is what `ConnectionAccepted`
 * announces. The TTL inequality (§5.4) holds by construction:
 * HEARTBEAT_TTL_MS ≥ HEARTBEAT_INTERVAL_MS + detection + jitter. */
export const TERMINAL_PIPELINE = {
  PROTOCOL_MAJOR: 1,
  PROTOCOL_MINOR: 0,
  HEARTBEAT_INTERVAL_MS: 5_000,
  HEARTBEAT_TTL_MS: 15_000,
  HELLO_DEADLINE_MS: 5_000,
  PRE_AUTH_MAX_BYTES: 65_536,
  PRE_AUTH_CONNECTION_CAP: 64,
  MAX_CONNECTION_SETS: 256,
  MAX_CLOCK_SKEW_MS: 5_000,
  MAX_GRANT_LIFETIME_MS: 600_000,
  TRANSPORT_GRANT_TTL_MS: 60_000,
  CELL_CONNECTION_CREDIT_BYTES: 16_777_216,
  CELL_PER_ACTIVATION_CREDIT_BYTES: 4_194_304,
  CELL_STAGING_BYTES_PER_SESSION: 8_388_608,
  CELL_STAGING_BYTES_TOTAL: 67_108_864,
  CELL_MAX_CONCURRENT_ACTIVATIONS: 256,
  CELL_MAX_CONCURRENT_SEEDS: 4,
  MAX_CONTROL_MESSAGE_BYTES: 262_144,
  MAX_PRESENTATION_CHUNK_BYTES: 1_048_576,
  MAX_BATCH_LATENCY_MS: 4,
  MAX_CREDIT_RETURN_DELAY_MS: 16,
  MAX_SCENE_APPLIED_DELAY_MS: 1_000,
  SCENE_APPLIED_REFRESH_MS: 2_000,
  PRESENTATION_STATUS_REFRESH_MS: 2_000,
  ACTIVATION_ATTACH_DEADLINE_MS: 5_000,
  MAX_ACTIVATION_CATCHUP_MS: 3_000,
  MAX_CATCHUP_BYTES: 8_388_608,
  CREDIT_ACCOUNT_DRAIN_TTL_MS: 5_000,
  // TP-S3b — the cell's own activation numbers. CELL_LEASE_TTL_MS ≥
  // SCENE_APPLIED_REFRESH_MS + detection + jitter (the TTL inequality, §5.4);
  // INPUT_LAG_SUSPEND_REVISIONS is the cell's lag call (input → suspended
  // {lagging} when newest − accepted exceeds it, or when no SceneApplied
  // arrives within MAX_SCENE_APPLIED_DELAY_MS after a unit was sent);
  // ATTACH_RENEWAL_MARGIN_MS closes input that far before the attach grant
  // expires without a renewal; SEED_FRAME_WAIT_MS bounds the wait for the
  // engine's full frame after a refresh.
  CELL_LEASE_TTL_MS: 6_000,
  INPUT_LAG_SUSPEND_REVISIONS: 64,
  ATTACH_RENEWAL_MARGIN_MS: 60_000,
  SEED_FRAME_WAIT_MS: 2_000,
  // TP-S3d — the writer/admission fairness FLOOR (§8). URGENT_RESERVE_BYTES of
  // connection credit is carved out for the urgent class: BULK admission (seed /
  // catch-up transfers) may consume connection credit only DOWN TO this reserve,
  // so an urgent incremental always has room (URGENT_RESERVE_BYTES ≥
  // MAX_URGENT_PRESENTATION_UNIT_BYTES). MAX_BULK_BYTES_ADMITTED_AHEAD bounds the
  // bulk bytes queued to the frames writer ahead of what it has written — the
  // bulk-induced-HOL bound is that plus the one chunk being written (so it is ≥
  // MAX_PRESENTATION_CHUNK_BYTES). A presentation unit larger than
  // MAX_URGENT_PRESENTATION_UNIT_BYTES is not an urgent incremental — it becomes
  // a (bulk) catch-up transfer.
  URGENT_RESERVE_BYTES: 2_097_152,
  MAX_BULK_BYTES_ADMITTED_AHEAD: 4_194_304,
  MAX_URGENT_PRESENTATION_UNIT_BYTES: 1_048_576,
} as const;

/** TPv3 — WebSocket close codes on the cell doors (terminal-pipeline-v3 §5.1):
 * `1008` = EVERY pre-authentication failure, silent by policy (no body, no
 * code on the wire — the reason lives in the cell's audit line); `1011` server
 * error; 4000+ protocol-specific and always named in the close reason. One
 * authority for the cell (Rust, by generation) and the renderer. */
export const TERMINAL_PIPELINE_CLOSE_CODES = {
  GOING_AWAY: 1001,
  POLICY_PRE_AUTH: 1008,
  SERVER_ERROR: 1011,
  STALE_ROUTE: 4000,
  FENCED: 4001,
  SUPERSEDED: 4002,
  PROTOCOL: 4003,
  LEG_TIMEOUT: 4004,
} as const;

/** Mesh namespaces. `ss:*` is reserved to SyncedStore; `x.<pluginId>.*` is the dynamic service namespace (D19). */
export const NAMESPACES = {
  RPC: "field.rpc",
  APPROVAL: "field.approval",
  DYNAMIC_PREFIX: "x.",
} as const;

/** Env prefixes registered with Ghosttea's strip list (G1′) — daemon secrets never enter agent PTYs (EL7).
 * Note: "FIELDD_" does NOT match the "FIELD_" prefix (5th char) and needs its own entry. */
export const ENV_PREFIXES = ["FIELD_", "FIELDD_"] as const;

/** LOG-44 — physical diagnostic streams. The value is the ONLY category /
 * basename pair callers may resolve beneath the platform log root. Dynamic
 * component, window, session, and plugin identities belong in record fields,
 * never in filenames. */
export const LOG_STREAMS = {
  SYSTEM_DESKTOP: "system/desktop",
  SYSTEM_RENDERER: "system/renderer",
  SYSTEM_UTILITY: "system/utility",
  SYSTEM_FIELDD: "system/fieldd",
  SYSTEM_FIELD_NATIVE: "system/field-native",
  PLUGINS_RENDERER: "plugins/renderer",
  PLUGINS_SERVICE: "plugins/service",
  PLUGINS_UTILITY: "plugins/utility",
} as const;
export type LogStream = (typeof LOG_STREAMS)[keyof typeof LOG_STREAMS];

/** LOG §12.4 — the renderer logging data plane is one bounded MessagePort per
 * WebContents generation. These are transport limits, so the browser-side
 * queue and the Electron accepting host consume the same tiny root constants
 * without importing the zod-heavy logging schema subpath into the boot chunk. */
export const LOG_TRANSPORT_LIMITS = {
  RENDERER_BATCH_RECORDS: 50,
  RENDERER_BATCH_BYTES: 256 * 1024,
  RENDERER_QUEUE_RECORDS: 1_000,
  RENDERER_QUEUE_BYTES: 2 * 1024 * 1024,
  RENDERER_RECORD_BYTES: 64 * 1024,
  RENDERER_BATCHES_PER_SECOND: 10,
  RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND: 10,
  RENDERER_ENVELOPE_BATCHES_PER_SECOND: 20,
  FIRST_PARTY_PARTIAL_LINE_BYTES: 64 * 1024,
  PLUGIN_PARTIAL_LINE_BYTES: 16 * 1024,
  PLUGIN_RECORD_BYTES: 16 * 1024,
  PLUGIN_MESSAGE_BYTES: 4 * 1024,
  PLUGIN_STRING_BYTES: 4 * 1024,
  PLUGIN_STACK_BYTES: 8 * 1024,
  PLUGIN_OBJECT_DEPTH: 4,
  PLUGIN_OBJECT_KEYS: 50,
  PLUGIN_ARRAY_ITEMS: 50,
  PLUGIN_ERROR_CAUSES: 2,
  PLUGIN_RATE_PER_SECOND: 20,
  PLUGIN_RATE_BURST: 100,
  PLUGIN_RATE_HIGH_SEVERITY_RESERVE: 20,
  PLUGIN_RATE_TRACKED_ENTRIES: 1_024,
  DIAGNOSTIC_PAGE_BYTES: 8 * 1024 * 1024,
  DIAGNOSTIC_PORT_REQUEST_BYTES: 64 * 1024,
  DIAGNOSTIC_PORT_RESPONSE_BYTES: 8 * 1024 * 1024,
} as const;

/** Every grantable capability (design-01 §7 + design-03 §8 + design-04). */
export const SCOPES = [
  "canvas.read",
  "canvas.write",
  "agent.spawn",
  "agent.control",
  "agent.observe",
  "agent.bless", // D38 — single-purpose, PTY-bound (spawn-through shims)
  "terminal.attach",
  // GT-8a (GT-D22) — open a link a terminal printed (`terminal.link.open`: a
  // web link in the browser, a file SHOWN in Finder). Its own scope and not
  // `shell.open`, which renderer plugins may be granted: this door must not be
  // reachable without a person's click, so only the window's token holds it —
  // Electron main mints it there and nowhere else. Local-only forever: in no
  // TAILNET preset, and absent from every plugin eligibility table.
  "terminal.link",
  "doc.read",
  "doc.write",
  "artifact.publish",
  "index.read",
  "approval.respond",
  "push.manage",
  "workspace.read",
  "native.admin",
  "services.provide",
  "process.spawn",
  "storage.self",
  "net.outbound",
  "background",
  "mcp.consume",
  "mcp.contribute",
  "shell.windows",
  "shell.dialog",
  "shell.clipboard",
  "shell.open",
  "shell.webcontents",
  "plugins.read", // registry snapshot (plugins.list/get/subscribe) — local-only like plugins.manage
  "plugins.manage",
  // P8b (ESP §8.4): resolve a module token to the bytes' path. SHELL-MAIN ONLY —
  // it is the one surface that hands out a filesystem path, so it is deliberately
  // NOT plugins.read (which the renderer holds). Local-only forever, like the
  // rest of plugins.*; it must never enter TAILNET_SCOPES.
  "plugins.serve",
  "diagnostics.read", // LOG §14 — trusted shell only; excluded from every federated preset
  "diagnostics.manage", // diagnostic leases/support mutations; trusted shell only
  "audit.append", // shell-originated audit actions; local-only
  "settings.manage", // trusted desktop shell/renderer app-preference surface
  "tokens.mint", // shell-main only: mint per-window renderer tokens (Track A bootstrap)
  // DT-D3 (thinking-devtools-pack.md) — the live-surface doors. Deliberately
  // three: `attach` redeems view tickets and drives demand on any kind;
  // `browser` creates browser sources (and later carries their human input +
  // navigation); `capture` creates SCK window/Simulator sources — split out
  // because capturing OTHER apps' windows is a different consent class
  // (Screen Recording gravity, A5/EL7). `surface.control` (the DT-5 agent
  // lane) is reserved and deliberately NOT minted by any v1 manifest.
  // None of these enter TAILNET_SCOPES: a surface is a window on THIS device.
  "surface.attach",
  "surface.browser",
  "surface.capture",
  // AR-1 (thinking-ar-data-topology.md §7, AR-D15…D22) — the agent-index and
  // agent-distribution management doors. `index.manage` mutates THIS user's
  // consent record: which discovered agent roots rosettad may read, which
  // runtimes are retired (`index.enroll`/`index.retire`; reads stay on
  // `index.read`). `agents.manage` mutates the MACHINE-scope distribution
  // record — the active executable per provider, updates — the native.admin
  // posture. Both are local-only forever: consent is an act of the person at
  // this device; neither enters TAILNET_SCOPES or any plugin eligibility table.
  "index.manage",
  "agents.manage",
  // AR-5b (the review's EL7 lens) — two CONTENT reads, split off the census
  // scopes the AR-5 doors first rode. `index.search` covers `index.sessions`
  // + `index.search`: transcript search over every consented root — which a
  // plugin that asked `index.read` to draw the roll call must never gain on
  // an upgrade with no re-consent. `agent.usage` covers `agents.usage` + its
  // subscription: the account's billing state, and a credentialed vendor call
  // per reading — not what `agent.observe` (the fold) was consented for.
  // Both are local-only forever (a person's transcripts and accounts are on
  // the device in front of them) and in NO plugin eligibility table:
  // `plugins.ts` names neither, and absence is the safe default there.
  // *Corrected 2026-10-03 (SP-D13 RULED (a), James): `index.search` is not
  // local-only. DS-D8 (ruled 2026-09-30, landed with DS-6 on 2026-10-01)
  // granted it to a self peer DAEMON (PEER_FIELDD_SCOPES — search by
  // asking), and SP-D13 admits it to the tailnet preset: a self phone
  // searches and lists its own history, every answer bounded for a tailnet
  // caller (INDEX_TAILNET_LIMITS). It is still in no plugin eligibility
  // table, and `agent.usage` stays local-only.*
  "index.search",
  "agent.usage",
  // PJ-3 (PJ-D15 (a) RULED 2026-10-07; `build-pj23.md` D8, D10) — the
  // `project.*` READS: the projects this desktop groups over every self
  // desktop's places, with each place's sessions. The person's own devices
  // read them — the window's token and the phone's preset (TAILNET_SCOPES) —
  // and nothing else: NEVER plugin-eligible (AR-5b's precedent; `plugins.ts`
  // names it nowhere), and a self peer DAEMON, which holds it only because
  // PEER_FIELDD_SCOPES is DERIVED from the preset, is refused by every
  // `project.*` handler (DS-L4: a daemon never aggregates another's
  // aggregate). P1 (a), 2026-10-08: an answer to a self principal may carry a
  // place's path; a guest never gets one (a guest holds no scope at all).
  // The acts (`project.intent`) are not this scope's: they ride
  // `settings.manage`, a desktop window's (P2 (a)).
  "project.read",
] as const;
export type Scope = (typeof SCOPES)[number];

/** The D32 tailnet-caller preset (C3): the scopes a WhoIs-authenticated tailnet
 * principal is granted on a served product surface. Broad product access MINUS
 * D32's local-only-forever set (doc.*, artifact mutations, tokens.mint,
 * native.admin, push.manage, plugins.*) and MINUS plugin-runtime/shell powers — those are capability
 * grants for local runtimes, meaningless (and dangerous) as remote-caller
 * scopes. Document replication uses its dedicated authenticated sync protocol;
 * the renderer's persistence API and lane tickets never federate.
 * SP-D13 (a), James, 2026-10-03 — `index.search` joins: a self phone may
 * search and list its own history (`index.sessions`, `index.search`,
 * `index.projects`, `index.recent`, and the History page's
 * `index.changes.subscribe` pings), every answer bounded for a `tailnet`
 * caller at fieldd's doors (INDEX_TAILNET_LIMITS). `index.catalog.subscribe`
 * rides the scope but stays the peer daemon's: its handler admits no other
 * kind.
 * PJ-3 (PJ-D15 (a); P1 (a), 2026-10-08) — `project.read` joins: the phone
 * lists its desktop's projects (`project.list`, `.get`, `.sessions`,
 * `.subscribe`), naming a place only by `PlaceRef`, never by a path; the
 * answer to a self phone may carry a place's path. It reaches the peer
 * preset by derivation, and every `project.*` handler refuses a peer
 * daemon. */
export const TAILNET_SCOPES: readonly Scope[] = [
  "canvas.read",
  "canvas.write",
  "agent.spawn",
  "agent.control",
  "agent.observe",
  "terminal.attach",
  "index.read",
  "index.search",
  "approval.respond",
  "workspace.read",
  "mcp.consume",
  "project.read",
] as const;

/** UA-4 (spec §7.3, UA-D5): the guest preset — a WhoIs-verified tailnet peer
 * whose login does not match this user's stored link. Deliberately empty:
 * guests get a polite hello and typed refusals, not capabilities. Any future
 * guest surface grows from the `guestOk` method column, never from scopes. */
export const TAILNET_GUEST_SCOPES: readonly Scope[] = [] as const;

/** DS-D8 (search by asking; design-06 §5 "History") — the grant a SELF PEER
 * DAEMON (the `peer-fieldd` principal) is minted at the tailnet door: the
 * tailnet preset plus `index.search`, so one of a person's desktops can ask
 * another's index — and replicate its history catalog — on that person's
 * behalf. The forwarding daemon checked its OWN caller's `index.search` before
 * it asked (the scope check precedes routing), and the owner still authorizes
 * the carrier by its own rule (DS-L7). DERIVED from the preset, never a copy
 * of it, so the two can only differ by this one scope.
 * SP-D13 RULED (a), James, 2026-10-03: the phone's preset carries
 * `index.search` too, so today the derivation adds nothing and the two presets
 * are EQUAL — the Set keeps the scope once, in the preset's order. The
 * derivation stays because the two grants are separate rulings: a peer
 * daemon's search is DS-D8's (a desktop asking for a window on another
 * desktop), the phone's is SP-D13's, and were the phone's ever withdrawn the
 * peer's must not go with it. What tells the two callers apart now is the
 * principal KIND, minted from the transport (D1): a `tailnet` caller's history
 * answers are bounded (INDEX_TAILNET_LIMITS) and a peer daemon's are not, and
 * only a peer is served `index.catalog.subscribe`. */
export const PEER_FIELDD_SCOPES: readonly Scope[] = [
  ...new Set<Scope>([...TAILNET_SCOPES, "index.search"]),
] as const;

/** SP-2 (`thinking-sync-planes.md` §6; design-06 §7) — the PHONE's connection
 * budget, as BUILT on 2026-10-01: the most the iOS companion holds open at
 * once, and the numbers its kit ENFORCES — a dial beyond the budget WAITS for a
 * slot; it is never refused and never raced past.
 *  - DOORS_PER_DESKTOP: one product-door WebSocket per self desktop. The phone
 *    dials every self desktop its roster lists (SP-L6 as built; there is no
 *    total until DS-8 homes it to ONE desktop, DS-D13), so the number that is
 *    true today is per desktop: a REPLACEMENT door waits for its predecessor's
 *    socket to close.
 *  - TERMINAL_LEGS: one attached terminal — its control leg and its frames leg
 *    (a routed attachment is a connection SET of two legs; the card attaches one
 *    session at a time).
 *  - WEB_VIEWS: one. Nothing on the phone opens one yet (SP-4).
 * SP-D12 is OPEN (James rules it): its lean is one door to the HOME desktop,
 * at most TWO attached terminals (the open card and one warm), one web view.
 * When it rules, this table moves and the kit's mirror
 * (`apps/ios/VibeFieldKit/Sources/FieldProduct/PhoneBudget.swift`) moves with
 * it — `pnpm check:ios-fixtures` pins the two verbatim, so one moving alone is
 * a red. TS-only: no daemon opens any of these, and the native plane has no
 * reader. */
export const PHONE_BUDGET = {
  DOORS_PER_DESKTOP: 1,
  TERMINAL_LEGS: 2,
  WEB_VIEWS: 1,
} as const;

/** Socket file names under the daemon run dirs; paths are stable across restarts (external-mode law). */
export const SOCKETS = {
  FIELDD: "fieldd.sock",
  MGMT: "mgmt.sock",
  MESHDATA: "meshdata.sock",
  /** NF — Ghosttea control/frame endpoints under native/run/: bound by
   * field-native (which owns creation, permissions, and stale-unlink), dialed
   * by ticket holders. Path stability across fieldd restarts is what lets
   * ghosttea clients read endpoints once at construction.
   * RENAMED 2026-08-05 (UA-D9 regression, live dev root): the user tree
   * (`users/<fuid>/`) pushed `terminal-control.sock` to 108 bytes on the
   * repo-nested dev root — past the macOS sun_path ceiling — so field-native
   * could not bind and the terminal plane crashed while mgmt.sock (96) sailed
   * through the old shortest-name guard. Socket names live under the tightest
   * path budget in the product; keep them ≤ 14 chars (registry lint). */
  TERMINAL_CONTROL: "termctl.sock",
  TERMINAL_FRAME: "termframe.sock",
} as const;

/** P8b (ESP §8.4) — the URL scheme staged plugin modules are served on.
 *
 * It lives HERE, unlike electron-shell's own `APP_SCHEME`, because two packages
 * that share nothing else must agree on it: fieldd MINTS these URLs and Electron
 * main SERVES them. A scheme only one package uses is that package's business; a
 * scheme spanning the daemon and the shell is wire truth.
 *
 * Deliberately NOT the product window's origin. §8.4 requires the CSP to admit
 * "only the chosen plugin module origin", which is a statement you can only make
 * about an origin that is not already `'self'` — keeping plugin bytes off the
 * app scheme means admitting them never widens what `'self'` means for the
 * product document. */
export const PLUGIN_MODULE_SCHEME = "vibefield-plugin" as const;

/** PA-29 / plugin spec §11.6 — the host-singleton externals list. React,
 * ReactDOM, three, R3F/drei, ICE/strata, Loro, and the SDK runtime are
 * host-provided singletons; a plugin bundle that carries a second copy of any
 * of them refuses activation.
 *
 * Declared in EXACTLY ONE place: here. `tooling/plugin-build` re-exports it, so
 * the renderer library-mode bundle, the esbuild service bundle, and the
 * pack-time duplicate-singleton check (§5.4 item 1, stage "artifact checks")
 * read THIS constant rather than hand-listing bundler externals. No plugin,
 * built-in or third-party, configures its own externals list.
 *
 * It is registry data rather than build-tool data because the two halves of the
 * PA-29 contract sit in different processes: pack time externalizes these
 * specifiers, and load time BINDS them (§11.6 — a host-injected import map in
 * the renderer, a `module.register` resolve hook in the service worker). The
 * renderer and Electron main must read the same list without depending on a
 * Node build tool, and one list hand-copied into two planes is the R4 drift
 * class. */
export const HOST_SINGLETON_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@vibefield/plugin-sdk",
  "@vibecook/ice",
  "loro-crdt",
] as const;

export type HostSingletonExternal = (typeof HOST_SINGLETON_EXTERNALS)[number];

/** §11.6 — the EXACT set of bare specifiers the renderer's host-injected import
 * map binds, and therefore the exact set a built plugin artifact is allowed to
 * emit.
 *
 * A superset of HOST_SINGLETON_EXTERNALS, because the bundler externalizes a
 * singleton AND its subpaths by prefix: an artifact emits subpath specifiers
 * the root list never names. The additions below are measured, not guessed —
 * every one appears bare in a shipping plugin's `dist/renderer.js`.
 *
 * ENUMERATED, never prefixed, and that is forced: an import map maps a trailing
 * slash only across a URL path segment, and PLUGIN_MODULE_SCHEME refuses path
 * segments. A specifier without its own entry does not resolve.
 *
 * The build refuses an artifact that emits anything outside this list ("artifact
 * checks"), which is §11.6's "unmapped fails loudly" moved from import time to
 * pack time. Widening the host surface is a deliberate edit HERE — never a
 * plugin's private decision. Renderer truth only: the service worker's resolve
 * hook binds the SDK alone, and node builtins are legitimately its own. */
export const HOST_SINGLETON_MODULE_SPECIFIERS = [
  ...HOST_SINGLETON_EXTERNALS,
  "@vibefield/plugin-sdk/ui",
  "@vibefield/plugin-sdk/canvas",
  "@vibefield/plugin-sdk/behavior",
] as const;

export type HostSingletonModuleSpecifier = (typeof HOST_SINGLETON_MODULE_SPECIFIERS)[number];

/** File names VibeField owns beneath a daemon's own data directory. A name here
 * is resolved by the plane that OWNS the file and by nobody else — GT-3's
 * `config.ghostty` is field-native's, so the native plane joins it to its data
 * dir and every reader asks the service where the file is rather than deriving
 * the same path a second time (two derivations of one path is the R4 drift
 * class wearing a different hat). */
export const FILES = {
  /** The app-owned Ghostty-syntax overlay the embedded terminal service loads
   * AFTER the user's own Ghostty files (GT-3 rider; ghosttea `with_config_path`). */
  TERMINAL_CONFIG: "config.ghostty",
  /** TC-L1f — the machine-wide custody admission ledger (flock'd; PTY budget
   * shared across EVERY user-pair on the machine). Resolves under the
   * VibeField ROOT — never under a user root: per-vault caps are subordinate
   * to one machine-wide budget, and kernel refusal stays the final authority. */
  CUSTODY_ADMISSION_LEDGER: "custody-admission.v1.json",
} as const;

/** UA-D10 — the on-disk layout under a data root, as REGISTRY DATA: relative
 * path segments, one authority, consumers join and never respell (the seven
 * hand-copied derivations the UA census found are the R4 drift class again).
 * Socket/file basenames compose from their own registries above. Generated
 * into Rust by `pnpm gen` and pinned on both sides by
 * `fixtures/layout.vector.json`; non-TS consumers (dev-runner .mjs) read the
 * committed `gen/layout.json`. The tree these segments describe is the CURRENT
 * flat-v1 layout — UA-1 re-roots the same segments under `users/<fuid>/` by
 * changing the ROOT, never the segments. */
export const LAYOUT = {
  FIELDD_RUN_DIR: ["fieldd", "run"],
  PRODUCT_JSON: ["fieldd", "run", "product.json"],
  SHELL_TOKEN: ["fieldd", "run", "shell.token"],
  DEVICE_ID: ["fieldd", "device-id"],
  SETTINGS_DOC: ["fieldd", "settings", "doc.loro"],
  REGISTRIES_DIR: ["registries"],
  DOCS_DIR: ["docs"],
  ARTIFACT_PREVIEWS_DIR: ["artifacts", "previews"],
  AUDIT_DIR: ["audit"],
  PLUGINS_INSTALLED_DIR: ["plugins", "installed"],
  NATIVE_DIR: ["native"],
  NATIVE_RUN_DIR: ["native", "run"],
  PAIRING_FILE: ["native", "pairing"],
  MESH_STATE_DIR: ["native", "mesh"],
  LINK_FILE: ["fieldd", "link.json"],
  /** SB-2 (AR-7g) — which shells fieldd birthed under an Agent Profile
   * (`TerminalBindingsFile`, 0600): session → profile set, never a variable.
   * fieldd's, because nothing below it can hold a session's metadata, and on
   * disk because the floor outlives fieldd — a restarted fieldd still says
   * which profile a surviving shell was born under. */
  TERMINAL_BINDINGS_FILE: ["fieldd", "terminal-bindings.json"],
  TERMINAL_CONFIG_FILE: ["native", FILES.TERMINAL_CONFIG],
  // RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
  // `TERMINAL_MIRROR_WRITE_FILE` = `native/terminal-mirror-write.key`, MF-2a's
  // minted mirror-write capability. A durable secret on disk, readable by every
  // same-uid process, whose holder could write into any mirrored session until
  // a human deleted the file and bounced the pair. The write right is a claim in
  // a per-client, expiring, revocable attach grant now — nothing mints this file
  // and nothing reads it. A key left by a pre-TM-3 boot is inert; no code path
  // consults the path, so it is stale bytes a user may delete.
  MGMT_SOCKET: ["native", "run", SOCKETS.MGMT],
  MESHDATA_SOCKET: ["native", "run", SOCKETS.MESHDATA],
  TERMINAL_CONTROL_SOCKET: ["native", "run", SOCKETS.TERMINAL_CONTROL],
  TERMINAL_FRAME_SOCKET: ["native", "run", SOCKETS.TERMINAL_FRAME],
  CRASH_DIR: ["crash"],
  EXPORTS_STAGING_DIR: ["exports", ".staging"],
  /** AR-0 — the agent index (rosetta): the disposable SQLite projection
   * rosettad serves for this user (`serve --db`), with its ledger, assets and
   * search sidecars beside it. Per USER root (design: one rosettad per user). */
  INDEX_DIR: ["index"],
  INDEX_DB: ["index", "rosetta.db"],
  /** fieldd's PRIVATE rosetta announce directory (`--announce-dir`): the
   * daemon's `<pid>.json` lands here, never in rosetta's shared per-user
   * directory (EL7 — the origin is the secret), and the next fieldd reads it
   * to put down an orphan holding the projection lock. (AR-8b, 2026-10-03:
   * since RO-1 the bearer is the secret, not the origin; the private directory
   * stays, because it is still how the next fieldd finds an orphan.) */
  INDEX_DAEMONS_DIR: ["index", "daemons"],
  /** AR-1 (AR-D17) — this user's consent record and persona ↔ runtime map:
   * which discovered kinds rosettad may read, which managed roots it is
   * handed, which runtimes are retired. VibeField's truth, written by fieldd
   * BEFORE every rosettad spawn — and the same file is the daemon's
   * `--enroll` input (rosetta ignores the keys only VibeField reads). */
  INDEX_ENROLLMENT_FILE: ["index", "enrollment.json"],
  /** AR-8b (RO-1, RO-10; rosetta docs/AUTH.md §4) — the credentials fieldd
   * hands each rosettad generation: the bearer (`--token-file`, 32 to 1,024
   * visible ASCII characters) and the grant key (`--grant-key-file`, at least
   * 32 raw bytes). Minted fresh for every start, written 0600 into this 0700
   * directory before the spawn, read ONCE by the daemon before it binds, and
   * removed by fieldd as soon as the daemon says ready (AUTH.md §7: keep the
   * file where agents are not pointed, delete it after `ready`). fieldd holds
   * both in memory for the generation's life; neither is projected, logged or
   * put in an agent's environment (EL7). A restart mints both again, which
   * revokes every grant the previous generation honoured. */
  INDEX_AUTH_DIR: ["index", "auth"],
  INDEX_TOKEN_FILE: ["index", "auth", "token"],
  INDEX_GRANT_KEY_FILE: ["index", "auth", "grant.key"],
  /** DS-6 — the history catalog's REPLICAS of this user's other desktops
   * (design-06 §5): one `<device>.<table>.json` per `{device, table}` — the
   * rows as last heard and the cursor to resume from — kept while the desktop
   * sleeps (DS-L8), replaced on a reset. Never this desktop's own rows: those
   * are rosetta's, followed live. */
  MESH_CATALOG_DIR: ["mesh", "catalog"],
  /** AR-1 (AR-D18/D20) — this user's personas: puppeteer's profile registry
   * (`ProfileRegistrySnapshot`, through fieldd's injected store) and the
   * managed roots beneath it (0700 — the agent's own data folder, bound at
   * spawn through the provider's root variable). A root under here is
   * managed ⇒ enrolled by construction, never discovered.
   * AR-S2 (AR-D23/D24) — each Agent Profile (puppeteer's profile set) owns ONE
   * folder, `profiles/<set>/`, named once from the profile's first name, and
   * every agent signed in there has its root inside it,
   * `profiles/<set>/<provider>-<8 hex>/`, allocated exclusively and never
   * reused: a profile's whole data — each agent's config, history, plugins and
   * sign-in — is one folder under its user. `roots/` is where AR-1..S1 put
   * `<provider>/<uuid>/` roots; nothing is allocated there any more, and a
   * root found there is adopted in place (a root never moves). */
  AGENTS_DIR: ["agents"],
  AGENT_PROFILES_FILE: ["agents", "profiles.json"],
  AGENT_PROFILE_SETS_DIR: ["agents", "profiles"],
  AGENT_ROOTS_DIR: ["agents", "roots"],
  /** AR-S4d — what each Agent Profile keeps once for its agents (pass 24,
   * S1): one `<set>.json` (0600) per profile with each kept MCP server's
   * definition (what it runs or where it is, and the NAMES of the variables it
   * reads), the names it keeps a value for, and which names it gave each
   * agent. The values live in the OS keychain, one entry per profile — never
   * under this root. */
  AGENT_EXTENSIONS_DIR: ["agents", "extensions"],
  /** AR-S4d2 — each Agent Profile's skills folder, `skills/<set>/<name>/`:
   * the one copy of each skill the profile keeps (a folder with a SKILL.md,
   * or a link to it in `~/.agents/skills` once Codex took it there). Every
   * agent in the profile is given a link to it where it looks for skills;
   * deleted with the profile. */
  AGENT_SKILLS_DIR: ["agents", "skills"],
  /** AR-3 — this user's managed-session records: one `<runtimeRunId>.json`
   * (0600) per session fieldd spawned, holding puppeteer's opaque continuation
   * beside the launch facts (provider, persona, cwd, workspace) and the exit,
   * once there is one. What `agent.resume` reads and what AR-4's re-attach
   * will read; never a transcript (rosetta's) and never a credential. */
  AGENT_SESSIONS_DIR: ["agents", "sessions"],
  /** AR-4 — puppeteer's durable creation registry for this user's runs
   * (its own layout beneath: `claims/` + `installation.key`, all 0600/0700):
   * the claim a run is restored against when fieldd re-attaches after a
   * restart. Never written by VibeField; puppeteer owns every byte. */
  AGENT_RUNS_DIR: ["agents", "runs"],
  /** AR-4b — the key the session records are signed with (HMAC-SHA256, 32
   * random bytes, 0600, minted once per user root): fieldd's own acts on a
   * session (the re-attach at boot, a resume-when-idle) trust only records
   * it wrote itself — a same-uid file dropped into `agents/sessions/` is set
   * aside, never acted on (EL7). */
  AGENT_SESSIONS_KEY_FILE: ["agents", "sessions.key"],
  /** TL (2026-10-02, TL-D8) — the status ledger: one `<runtimeRunId>.jsonl`
   * (0600, the directory 0700) per managed run the fold watched, appended a
   * line per status change while the run lives (`agent-status-ledger.ts`).
   * What `agent.history` answers from; content-free by the fold's standard (a
   * status, its moment, a blocker's words, a working span's last activity
   * line), kept for `AGENT_HISTORY.HORIZON_MS` after the run exits. */
  AGENT_HISTORY_DIR: ["agents", "history"],
  /** AR-7 — the spawn-through shim's home under this user (0700): the
   * rendezvous files, one launcher per offered agent's command, the bundled
   * shim and the shell integration. puppeteer's spawn-through kit writes every
   * file in it; fieldd chooses the path. A shell born in one of our panes
   * carries only this DIRECTORY — what changes across a fieldd restart (the
   * gateway's port, its bearer) lives in the files, never in the shell's
   * environment, because our shells outlive fieldd. */
  AGENT_SHIMS_DIR: ["agents", "shims"],
  /** UA-1 — the user directory ABOVE the per-user roots. `users/<fuid>/` holds
   * a full tree of the segments above; these four live at the VibeField root
   * itself and, with the `machine/` set below, are the only segments that
   * never re-root (LAYOUT_ROOT_LEVEL is that set, as data). */
  USERS_DIR: ["users"],
  USERS_FILE: ["users.json"],
  USERS_LOCK: ["users.json.lock"],
  LAYOUT_STAMP: ["layout.json"],
  /** AR-1 (AR-D15/D16) — the MACHINE scope: the one named exception to
   * UA-D1's "all product state under the user". Exactly agent distribution:
   * installs are OS-user-global by nature, and VibeField owns nothing there
   * but a choice (the active executable per provider) and a preference
   * (channel, network opt-in) — `distribution.json`, root-locked, published
   * atomically by the attached user's fieldd — plus puppeteer's opaque update
   * transcripts under `updates/`. Nothing else enters `machine/` without a
   * new decision. */
  MACHINE_DIR: ["machine"],
  MACHINE_AGENTS_DIR: ["machine", "agents"],
  MACHINE_DISTRIBUTION_FILE: ["machine", "agents", "distribution.json"],
  MACHINE_UPDATES_DIR: ["machine", "agents", "updates"],
  /** FS-1a (`thinking-files-service.md` §6) — the files service's state under
   * this user: the roots registry (`roots.json`, fieldd-owned, written
   * atomically) — every place an agent was spawned, with when it was last
   * active and whether its folder is still there. The browse exports (the
   * home directory, the mounted volumes) are enumerated live, never kept. */
  WORKSPACE_DIR: ["workspace"],
  WORKSPACE_ROOTS_FILE: ["workspace", "roots.json"],
  /** PJ-3 (D9) — the projects' key memory under this user: the last key each
   * place was seen in and the key moves inferred from it (`PROJECT_DOORS`),
   * fieldd-owned, written atomically, so a reader holding a key from before a
   * regroup — or from before a restart — is answered `movedTo`. Opaque keys
   * and placeIds only: no path, no remote. */
  PROJECTS_DIR: ["projects"],
  PROJECT_KEYS_FILE: ["projects", "keys.json"],
} as const;

/** The segments that live at the VibeField ROOT and never re-root under
 * `users/<fuid>/` (UA-1's four + AR-D15's machine scope) — as data, so the
 * flat-v1 migration's manifest and every "is this root-level?" question read
 * one list instead of respelling it. */
export const LAYOUT_ROOT_LEVEL = [
  "USERS_DIR",
  "USERS_FILE",
  "USERS_LOCK",
  "LAYOUT_STAMP",
  "MACHINE_DIR",
  "MACHINE_AGENTS_DIR",
  "MACHINE_DISTRIBUTION_FILE",
  "MACHINE_UPDATES_DIR",
] as const satisfies readonly (keyof typeof LAYOUT)[];

/** The CLOSED Electron IPC surface (ESR spec §6.2 + LOG §12.4/§14): these channels, nothing
 * else. Payload schemas live in shell.ts; call sites import these names — a raw
 * `vibefield:` literal outside contracts is a boundary violation (wall R6). */
export const IPC_CHANNELS = {
  /** renderer → main invoke, once per webContents generation: WindowConnection */
  windowBootstrap: "vibefield:shell:window-bootstrap",
  /** main → renderer event, once per close attempt: CloseRequest */
  prepareClose: "vibefield:shell:prepare-close",
  /** renderer → main event, once per close attempt: CloseResult */
  closeResult: "vibefield:shell:close-result",
  /** main → preload, one transferred MessagePort per WebContents generation */
  rendererLogPort: "vibefield:logging:renderer-port",
  /** main ↔ preload, one host-only diagnostics MessagePort per generation */
  diagnosticsPort: "vibefield:diagnostics:host-port",
  /** main → preload, exactly four Live Surfaces ports per renderer generation */
  liveSurfacePorts: "vibefield:live-surfaces:host-ports",
  /** main → renderer: validated, presentation-only shell commands */
  shellCommand: "vibefield:shell:command",
  /** main → renderer: native tray/background capability truth */
  desktopState: "vibefield:shell:desktop-state",
  // GT-D3's bridge channels (`vibefield:terminal:connect` invoke,
  // `vibefield:terminal:status` event) RETIRED at TP-S3e: the renderer dials
  // the cells' T1 doors directly and main runs no terminal Backend.
  /** main → renderer event: FrameViewState — this window's active view, which
   * main owns (FR-1, grown from GT-D2's Godview bit: the View menu and the
   * close item read it, so the menu and the renderer read ONE state, main's) */
  viewState: "vibefield:view:state",
  /** renderer → main invoke: FrameViewSetRequest — the views track and ⌘1–⌘4
   * asking for a view; answers with the resulting FrameViewState */
  viewSet: "vibefield:view:set",
  /** main → renderer event: FrameZoomRequest — the View menu's Actual Size,
   * Zoom In and Zoom Out (One Frame FR-4, 3b), sent as the ACT to the window's
   * head, which answers on Canvas; the items are disabled under a cover. They
   * replaced Electron's page-zoom roles, so nothing zooms the whole window. */
  viewZoom: "vibefield:view:zoom",
  /** main → renderer event: ThemeState — the app's one theme, which main owns
   * (One Frame FR-4, FC-D5: Light · Dark · Auto, Auto following the OS through
   * `nativeTheme`); sent on every load and every change, to every window */
  themeState: "vibefield:theme:state",
  /** renderer → main invoke: ThemeSetRequest — the Me menu's Theme, Settings →
   * Appearance and the Setup Assistant choosing a theme; answers ThemeState */
  themeSet: "vibefield:theme:set",
  /** renderer → main invoke: UsersUpdateParams → UserRecord — the Account
   * page's profile write. Main owns users.json (UA-D10); fieldd never writes
   * it, which is what keeps the boundary lint honest. */
  usersUpdate: "vibefield:users:update",
  /** renderer → main invoke: {} → UsersListSnapshot — the roster + attached
   * (UA-5; the Account switcher and the tray submenu read one truth) */
  usersList: "vibefield:users:list",
  /** renderer → main invoke: UsersCreateParams → UserRecord — mints user N
   * under the §3.3 lock, then attaches to it (UA-5; the reloaded window runs
   * the wizard's second-user variant) */
  usersCreate: "vibefield:users:create",
  /** renderer → main invoke: UsersSwitchParams → UserRecord — attach
   * re-target + window reload (UA-D15); same-user switch is a no-op */
  usersSwitch: "vibefield:users:switch",
  /** renderer → main invoke: ScreenshotCaptureRequest → ScreenshotCaptureResult
   * — the native screenshot helper, one capture at a time (SNAP-D3). The View
   * menu's Take Screenshot item asks main for the SAME capture, so neither
   * door holds an opinion the other cannot see. */
  screenshotCapture: "vibefield:screenshot:capture",
  /** main → renderer event: ScreenshotCaptureResult — the answer to a capture
   * MAIN ran on the page's behalf (the View menu's item, its accelerator). A
   * renderer that asked through `screenshotCapture` already holds its own
   * answer; this is how the other door stops being invisible to the page that
   * will hold the still (SNAP-3, the clipboard tray). */
  screenshotResult: "vibefield:screenshot:result",
  /** A registered product window asks main to preview one retained still. */
  screenshotPreview: "vibefield:screenshot:preview",
} as const;
