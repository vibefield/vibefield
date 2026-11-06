//! DR-3a (W3, VF-FLOOR) — the file transfer's backend behind
//! `native.mesh.fileTransfer.*` (contracts mgmt.ts, the file transfer's
//! header; the facade is `mgmt/file_transfer.rs`).
//!
//! The drive moves an object between desktops by truffle's own file transfer,
//! pulled by a NAMED ROOT and a path relative to it (truffle T-3, RFC 032), so
//! no desktop names another's folders (EL7). The floor only asks for a pull and
//! reports what became of it; the bytes go Rust to Rust through the node (EL2).
//!
//! TWO ARMS, one trait:
//!
//!   [`UnsupportedFileTransfer`] — PRODUCTION at the `=0.7.24` pin (the root
//!       `Cargo.toml`). That release has no named-root pull: `add_pull_root`
//!       registers a canonicalized ABSOLUTE root, and `pull_file(peer_id,
//!       remote_path, local_path)` names the file by the holder's own path
//!       (truffle-core-0.7.24 `src/file_transfer/mod.rs:185-189, 330-335`), which
//!       would put that path on the wire (EL7). So the floor calls no truffle
//!       file-transfer API at all. Every verb answers `file-transfer-unsupported`,
//!       a capability fact that holds for the floor's life, as egress's
//!       `UnsupportedEgress` does (`services/mesh_egress.rs:158-161`).
//!   [`NamedRootsFileTransfer`] — the named-root arm (W3's stack B), over a
//!       VibeField [`PullSubstrate`]. UNREACHABLE IN PRODUCTION: nothing but the
//!       test seam installs it (`MeshHandle::install_file_transfer_for_tests`),
//!       and nothing but [`ScriptedPulls`] implements the substrate. The truffle
//!       substrate (`impl PullSubstrate for MeshNode`) and the default flip (a
//!       `truffle-named-pull` default feature, egress's `Cargo.toml` shape) are
//!       EL8-TRUFFLE's, when truffle releases T-3.
//!
//! The substrate speaks VibeField types only, so no truffle type is named here
//! before the release that defines it: T-3's `TransferError` is
//! `#[non_exhaustive]` and adds `Unsupported` (truffle-t3 `e429c43`
//! `crates/truffle-core/src/file_transfer/types.rs:198-215`), and an adapter
//! written now would fold it into `io` through a `_` arm.

use crate::config::{FileTransferRootDirs, NativeConfig};
use crate::contracts::{
    Blake3Hex, FileTransferId, FileTransferRootName, NativeFileTransferPullParams,
    NativeFileTransferRoot, NativeFileTransferRow,
};
use crate::registries::{drive_limits, mesh_file_transfer};
use crate::services::mesh::{TEARDOWN_RETIRED, TEARDOWN_STOPPED};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::sync::{broadcast, oneshot};

/// The facade's substrate. Held on the mesh unit (`services/mesh.rs`'s
/// `Shared`) beside egress's, and read per request through
/// `MeshHandle::file_transfer`. The facade has answered steps 1 to 5 of the
/// contract's refusal order before a verb reaches an arm
/// (`mgmt/file_transfer.rs`), so an arm answers step 6 and its substrate.
#[async_trait::async_trait]
pub trait FileTransferBackend: Send + Sync {
    /// Which arm answers: logged at boot, asserted by tests, never shown.
    fn arm(&self) -> &'static str;
    /// `false` = every verb answers `file-transfer-unsupported`, first, node or
    /// no node (the refusal order's step 1).
    fn supported(&self) -> bool;
    /// A node was installed (`MeshHandle::on_node_installed`): its substrate,
    /// whether the node was BUILT gated, and the posture's login.
    async fn attach(&self, substrate: Arc<dyn PullSubstrate>, gated: bool, login: Option<String>);
    /// The node is being taken down (`MeshHandle::teardown_node`), for
    /// `reason`, its word.
    async fn detach(&self, reason: &str);
    /// `roots`: the WHOLE declared set, replacing the last, under the gate and
    /// the login the facade read for this request. One answer per name asked.
    async fn roots(
        &self,
        roots: Vec<FileTransferRootName>,
        gated: bool,
        login: Option<String>,
    ) -> Result<Vec<NativeFileTransferRoot>, FileTransferError>;
    /// `pull`: start one pull. Answered at once; its end rides the stream.
    fn pull(&self, params: NativeFileTransferPullParams) -> Result<(), FileTransferError>;
    /// The pulls running now, ordered by transferId: the stream's snapshot.
    fn snapshot(&self) -> Vec<NativeFileTransferRow>;
    /// The stream of the pulls' progress and ends. It is the arm's, so it is
    /// the mesh unit's, held across node rebuilds (W3-2).
    fn subscribe(&self) -> broadcast::Receiver<PullEvent>;
}

