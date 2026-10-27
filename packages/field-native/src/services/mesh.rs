//! MeshUnit (C1 spike) — truffle-core embedded as this device's single tailnet
//! identity (design-02 §2.1 MeshGateway; v0.5 law: truffle lives ONLY here).
//!
//! Lifecycle honesty over the M2 health shape:
//!   disabled              — no node: nobody has asked for one (the default)
//!   starting              — background node bring-up (truffle's build() blocks
//!                           until the tailnet is Running, so it runs spawned)
//!   starting + authUrl    — sidecar wants a browser login; URL surfaced verbatim
//!   up                    — node online; detail = tailnet DNS name
//!   degraded              — sidecar missing / bring-up failed (daemon stays up)
//!
//! UA-P-0a (D1) — THE POSTURE DERIVES FROM THE LINK. This unit no longer brings
//! a node up at boot because an env flag said so. It comes up when fieldd asks
//! (`native.mesh.start`), in one of two modes, and fieldd asks because a user
//! linked a tailscale account — unlinked is a default LOCAL account and a
//! desktop with no node at all. The two modes are not cosmetic:
//!
//!   capture — the interactive login is running and NOTHING may be declared or
//!             published. The floor enforces that itself (`serve.add` and
//!             `store.set` are refused) rather than trusting fieldd to remember:
//!             the account is not known yet, so nothing can be scoped to it.
//!   linked  — the captured login IS the account, and since UA-P-4 it is the
//!             NODE'S OWN GATE: the builder gets `.login_allow([login])`, so
//!             Layer 3 reports only peers under that login and the hello
//!             refuses every other one (RFC 025 §3.3/§3.4). Every subsystem on
//!             the session plane — the synced store above all — is scoped by
//!             construction rather than by a check each caller must remember.
//!
//! UA-P-4 — THE GATE IS A BUILD-TIME FACT (RFC 025 §3.1: fixed for the node's
//! lifetime). So the capture → linked promotion REBUILDS rather than relabels:
//! a live capture node is ungated, and leaving it installed while the posture
//! says "linked" would be a node scoped to nobody wearing an account's name.
//! `Shared.login_allow` records what the LIVE node was actually built with, so
//! the rebuild decision and `native.mesh.self`'s honest `loginAllow` read the
//! same fact rather than re-deriving it from the posture.
//!
//! `FIELD_NATIVE_MESH=1` survives as a FORCED-ON DEVELOPMENT OVERRIDE only —
//! the probes and the kill matrix drive this floor without a fieldd to ask —
//! and it starts the node in `linked` mode with NO login, which after UA-P-4
//! means it starts UNGATED (an empty allow-list is RFC 025's "no gate"): the
//! probes need every peer on the test tailnet, and there is no account to scope
//! to. It is not the product's switch and must never become one again — the
//! product reaches `linked` only through a captured login, and a captured login
//! is always a gate.
//!
//! The sidecar binary is truffle's Go child process. Resolution mirrors
//! truffle-sidecar's runtime order WITHOUT its build-time downloader (a network
//! fetch inside `cargo build` would poison every offline/CI build): explicit
//! env override, then the well-known install locations. AH-1b packages the
//! exact platform sidecar release next to field-native, which the
//! executable-adjacent probe picks up first.

use crate::config::{MeshProbeIdentity, NativeConfig};
use crate::contracts::{MeshMode, UnitHealth, UnitState};
use crate::manager::NativeService;
use crate::services::mesh_egress::{self, EgressBackend};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;
use truffle_core::network::{BackendState, NetworkStatusEvent};
use truffle_core::synced_store::SyncedStore;
use truffle_core::{network::tailscale::TailscaleProvider, Node};

/// = @vibefield/contracts registries APP_ID (one tailnet app namespace per product).
const APP_ID: &str = "vibefield";
// WIN-7: the truffle sidecar ships `sidecar-slim.exe` on Windows; a bare
// `sidecar-slim` name would never match the file beside field-native.exe.
#[cfg(windows)]
const SIDECAR_NAMES: [&str; 2] = ["sidecar-slim.exe", "truffle-sidecar.exe"];
#[cfg(not(windows))]
const SIDECAR_NAMES: [&str; 2] = ["sidecar-slim", "truffle-sidecar"];

pub type MeshNode = Node<TailscaleProvider>;
pub type JsonStore = SyncedStore<Value>;

struct Shared {
    health: Mutex<UnitHealth>,
    /// A WATCH and not a mutex: bring-up is asynchronous, so consumers that
    /// cannot start until the node exists (C6-3's lane transport) need to be
    /// woken rather than to poll. `borrow()` still answers "is it up yet?"
    /// synchronously, which is what the mgmt facade asks.
    node: watch::Sender<Option<Arc<MeshNode>>>,
    /// pokes the daemon's health-refresh task (lib.rs) after every transition
    ping: UnboundedSender<()>,
    /// facade state (C2): open stores + declared serves (config JSON kept for list)
    stores: tokio::sync::Mutex<HashMap<String, Arc<JsonStore>>>,
    serves: tokio::sync::Mutex<HashMap<String, Value>>,
    /// truffle state root (identity + keys) — lives on Shared so the mgmt
    /// facade can retire it even when no node ever came up (UA-3 unlink).
    state_dir: PathBuf,
    /// UA-P-0a — the resolved sidecar path and the places looked, on Shared
    /// because BRING-UP IS NOW A HANDLE CALL: `native.mesh.start` reaches this
    /// through `MeshHandle`, long after `MeshUnit::start` ran and returned.
    sidecar: Option<PathBuf>,
    searched: Vec<String>,
    /// UA-P-0a — the posture, `None` while there is no node. Read by the mgmt
    /// facade's capture-mode refusal; written only by `start`/`stop`/`retire`.
    mode: Mutex<Option<(MeshMode, Option<String>)>>,
    /// UA-P-4 (RFC 025 §3.1) — the login allow-list the current bring-up hands
    /// truffle, and therefore the one the INSTALLED node was built with. A
    /// different fact from the posture: the gate is fixed for a node's
    /// lifetime, so between `start(Linked, login)` and the rebuild it forces,
    /// the posture already says "linked" while the node still running is the
    /// ungated capture one. Written only by `spawn_bring_up` (the one place a
    /// node is constructed) and cleared by `teardown_node` with the node, so it
    /// is never a stale list describing a node that is gone.
    ///
    /// Two readers, and both need the BUILT value rather than the intended
    /// one: `start` decides whether a posture change has to rebuild, and
    /// `native.mesh.self` answers `loginAllow` — "is this node gated?" — which
    /// would be a lie told from the posture.
    login_allow: Mutex<Vec<String>>,
    /// UA-P-0a — the in-flight bring-up, on Shared for the same reason as the
    /// sidecar: `stop` has to abort it, and `stop` arrives through the handle.
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// UA-3 — set by retire(); the bring-up task checks it before installing
    /// a node, so a login completing AFTER an unlink cannot resurrect the
    /// identity the user just archived.
    retired: std::sync::atomic::AtomicBool,
    /// E-F1 TEST SEAM — see [`MeshHandle::force_node_presence_for_tests`]. A
    /// second watch rather than a fake node because a `Node` cannot be
    /// constructed headlessly; it is OR'd with the real one and NOTHING in the
    /// product ever writes it.
    node_presence_forced: watch::Sender<bool>,
    /// DS-1 — the egress substrate (`services/mesh_egress.rs`): the
    /// unsupported arm in production today, a fake in tests. Behind a mutex
    /// only so a test can install its fake; production never swaps it.
    egress: Mutex<Arc<dyn EgressBackend>>,
    /// DS-1 — bumped whenever the egress route table moves (an add, a remove,
    /// a teardown's reset). A WATCH, so `route.subscribe` forwarders coalesce
    /// bursts and re-read the whole table: the table is the payload, never an
    /// edge, so a skipped intermediate state loses nothing.
    egress_changes: watch::Sender<u64>,
    /// TS-1 (track TS) — the sign-in facts of the current bring-up and its
    /// node ([`LinkFacts`]): what a person needs to act on a link that waits on
    /// someone, lapses, or is asked for again. Reset by every bring-up.
    facts: Mutex<LinkFacts>,
    /// TS-1 — bumped by every bring-up and captured by the status hook it
    /// starts, so a hook still running for a node a rebuild has replaced can
    /// never write its successor's facts or tear its successor down.
    generation: AtomicU64,
    /// TS-1 (P3) — `NativeConfig::mesh_start_timeout`; `None` waits for ever.
    start_timeout: Option<Duration>,
    /// TS-1 TEST SEAM — `NativeConfig::mesh_probe`; `None` in the product.
    probe: Option<MeshProbeIdentity>,
    /// TS-D15/D16 — whether the current bring-up's node sends Tailscale its
    /// client logs: false (VibeField's default, D15) unless the link opted in on
    /// a network that requires them (D16). Like `login_allow`, the BUILT value,
    /// which truffle fixes for the node's lifetime: written only by
    /// `spawn_bring_up`, cleared by `teardown_node`, read by `start` (a changed
    /// opt-in rebuilds) and by `native.mesh.self`.
    client_log_upload: AtomicBool,
}

