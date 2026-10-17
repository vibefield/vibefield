//! The truffle bump's session-layer witness, on a REAL tailnet (2026-10-17).
//!
//! 0.7.19 carries 9eb8ddc: a restarted peer's session is recovered promptly,
//! and callers share one dial per peer. It rewrites the layer under the
//! roster and the synced store, which carry `field.devices.v1`, the holders and
//! the artifacts catalog. The plan's risk read names it the highest-risk
//! change in the bump (`draft/thinking-freeway-every-pair.md` §9). These rows
//! witness what VibeField relies on across it: the ROSTER and the STORE
//! converge, and reconverge after a restart.
//!
//! 1. `the_new_side_converges_with_an_older_peer_across_both_restarts` and
//!    `the_old_side_answers_the_new_one_across_both_restarts` — ONE run, TWO
//!    builds. A 0.7.19 node and a peer on an OLDER truffle (<= 0.7.17, without
//!    9eb8ddc) converge in both directions. Then the OLDER side restarts and the
//!    0.7.19 side must recover it promptly (9eb8ddc's own claim, across
//!    versions). Then the 0.7.19 side restarts and the older side must recover
//!    it (the old session code facing the new). That is the shape a fleet has
//!    while it upgrades: a desktop on the new pin beside a desktop, or a phone,
//!    on the old one.
//! 2. `a_restarted_peer_reconverges_on_one_build` — the same restart, both
//!    nodes in this process on this pin. The plan's "two-node peer restart".
//!
//! WHY TWO PROCESSES FOR ROW 1. A test binary links ONE truffle-core: a second
//! version in the graph is the `Arc<Node>` split EL8's exact pin exists to
//! refuse. So the older peer is a second build of THIS FILE, in a checkout at
//! an older pin: truffle-core <= 0.7.17, such as 0.7.14 at main's `003cec643`.
//! The file uses only APIs both versions have
//! (`Node::stop`/`peers`/`state_dir`/`synced_store_with_backend`,
//! `SyncedStore::set`/`all`/`stop`,
//! `truffle_core::synced_store::FileBackend::new`, read at truffle-v0.7.14 and
//! truffle-v0.7.19)
//! and `common`'s helpers, which `tests/common` has at `003cec643` too, so it
//! compiles at both. Each side reads its truffle-core version from the
//! `Cargo.lock` it was built from and PUBLISHES it in its slice. "Older" is
//! therefore checked by the run, never assumed. The two sides coordinate
//! through the store itself (a handshake on slice fields), so the convergence
//! being measured is also the only channel between them.
//!
//! `#[ignore]`d and gated, for the reasons in `common/mod.rs`. The key comes
//! from the shell, else from the first `.env` holding it found walking UP from
//! the crate (`common::authkey`). That walk does not stop at the checkout, so a
//! `.env` above it (for an `../old-side` worktree, any of its parents) can
//! answer. Export the key in each shell and copy no secret between trees; the
//! run prints only `redact(&key)`. Row 1, both sides on one machine or two, with
//! the SAME key and a FRESH app id per run (discovery filters by it, so a reused
//! id chases the last run's ghosts):
//!
//! ```sh
//! export TRUFFLE_TEST_AUTHKEY=…                       # ephemeral + reusable
//! export FIELD_NATIVE_MIXED_PROBE_APP_ID=vfmixed$(openssl rand -hex 4)
//!
//! # THE OLDER SIDE: a worktree at an older pin (main's 003cec643 is one, at
//! # 0.7.14), beside this checkout so its ../ghosttea-0.11.2 patch resolves. It
//! # needs a sidecar ITS core speaks (protocol 5: 0.7.14's vendored one, after a
//! # `pnpm install` in that worktree, or FIELD_NATIVE_SIDECAR_PATH at a copy of
//! # it) and its OWN CARGO_TARGET_DIR, because the shared one runs whichever
//! # checkout built last. A fresh worktree has no node_modules, and
//! # `common::sidecar()` would then fall to an unrelated ~/.config/truffle/bin
//! # binary, so name one: any checkout still at 0.7.14 vendors it under
//! # apps/desktop/node_modules/@vibecook/truffle-sidecar-<platform>-<arch>/bin.
//! git worktree add --detach ../old-side 003cec643
//! cp packages/field-native/tests/mesh_mixed_version_probe.rs \
//!   ../old-side/packages/field-native/tests/
//! (cd ../old-side && FIELD_NATIVE_MIXED_PROBE_ROLE=old CARGO_TARGET_DIR=<its own> \
//!   FIELD_NATIVE_SIDECAR_PATH=<a 0.7.14 sidecar-slim> \
//!   cargo test -p field-native --test mesh_mixed_version_probe -- --ignored --nocapture)
//!
//! # THE 0.7.19 SIDE, here, started within a few minutes of the other:
//! FIELD_NATIVE_MIXED_PROBE_ROLE=new \
//!   cargo test -p field-native --test mesh_mixed_version_probe -- --ignored --nocapture
//! ```
//!
//! Row 2 runs with the role UNSET (each row skips when the role is not its own,
//! so one `--ignored` run never stands two roles in one process):
//! `cargo test -p field-native --test mesh_mixed_version_probe -- --ignored --nocapture`.
//!
//! Read the `[mixed] … sidecar=` lines. `common::sidecar()` prefers the vendored
//! binary, and an exported FIELD_NATIVE_SIDECAR_PATH outranks it. The retired
//! protocol-5 override under a 0.7.19 core still runs the store (its plane
//! needs only the WS session), so it would NOT redden these rows. It is the
//! sidecar line that says which binary ran.
mod common;