/// Why an arm refused a verb. The facade maps each arm onto the wire
/// (`mgmt/file_transfer.rs`); nothing else reads these.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileTransferError {
    /// This arm cannot pull by a named root: every verb, for the floor's life.
    Unsupported,
    /// No node's substrate is attached: the node gate's answer.
    MeshDown,
    /// A live transferId, or a digest a running pull holds: the words say which.
    Conflict(&'static str),
    /// DRIVE_LIMITS.PULLS_IN_FLIGHT pulls are running.
    Exhausted,
    /// Anything else, verbatim.
    Internal(String),
}

/// One event on the stream, as the facade writes it to
/// `native.mesh.fileTransfer.delta` (contracts mgmt.ts
/// `NativeFileTransferDelta`): a progress, or a pull's end.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PullEvent {
    Progress {
        transfer_id: FileTransferId,
        bytes: u64,
        total: u64,
    },
    /// The file is in place in its root's `lands` folder, named `incoming`.
    Completed {
        transfer_id: FileTransferId,
        digest: Blake3Hex,
        incoming: String,
        bytes: u64,
        sha256: String,
    },
    /// Nothing of the pull is left in the `lands` folder.
    Failed {
        transfer_id: FileTransferId,
        reason: &'static str,
        message: String,
    },
}

/// The arm production builds: [`UnsupportedFileTransfer`] at the `=0.7.24` pin,
/// whose truffle cannot pull by a named root.
pub fn default_backend() -> Arc<dyn FileTransferBackend> {
    Arc::new(UnsupportedFileTransfer)
}

/// The arm of a floor whose truffle cannot pull by a named root: every verb
/// answers `file-transfer-unsupported` for the floor's life, which is what lets
/// fieldd cache the answer per floor boot rather than retry it.
pub struct UnsupportedFileTransfer;

#[async_trait::async_trait]
impl FileTransferBackend for UnsupportedFileTransfer {
    fn arm(&self) -> &'static str {
        "unsupported"
    }
    fn supported(&self) -> bool {
        false
    }
    /// No substrate is used: production's teardown and install pass through.
    async fn attach(&self, _: Arc<dyn PullSubstrate>, _: bool, _: Option<String>) {}
    async fn detach(&self, _: &str) {}
    async fn roots(
        &self,
        _: Vec<FileTransferRootName>,
        _: bool,
        _: Option<String>,
    ) -> Result<Vec<NativeFileTransferRoot>, FileTransferError> {
        Err(FileTransferError::Unsupported)
    }
    fn pull(&self, _: NativeFileTransferPullParams) -> Result<(), FileTransferError> {
        Err(FileTransferError::Unsupported)
    }
    fn snapshot(&self) -> Vec<NativeFileTransferRow> {
        Vec::new()
    }
    /// A stream that never carries anything: its sender is gone at once.
    fn subscribe(&self) -> broadcast::Receiver<PullEvent> {
        broadcast::channel(1).1
    }
}

/// What a node does for the named-root arm, in VibeField's words. One per
/// node: the arm is handed it when a node is installed
/// (`MeshHandle::on_node_installed`) and forgets it when the node is torn down.
///
/// At EL8-TRUFFLE, `impl PullSubstrate for MeshNode` maps each method onto
/// truffle T-3: `set_cap` → `set_max_transfer_size`, `refuse_pushes` →
/// `auto_reject`, `serve_root`/`unserve_root` → `add_named_pull_root`/
/// `remove_named_pull_root`, `pull` → `pull_named_file`, `progress` → the file
/// transfer's events filtered to Receive.
#[async_trait::async_trait]
pub trait PullSubstrate: Send + Sync {
    /// Cap every transfer of the node at `bytes` (DRIVE_LIMITS.OBJECT_MAX_BYTES).
    async fn set_cap(&self, bytes: u64);
    /// Refuse every pushed offer: `offer` stays reserved and undeclared.
    async fn refuse_pushes(&self);
    /// Serve `dir` to the node's peers under `name`.
    async fn serve_root(&self, name: FileTransferRootName, dir: &Path) -> Result<(), String>;
    /// Stop serving `name`.
    async fn unserve_root(&self, name: FileTransferRootName);
    /// Pull `path`, below the peer's root `root`, into `into` (the floor's own
    /// path, never the holder's). The bytes are checked against the holder's
    /// SHA-256 before the file is placed.
    async fn pull(
        &self,
        peer: &str,
        root: FileTransferRootName,
        path: &str,
        into: &Path,
    ) -> Result<Landed, PullFailure>;
    /// The node's receive progress, every pull's, keyed by the pulled file's
    /// name (the holder's offer names it: the drive's paths end in the digest).
    fn progress(&self) -> broadcast::Receiver<PullProgress>;
}