/// TS-1 (track TS) — what the floor knows about this node's sign-in beyond the
/// health shape. One per unit, reset by every bring-up, and read where fieldd
/// already reads the node: `native.mesh.self`, and its answer while there is no
/// node (`MeshNotUpDetails`). The health stream carries none of it; a change a
/// person must see moves the unit's `detail` too, so the stream still says
/// "read me again" (P2).
#[derive(Clone, Debug, Default)]
pub struct LinkFacts {
    /// The tailnet's device approval holds this node (Tailscale's
    /// NeedsMachineAuth). Cleared when the node comes up: approved.
    pub needs_approval: bool,
    /// The admin console's Machines page; `None` for a custom control server
    /// (Headscale has no console), and until the sidecar names its server.
    pub admin_url: Option<String>,
    /// When the node's key expires: `Some(Some(ms))`, `Some(None)` when expiry
    /// is disabled, and `None` while not known (a sidecar before protocol 10,
    /// or a node not up yet).
    pub key_expiry_ms: Option<Option<i64>>,
    /// A node that was running asks to be signed in again: its key expired, or
    /// it was removed in the console. truffle says so with
    /// `BackendStateChanged { NeedsLogin }`; nothing reaches the tailnet until a
    /// new sign-in.
    pub needs_login: bool,
    /// T11 — Tailnet Lock holds this node: it is up, but reaches no peer and no
    /// peer reaches it until a signing device signs it (`NeedsSignature`, then
    /// `Signed`).
    pub needs_signature: bool,
    /// T11 — the Tailscale release the node's sidecar embeds (`1.104.1`); `None`
    /// until a node is up.
    pub tailscale_version: Option<String>,
    /// The name Tailscale shows for this node — on its "connect the device …?"
    /// page and in the admin console: the name truffle composes before the
    /// node is up, the one Tailscale granted after (it may add `-1`).
    pub machine_name: Option<String>,
    /// Why the last bring-up ended without a node, as one word a person's
    /// sentence is chosen by: [`FAILURE_SIDECAR_MISSING`],
    /// [`FAILURE_BRING_UP`], [`FAILURE_SIDECAR_EXITED`] or
    /// [`FAILURE_LOGGING_REQUIRED`]. The unit's `detail` keeps the floor's own
    /// words.
    pub failure: Option<&'static str>,
}

/// TS-1 — no sidecar was found: reinstalling VibeField is the way forward.
pub const FAILURE_SIDECAR_MISSING: &str = "sidecar_missing";
/// TS-1 — the build failed after the sidecar started.
pub const FAILURE_BRING_UP: &str = "bring_up_failed";
/// TS-1 — the sidecar of a node that was up exited on its own.
pub const FAILURE_SIDECAR_EXITED: &str = "sidecar_exited";
/// TS-D16 — the tailnet requires client logs (its flow logs are on) and this
/// node sends none, so Tailscale keeps it down until it is built again with
/// uploads allowed, or until the flow logs are off.
pub const FAILURE_LOGGING_REQUIRED: &str = "logging_required";

/// TS-D16 — the words truffle's start error carries when a tailnet that
/// requires client logs refused an opted-out node (truffle-core 0.7.24
/// provider.rs, the status processor's `LoggingRequired` arm: "this tailnet
/// requires client logging (network flow logs are on), …"). Read because the
/// typed event can be lost with a failed build; a typed refusal is a candidate
/// truffle petition.
const LOGGING_REQUIRED_REFUSAL: &str = "requires client logging";

/// TS-1 (P7) — a Tailscale auth key on its way to a capture's builder. It is
/// never stored and never logged: `Debug` redacts it, the floor holds it only
/// inside the one bring-up it signs in, and truffle redacts its own copy.
#[derive(Clone)]
pub struct AuthKey(String);

impl AuthKey {
    pub fn new(key: String) -> Self {
        Self(key)
    }
    fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for AuthKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthKey([REDACTED])")
    }
}

/// TS-1 — what `native.mesh.start` may ask beyond the posture.
#[derive(Clone, Debug, Default)]
pub struct StartOptions {
    /// Capture only: sign the node in with this key instead of a browser.
    pub auth_key: Option<AuthKey>,
    /// Linked only: rebuild an INSTALLED node whose gate has not moved, because
    /// it was signed out (an expired key, a removal) and only a new bring-up
    /// hands out a new sign-in address. A bring-up still waiting for its
    /// sign-in is left alone: its address is already the live one.
    pub renew: bool,
    /// TS-D15/D16 — either mode: the node sends Tailscale its client logs. false
    /// is VibeField's default; true only where the person opted in on a network
    /// that requires logs. truffle fixes it for a node's lifetime, so a node
    /// built with the other setting is rebuilt.
    pub client_log_upload: bool,
}

/// E-F1 — a subscription to `node_present()`: "is a tailnet node installed?",
/// which is the half of `HelloAck.terminalMesh` that MOVES after the hello.
///
/// Two watches waited on together, because the fact has two writers with very
/// different standing: the node watch (the real bring-up, `send_replace`) and
/// the test override. `get()` is their OR; `changed()` parks until either moves.
pub struct NodePresence {
    node: watch::Receiver<Option<Arc<MeshNode>>>,
    forced: watch::Receiver<bool>,
    /// Only ever `Some` in [`NodePresence::for_tests`]: the node half's sender,
    /// held so its receiver keeps reporting "no node" instead of "gone".
    _detached_node: Option<watch::Sender<Option<Arc<MeshNode>>>>,
}

impl NodePresence {
    /// T-M2 TEST SEAM — a presence fact with no mesh unit behind it, so a unit
    /// row can drive the node half directly (`forced`) and exercise the readers
    /// of this watch: the routes forwarder's two triggers and its dedupe. The
    /// node half is a live channel that never moves, which is what a floor
    /// whose gateway never came up really looks like.
    #[doc(hidden)]
    pub fn for_tests(forced: watch::Receiver<bool>) -> Self {
        let (node_tx, node) = watch::channel(None);
        Self {
            node,
            forced,
            _detached_node: Some(node_tx),
        }
    }

    /// Is a node installed right now? Cheap — two watch borrows, no wait.
    pub fn get(&self) -> bool {
        self.node.borrow().is_some() || *self.forced.borrow()
    }

    /// Park until either half moves. `Err` is the watch's own `RecvError`: a
    /// half's sender is gone, so the mesh unit is gone and this fact will never
    /// move again — a forwarder should stop selecting on it rather than spin.
    pub async fn changed(&mut self) -> Result<(), watch::error::RecvError> {
        tokio::select! {
            r = self.node.changed() => r,
            r = self.forced.changed() => r,
        }
    }
}

/// Cloneable door to the mesh for the mgmt server (design-02: fieldd consumes
/// mesh-as-a-service; this handle is the in-process seam it lands on).
#[derive(Clone)]
pub struct MeshHandle {
    shared: Arc<Shared>,
}

impl MeshHandle {
    pub fn node(&self) -> Option<Arc<MeshNode>> {
        self.shared.node.borrow().clone()
    }

    /// E-F1 — "is a tailnet node installed?", the live half of the terminal-mesh
    /// reading, read WITHOUT cloning the node. `node().is_some()` plus the test
    /// override; `state.rs`'s `terminal_mesh_published` composes it with the flag.
    pub fn node_present(&self) -> bool {
        self.shared.node.borrow().is_some() || *self.shared.node_presence_forced.borrow()
    }

    /// E-F1 — subscribe to `node_present()`. The routes forwarder holds one of
    /// these so a node that arrives SECONDS AFTER the hello reaches fieldd as a
    /// push instead of waiting for an unrelated re-pair.
    pub fn node_presence(&self) -> NodePresence {
        NodePresence {
            node: self.shared.node.subscribe(),
            forced: self.shared.node_presence_forced.subscribe(),
            _detached_node: None,
        }
    }

    /// E-F1 TEST SEAM — force the node-presence fact, for tests only.
    ///
    /// WHY IT EXISTS, stated plainly because it bounds what the rows above it
    /// prove: a tailnet node cannot be built headlessly. `MeshUnit::start` drives
    /// an INTERACTIVE browser login (`build_with_auth_handler`), so no test on
    /// this plane can put a real `Node` in the watch, and the floor's own mesh
    /// service has no auth-key path at all (the same wall
    /// `tests/terminal_cell_route_probe.rs` names in its module note — it mints
    /// its OWN ephemeral nodes rather than making the floor join).
    ///
    /// So this moves the ONE fact everything downstream reads off the node
    /// watch, and a test that uses it witnesses the PUSH MACHINERY — the watch
    /// wakes the forwarder, the forwarder composes the boolean, the boolean
    /// reaches fieldd with no second hello — not tsnet bring-up. The live
    /// witness for "a real node flips this" is a hardware run.
    ///
    /// It ORs with the real node and never replaces it, so it cannot mask a
    /// node that is genuinely absent-then-present. Nothing in the product calls
    /// it.
    #[doc(hidden)]
    pub fn force_node_presence_for_tests(&self, present: bool) {
        self.shared.node_presence_forced.send_replace(present);
    }