use common::{authkey, build_node, probe_app_id, redact, sidecar, AUTHKEY_ENV};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::{Node, Peer, SyncedStore};

type MeshNode = Node<TailscaleProvider>;
type Store = SyncedStore<Value>;

const STORE: &str = "field.mixed.probe.v1";
const APP_ID_ENV: &str = "FIELD_NATIVE_MIXED_PROBE_APP_ID";
const ROLE_ENV: &str = "FIELD_NATIVE_MIXED_PROBE_ROLE";
const NEW_NAME: &str = "mixednew";
const OLD_NAME: &str = "mixedold";

/// First contact: the operator starts the two sides by hand, minutes apart.
const MEET_LIMIT: Duration = Duration::from_secs(600);
/// A 0.7.19 observer recovering a restarted peer, BEYOND the restart's own
/// duration (the restarted side reports it). A ceiling for "promptly", not a
/// measurement: the run prints the lag, and the lag is the reading.
const RECOVER_LIMIT: Duration = Duration::from_secs(90);
/// An observer WITHOUT 9eb8ddc recovering a restarted peer, beyond the
/// restart: looser on purpose, because this is the old code's behaviour,
/// which the bump does not change on that side.
const OLD_RECOVER_LIMIT: Duration = Duration::from_secs(300);
/// A real restart's gap: long enough that the peer's session to the old
/// process is gone, not a reconnect inside one TCP lifetime.
const RESTART_GAP: Duration = Duration::from_secs(5);

/// Each row stands tailnet nodes, and the harness runs rows in parallel.
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