/// A pull that placed its file: the bytes moved and the SHA-256 they matched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Landed {
    pub bytes: u64,
    pub sha256: String,
}

/// Why a pull ended without its file, one arm per MESH_FILE_TRANSFER.FAILED_*
/// word (contracts mgmt.ts), each with the substrate's own message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PullFailure {
    /// The holder refused: no such root, a path outside it, no such file.
    Rejected(String),
    /// The holder's truffle predates named roots.
    Unsupported(String),
    /// No offer came, or the bytes stopped coming.
    Timeout(String),
    /// The bytes did not match the holder's SHA-256.
    Integrity(String),
    /// The holder offered more than this node's cap.
    TooLarge(String),
    /// This desktop's disk refused the landing.
    NoSpace(String),
    /// Any other local failure.
    Io(String),
    /// The node went down, or was rebuilt, while the pull ran.
    NodeDown(String),
}

/// One progress report from the substrate: `bytes` of `total` of the file
/// `file_name` have landed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PullProgress {
    pub file_name: String,
    pub bytes: u64,
    pub total: u64,
}

/// The stream's event buffer (the door's and the lanes'): a subscriber that
/// falls behind it is owed a snapshot, never a gap (`mgmt/file_transfer.rs`).
const STREAM_CAPACITY: usize = 64;

/// The suffix truffle gives a pull's temporary, `<landed>.<token>.truffle-tmp`
/// (truffle-core-0.7.24 `file_transfer/mod.rs:553`; contracts mgmt.ts
/// `FILE_TRANSFER_LANDED_PATTERN`).
const TEMP_SUFFIX: &str = ".truffle-tmp";

/// The named-root arm (module note).
///
/// THE HELD SET (DR-2a's review nit 8 as the W3 critic's finding 0 rewrote it;
/// contracts mgmt.ts `NativeFileTransferRootsParams`): the floor holds the last
/// declared set BOUND TO THE LOGIN it was declared under, serves it again from
/// every node attached GATED for that same login, serves nothing from a node
/// gated to another login until fieldd declares, and drops it at a stop or an
/// unlink (`detach` for TEARDOWN_STOPPED or TEARDOWN_RETIRED). The gate is the
/// node's BUILT allow-list (`!login_allow().is_empty()`), never the posture.
///
/// THE FOLDERS (the critic's finding 11): a root's `serves` and `lands`
/// leaves are made and then ALWAYS set to 0700, even when they exist; a folder
/// on the way to them that the floor itself creates (a `drive/` mille has not
/// made yet) is 0700 too, as the run dir is (lib.rs, `bootstrap_with_logging`).
/// Nothing else is touched: `harden_state_dir` recurses, and `drive/` is
/// mille's root. On Windows the tree inherits the user profile's ACL.
pub struct NamedRootsFileTransfer {
    core: Arc<Core>,
}

/// What the arm's tasks share with it.
struct Core {
    config: NativeConfig,
    events: broadcast::Sender<PullEvent>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// the installed node's substrate, `None` between nodes
    node: Option<Attached>,
    /// counts attaches, so an answer that awaited the substrate writes only
    /// to the node it asked
    attaches: u64,
    held: Option<Held>,
}

struct Attached {
    id: u64,
    substrate: Arc<dyn PullSubstrate>,
    /// the roots this node serves now
    serving: BTreeSet<FileTransferRootName>,
}

/// The last declared set and the login it was declared under.
struct Held {
    login: Option<String>,
    roots: Vec<FileTransferRootName>,
}