    /// DS-1 — the egress substrate the facade answers from.
    pub fn egress(&self) -> Arc<dyn EgressBackend> {
        self.shared.egress.lock().unwrap().clone()
    }

    /// DS-1 — a receiver woken whenever the egress route table moves.
    pub fn egress_changes(&self) -> watch::Receiver<u64> {
        self.shared.egress_changes.subscribe()
    }

    /// DS-1 — the facade moved the table (an add, a remove, a reset took
    /// effect). Returns the table's NEW revision, which an add's answer
    /// carries so its reader can order it against the stream.
    pub fn note_egress_changed(&self) -> u64 {
        let mut revision = 0;
        self.shared.egress_changes.send_modify(|current| {
            *current += 1;
            revision = *current;
        });
        revision
    }

    /// DS-1 — the table's current revision. A reader takes it BEFORE it reads
    /// the table, so the table it then reads is at least that new — never
    /// older than the revision it is stamped with.
    pub fn egress_revision(&self) -> u64 {
        *self.shared.egress_changes.borrow()
    }

    /// DS-1 TEST SEAM — install an egress arm, for tests only.
    ///
    /// Production builds `mesh_egress::default_backend()` at construction and
    /// never swaps it. A test installs `FakeEgress` here and pairs it with
    /// [`Self::force_node_presence_for_tests`], because the same wall stands:
    /// no node can be built headlessly, so what such a test witnesses is the
    /// FACADE — the verbs, the refusals, the table, the reset and its stream —
    /// with real loopback sockets, not tsnet's egress. The live witness is the
    /// petition window's hardware run (two desktops, the Tailscale app quit).
    #[doc(hidden)]
    pub fn install_egress_for_tests(&self, backend: Arc<dyn EgressBackend>) {
        *self.shared.egress.lock().unwrap() = backend;
    }

    /// DS-1b PROBE SEAM — install a node a test built itself, for the
    /// `#[ignore]`d real-tailnet probes only.
    ///
    /// The floor's own bring-up drives an INTERACTIVE login, so the floor
    /// cannot join a tailnet headlessly (the wall
    /// [`Self::force_node_presence_for_tests`] names). The probe harness can:
    /// it builds a node from the auth key in `.env` (`tests/common/mod.rs`).
    /// A probe that must witness the FACADE over a REAL node (the egress verbs
    /// through truffle's RFC 026 egress, `tests/mesh_egress_probe.rs`) hands
    /// that node here, and every reader of the node watch sees it as the floor's
    /// own. It sets no posture (`mode()` stays `None`: neither capture's belt
    /// nor a linked login is claimed), and a teardown drops it like any node.
    /// Nothing in the product calls it.
    #[doc(hidden)]
    pub fn install_node_for_tests(&self, node: Arc<MeshNode>) {
        self.shared.node.send_replace(Some(node));
    }

    /// The gateway's own health, for a consumer that must decide whether
    /// waiting for a node is still worth doing (GT-4a's terminal mesh). A
    /// `disabled`/`degraded` gateway will never produce one, and its `detail`
    /// is the reason — so a borrower reports the gateway's words rather than
    /// inventing its own account of a failure it did not see.
    pub fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    /// Park until the node exists, then hand it over. Never resolves while the
    /// mesh is disabled or degraded — which is the honest answer, not a hang to
    /// paper over: there is no node to give, and a caller that needs one has
    /// nothing to do until there is. Callers spawn this and are aborted at
    /// shutdown.
    pub async fn wait_for_node(&self) -> Arc<MeshNode> {
        let mut rx = self.shared.node.subscribe();
        loop {
            if let Some(node) = rx.borrow_and_update().clone() {
                return node;
            }
            if rx.changed().await.is_err() {
                // The unit is gone; there will never be a node. Park forever
                // rather than return a lie — the task is aborted on shutdown.
                std::future::pending::<()>().await;
            }
        }
    }

    /// Item 79 — the installed node as a WATCH, `None` between nodes. For wiring
    /// that must follow the node across a rebuild (the lane transport: a
    /// promotion replaces the node, and a transport built once on the first one
    /// kept it, and its sidecar, alive). A caller that wants one node, once,
    /// wants `wait_for_node`.
    pub fn subscribe_node(&self) -> watch::Receiver<Option<Arc<MeshNode>>> {
        self.shared.node.subscribe()
    }

    /// Get-or-create a JSON synced store, file-backed under the node's state dir.
    pub async fn open_store(&self, node: &Arc<MeshNode>, store_id: &str) -> Arc<JsonStore> {
        let mut stores = self.shared.stores.lock().await;
        if let Some(s) = stores.get(store_id) {
            return s.clone();
        }
        let backend = Arc::new(truffle_core::synced_store::FileBackend::new(
            node.state_dir().join("synced_store"),
        ));
        let store = node.synced_store_with_backend::<Value>(store_id, backend);
        stores.insert(store_id.to_string(), store.clone());
        store
    }

    pub async fn record_serve(&self, name: &str, config: Value) {
        self.shared
            .serves
            .lock()
            .await
            .insert(name.to_string(), config);
    }
    pub async fn forget_serve(&self, name: &str) {
        self.shared.serves.lock().await.remove(name);
    }
    pub async fn serve_config(&self, name: &str) -> Option<Value> {
        self.shared.serves.lock().await.get(name).cloned()
    }

    /// UA-P-0a — the posture, or `None` when no node is installed. The mgmt
    /// facade reads this to refuse `serve.add` and `store.set` while capturing:
    /// the account is not known yet, so nothing can be scoped to it and
    /// therefore nothing may be declared or published.
    pub fn mode(&self) -> Option<MeshMode> {
        self.shared.mode.lock().unwrap().as_ref().map(|(m, _)| *m)
    }