/// The truffle-core version the `Cargo.lock` THIS binary was built from names.
fn locked_truffle_core() -> Option<String> {
    let lock =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.lock"))
            .ok()?;
    let lines: Vec<&str> = lock.lines().collect();
    let at = lines
        .iter()
        .position(|line| line.trim() == r#"name = "truffle-core""#)?;
    let version = lines.get(at + 1)?.trim();
    version
        .strip_prefix("version = \"")?
        .strip_suffix('"')
        .map(str::to_string)
}

/// `major.minor.patch`, or `None` for anything else.
fn semver(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

fn role() -> Option<String> {
    std::env::var(ROLE_ENV).ok().filter(|role| !role.is_empty())
}

fn shared_app_id() -> Option<String> {
    std::env::var(APP_ID_ENV).ok().filter(|id| !id.is_empty())
}

/// One side's slice: who it is, the truffle it runs, and its handshake fields.
fn slice(from: &str, version: &str, fields: Value) -> Value {
    let mut out = json!({ "from": from, "truffleCore": version });
    if let (Some(map), Value::Object(fields)) = (out.as_object_mut(), fields) {
        map.extend(fields);
    }
    out
}

/// The newest slice whose `from` is `who`, by its `gen`. `all()` includes the
/// node's OWN slice, so slices are asked for by marker, never counted.
async fn slice_of(store: &Store, who: &str) -> Option<Value> {
    store
        .all()
        .await
        .into_values()
        .map(|slice| slice.data)
        .filter(|data| data["from"] == who)
        .max_by_key(|data| data["gen"].as_u64().unwrap_or(0))
}

/// `who`'s field `field` is at least `n`.
fn at_least(field: &'static str, n: u64) -> impl Fn(&Value) -> bool {
    move |data| data[field].as_u64().unwrap_or(0) >= n
}

/// Wait until `who`'s slice satisfies `ready`, answering with it and how long
/// that took, or `None` at `limit`. A timeout is returned, never panicked, so
/// the caller names what did not converge.
async fn wait_for(
    store: &Store,
    who: &str,
    limit: Duration,
    ready: impl Fn(&Value) -> bool,
) -> Option<(Value, Duration)> {
    let started = Instant::now();
    loop {
        if let Some(data) = slice_of(store, who).await {
            if ready(&data) {
                return Some((data, started.elapsed()));
            }
        }
        if started.elapsed() > limit {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// The roster rows `node` holds for the device named `name` (a truffle hostname
/// is `truffle-{app_id}-{slug(device_name)}`, and discovery is already filtered
/// to this run's app id).
async fn rows_for(node: &MeshNode, name: &str) -> Vec<Peer> {
    let suffix = format!("-{name}");
    node.peers()
        .await
        .into_iter()
        .filter(|peer| peer.hostname.ends_with(&suffix))
        .collect()
}

/// THE ROSTER after a convergence: exactly ONE row for the peer, online. A
/// second row would be a second identity for one node, and none at all a
/// roster the store outran. The connection type is printed, never asserted:
/// it moved at 0.7.17 ("unknown" for a peer idle ~2 min; "direct" ahead of a
/// home DERP) and F0 reads it, this row does not.
async fn one_live_row(node: &MeshNode, name: &str, step: &str) {
    let deadline = Instant::now() + RECOVER_LIMIT;
    loop {
        let rows = rows_for(node, name).await;
        if rows.len() == 1 && rows[0].online {
            let row = &rows[0];
            eprintln!(
                "[mixed] {step}: roster holds ONE row for {name} — online, ws_connected={}, \
                 generation {}, connection_type={}",
                row.ws_connected, row.generation, row.connection_type
            );
            return;
        }
        assert!(
            Instant::now() < deadline,
            "{step}: the roster should hold exactly one ONLINE row for {name}, holds {}: {:?}",
            rows.len(),
            rows.iter()
                .map(|row| (row.online, row.generation))
                .collect::<Vec<_>>()
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// One node of a row: how to bring it up, and to restart it in place.
struct Side<'a> {
    app_id: &'a str,
    name: &'a str,
    state: &'a Path,
    key: &'a str,
    sidecar: &'a Path,
}

impl Side<'_> {
    async fn up(&self) -> (Arc<MeshNode>, Arc<Store>) {
        let node =
            Arc::new(build_node(self.app_id, self.name, self.state, self.key, self.sidecar).await);
        // FILE-BACKED under the node's state dir, exactly as the floor opens
        // its stores (`MeshHandle::open_store`). This is load-bearing for the
        // restart rows, not a nicety. A store keeps a slice per device by
        // version and drops an incoming one that is not newer
        // (`apply_remote_slice`), `stop()` sends no Clear, and a peer's slice
        // goes only when the node leaves the netmap, which a restart of seconds
        // does not do. With the default MemoryBackend a restarted node's
        // version starts over at 1, so its peer would ignore it until it had
        // out-written its own past, and the handshake below would deadlock. The
        // product restores the version from disk, and so does this.
        let backend = Arc::new(truffle_core::synced_store::FileBackend::new(
            node.state_dir().join("synced_store"),
        ));
        let store = node.synced_store_with_backend::<Value>(STORE, backend);
        // The store subscribes inside the task the `synced_store` module spawns, not
        // before returning: a slice set in the same breath could reach a
        // receiver that is not listening yet, and a lost broadcast is never
        // retried. A beat first.
        tokio::time::sleep(Duration::from_millis(500)).await;
        (node, store)
    }

    /// Stop the store and the node, wait out a real gap, and bring the node up
    /// again on the SAME state dir: the same tailnet identity and the same
    /// device id (`{state_dir}/device-id.txt`), which is what a restarted
    /// desktop is. Answers how long the whole restart took.
    async fn restart(
        &self,
        node: Arc<MeshNode>,
        store: Arc<Store>,
    ) -> (Arc<MeshNode>, Arc<Store>, Duration) {
        let started = Instant::now();
        store.stop().await;
        drop(store);
        node.stop().await;
        drop(node);
        tokio::time::sleep(RESTART_GAP).await;
        let (node, store) = self.up().await;
        (node, store, started.elapsed())
    }
}

/// The gates every row shares. `None` = skipped, and the reason was printed.
fn gates(row: &str, want_role: Option<&str>) -> Option<(String, std::path::PathBuf)> {
    if role().as_deref() != want_role {
        eprintln!(
            "[skip] {row}: {ROLE_ENV} is {:?}, this row runs at {want_role:?}",
            role()
        );
        return None;
    }
    let Some(key) = authkey() else {
        eprintln!("[skip] {row}: {AUTHKEY_ENV} not set");
        return None;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] {row}: no truffle sidecar found");
        return None;
    };
    Some((key, sidecar))
}

/// Row 1, the 0.7.19 half. Runs in a checkout at truffle-core >= 0.7.18, which it asserts.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet, TWO builds: needs TRUFFLE_TEST_AUTHKEY, FIELD_NATIVE_MIXED_PROBE_APP_ID, \
            FIELD_NATIVE_MIXED_PROBE_ROLE=new, and the old side running; run with --ignored"]
async fn the_new_side_converges_with_an_older_peer_across_both_restarts() {
    let Some((key, sidecar_path)) = gates("mixed (new side)", Some("new")) else {
        return;
    };
    let Some(app_id) = shared_app_id() else {
        eprintln!(
            "[skip] mixed (new side): {APP_ID_ENV} not set — the SAME fresh value both sides"
        );
        return;
    };
    let _turn = ONE_AT_A_TIME.lock().await;
    let mine = locked_truffle_core().expect("this build's Cargo.lock names truffle-core");
    assert!(
        semver(&mine) >= Some((0, 7, 18)),
        "the NEW side must carry 9eb8ddc (truffle-core >= 0.7.18); this build's lock names {mine}"
    );
    eprintln!(
        "[mixed] new side: truffle-core {mine} app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );
    let state = tempfile::TempDir::with_prefix("vf-mixed-new-").unwrap();
    let side = Side {
        app_id: &app_id,
        name: NEW_NAME,
        state: state.path(),
        key: &key,
        sidecar: &sidecar_path,
    };
    let (node, store) = side.up().await;
    let say = |fields: Value| slice("new", &mine, fields);
    store.set(say(json!({ "gen": 1, "ackOld": 0 }))).await;

    // 1. FIRST CONVERGENCE, old → new, and the precondition: the peer is OLDER.
    let (old, took) = wait_for(&store, "old", MEET_LIMIT, at_least("gen", 1))
        .await
        .expect(
            "the older side's slice never arrived: is it running with the same \
             FIELD_NATIVE_MIXED_PROBE_APP_ID and key, and ROLE=old?",
        );
    let theirs = old["truffleCore"].as_str().unwrap_or_default().to_string();
    assert!(
        semver(&theirs).is_some_and(|version| version <= (0, 7, 17)),
        "the peer must run an OLDER truffle (<= 0.7.17, without 9eb8ddc), or this row witnesses \
         nothing across versions; its slice says truffle-core {theirs:?}"
    );
    eprintln!("[mixed] 1. the old side (truffle-core {theirs}) reached the new in {took:?}");
    one_live_row(&node, OLD_NAME, "1").await;
    store.set(say(json!({ "gen": 1, "ackOld": 1 }))).await;
    let acked_at = Instant::now();

    // …and new → old.
    let (_, took) = wait_for(&store, "old", MEET_LIMIT, at_least("ackNew", 1))
        .await
        .expect(
            "the older side never acknowledged the new side's slice: new → old did not converge",
        );
    eprintln!("[mixed] 1. the new side reached the old in {took:?} (both directions converged)");

    // 2. THE OLDER SIDE RESTARTS, and this 0.7.19 node must recover it promptly.
    let (old, _) = wait_for(&store, "old", MEET_LIMIT, at_least("gen", 2))
        .await
        .expect("the older side's slice never came back after its restart");
    let elapsed = acked_at.elapsed();
    let restart = Duration::from_millis(old["restartMs"].as_u64().unwrap_or(0));
    let lag = elapsed.saturating_sub(restart);
    eprintln!(
        "[mixed] 2. the old side restarted ({restart:?} down and up) and its slice was back \
         here {elapsed:?} after our ack: a recovery lag of about {lag:?}"
    );
    assert!(
        lag <= RECOVER_LIMIT,
        "9eb8ddc's claim, across versions: a 0.7.19 node recovers a restarted peer promptly. The \
         lag beyond the peer's own restart was {lag:?}, past the {RECOVER_LIMIT:?} ceiling"
    );
    one_live_row(&node, OLD_NAME, "2").await;
    store.set(say(json!({ "gen": 1, "ackOld": 2 }))).await;
    wait_for(&store, "old", MEET_LIMIT, at_least("ackNew", 2))
        .await
        .expect("after its restart the older side never received the new side's slice again");

    // 3. THIS SIDE RESTARTS, and the older side must recover it.
    let (node, store, restart) = side.restart(node, store).await;
    let back_at = Instant::now();
    store
        .set(say(
            json!({ "gen": 3, "ackOld": 2, "restartMs": restart.as_millis() as u64 }),
        ))
        .await;
    let (_, took) = wait_for(&store, "old", OLD_RECOVER_LIMIT, at_least("ackNew", 3))
        .await
        .unwrap_or_else(|| {
            panic!(
                "the older side never received the restarted 0.7.19 node's slice within \
                 {OLD_RECOVER_LIMIT:?} of its return — the old session code did not recover it"
            )
        });
    eprintln!(
        "[mixed] 3. restarted ({restart:?}); the old side held our new slice {took:?} after we \
         were back (that observer runs the OLD session layer)"
    );
    // …and this restarted node holds the older side's slice again: the store's
    // join resync, from the new side's end.
    wait_for(&store, "old", RECOVER_LIMIT, at_least("gen", 2))
        .await
        .expect("the restarted 0.7.19 node never re-received the older side's slice");
    one_live_row(&node, OLD_NAME, "3").await;
    eprintln!(
        "[mixed] 3. the restarted node re-received the old side's slice ({:?} after return)",
        back_at.elapsed()
    );

    store
        .set(say(json!({ "gen": 3, "ackOld": 2, "done": true })))
        .await;
    tokio::time::sleep(Duration::from_secs(10)).await;
    store.stop().await;
    node.stop().await;
    eprintln!("[mixed] new side: every step converged");
}

/// Row 1, the older half. Runs in a checkout at an older pin (see the header).
#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet, TWO builds: the OLDER half of the mixed row; needs TRUFFLE_TEST_AUTHKEY, \
            FIELD_NATIVE_MIXED_PROBE_APP_ID, FIELD_NATIVE_MIXED_PROBE_ROLE=old; run with --ignored"]
async fn the_old_side_answers_the_new_one_across_both_restarts() {
    let Some((key, sidecar_path)) = gates("mixed (old side)", Some("old")) else {
        return;
    };
    let Some(app_id) = shared_app_id() else {
        eprintln!(
            "[skip] mixed (old side): {APP_ID_ENV} not set — the SAME fresh value both sides"
        );
        return;
    };
    let _turn = ONE_AT_A_TIME.lock().await;
    let mine = locked_truffle_core().expect("this build's Cargo.lock names truffle-core");
    eprintln!(
        "[mixed] old side: truffle-core {mine} app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );
    // Said, not asserted, here: the NEW side asserts the version it is shown,
    // so a run with both sides on one pin fails there, by name.
    let state = tempfile::TempDir::with_prefix("vf-mixed-old-").unwrap();
    let side = Side {
        app_id: &app_id,
        name: OLD_NAME,
        state: state.path(),
        key: &key,
        sidecar: &sidecar_path,
    };
    let (node, store) = side.up().await;
    let say = |fields: Value| slice("old", &mine, fields);
    store.set(say(json!({ "gen": 1, "ackNew": 0 }))).await;

    // 1. Hold the new side's slice and say so; then wait to be held.
    wait_for(&store, "new", MEET_LIMIT, at_least("gen", 1))
        .await
        .expect("the 0.7.19 side's slice never arrived: is it running, with the same app id?");
    store.set(say(json!({ "gen": 1, "ackNew": 1 }))).await;
    wait_for(&store, "new", MEET_LIMIT, at_least("ackOld", 1))
        .await
        .expect("the 0.7.19 side never acknowledged this side's slice");
    eprintln!("[mixed] 1. both directions converged");

    // 2. Restart, and come back saying how long it took.
    let (node, store, restart) = side.restart(node, store).await;
    store
        .set(say(
            json!({ "gen": 2, "ackNew": 1, "restartMs": restart.as_millis() as u64 }),
        ))
        .await;
    eprintln!("[mixed] 2. restarted ({restart:?}), slice gen 2 set");
    wait_for(&store, "new", MEET_LIMIT, at_least("ackOld", 2))
        .await
        .expect("the 0.7.19 side never acknowledged this side's slice after its restart");
    store.set(say(json!({ "gen": 2, "ackNew": 2 }))).await;

    // 3. The 0.7.19 side restarts: hold its new slice and say so.
    let (_, took) = wait_for(&store, "new", MEET_LIMIT, at_least("gen", 3))
        .await
        .expect("the restarted 0.7.19 node's slice never reached this side");
    eprintln!("[mixed] 3. held the restarted 0.7.19 node's slice ({took:?} of waiting)");
    one_live_row(&node, NEW_NAME, "3 (old side)").await;
    store.set(say(json!({ "gen": 2, "ackNew": 3 }))).await;

    if wait_for(&store, "new", Duration::from_secs(120), |data| {
        data["done"] == true
    })
    .await
    .is_none()
    {
        eprintln!(
            "[mixed] old side: the 0.7.19 side's `done` never arrived; its own run is the verdict"
        );
    }
    store.stop().await;
    node.stop().await;
    eprintln!("[mixed] old side: done");
}

/// Row 2 — a restarted peer reconverges on ONE build: two nodes in this
/// process on this pin. The plan's "two-node peer restart" beside
/// `mesh_self_probe`.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY (and FIELD_NATIVE_MIXED_PROBE_ROLE unset); run with --ignored"]
async fn a_restarted_peer_reconverges_on_one_build() {
    let Some((key, sidecar_path)) = gates("restart (one build)", None) else {
        return;
    };
    let _turn = ONE_AT_A_TIME.lock().await;
    let app_id = probe_app_id();
    let version = locked_truffle_core().unwrap_or_else(|| "unknown".into());
    eprintln!(
        "[restart] truffle-core {version} app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );
    let state_a = tempfile::TempDir::with_prefix("vf-restart-a-").unwrap();
    let state_b = tempfile::TempDir::with_prefix("vf-restart-b-").unwrap();
    let a = Side {
        app_id: &app_id,
        name: "restarta",
        state: state_a.path(),
        key: &key,
        sidecar: &sidecar_path,
    };
    let b = Side {
        app_id: &app_id,
        name: "restartb",
        state: state_b.path(),
        key: &key,
        sidecar: &sidecar_path,
    };
    let (node_a, store_a) = a.up().await;
    let (node_b, store_b) = b.up().await;
    store_a.set(slice("a", &version, json!({ "gen": 1 }))).await;
    store_b.set(slice("b", &version, json!({ "gen": 1 }))).await;

    // 1. Converge both ways: the CONTROL every recovery below is measured against.
    let (_, a_to_b) = wait_for(&store_b, "a", MEET_LIMIT, at_least("gen", 1))
        .await
        .expect("the CONTROL failed: A's slice never reached B");
    let (_, b_to_a) = wait_for(&store_a, "b", MEET_LIMIT, at_least("gen", 1))
        .await
        .expect("the CONTROL failed: B's slice never reached A");
    eprintln!("[restart] 1. control: A → B {a_to_b:?}, B → A {b_to_a:?}");
    one_live_row(&node_a, "restartb", "1").await;

    // 2. B restarts; A must recover it promptly and hold exactly one row for it.
    let (node_b, store_b, restart) = b.restart(node_b, store_b).await;
    let back_at = Instant::now();
    store_b.set(slice("b", &version, json!({ "gen": 2 }))).await;
    let (_, lag) = wait_for(&store_a, "b", RECOVER_LIMIT, at_least("gen", 2))
        .await
        .unwrap_or_else(|| {
            panic!(
                "A never received the restarted B's slice within {RECOVER_LIMIT:?} of B's return \
                 (B was down and up in {restart:?})"
            )
        });
    eprintln!(
        "[restart] 2. B restarted ({restart:?}); A held its new slice {lag:?} after B was back"
    );
    one_live_row(&node_a, "restartb", "2").await;
    // …and the restarted B holds A's slice again (the join resync).
    wait_for(&store_b, "a", RECOVER_LIMIT, at_least("gen", 1))
        .await
        .expect("the restarted B never re-received A's slice");
    eprintln!(
        "[restart] 2. the restarted B re-received A's slice ({:?} after its return)",
        back_at.elapsed()
    );

    store_a.stop().await;
    store_b.stop().await;
    node_a.stop().await;
    node_b.stop().await;
}