impl NamedRootsFileTransfer {
    /// The arm for the user root `config` names.
    pub fn new(config: &NativeConfig) -> Self {
        Self {
            core: Arc::new(Core {
                config: config.clone(),
                events: broadcast::channel(STREAM_CAPACITY).0,
                inner: Mutex::new(Inner::default()),
            }),
        }
    }

    /// TESTS ONLY — the idle bound a pull may sit without a byte.
    #[doc(hidden)]
    pub fn with_idle_bound(self, idle: Duration) -> Self {
        let _ = idle;
        self
    }

    /// TESTS ONLY — the stream's event buffer, so a row can make its reader
    /// lag. A shape is set before the arm is installed; once shared it stays.
    #[doc(hidden)]
    pub fn with_stream_capacity(mut self, capacity: usize) -> Self {
        if let Some(core) = Arc::get_mut(&mut self.core) {
            core.events = broadcast::channel(capacity).0;
        }
        self
    }
}

#[async_trait::async_trait]
impl FileTransferBackend for NamedRootsFileTransfer {
    fn arm(&self) -> &'static str {
        "named-roots"
    }

    fn supported(&self) -> bool {
        true
    }

    /// Per node: the cap and the push refusal once, then the held roots, when
    /// the node is gated for the login they were declared under.
    async fn attach(&self, substrate: Arc<dyn PullSubstrate>, gated: bool, login: Option<String>) {
        substrate.set_cap(drive_limits::OBJECT_MAX_BYTES).await;
        substrate.refuse_pushes().await;
        let (node, held) = {
            let mut inner = lock(&self.core.inner);
            inner.attaches += 1;
            let node = inner.attaches;
            inner.node = Some(Attached {
                id: node,
                substrate: substrate.clone(),
                serving: BTreeSet::new(),
            });
            let held = match &inner.held {
                Some(held) if gated && held.login == login => held.roots.clone(),
                _ => Vec::new(),
            };
            (node, held)
        };
        let mut served = 0;
        for name in held {
            if self.core.serve(&substrate, node, name).await.registered {
                served += 1;
            }
        }
        tracing::info!(
            event = "field_native.mesh.file_transfer.attached",
            component = "mesh",
            gated,
            served,
            "The file transfer attached to the installed node"
        );
    }

    /// The node goes, and what it served goes with it; a stop or an unlink
    /// drops the held set too (finding 0).
    async fn detach(&self, reason: &str) {
        let mut inner = lock(&self.core.inner);
        inner.node = None;
        if reason == TEARDOWN_STOPPED || reason == TEARDOWN_RETIRED {
            inner.held = None;
        }
    }

    async fn roots(
        &self,
        roots: Vec<FileTransferRootName>,
        gated: bool,
        login: Option<String>,
    ) -> Result<Vec<NativeFileTransferRoot>, FileTransferError> {
        let (substrate, node, serving) = {
            let mut inner = lock(&self.core.inner);
            let Some(attached) = inner.node.as_ref() else {
                return Err(FileTransferError::MeshDown);
            };
            let current = (
                attached.substrate.clone(),
                attached.id,
                attached.serving.clone(),
            );
            inner.held = Some(Held {
                login,
                roots: roots.clone(),
            });
            current
        };
        // What the set drops, or everything on a node that cannot serve.
        for name in serving
            .into_iter()
            .filter(|name| !gated || !roots.contains(name))
        {
            substrate.unserve_root(name).await;
            if let Some(attached) = lock(&self.core.inner)
                .node
                .as_mut()
                .filter(|attached| attached.id == node)
            {
                attached.serving.remove(&name);
            }
        }
        let mut answers = Vec::with_capacity(roots.len());
        for name in roots {
            answers.push(if gated {
                self.core.serve(&substrate, node, name).await
            } else {
                refused(name, mesh_file_transfer::ROOT_UNGATED)
            });
        }
        Ok(answers)
    }

    fn pull(&self, _: NativeFileTransferPullParams) -> Result<(), FileTransferError> {
        // W3 stack B's C5: the pulls are C6's.
        Err(FileTransferError::Internal("not built".into()))
    }

    fn snapshot(&self) -> Vec<NativeFileTransferRow> {
        Vec::new()
    }

    fn subscribe(&self) -> broadcast::Receiver<PullEvent> {
        self.core.events.subscribe()
    }
}