    /// UA-P-0a — the account this node's surfaces are scoped to, once captured.
    /// UA-P-4 made it a trust input as well as a record: it is the node's own
    /// `login_allow` (the DOOR still compares against fieldd's `link.json` —
    /// two independent readings of one link, which is the point).
    pub fn login(&self) -> Option<String> {
        self.shared
            .mode
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|(_, login)| login.clone())
    }

    /// UA-P-4 (RFC 025 §3.6) — the allow-list the INSTALLED node was built
    /// with. `[]` is RFC 025's "no gate" and is the honest answer for a capture
    /// node, for the development override, and for no node at all. Never
    /// derived from the posture: see `Shared::login_allow`.
    pub fn login_allow(&self) -> Vec<String> {
        self.shared.login_allow.lock().unwrap().clone()
    }

    /// UA-P-0a (D1) — bring the node up in `mode`, or move a running node to it.
    ///
    /// Idempotent per posture: asking for the mode a live node is already in
    /// answers `started: false` and touches nothing.
    ///
    /// CORRECTED BY UA-P-4 (2026-09-16). This doc used to say the ordinary
    /// capture → linked promotion "costs no restart, because the node is the
    /// same node and only the account it is scoped to became known", and the
    /// code returned early on any posture change to a live node. That was true
    /// while the login was only a RECORD. Since RFC 025 the login is the node's
    /// `login_allow`, which §3.1 fixes for the node's lifetime — so relabelling
    /// a live capture node "linked" would leave an UNGATED node serving an
    /// account's surfaces, which is exactly what D2 forbids. The promotion
    /// rebuilds: same state dir, same tailnet identity, same keys (so no second
    /// interactive login), new node with the gate compiled in.
    ///
    /// The decision is made against `login_allow()` — what the live node was
    /// BUILT with — and not against the posture, so an in-flight bring-up that
    /// has not installed its node yet cannot be mistaken for a gated one.
    ///
    /// Clearing `retired` here is the deliberate inverse of UA-3's guard: that
    /// flag exists so a login completing AFTER an unlink cannot resurrect an
    /// archived identity, and a fresh `start` is exactly the act that says the
    /// user wants an identity again.
    pub async fn start(&self, mode: MeshMode, login: Option<String>) -> anyhow::Result<bool> {
        self.start_with(mode, login, StartOptions::default()).await
    }

    /// TS-1 — [`Self::start`], with what a person's act may add to it: an auth
    /// key that signs a capture in with no browser (P7), or a renewal that
    /// rebuilds a signed-out linked node so its build hands out a new sign-in
    /// address. The mgmt facade refuses either one in the other mode.
    pub async fn start_with(
        &self,
        mode: MeshMode,
        login: Option<String>,
        options: StartOptions,
    ) -> anyhow::Result<bool> {
        let already = {
            let current = self.shared.mode.lock().unwrap();
            current.as_ref().map(|(m, _)| *m)
        };
        let desired_allow = desired_login_allow(mode, login.as_deref());
        *self.shared.mode.lock().unwrap() = Some((mode, login));
        let node_present = self.shared.node.borrow().is_some();
        // TS-1 — a renewal is the one ask that rebuilds a node whose gate did
        // not move: the node was signed out, and only a new bring-up's
        // interactive login hands out an address (the identity and the keys
        // survive it, as Tailscale's own re-auth keeps the node and its IP).
        let renewing = options.renew && node_present;
        // TS-D15/D16 — the log upload is part of the node's construction, as the
        // gate is: a node built with the other setting is rebuilt.
        let same_build = self.login_allow() == desired_allow
            && self.client_log_upload() == options.client_log_upload;
        // (An auth key needs no rule of its own: with no node installed every
        // `start` builds, and a node already up has nothing left to sign in.)
        if !renewing {
            if already == Some(mode) && node_present && same_build {
                return Ok(false);
            }
            if node_present && same_build {
                // a live node whose GATE does not move: the tailnet identity did
                // not move either, and nothing about the node's construction
                // changed — only what we call the posture.
                return Ok(true);
            }
        }
        // UA-P-4 — the gate moved (or there is no node yet, or TS-1's renewal
        // or key asked for a new bring-up), so BUILD. The teardown is
        // unconditional: it STOPS a live node (which ends its sidecar) before
        // the new one binds the state dir, AND it aborts an in-flight bring-up
        // that would otherwise install a node the new posture never asked for.
        // On a first start it is a no-op.
        self.teardown_node(if renewing { "renewed" } else { "gate_changed" })
            .await;
        self.shared
            .retired
            .store(false, std::sync::atomic::Ordering::SeqCst);
        spawn_bring_up(&self.shared, options.auth_key, options.client_log_upload)?;
        Ok(true)
    }

    /// TS-1 — the sign-in facts, as `native.mesh.self` and its answer while
    /// there is no node report them.
    pub fn link_facts(&self) -> LinkFacts {
        self.shared.facts.lock().unwrap().clone()
    }

    /// TS-D15/D16 — whether the current bring-up's node sends Tailscale its
    /// client logs: the BUILT value, `false` with no node.
    pub fn client_log_upload(&self) -> bool {
        self.shared.client_log_upload.load(Ordering::SeqCst)
    }

    /// UA-P-4 — drop the installed node and everything bound to it, WITHOUT
    /// touching the posture or the health state. Shared by `stop` (which then
    /// says offline) and by the gate-change rebuild in `start` (which then
    /// builds again immediately). Factored out so the two paths cannot drift on
    /// what "the node is gone" means — a store handle or serve record surviving
    /// a rebuild would be bound to a dead node.
    ///
    /// `reason` names the act for `field_native.mesh.node_replaced`:
    /// `gate_changed` (the promotion's rebuild), `renewed` (TS-1's sign-in
    /// again), `sidecar_exited` (TS-1: the node died under us), `stopped`,
    /// `retired`.
    async fn teardown_node(&self, reason: &'static str) {
        if let Some(t) = self.shared.task.lock().unwrap().take() {
            t.abort(); // in-flight bring-up: the sidecar child is kill_on_drop
        }
        // TS-1 — the generation moves on, so the old bring-up's status hook
        // falls silent before anything else happens to the unit.
        self.shared.generation.fetch_add(1, Ordering::SeqCst);
        let had = self.shared.node.send_replace(None);
        self.shared.stores.lock().await.clear();
        self.shared.serves.lock().await.clear();
        *self.shared.login_allow.lock().unwrap() = Vec::new();
        self.shared.client_log_upload.store(false, Ordering::SeqCst);
        // DS-1 — egress routes are listeners the SIDECAR bound for this node,
        // so they die with it; the table is rebuilt-not-persisted like the
        // serves above. Pushed only when something was dropped: an empty
        // table resetting to empty tells no reader anything.
        if self.egress().reset().await > 0 {
            self.note_egress_changed();
        }
        // Item 79 (2026-10-27) — STOP the node, then drop it. This line used to
        // read `drop(had); // node drop kills the sidecar (kill_on_drop)`, and
        // that was false: truffle's `Node::drop` only cancels the node-scoped
        // tasks; the session's loops and the provider that owns the sidecar end
        // in `Node::stop()` (truffle-core node.rs `impl Drop` and `stop`, the
        // same in 0.7.22 and 0.7.23). So every teardown left the sidecar
        // running: after a promotion beside its replacement on the same state
        // dir (the W11 mini, 04:19Z), and after a stop or a retire for the rest
        // of the process's life (the item-79 probe: an explicit `stop()` ends
        // it, `mesh.stop()` did not). `stop()` is bounded (truffle's grace, then
        // a kill), so a teardown cannot hang on it.
        if let Some(node) = had {
            let sidecar_pid = node.sidecar_pid();
            node.stop().await;
            let sidecar_exited = node.sidecar_pid().is_none();
            tracing::info!(
                event = "field_native.mesh.node_replaced",
                component = "mesh",
                reason,
                sidecar_pid = ?sidecar_pid,
                sidecar_exited,
                "The mesh node was taken down"
            );
        }
    }

    /// UA-P-0a — drop the node WITHOUT touching the identity on disk.
    ///
    /// This is not unlink. `retire` archives the state dir, so relinking mints
    /// a fresh tailnet identity peers see as a new device; `stop` is the
    /// posture going offline with the identity intact — a capture that never
    /// learned a login, or a login another local user already holds (UA-P-0b),
    /// both of which the user may resolve and retry.
    pub async fn stop(&self) -> bool {
        let was_up = self.shared.node.borrow().is_some();
        self.teardown_node("stopped").await;
        *self.shared.mode.lock().unwrap() = None;
        self.forget_facts();
        self.shared
            .set(UnitState::Disabled, Some(OFFLINE.into()), None);
        was_up
    }

    /// TS-1 — no node, so none of its sign-in facts stand. The machine's name
    /// does: the next bring-up composes the same one.
    fn forget_facts(&self) {
        let mut facts = self.shared.facts.lock().unwrap();
        *facts = LinkFacts {
            machine_name: facts.machine_name.take(),
            ..LinkFacts::default()
        };
    }

    /// UA-3 unlink, native half: stop the node (its sidecar ends with the stop,
    /// before the caller archives the state dir it held — item 79: a drop alone
    /// left it running on the archived identity), clear the facade's node-bound
    /// state, mark the unit retired so a
    /// mid-flight bring-up cannot resurrect the identity, and hand back the
    /// state dir to archive — Some only when there is state on disk. The
    /// caller (the mgmt handler) owns the rename; this owns the lifecycle.
    ///
    /// TS-D14 — and first, sign the device out of its tailnet, so the admin
    /// console stops counting it as signed in.
    pub async fn retire(&self) -> Retired {
        self.shared
            .retired
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // UA-P-0a: an in-flight bring-up dies with the identity — `retired` is
        // set FIRST so a build that completes in the same beat discards itself.
        //
        // TS-D14 — the logout comes before the teardown, on the node that is
        // up. truffle bounds it (`LOGOUT_TIMEOUT`, 12 s, which contains the
        // sidecar's own 10 s) and stops the node whatever the control server
        // said; only a sidecar before protocol 11 leaves it running
        // (`Unsupported`), and the teardown below stops it then. A node still
        // signing in has nothing to sign out.
        let node = self.shared.node.borrow().clone();
        let signed_out = match node {
            Some(node) => match node.logout().await {
                Ok(()) => true,
                Err(e) => {
                    tracing::warn!(
                        event = "field_native.mesh.logout_failed",
                        component = "mesh",
                        error = %e,
                        "The node was not signed out of its tailnet; the admin console keeps it"
                    );
                    false
                }
            },
            None => false,
        };
        self.teardown_node("retired").await;
        *self.shared.mode.lock().unwrap() = None;
        self.forget_facts();
        self.shared.set(
            UnitState::Disabled,
            Some("retired — relink to mint a new tailnet identity".into()),
            None,
        );
        let dir = self.shared.state_dir.clone();
        Retired {
            state_dir: dir.exists().then_some(dir),
            signed_out,
        }
    }
}

/// UA-3 / TS-D14 — what [`MeshHandle::retire`] did: the state dir to archive
/// (`None` when there is no state on disk), and whether the device was signed
/// out of its tailnet first.
#[derive(Debug)]
pub struct Retired {
    pub state_dir: Option<PathBuf>,
    pub signed_out: bool,
}

impl Shared {
    fn set(&self, state: UnitState, detail: Option<String>, auth_url: Option<String>) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: "mesh-gateway".into(),
            state,
            detail,
            auth_url,
        };
        let _ = self.ping.send(());
    }
}

/// UA-P-0a — the honest word for "no node, and that is the correct state".
/// An unlinked desktop is a default LOCAL account, not a broken one.
const OFFLINE: &str = "offline — no tailscale link (linking starts the node)";

pub struct MeshUnit {
    /// UA-P-0a — the FORCED-ON DEVELOPMENT OVERRIDE (`FIELD_NATIVE_MESH=1`),
    /// not the product's switch: the probes and the kill matrix drive this
    /// floor with no fieldd to ask it for a posture. Off, the node waits for
    /// `native.mesh.start`.
    forced: bool,
    shared: Arc<Shared>,
}

impl MeshUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>) -> Self {
        let mut searched = Vec::new();
        let sidecar = resolve_sidecar(config.sidecar_override.clone(), &mut searched);
        Self {
            forced: config.mesh_enabled,
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: "mesh-gateway".into(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                node: watch::channel(None).0,
                node_presence_forced: watch::channel(false).0,
                egress: Mutex::new(mesh_egress::default_backend()),
                egress_changes: watch::channel(0).0,
                ping,
                stores: tokio::sync::Mutex::new(HashMap::new()),
                serves: tokio::sync::Mutex::new(HashMap::new()),
                state_dir: config.mesh_state_dir(),
                sidecar,
                searched,
                mode: Mutex::new(None),
                login_allow: Mutex::new(Vec::new()),
                task: Mutex::new(None),
                retired: std::sync::atomic::AtomicBool::new(false),
                facts: Mutex::new(LinkFacts::default()),
                generation: AtomicU64::new(0),
                start_timeout: config.mesh_start_timeout,
                probe: config.mesh_probe.clone(),
                client_log_upload: AtomicBool::new(false),
            }),
        }
    }

    /// The mgmt server's door to the mesh (C2 facade).
    pub fn handle(&self) -> MeshHandle {
        MeshHandle {
            shared: self.shared.clone(),
        }
    }

    /// The live node, once up (C2 facade calls go through this).
    pub fn node(&self) -> Option<Arc<MeshNode>> {
        self.shared.node.borrow().clone()
    }
}

#[async_trait::async_trait]
impl NativeService for MeshUnit {
    fn id(&self) -> &'static str {
        "mesh-gateway"
    }

    async fn start(&self) -> anyhow::Result<()> {
        // DS-1 — which egress substrate this floor answers from, once per boot,
        // so a log reader can tell "no egress" from "egress failed".
        tracing::info!(
            event = "field_native.mesh.egress.backend",
            component = "mesh",
            arm = self.handle().egress().arm(),
            "egress backend selected"
        );
        // UA-P-0a (D1) — boot no longer brings a node up. The posture derives
        // from fieldd's link, and fieldd asks for it over the mgmt channel; the
        // floor's own default is OFFLINE, which is the honest state of an
        // unlinked desktop rather than a degradation. The one exception is the
        // forced-on development override, which starts `linked` with no login
        // so the probes and the kill matrix keep working without a fieldd.
        if !self.forced {
            self.shared
                .set(UnitState::Disabled, Some(OFFLINE.into()), None);
            return Ok(());
        }
        self.handle().start(MeshMode::Linked, None).await?;
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    async fn stop(&self) -> anyhow::Result<()> {
        // UA-P-0a — one teardown, shared with the posture verb: abort any
        // in-flight bring-up, stop the node (which ends its sidecar; a drop
        // alone did not — item 79), clear the facade state, and say offline.
        self.handle().stop().await;
        Ok(())
    }
}