impl Core {
    /// Serve `name` from the node `node`: its folders made (0700), its `lands`
    /// folder swept, and the substrate asked unless this node serves it
    /// already, so a repeat is a no-op.
    async fn serve(
        &self,
        substrate: &Arc<dyn PullSubstrate>,
        node: u64,
        name: FileTransferRootName,
    ) -> NativeFileTransferRoot {
        let dirs = self.config.file_transfer_root(name);
        if let Err(e) = self.make_root_dirs(&dirs) {
            tracing::warn!(
                event = "field_native.mesh.file_transfer.root_folders_failed",
                component = "mesh",
                root = %name,
                error = %e,
                "A named root's folders could not be made"
            );
            return refused(name, io_word(&e));
        }
        self.sweep(&dirs.lands);
        let serving = lock(&self.inner)
            .node
            .as_ref()
            .is_some_and(|attached| attached.id == node && attached.serving.contains(&name));
        if !serving {
            if let Err(message) = substrate.serve_root(name, &dirs.serves).await {
                tracing::warn!(
                    event = "field_native.mesh.file_transfer.serve_failed",
                    component = "mesh",
                    root = %name,
                    error = %message,
                    "The node refused to serve a named root"
                );
                return refused(name, mesh_file_transfer::FAILED_IO);
            }
            if let Some(attached) = lock(&self.inner)
                .node
                .as_mut()
                .filter(|attached| attached.id == node)
            {
                attached.serving.insert(name);
            }
        }
        NativeFileTransferRoot {
            name,
            registered: true,
            reason: None,
        }
    }

    fn make_root_dirs(&self, dirs: &FileTransferRootDirs) -> std::io::Result<()> {
        self.make_private_dir(&dirs.serves)?;
        self.make_private_dir(&dirs.lands)
    }

    /// Make `leaf` under the user root: every folder on the way that the floor
    /// creates is 0700, and the leaf is set to 0700 whether it was made now or
    /// before. A folder that exists on the way is left as it is.
    fn make_private_dir(&self, leaf: &Path) -> std::io::Result<()> {
        let root = &self.config.data_dir;
        let below = leaf.strip_prefix(root).map_err(|_| {
            std::io::Error::other("a named root's folder lies outside the user root")
        })?;
        let mut path = root.clone();
        for part in below.components() {
            path.push(part);
            match std::fs::create_dir(&path) {
                Ok(()) => set_private(&path)?,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
        }
        set_private(leaf)
    }

    /// Remove every `*.truffle-tmp` in `lands`: what pulls that failed, or ran
    /// on an earlier node or floor, left behind. A landed name is never
    /// touched: it is fieldd's to adopt or sweep.
    fn sweep(&self, lands: &Path) {
        let Ok(entries) = std::fs::read_dir(lands) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !name
                .to_str()
                .is_some_and(|name| name.ends_with(TEMP_SUFFIX))
            {
                continue;
            }
            if let Err(e) = std::fs::remove_file(entry.path()) {
                tracing::warn!(
                    event = "field_native.mesh.file_transfer.sweep_failed",
                    component = "mesh",
                    error = %e,
                    "A pull's leftover temporary could not be removed"
                );
            }
        }
    }
}

/// A root this request could not register, and the MESH_FILE_TRANSFER word
/// that says why.
fn refused(name: FileTransferRootName, word: &str) -> NativeFileTransferRoot {
    NativeFileTransferRoot {
        name,
        registered: false,
        reason: Some(word.to_owned()),
    }
}

/// A disk that refused the write is NO_SPACE (DR-L8's "out of room"); any
/// other local failure is IO.
fn io_word(e: &std::io::Error) -> &'static str {
    if e.kind() == std::io::ErrorKind::StorageFull {
        mesh_file_transfer::FAILED_NO_SPACE
    } else {
        mesh_file_transfer::FAILED_IO
    }
}