/// UA-P-0a — THE bring-up, called from exactly two places: the forced-on
/// development override at boot, and `MeshHandle::start` when fieldd asks
/// because a user linked. Everything about the node's construction is here, so
/// a posture that reaches a node and a flag that reaches one cannot drift.
///
/// Returns `Err` only for a state dir that cannot be created — a MISSING
/// SIDECAR is degraded, not fatal (the daemon keeps serving every other unit),
/// and a bring-up that fails later reports itself through the health shape.
///
/// UA-P-4 — and it is the ONE place `login_allow` is decided and recorded, for
/// the same reason the rest of the construction lives here: a gate applied
/// somewhere else could drift from the posture that asked for it.
///
/// TS-1 (track TS) — and the one place a bring-up's sign-in is shaped: no
/// timer (`start_timeout`, P3 — the person ends a capture, never a clock), the
/// status hook that keeps [`LinkFacts`], and the auth key a capture may sign in
/// with (P7), which lives in this task alone and dies with it.
fn spawn_bring_up(
    shared: &Arc<Shared>,
    auth_key: Option<AuthKey>,
    client_log_upload: bool,
) -> anyhow::Result<()> {
    // TS-1 — this bring-up's generation. Everything it starts (the status
    // hook) carries it, and acts only while it is current.
    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    // TS-1 — a new bring-up starts from no facts but its name: the one truffle
    // composes from the same app id and this machine's hostname, so the pane
    // can say "Tailscale will ask to connect <name>" before the node is up.
    *shared.facts.lock().unwrap() = LinkFacts {
        machine_name: composed_machine_name(shared.probe.as_ref()),
        ..LinkFacts::default()
    };
    // UA-P-4 — the gate, recorded FIRST: before the sidecar check, before the
    // state dir, before the spawn. It is the gate THIS bring-up is for, so a
    // desktop that is linked but has no sidecar reads as "meant to be gated
    // with no node" rather than as "ungated" — the fail-closed reading of a
    // desktop whose node did not come up. (`node_present()` is the separate
    // question, and `native.mesh.self` only answers when a node exists.)
    let login_allow = {
        let mode = shared.mode.lock().unwrap();
        match mode.as_ref() {
            Some((m, login)) => desired_login_allow(*m, login.as_deref()),
            None => Vec::new(),
        }
    };
    *shared.login_allow.lock().unwrap() = login_allow.clone();
    // TS-D15/D16 — the log upload this bring-up is for, recorded beside the gate
    shared
        .client_log_upload
        .store(client_log_upload, Ordering::SeqCst);
    let Some(sidecar) = shared.sidecar.clone() else {
        shared.facts.lock().unwrap().failure = Some(FAILURE_SIDECAR_MISSING);
        shared.set(
            UnitState::Degraded,
            Some(format!(
                "tailscale sidecar not found (searched: {}); set FIELD_NATIVE_SIDECAR_PATH",
                shared.searched.join(", ")
            )),
            None,
        );
        return Ok(());
    };
    std::fs::create_dir_all(&shared.state_dir)?;
    // UA-P-0d (D7) — 0700 the moment the directory exists, and BEFORE truffle
    // is handed it: the synced-store FileBackend writes slices in here with an
    // ordinary create, and the run dir's own chmod (lib.rs) never covered this
    // tree. A same-uid reader is still the adversary EL7 names — this is the
    // OS-level floor under that, not a substitute for keeping secrets out.
    harden_state_dir(&shared.state_dir);
    shared.set(
        UnitState::Starting,
        Some("bringing up tailnet node".into()),
        None,
    );

    let state_dir = shared.state_dir.to_string_lossy().into_owned();
    let task_shared = shared.clone();
    // TS-1 — the hook lives as long as the node it reports on, so it holds the
    // unit weakly: the node is on Shared, and a strong hold would be a cycle.
    let hook_shared = Arc::downgrade(shared);
    let start_timeout = shared.start_timeout;
    let probe = shared.probe.clone();
    let handle = tokio::spawn(async move {
        let shared = task_shared;
        let auth_shared = shared.clone();
        let built = async {
            let app_id = probe.as_ref().map_or(APP_ID, |p| p.app_id.as_str());
            let mut builder = Node::<TailscaleProvider>::builder()
                .app_id(app_id)
                .map_err(|e| anyhow::anyhow!("app_id: {e}"))?
                .sidecar_path(&sidecar)
                .state_dir(&state_dir)
                // RFC 025 §3.1/§3.3/§3.4 — ONE exact login, never a widened
                // glob: `login_allowed` lowercases both sides and matches the
                // whole string, so an account's own login is the pattern and
                // `*@domain` would be a different (wider) ruling than D2's.
                // An EMPTY list is truffle's "no gate" and is what capture mode
                // and the development override pass.
                .login_allow(login_allow.clone())
                // TS-1 (P3) — the product waits for ever: a person creating a
                // Tailscale account outlasted truffle's five-minute default
                // into a dead end (gap 12). Every new address tsnet issues
                // while it waits reaches the auth handler below.
                .start_timeout(start_timeout)
                // TS-D15 — the embedded node sends Tailscale no client logs
                // unless the person opted in on a network that requires them
                // (TS-D16). With false, truffle refuses a sidecar before
                // protocol 11 before anything starts, since an older one would
                // upload the logs it was asked not to.
                .client_log_upload(client_log_upload)
                .on_network_status(move |event| {
                    if let Some(shared) = hook_shared.upgrade() {
                        note_network_status(&shared, generation, event);
                    }
                });
            if let Some(probe) = probe.as_ref() {
                // TS-1 TEST SEAM — a live probe's node: its own name, and
                // ephemeral, so the tailnet removes it once it goes away.
                builder = builder
                    .device_name(probe.device_name.clone())
                    .ephemeral(true);
            }
            if let Some(key) = auth_key.as_ref() {
                // TS-1 (P7) — truffle passes it to its sidecar's start command
                // and redacts it in its own Debug; nothing here logs it.
                builder = builder.auth_key(key.expose());
            }
            builder
                .build_with_auth_handler(move |url| {
                    tracing::info!(
                        event = "field_native.mesh.authentication_required",
                        component = "mesh",
                        auth_url_present = true,
                        "Mesh authentication is required"
                    );
                    auth_shared.set(
                        UnitState::Starting,
                        Some("tailnet login required".into()),
                        Some(url),
                    );
                })
                .await
                .map_err(|e| anyhow::anyhow!("node build: {e}"))
        }
        .await;
        // TS-1 — the key's one use is over, whatever the outcome.
        drop(auth_key);
        match built {
            Ok(node) => {
                if shared.generation.load(Ordering::SeqCst) != generation {
                    // TS-1 — a newer bring-up superseded this one while its
                    // build was finishing (the rebuild's abort lands at the
                    // next await, and a build can complete in the same beat).
                    // Never install a node a newer ask did not build.
                    node.stop().await;
                    tracing::info!(
                        event = "field_native.mesh.bring_up_discarded",
                        component = "mesh",
                        "Mesh bring-up completed after a newer one began; node discarded"
                    );
                    return;
                }
                if shared.retired.load(std::sync::atomic::Ordering::SeqCst) {
                    // UA-3: retired mid-bring-up — never resurrect an identity
                    // the user just archived; STOPPING the node ends its sidecar
                    // (a drop alone does not — item 79) and the retired face
                    // stands.
                    node.stop().await;
                    tracing::info!(
                        event = "field_native.mesh.bring_up_discarded",
                        component = "mesh",
                        "Mesh bring-up completed after retire; node discarded"
                    );
                    return;
                }
                if shared.mode.lock().unwrap().is_none() {
                    // UA-P-0a: STOPPED mid-bring-up. The abort usually wins the
                    // race, but a build that completed in the same beat must not
                    // install a node the posture no longer asks for — an
                    // unlinked desktop is offline, and a node nobody asked for
                    // would publish its presence on somebody's tailnet. Stopped,
                    // not dropped: a dropped node's sidecar runs on (item 79).
                    node.stop().await;
                    tracing::info!(
                        event = "field_native.mesh.bring_up_discarded",
                        component = "mesh",
                        "Mesh bring-up completed after stop; node discarded"
                    );
                    return;
                }
                let node = Arc::new(node);
                let info = node.local_info();
                let name = info
                    .dns_name
                    .clone()
                    .unwrap_or_else(|| info.tailscale_hostname.clone());
                // TS-1 — the node is up, so approved; and its facts are now the
                // node's own answers: the name Tailscale granted (a collision
                // adds `-1`), the console, and the key's expiry, read here as
                // well as heard, since a status event can race the install.
                let held = {
                    let mut facts = shared.facts.lock().unwrap();
                    facts.needs_approval = false;
                    facts.needs_login = false;
                    facts.failure = None;
                    if !info.tailscale_hostname.is_empty() {
                        facts.machine_name = Some(info.tailscale_hostname.clone());
                    }
                    if let Some(server) = node.control_server() {
                        facts.admin_url = server.machines_admin_url().map(str::to_owned);
                    }
                    if let Some(expiry) = node.key_expiry() {
                        facts.key_expiry_ms = Some(expiry.unix_millis());
                    }
                    // T11 — the embedded client, and Tailnet Lock's hold, read
                    // here as well as heard (`NeedsSignature` arrives before
                    // `start()` returns, and can race this install)
                    if let Some(version) = node.tailscale_version() {
                        facts.tailscale_version = Some(version.version);
                    }
                    if let Some(locked_out) = node.needs_signature() {
                        facts.needs_signature = locked_out;
                    }
                    facts.needs_signature
                };
                // UA-P-0d — truffle creates `synced_store/` under the state dir
                // on its own schedule; re-harden now that the tree exists.
                harden_state_dir(&shared.state_dir);
                // TS-1 — a node a racing bring-up installed is stopped, never
                // dropped with its sidecar running (item 79's class).
                if let Some(stale) = shared.node.send_replace(Some(node.clone())) {
                    stale.stop().await;
                }
                shared.set(UnitState::Up, Some(up_words(&name, held)), None);
                tracing::info!(
                    event = "field_native.mesh.node_ready",
                    component = "mesh",
                    node_name = %name,
                    "The mesh node is ready"
                );
            }
            Err(e) => {
                // TS-D16 — a tailnet that requires client logs refuses an
                // opted-out node at its start. truffle raises `LoggingRequired`
                // just before the start fails, but aborts the status forwarder
                // with the failed build (truffle-core 0.7.24 node.rs, the
                // `status_task.abort()` after `provider.start()`), so the hook
                // can miss it: the refusal is read from the start error as
                // well. Anything else the hook named during this bring-up
                // stays named: the facts were reset when it began.
                let refused_for_logs = e.to_string().contains(LOGGING_REQUIRED_REFUSAL);
                {
                    let mut facts = shared.facts.lock().unwrap();
                    if refused_for_logs {
                        facts.failure = Some(FAILURE_LOGGING_REQUIRED);
                    } else if facts.failure.is_none() {
                        facts.failure = Some(FAILURE_BRING_UP);
                    }
                }
                // UA-P-4 — truffle's reason rides through VERBATIM, and the one
                // that matters most here is RFC 025 D3's: a GATED node refuses
                // to start against a sidecar below protocol 5 ("login_allow
                // requires sidecar protocol 5 (loginName on peers); this
                // sidecar speaks N"), because below 5 no row carries a login,
                // the gate would fail closed on every peer, and the node would
                // sit silently peerless. Degraded with that sentence is the
                // honest face of it — never a blank, and never a quiet
                // downgrade to an ungated node (the tolerant-reader law:
                // degraded states surface, they do not get papered over).
                tracing::error!(
                    event = "field_native.mesh.bring_up_failed",
                    component = "mesh",
                    error = %e,
                    "Mesh bring-up failed"
                );
                shared.set(
                    UnitState::Degraded,
                    Some(format!("bring-up failed: {e}")),
                    None,
                );
            }
        }
    });
    *shared.task.lock().unwrap() = Some(handle);
    Ok(())
}