#[cfg(unix)]
fn set_private(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

/// No mode bit on Windows: the folders inherit the user profile's ACL, as the
/// mesh state dir does (`services/mesh.rs`, `harden_state_dir`).
#[cfg(not(unix))]
fn set_private(_: &Path) -> std::io::Result<()> {
    Ok(())
}

/// A poisoned lock still holds a consistent table here: every writer below
/// finishes its change before it can panic.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a [`ScriptedPulls`] pull of one path does.
#[derive(Clone, Debug)]
pub enum Scripted {
    /// Write `body` to the pull's temporary, report `progress` (each a byte
    /// count of `body.len()`) `every` apart, then place it and answer `sha256`.
    Land {
        body: Vec<u8>,
        sha256: String,
        progress: Vec<u64>,
        every: Duration,
    },
    /// Write the temporary, then wait for [`ScriptedPulls::release`], and do
    /// what the release says.
    Hold,
    /// Write the temporary and fail, leaving it: truffle leaves its temporary
    /// on a read or write error (truffle-core-0.7.24 `file_transfer/mod.rs`
    /// `pull_file`, the `?` on each write).
    FailLeavingTemp(PullFailure),
    /// Place the file, then fail: truffle places the file before it writes its
    /// ACK, and a failed ACK write fails the pull (`pull_file`'s
    /// `finalize_received_file`, then `stream.write_all(&[0x01])?`).
    PlaceThenFail(PullFailure),
    /// Write the temporary and never answer.
    Stall,
}

impl Scripted {
    /// Land `body` at once, with no progress.
    pub fn land(body: &[u8], sha256: &str) -> Self {
        Self::Land {
            body: body.to_vec(),
            sha256: sha256.to_owned(),
            progress: Vec::new(),
            every: Duration::ZERO,
        }
    }
}

/// One pull a [`ScriptedPulls`] was asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PullCall {
    pub peer: String,
    pub root: FileTransferRootName,
    pub path: String,
    pub into: PathBuf,
}

enum ScriptEntry {
    Step(Scripted),
    Held(oneshot::Receiver<Scripted>),
}

/// TESTS ONLY — nothing in the product constructs it (the same standing as
/// `FakeEgress`, and attached the same way:
/// `MeshHandle::attach_file_transfer_for_tests`).
///
/// A substrate whose pulls do what a test scripts, per path, with REAL files:
/// each writes a temporary named as truffle names its own,
/// `<into>.<token>.truffle-tmp` (truffle-core-0.7.24 `file_transfer/mod.rs:553`),
/// and places the file by renaming it, as truffle does. A path the test never
/// scripted is refused, RFC 032's one word. It records what the arm asked of it
/// (the cap, the push refusal, the roots it serves, each pull) for a test to
/// read. Scripted from the facts read at 0.7.24 (`mod.rs:378-650`); the
/// EL8-TRUFFLE probe is the first live evidence.
#[doc(hidden)]
pub struct ScriptedPulls {
    scripts: Mutex<HashMap<String, ScriptEntry>>,
    releases: Mutex<HashMap<String, oneshot::Sender<Scripted>>>,
    progress: broadcast::Sender<PullProgress>,
    cap: Mutex<Option<u64>>,
    pushes_refused: AtomicUsize,
    served: Mutex<BTreeMap<String, PathBuf>>,
    serve_calls: AtomicUsize,
    calls: Mutex<Vec<PullCall>>,
    in_flight: Arc<AtomicUsize>,
    tokens: AtomicUsize,
}

/// Counts a pull from its start until its future is dropped, so a test can
/// tell a pull the floor ended from one it left running.
struct InFlight(Arc<AtomicUsize>);