/// TS-1 — the bring-up's status hook (`NodeBuilder::on_network_status`), from
/// the moment the build starts until the node is gone. It keeps [`LinkFacts`]
/// and, where a person must see the change, moves the unit's words, which is
/// what puts it on the health stream fieldd listens to (P2). A hook of a
/// bring-up that is no longer current does nothing.
fn note_network_status(shared: &Arc<Shared>, generation: u64, event: NetworkStatusEvent) {
    if shared.generation.load(Ordering::SeqCst) != generation {
        return;
    }
    match event {
        NetworkStatusEvent::NeedsApproval => {
            shared.facts.lock().unwrap().needs_approval = true;
            tracing::info!(
                event = "field_native.mesh.needs_approval",
                component = "mesh",
                "The tailnet's device approval holds this node"
            );
            // still starting: the sign-in is done and the address spent, so
            // the words say who acts now
            shared.set(
                UnitState::Starting,
                Some("waiting for device approval".into()),
                None,
            );
        }
        NetworkStatusEvent::ControlServerKnown { control_server } => {
            // it arrives before the address or the approval it serves, so the
            // health change that follows carries it to fieldd
            shared.facts.lock().unwrap().admin_url =
                control_server.machines_admin_url().map(str::to_owned);
        }
        NetworkStatusEvent::KeyExpiryKnown { key_expiry } => {
            // no words move: fieldd reads it with the node, at the next probe
            shared.facts.lock().unwrap().key_expiry_ms = Some(key_expiry.unix_millis());
        }
        NetworkStatusEvent::SidecarExited { exit_code } => {
            tracing::warn!(
                event = "field_native.mesh.sidecar_exited",
                component = "mesh",
                exit_code = ?exit_code,
                "The mesh node's sidecar exited on its own"
            );
            // While the build waits it fails on its own and says so; a node
            // that was UP must not be read as up any longer, so it goes.
            if shared.node.borrow().is_none() {
                return;
            }
            shared.facts.lock().unwrap().failure = Some(FAILURE_SIDECAR_EXITED);
            let handle = MeshHandle {
                shared: shared.clone(),
            };
            tokio::spawn(async move {
                if handle.shared.generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                handle.teardown_node("sidecar_exited").await;
                let code = exit_code.map_or_else(|| "a signal".to_owned(), |c| format!("code {c}"));
                handle.shared.set(
                    UnitState::Degraded,
                    Some(format!(
                        "the tailnet sidecar exited ({code}); the node is down until it is started again"
                    )),
                    None,
                );
            });
        }
        // TS-D16 — the tailnet requires client logs (its flow logs are on) and
        // this node sends none. While the build waits, its start fails next,
        // and the failure branch keeps this word. A node that was UP has been
        // stopped by Tailscale, so it goes as a node whose sidecar exited does,
        // and stays down until it is built again: with uploads allowed, or
        // after the tailnet's flow logs are off.
        NetworkStatusEvent::LoggingRequired => {
            tracing::warn!(
                event = "field_native.mesh.logging_required",
                component = "mesh",
                "The tailnet requires client logs, and this node sends none"
            );
            shared.facts.lock().unwrap().failure = Some(FAILURE_LOGGING_REQUIRED);
            if shared.node.borrow().is_none() {
                return;
            }
            let handle = MeshHandle {
                shared: shared.clone(),
            };
            tokio::spawn(async move {
                if handle.shared.generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                handle.teardown_node("logging_required").await;
                handle.shared.set(
                    UnitState::Degraded,
                    Some(
                        "the tailnet requires client logs and this node sends none; it is down until it is built again"
                            .into(),
                    ),
                    None,
                );
            });
        }
        // T11 — Tailnet Lock: the node runs, but reaches no peer and no peer
        // reaches it until a signing device signs it. Heard before `start()`
        // returns when the node starts unsigned (the install reads it too), and
        // whenever it becomes unsigned later; `Signed` follows. The words move
        // while a node is up, so fieldd reads it again (P2).
        NetworkStatusEvent::NeedsSignature => {
            shared.facts.lock().unwrap().needs_signature = true;
            tracing::info!(
                event = "field_native.mesh.needs_signature",
                component = "mesh",
                "Tailnet Lock holds this node until a signing device signs it"
            );
            let node = shared.node.borrow().clone();
            if let Some(node) = node {
                shared.set(UnitState::Up, Some(up_words(&node_name(&node), true)), None);
            }
        }
        NetworkStatusEvent::Signed => {
            shared.facts.lock().unwrap().needs_signature = false;
            tracing::info!(
                event = "field_native.mesh.signed",
                component = "mesh",
                "Tailnet Lock signed this node"
            );
            let node = shared.node.borrow().clone();
            if let Some(node) = node {
                shared.set(
                    UnitState::Up,
                    Some(up_words(&node_name(&node), false)),
                    None,
                );
            }
        }
        // T10 — the installed node's backend moved. NeedsLogin is the one a
        // person acts on: its key expired, or it was removed or logged out in
        // the console, and nothing reaches it until a new sign-in (`renew`).
        // truffle delivers it for every sidecar, within about a second at
        // protocol 11 and at an older sidecar's once-a-minute check, so the
        // floor's own 15 s tick of TS-1 retired with the pin (exact 0.7.24).
        // Running again — the same node signed back in — puts it back up.
        NetworkStatusEvent::BackendStateChanged { state } => {
            let node = shared.node.borrow().clone();
            let Some(node) = node else {
                return;
            };
            let needs_login = matches!(state, BackendState::NeedsLogin);
            let back = matches!(state, BackendState::Running);
            let changed = {
                let mut facts = shared.facts.lock().unwrap();
                let was = facts.needs_login;
                if needs_login {
                    facts.needs_login = true;
                } else if back {
                    facts.needs_login = false;
                }
                facts.needs_login != was
            };
            if !changed {
                return;
            }
            if needs_login {
                tracing::warn!(
                    event = "field_native.mesh.needs_login",
                    component = "mesh",
                    "The mesh node was signed out of the tailnet (its key expired, or it was removed)"
                );
                shared.set(
                    UnitState::Degraded,
                    Some("signed out of the tailnet: sign in again".into()),
                    None,
                );
            } else {
                let held = shared.facts.lock().unwrap().needs_signature;
                shared.set(UnitState::Up, Some(up_words(&node_name(&node), held)), None);
            }
        }
        // LoginKnown: fieldd reads the login from `native.mesh.self`.
        _ => {}
    }
}

/// The name a unit's words give its node: its MagicDNS name, or the hostname
/// Tailscale granted.
fn node_name(node: &MeshNode) -> String {
    let info = node.local_info();
    info.dns_name.unwrap_or(info.tailscale_hostname)
}

/// T11 — an UP unit's words: its node's name, and Tailnet Lock's hold while it
/// holds the node, so the words say why no peer answers. A node that starts
/// unsigned hears the hold before its install, so the install chooses too.
fn up_words(name: &str, held: bool) -> String {
    if held {
        format!("tailnet {name}: locked until a signing device signs it")
    } else {
        format!("tailnet {name}")
    }
}

/// TS-1 — the name truffle will give this node before it has one: its own
/// composition (`truffle-{app}-{slug}`, RFC 017) of the same app id and the
/// hostname truffle itself falls back to. `None` when the hostname cannot be
/// read; the pane then names no machine rather than a wrong one.
fn composed_machine_name(probe: Option<&MeshProbeIdentity>) -> Option<String> {
    let (app, host) = match probe {
        Some(probe) => (probe.app_id.clone(), probe.device_name.clone()),
        None => (
            APP_ID.to_owned(),
            hostname::get().ok()?.to_string_lossy().into_owned(),
        ),
    };
    let app = truffle_core::AppId::parse(&app).ok()?;
    Some(truffle_core::tailscale_hostname(
        &app,
        &truffle_core::DeviceName::parse(host),
    ))
}

/// UA-P-4 (D2, RFC 025 §3.1) — the login allow-list a posture asks for.
///
/// `linked` with a captured login is the ONE gated case, and its list is that
/// one login exactly. Everything else is `[]` — truffle's "no gate" — and each
/// for its own honest reason:
///
///  - `capture`: the tailnet has not answered who this node is yet. A gate
///    needs a login and there is none; the CAPTURE BELT (the mgmt facade's
///    refusal of `serve.add` and `store.set`) is what keeps the window safe,
///    not a gate that would have to be invented from a claim.
///  - `linked` with no login: only the `FIELD_NATIVE_MESH` development
///    override reaches this, and the probes it exists for need the whole test
///    tailnet. The product cannot: `native.mesh.start` refuses linked without a
///    login (`mgmt/mesh.rs`), which is why this arm is a dev-only state and not
///    a fail-open hole.
fn desired_login_allow(mode: MeshMode, login: Option<&str>) -> Vec<String> {
    match (mode, login) {
        (MeshMode::Linked, Some(login)) if !login.is_empty() => vec![login.to_owned()],
        _ => Vec::new(),
    }
}