impl InFlight {
    fn enter(count: &Arc<AtomicUsize>) -> Self {
        count.fetch_add(1, Ordering::SeqCst);
        Self(count.clone())
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Default for ScriptedPulls {
    fn default() -> Self {
        Self::new()
    }
}

impl ScriptedPulls {
    pub fn new() -> Self {
        Self {
            scripts: Mutex::new(HashMap::new()),
            releases: Mutex::new(HashMap::new()),
            progress: broadcast::channel(64).0,
            cap: Mutex::new(None),
            pushes_refused: AtomicUsize::new(0),
            served: Mutex::new(BTreeMap::new()),
            serve_calls: AtomicUsize::new(0),
            calls: Mutex::new(Vec::new()),
            in_flight: Arc::new(AtomicUsize::new(0)),
            tokens: AtomicUsize::new(0),
        }
    }

    /// The next pull of `path` does `step`.
    pub fn script(&self, path: &str, step: Scripted) {
        let entry = match step {
            Scripted::Hold => {
                let (release, held) = oneshot::channel();
                lock(&self.releases).insert(path.to_owned(), release);
                ScriptEntry::Held(held)
            }
            step => ScriptEntry::Step(step),
        };
        lock(&self.scripts).insert(path.to_owned(), entry);
    }

    /// Release the held pull of `path` to do `step` (a `Hold` here stalls).
    /// `false` when no pull of `path` was held.
    pub fn release(&self, path: &str, step: Scripted) -> bool {
        lock(&self.releases)
            .remove(path)
            .is_some_and(|release| release.send(step).is_ok())
    }

    /// The cap the arm set, if it set one.
    pub fn cap(&self) -> Option<u64> {
        *lock(&self.cap)
    }

    /// How many times the arm refused pushes.
    pub fn pushes_refused(&self) -> usize {
        self.pushes_refused.load(Ordering::SeqCst)
    }

    /// The roots served now: name → folder.
    pub fn served(&self) -> BTreeMap<String, PathBuf> {
        lock(&self.served).clone()
    }

    /// How many times the arm asked to serve a root.
    pub fn serve_calls(&self) -> usize {
        self.serve_calls.load(Ordering::SeqCst)
    }

    /// Every pull the arm asked for, in order.
    pub fn calls(&self) -> Vec<PullCall> {
        lock(&self.calls).clone()
    }

    /// The pulls running now: started, and not yet answered or dropped.
    pub fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::SeqCst)
    }

    async fn run(
        &self,
        step: Scripted,
        path: &str,
        into: &Path,
        temp: &Path,
    ) -> Result<Landed, PullFailure> {
        let io = |e: std::io::Error| PullFailure::Io(e.to_string());
        match step {
            Scripted::Land {
                body,
                sha256,
                progress,
                every,
            } => {
                std::fs::write(temp, &body).map_err(io)?;
                let total = body.len() as u64;
                let file_name = path.rsplit('/').next().unwrap_or(path).to_owned();
                for bytes in progress {
                    let _ = self.progress.send(PullProgress {
                        file_name: file_name.clone(),
                        bytes,
                        total,
                    });
                    if !every.is_zero() {
                        tokio::time::sleep(every).await;
                    }
                }
                std::fs::rename(temp, into).map_err(io)?;
                Ok(Landed {
                    bytes: total,
                    sha256,
                })
            }
            Scripted::FailLeavingTemp(failure) => Err(failure),
            Scripted::PlaceThenFail(failure) => {
                std::fs::rename(temp, into).map_err(io)?;
                Err(failure)
            }
            Scripted::Hold | Scripted::Stall => std::future::pending().await,
        }
    }
}

#[async_trait::async_trait]
impl PullSubstrate for ScriptedPulls {
    async fn set_cap(&self, bytes: u64) {
        *lock(&self.cap) = Some(bytes);
    }

    async fn refuse_pushes(&self) {
        self.pushes_refused.fetch_add(1, Ordering::SeqCst);
    }

    async fn serve_root(&self, name: FileTransferRootName, dir: &Path) -> Result<(), String> {
        self.serve_calls.fetch_add(1, Ordering::SeqCst);
        lock(&self.served).insert(name.to_string(), dir.to_path_buf());
        Ok(())
    }

    async fn unserve_root(&self, name: FileTransferRootName) {
        lock(&self.served).remove(&name.to_string());
    }

    async fn pull(
        &self,
        peer: &str,
        root: FileTransferRootName,
        path: &str,
        into: &Path,
    ) -> Result<Landed, PullFailure> {
        lock(&self.calls).push(PullCall {
            peer: peer.to_owned(),
            root,
            path: path.to_owned(),
            into: into.to_path_buf(),
        });
        let _live = InFlight::enter(&self.in_flight);
        let entry = lock(&self.scripts).remove(path);
        let Some(entry) = entry else {
            return Err(PullFailure::Rejected("the holder refused the pull".into()));
        };
        let token = self.tokens.fetch_add(1, Ordering::SeqCst);
        let landed = into
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let temp = into.with_file_name(format!("{landed}.t{token}.truffle-tmp"));
        std::fs::write(&temp, b"").map_err(|e| PullFailure::Io(e.to_string()))?;
        let step = match entry {
            ScriptEntry::Step(step) => step,
            ScriptEntry::Held(held) => held.await.unwrap_or(Scripted::Stall),
        };
        self.run(step, path, into, &temp).await
    }

    fn progress(&self) -> broadcast::Receiver<PullProgress> {
        self.progress.subscribe()
    }
}