/// UA-P-0d (D7) — the mesh state dir is 0700, and so is every directory
/// truffle creates beneath it. Best-effort by design: a permission failure is
/// logged, never fatal — the daemon losing its tailnet because a mode could
/// not be set would be a worse outcome than the mode not being set.
///
/// A no-op on Windows, where the tree inherits the user profile's ACL and
/// there is no mode bit to set.
fn harden_state_dir(dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut stack = vec![dir.to_path_buf()];
        while let Some(path) = stack.pop() {
            if let Err(e) = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            {
                tracing::warn!(
                    event = "field_native.mesh.state_dir_mode_failed",
                    component = "mesh",
                    error = %e,
                    "The mesh state directory could not be restricted to this user"
                );
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&path) else {
                continue;
            };
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    stack.push(entry.path());
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// truffle-sidecar's runtime search order, minus the build-time downloader.
/// An explicit override is AUTHORITATIVE: no silent fallback when it's wrong —
/// that would mask config errors with whatever install happens to be lying around.
fn resolve_sidecar(override_path: Option<PathBuf>, searched: &mut Vec<String>) -> Option<PathBuf> {
    if let Some(p) = override_path {
        searched.push(p.display().to_string());
        return p.is_file().then_some(p);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in SIDECAR_NAMES {
                candidates.push(dir.join(name));
            }
        }
    }
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        // truffle's own Windows install dir — the fallback to the exe-adjacent primary.
        for name in SIDECAR_NAMES {
            candidates.push(local.join("truffle").join("bin").join(name));
        }
    }
    #[cfg(unix)]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        #[cfg(target_os = "macos")]
        for name in SIDECAR_NAMES {
            candidates.push(
                home.join("Library/Application Support/truffle/bin")
                    .join(name),
            );
        }
        for name in SIDECAR_NAMES {
            candidates.push(home.join(".config/truffle/bin").join(name));
        }
    }
    #[cfg(unix)]
    for name in SIDECAR_NAMES {
        candidates.push(PathBuf::from("/usr/local/bin").join(name));
    }
    for c in candidates {
        searched.push(c.display().to_string());
        if c.is_file() {
            return Some(c);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::sync::mpsc;

    type MgmtReader =
        tokio::io::Lines<BufReader<tokio::io::ReadHalf<crate::local_ipc::ClientStream>>>;
    type MgmtWriter = tokio::io::WriteHalf<crate::local_ipc::ClientStream>;

    async fn mgmt_send(writer: &mut MgmtWriter, id: u64, method: &str, params: Value) {
        let line = format!(
            "{}\n",
            json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params})
        );
        writer.write_all(line.as_bytes()).await.unwrap();
    }

    /// The next line that is not the floor's liveness tick (WG-D6: pushed to
    /// an authenticated connection every second, and no part of these rows).
    async fn mgmt_next_line(reader: &mut MgmtReader) -> std::io::Result<Option<String>> {
        loop {
            let Some(line) = reader.next_line().await? else {
                return Ok(None);
            };
            let tick = serde_json::from_str::<Value>(&line)
                .is_ok_and(|value| value["method"] == "native.lifecycle.tick");
            if !tick {
                return Ok(Some(line));
            }
        }
    }

    async fn mgmt_recv(reader: &mut MgmtReader) -> Value {
        let line = tokio::time::timeout(std::time::Duration::from_secs(5), mgmt_next_line(reader))
            .await
            .expect("management reply deadline")
            .unwrap()
            .expect("management connection closed");
        serde_json::from_str(&line).unwrap()
    }

    async fn mgmt_client(daemon: &crate::RunningDaemon) -> (MgmtReader, MgmtWriter) {
        let stream = crate::local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .unwrap();
        let (read, mut write) = tokio::io::split(stream);
        let mut read = BufReader::new(read).lines();
        let secret = hex::decode(
            std::fs::read_to_string(&daemon.pairing_file)
                .unwrap()
                .trim(),
        )
        .unwrap();
        let ts = crate::pairing::now_epoch_secs();
        let boot = "phase0-mesh-control-test";
        let mac = crate::pairing::compute_mac(&secret, boot, ts);
        mgmt_send(
            &mut write,
            1,
            "native.lifecycle.hello",
            json!({
                "contractsVersion":"0.1.0", "minCompatible":"0.1.0", "clientKind":"fieldd",
                "credential":{"bootId":boot, "ts":ts, "mac":mac}
            }),
        )
        .await;
        assert!(mgmt_recv(&mut read).await.get("result").is_some());
        (read, write)
    }

    // Real management sockets and pairing, with a deterministic slow mesh
    // operation. Holding the store lock pauses teardown without a tailnet or
    // a timing-dependent network. This is the same dispatch path a slow TLS
    // listener occupied during Phase 0, starving the floor heartbeat.
    #[tokio::test]
    async fn mesh_control_keeps_heartbeat_live_and_mesh_requests_ordered() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
            .await
            .unwrap();
        let (mut reader, mut writer) = mgmt_client(&daemon).await;
        let mut entered = daemon.state.mesh.shared.node.subscribe();
        let held = daemon.state.mesh.shared.stores.lock().await;
        mgmt_send(&mut writer, 2, "native.mesh.stop", json!({})).await;
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.changed())
            .await
            .unwrap()
            .unwrap();
        mgmt_send(&mut writer, 3, "native.lifecycle.ping", json!({})).await;
        mgmt_send(&mut writer, 4, "native.mesh.stop", json!({})).await;
        let first = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            mgmt_next_line(&mut reader),
        )
        .await;
        drop(held);
        if first.is_err() {
            drop(writer);
            drop(reader);
            daemon.shutdown().await;
            panic!("a pending mesh operation blocked the floor heartbeat");
        }
        let first: Value = serde_json::from_str(&first.unwrap().unwrap().unwrap()).unwrap();
        assert_eq!(
            first["id"], 3,
            "the heartbeat must pass the waiting mesh requests"
        );
        assert!(first.get("result").is_some());
        assert_eq!(mgmt_recv(&mut reader).await["id"], 2);
        assert_eq!(mgmt_recv(&mut reader).await["id"], 4);
        drop(writer);
        drop(reader);
        daemon.shutdown().await;
    }

    #[tokio::test]
    async fn mesh_control_discards_superseded_clients_queued_mutations() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
            .await
            .unwrap();
        let (mut old_read, mut old_write) = mgmt_client(&daemon).await;
        let mut entered = daemon.state.mesh.shared.node.subscribe();
        let held = daemon.state.mesh.shared.stores.lock().await;
        mgmt_send(&mut old_write, 2, "native.mesh.stop", json!({})).await;
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.changed())
            .await
            .unwrap()
            .unwrap();
        mgmt_send(&mut old_write, 3, "native.mesh.retire", json!({})).await;
        let (mut new_read, mut new_write) = mgmt_client(&daemon).await;
        // Takeover closes the old outbox; consume its supersession notice.
        let old_closed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while old_read.next_line().await.unwrap().is_some() {}
        })
        .await;
        drop(held);
        old_closed.expect("the superseded connection must close even with a pending mesh call");
        mgmt_send(&mut new_write, 2, "native.mesh.stop", json!({})).await;
        assert!(mgmt_recv(&mut new_read).await.get("result").is_some());
        assert!(
            !daemon
                .state
                .mesh
                .shared
                .retired
                .load(std::sync::atomic::Ordering::SeqCst),
            "the superseded client's queued retire must not run"
        );
        drop((old_read, old_write, new_read, new_write));
        daemon.shutdown().await;
    }

    #[tokio::test]
    async fn mesh_control_saturation_refuses_work_without_blocking_heartbeat() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
            .await
            .unwrap();
        let (mut reader, mut writer) = mgmt_client(&daemon).await;
        let mut entered = daemon.state.mesh.shared.node.subscribe();
        let held = daemon.state.mesh.shared.stores.lock().await;
        mgmt_send(&mut writer, 2, "native.mesh.stop", json!({})).await;
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.changed())
            .await
            .unwrap()
            .unwrap();
        // More requests than any intended local caller needs. They must be
        // refused promptly rather than parking the reader behind the worker.
        for id in 3..43 {
            mgmt_send(&mut writer, id, "native.mesh.stop", json!({})).await;
        }
        mgmt_send(&mut writer, 43, "native.lifecycle.ping", json!({})).await;
        let mut refused = 0;
        loop {
            let reply = mgmt_recv(&mut reader).await;
            if reply["id"] == 43 {
                assert!(reply.get("result").is_some());
                break;
            }
            assert_eq!(reply["error"]["code"], -32010);
            refused += 1;
        }
        assert!(
            refused > 0,
            "pending mesh requests must have a finite bound"
        );
        drop(held);
        drop((reader, writer));
        daemon.shutdown().await;
    }

    // UA-3 — the retire lifecycle at the handle seam: state-dir custody and
    // the resurrection guard. The archive RENAME belongs to the mgmt handler
    // and the live sidecar path to the #[ignore]d probes.

    #[tokio::test]
    async fn retire_hands_back_nothing_when_no_state_exists() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::config::NativeConfig::for_data_dir(dir.path().to_path_buf());
        let (ping, _rx) = mpsc::unbounded_channel();
        let unit = MeshUnit::new(&config, ping);
        let handle = unit.handle();
        let retired = handle.retire().await;
        assert!(retired.state_dir.is_none());
        // TS-D14 — no node was up, so none was signed out
        assert!(!retired.signed_out);
        let health = unit.shared.health.lock().unwrap().clone();
        assert!(matches!(health.state, UnitState::Disabled));
        assert!(health.detail.unwrap_or_default().contains("retired"));
    }

    #[tokio::test]
    async fn retire_hands_back_an_existing_state_dir_and_blocks_resurrection() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::config::NativeConfig::for_data_dir(dir.path().to_path_buf());
        std::fs::create_dir_all(config.mesh_state_dir()).unwrap();
        let (ping, _rx) = mpsc::unbounded_channel();
        let unit = MeshUnit::new(&config, ping);
        let handle = unit.handle();
        let handed = handle
            .retire()
            .await
            .state_dir
            .expect("existing state dir handed back");
        assert_eq!(handed, config.mesh_state_dir());
        // the retired flag stands — a bring-up finishing AFTER an unlink must
        // never install a node over the archived identity
        assert!(unit
            .shared
            .retired
            .load(std::sync::atomic::Ordering::SeqCst));
    }

    // WIN-7: the resolver must find the Windows sidecar by its `.exe` name in
    // truffle's own `%LOCALAPPDATA%\truffle\bin` — both halves of the fix at once.
    #[cfg(windows)]
    #[test]
    fn resolve_sidecar_finds_the_windows_exe_in_localappdata() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("truffle").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join("sidecar-slim.exe");
        std::fs::write(&exe, b"x").unwrap();

        let prev = std::env::var_os("LOCALAPPDATA");
        std::env::set_var("LOCALAPPDATA", dir.path());
        let mut searched = Vec::new();
        let found = resolve_sidecar(None, &mut searched);
        match prev {
            Some(v) => std::env::set_var("LOCALAPPDATA", v),
            None => std::env::remove_var("LOCALAPPDATA"),
        }

        assert_eq!(
            found.as_deref(),
            Some(exe.as_path()),
            "the resolver should find the .exe under LOCALAPPDATA; searched: {searched:?}"
        );
    }
}
