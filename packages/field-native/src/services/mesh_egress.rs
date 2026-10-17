//! DS-1 — the egress backend behind `native.mesh.egress.*` (design-02 §2.4's
//! egress bullet; design-06 §3; petition T7 = truffle RFC 026).
//!
//! Serving publishes a loopback port ONTO the tailnet. Egress is the mirror
//! image: a process on this desktop reaches a peer THROUGH the node, so no
//! desktop-to-desktop path depends on the operating system's Tailscale app
//! (DS-L5). The bytes never come near this crate. Every rung lives in the
//! SIDECAR (E1 the node's own SOCKS5, E2 loopback routes with a fixed target,
//! E3 an authenticated HTTP CONNECT proxy); the floor only asks for them and
//! hands fieldd an address and a credential (EL2, TC-L1c). A forwarder here
//! over `open_tcp` was considered and rejected: it would put the floor back
//! in the byte path (design-02 §2.4).
//!
//! THREE ARMS, one trait:
//!
//!   `TruffleEgress` — PRODUCTION since 2026-10-17 (DECISIONS, the TB-E row):
//!       the cargo feature `truffle-egress` is in field-native's DEFAULT
//!       features. COMPILED 2026-10-01 (DS-1b) against truffle-core as built on
//!       truffle's `rfc026-egress` branch at `92ab2b7` (RFC 026, sidecar
//!       protocol 6), through a local `[patch.crates-io]` that never entered
//!       this repo. The release that shipped it (0.7.16; the pin is 0.7.19)
//!       carries the same API, with `egress.rs` byte-identical but for two
//!       doc hunks. A node whose sidecar predates RFC 026 is refused by the
//!       core before it asks, and `truffle_refusal` answers that
//!       `egress-unsupported` PER CALL. The sidecar binary is fixed for the
//!       floor's boot, so fieldd's per-boot cache of that answer holds, and a
//!       mixed fleet degrades to the OS network honestly.
//!   [`UnsupportedEgress`] — the REVERT arm: what a build without the feature
//!       answers (TB-E's revert drops it from `default`). Every call answers
//!       `egress-unsupported`, a capability fact that holds for the floor's
//!       life, which is what lets fieldd fall back to the OS network without
//!       retrying. It is the same wire answer the truffle arm gives for a
//!       sidecar below protocol 7.
//!   [`FakeEgress`] — TESTS. Real loopback listeners that splice to an address
//!       the test controls, so the facade, the table, the reset and fieldd's
//!       consumers are exercised without a tailnet.
//!
//! Protocol numbers here are the release's. "Sidecar protocol 6" above is the
//! BRANCH's number (`92ab2b7`: `SIDECAR_V6_EGRESS = 6`). In the release 0.7.15
//! gave protocol 6 to authenticated UDP relays, and RFC 026 egress shipped at
//! protocol 7 in 0.7.16 (`SIDECAR_V7_EGRESS`, truffle-v0.7.19 `provider.rs`).
//! The sidecar the 0.7.19 pin vendors speaks 8, which adds no command.
//!
//! The route table is REBUILT-NOT-PERSISTED like every facade table: a node
//! teardown or rebuild calls [`EgressBackend::reset`], and the facade's
//! `route.subscribe` stream pushes the emptied table — the reset fieldd reads.

use super::mesh::MeshNode;
use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::sync::Arc;

/// Why a backend could not answer. The mgmt facade maps each arm onto the wire
/// (`mgmt/mesh_egress.rs`); nothing else reads these.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressError {
    /// The substrate predates RFC 026: every verb, for the floor's lifetime.
    Unsupported,
    /// Egress exists, but no node is installed to carry it.
    MeshDown,
    /// No route with this id.
    NotFound,
    /// The id is already bound to ANOTHER target; a route never re-aims.
    Conflict { bound_target: String },
    /// The substrate refused the ask: a target that is not an admitted peer, a
    /// login that does not match, a malformed target. `code` is the
    /// substrate's own (RFC 026 as built: TARGET_NOT_PEER, LOGIN_REFUSED,
    /// LOGIN_UNKNOWN, INVALID_TARGET, INVALID_LOGIN), carried verbatim with
    /// its message.
    Refused { code: String, message: String },
    /// Anything else, verbatim.
    Failed(String),
}

/// One bound route: a loopback listener with a FIXED tailnet target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressRoute {
    pub id: String,
    pub target: String,
    /// `127.0.0.1:<p>` (or `[::1]:<p>`): what a local process dials.
    pub listen: String,
}

/// A proxy the node runs (E1's SOCKS5, E3's HTTP CONNECT): where it listens
/// and the credential it demands. The credential is the only secret here; it
/// is handed to fieldd over the paired channel and never logged.
#[derive(Clone, PartialEq, Eq)]
pub struct ProxyGrant {
    pub address: String,
    /// the substrate's constant (tsnet's loopback proxy fixes it), never a secret
    pub username: String,
    pub credential: String,
}

impl std::fmt::Debug for ProxyGrant {
    // A derived Debug would print the credential into any `{:?}` a future
    // caller writes; the address is all a log ever needs.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProxyGrant")
            .field("address", &self.address)
            .field("username", &self.username)
            .field("credential", &"<redacted>")
            .finish()
    }
}

/// The facade's substrate. `node` is the installed node when there is one;
/// an arm that needs it answers [`EgressError::MeshDown`] without it. The
/// facade has already refused `mesh-down`, capture mode and DS-L6 before a
/// mutating call reaches an arm, so an arm only answers for its substrate.
#[async_trait::async_trait]
pub trait EgressBackend: Send + Sync {
    /// Which arm answers: logged at bring-up, asserted by tests, never shown.
    fn arm(&self) -> &'static str;
    /// `false` = every verb answers `egress-unsupported`.
    fn supported(&self) -> bool;
    /// E1 — the node's loopback SOCKS5.
    async fn loopback_proxy(&self, node: Option<&Arc<MeshNode>>)
        -> Result<ProxyGrant, EgressError>;
    /// E2 — bind (or re-answer) the route `id` → `target`.
    async fn route_add(
        &self,
        node: Option<&Arc<MeshNode>>,
        id: &str,
        target: &str,
        login: Option<&str>,
    ) -> Result<EgressRoute, EgressError>;
    /// E2 — drop the route `id`.
    async fn route_remove(&self, node: Option<&Arc<MeshNode>>, id: &str)
        -> Result<(), EgressError>;
    /// E2 — the table, ordered by id.
    async fn route_list(
        &self,
        node: Option<&Arc<MeshNode>>,
    ) -> Result<Vec<EgressRoute>, EgressError>;
    /// E3 — the node's authenticated HTTP CONNECT proxy.
    async fn http_proxy(&self, node: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError>;
    /// The node that carried every route is gone (teardown or rebuild): forget
    /// them all. Returns how many were dropped, so the facade pushes a reset
    /// only when a reader could have held something.
    async fn reset(&self) -> usize;
}

/// The arm production builds (see the module note): `TruffleEgress` under the
/// default features since TB-E (2026-10-17), `UnsupportedEgress` in a build
/// without them.
pub fn default_backend() -> Arc<dyn EgressBackend> {
    #[cfg(feature = "truffle-egress")]
    {
        Arc::new(TruffleEgress::default())
    }
    #[cfg(not(feature = "truffle-egress"))]
    {
        Arc::new(UnsupportedEgress)
    }
}

/// The REVERT arm: a floor built without `truffle-egress` (TB-E's revert)
/// answers every call `egress-unsupported`, the same honest answer the truffle
/// arm gives, per call, for a sidecar below protocol 7.
pub struct UnsupportedEgress;

#[async_trait::async_trait]
impl EgressBackend for UnsupportedEgress {
    fn arm(&self) -> &'static str {
        "unsupported"
    }
    fn supported(&self) -> bool {
        false
    }
    async fn loopback_proxy(&self, _: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        Err(EgressError::Unsupported)
    }
    async fn route_add(
        &self,
        _: Option<&Arc<MeshNode>>,
        _: &str,
        _: &str,
        _: Option<&str>,
    ) -> Result<EgressRoute, EgressError> {
        Err(EgressError::Unsupported)
    }
    async fn route_remove(&self, _: Option<&Arc<MeshNode>>, _: &str) -> Result<(), EgressError> {
        Err(EgressError::Unsupported)
    }
    async fn route_list(&self, _: Option<&Arc<MeshNode>>) -> Result<Vec<EgressRoute>, EgressError> {
        Err(EgressError::Unsupported)
    }
    async fn http_proxy(&self, _: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        Err(EgressError::Unsupported)
    }
    async fn reset(&self) -> usize {
        0
    }
}

/// TESTS ONLY — nothing in the product constructs it (the same standing as
/// `MeshHandle::force_node_presence_for_tests`, and installed the same way:
/// `MeshHandle::install_egress_for_tests`).
///
/// It plays the sidecar's half with REAL sockets: every route binds a loopback
/// listener, and each accepted connection is spliced to the address the test
/// admitted for the route's target. A target the test never admitted is
/// refused at add, which is RFC 026 E2's own rule ("a route to a non-peer is
/// refused with a reason"). The proxies answer the grants a test configured;
/// nothing listens behind them, because the facade's job ends at the answer.
#[doc(hidden)]
pub struct FakeEgress {
    proxy: ProxyGrant,
    http_proxy: ProxyGrant,
    /// target → where the fake splices a connection for it
    peers: std::sync::Mutex<HashMap<String, SocketAddr>>,
    routes: tokio::sync::Mutex<BTreeMap<String, FakeRoute>>,
}

struct FakeRoute {
    target: String,
    listen: SocketAddr,
    /// owns the accept loop AND, through its JoinSet, every spliced
    /// connection: aborting it closes the listener and cuts the connections,
    /// which is what a sidecar's route removal does
    task: tokio::task::JoinHandle<()>,
}

impl Default for FakeEgress {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeEgress {
    pub fn new() -> Self {
        Self {
            proxy: ProxyGrant {
                address: "127.0.0.1:1080".into(),
                username: "tsnet".into(),
                credential: "fake-socks-credential".into(),
            },
            http_proxy: ProxyGrant {
                address: "127.0.0.1:3128".into(),
                username: "tsnet".into(),
                credential: "fake-http-credential".into(),
            },
            peers: std::sync::Mutex::new(HashMap::new()),
            routes: tokio::sync::Mutex::new(BTreeMap::new()),
        }
    }

    /// Answer `proxy` / `httpProxy` with these grants.
    pub fn with_proxies(mut self, proxy: ProxyGrant, http_proxy: ProxyGrant) -> Self {
        self.proxy = proxy;
        self.http_proxy = http_proxy;
        self
    }

    /// Admit `target` (`<host>:<port>`, as a route names it) as a peer door,
    /// reachable at `splice_to`.
    pub fn admit(&self, target: &str, splice_to: SocketAddr) {
        self.peers
            .lock()
            .unwrap()
            .insert(target.to_string(), splice_to);
    }
}

impl Drop for FakeEgress {
    fn drop(&mut self) {
        for route in self.routes.get_mut().values() {
            route.task.abort();
        }
    }
}

#[async_trait::async_trait]
impl EgressBackend for FakeEgress {
    fn arm(&self) -> &'static str {
        "fake"
    }
    fn supported(&self) -> bool {
        true
    }
    async fn loopback_proxy(&self, _: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        Ok(self.proxy.clone())
    }
    async fn route_add(
        &self,
        _: Option<&Arc<MeshNode>>,
        id: &str,
        target: &str,
        _login: Option<&str>,
    ) -> Result<EgressRoute, EgressError> {
        let mut routes = self.routes.lock().await;
        if let Some(bound) = routes.get(id) {
            if bound.target == target {
                return Ok(EgressRoute {
                    id: id.to_string(),
                    target: bound.target.clone(),
                    listen: bound.listen.to_string(),
                });
            }
            return Err(EgressError::Conflict {
                bound_target: bound.target.clone(),
            });
        }
        let Some(splice_to) = self.peers.lock().unwrap().get(target).copied() else {
            // the code RFC 026's sidecar answers for the same refusal
            return Err(EgressError::Refused {
                code: "TARGET_NOT_PEER".into(),
                message: format!("{target} is not a peer this node admits"),
            });
        };
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| EgressError::Failed(format!("bind a loopback listener: {e}")))?;
        let listen = listener
            .local_addr()
            .map_err(|e| EgressError::Failed(format!("read the listener's address: {e}")))?;
        let task = tokio::spawn(splice_loop(listener, splice_to));
        routes.insert(
            id.to_string(),
            FakeRoute {
                target: target.to_string(),
                listen,
                task,
            },
        );
        Ok(EgressRoute {
            id: id.to_string(),
            target: target.to_string(),
            listen: listen.to_string(),
        })
    }
    async fn route_remove(&self, _: Option<&Arc<MeshNode>>, id: &str) -> Result<(), EgressError> {
        match self.routes.lock().await.remove(id) {
            Some(route) => {
                route.task.abort();
                Ok(())
            }
            None => Err(EgressError::NotFound),
        }
    }
    async fn route_list(&self, _: Option<&Arc<MeshNode>>) -> Result<Vec<EgressRoute>, EgressError> {
        Ok(self
            .routes
            .lock()
            .await
            .iter()
            .map(|(id, route)| EgressRoute {
                id: id.clone(),
                target: route.target.clone(),
                listen: route.listen.to_string(),
            })
            .collect())
    }
    async fn http_proxy(&self, _: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        Ok(self.http_proxy.clone())
    }
    async fn reset(&self) -> usize {
        let mut routes = self.routes.lock().await;
        let dropped = routes.len();
        for route in routes.values() {
            route.task.abort();
        }
        routes.clear();
        dropped
    }
}

/// The fake route's accept loop. Every connection is spliced in a task the
/// loop's JoinSet owns, so aborting the loop cuts them too.
async fn splice_loop(listener: tokio::net::TcpListener, splice_to: SocketAddr) {
    let mut connections = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((mut inbound, _)) = accepted else { return };
                connections.spawn(async move {
                    if let Ok(mut outbound) = tokio::net::TcpStream::connect(splice_to).await {
                        let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

// ---- D6 (DS-1b, 2026-10-01): the sidecar's route table, and the floor's cache of it ----

/// The sidecar's route verbs, already mapped onto [`EgressError`]: what
/// [`RouteMirror`] drives. The truffle arm implements it over the node
/// (`impl RouteSubstrate for MeshNode`), the tests over a scripted table.
/// Not [`EgressBackend`]: that trait is the facade's; this one is the
/// substrate under the cache.
#[cfg(any(test, feature = "truffle-egress"))]
#[async_trait::async_trait]
pub(crate) trait RouteSubstrate: Send + Sync {
    async fn add(
        &self,
        id: &str,
        target: &str,
        login: Option<&str>,
    ) -> Result<EgressRoute, EgressError>;
    async fn remove(&self, id: &str) -> Result<(), EgressError>;
    /// The live routes, ordered by id.
    async fn list(&self) -> Result<Vec<EgressRoute>, EgressError>;
}

/// D6 — THE FLOOR'S CACHE OF THE SIDECAR'S ROUTE TABLE, and only a cache: the
/// sidecar's table is the truth, and this never outlives the node.
///
/// Why a cache at all: the sidecar's `egress:add` refuses ANY id it holds, the
/// same target included (`EGRESS_EXISTS`, `handleEgressAdd` in
/// `packages/sidecar-slim/egress.go`), while the facade promises an idempotent
/// re-add (fieldd re-ensures a route it holds, and replays its adds after a
/// restart). The mirror is what answers a re-add without a second bind.
///
/// Why it must yield to the table: the core stops waiting for an add after
/// 20 s (`EGRESS_REPLY_TIMEOUT`) while the sidecar may still bind it, and a
/// placeholder for an add in flight is not listed. Such a route is live on the
/// sidecar and absent here. The wave-1 arm trusted the mirror, so that id then
/// answered CONFLICT to every re-add and NOT_FOUND to every remove until the
/// node was torn down (review D6). Now:
///  - a FAILED add (any refusal, the timeout included) re-reads the sidecar's
///    table before it answers: an id listed with the same target is the add
///    that landed after all, answered as bound; listed with another target, a
///    conflict naming THAT target; unlisted, the refusal stands;
///  - a remove asks the sidecar whenever a node is up, mirror or not;
///  - `reset` (the node's teardown) clears it.
#[cfg(any(test, feature = "truffle-egress"))]
#[derive(Default)]
pub(crate) struct RouteMirror {
    bound: tokio::sync::Mutex<BTreeMap<String, EgressRoute>>,
}

#[cfg(any(test, feature = "truffle-egress"))]
impl RouteMirror {
    pub(crate) async fn add(
        &self,
        substrate: &dyn RouteSubstrate,
        id: &str,
        target: &str,
        login: Option<&str>,
    ) -> Result<EgressRoute, EgressError> {
        let mut bound = self.bound.lock().await;
        if let Some(existing) = bound.get(id) {
            if existing.target == target {
                return Ok(existing.clone());
            }
            return Err(EgressError::Conflict {
                bound_target: existing.target.clone(),
            });
        }
        let refusal = match substrate.add(id, target, login).await {
            Ok(route) => {
                bound.insert(id.to_string(), route.clone());
                return Ok(route);
            }
            Err(refusal) => refusal,
        };
        // The table decides (see the type's note). A table the sidecar cannot
        // list leaves the refusal as the answer; the next verb tries again.
        let Ok(table) = substrate.list().await else {
            return Err(refusal);
        };
        *bound = table
            .into_iter()
            .map(|route| (route.id.clone(), route))
            .collect();
        match bound.get(id) {
            Some(route) if route.target == target => Ok(route.clone()),
            Some(route) => Err(EgressError::Conflict {
                bound_target: route.target.clone(),
            }),
            None => Err(refusal),
        }
    }

    /// `substrate` is `None` when no node is up: every route died with it, so
    /// the mirror entry was all that was left.
    pub(crate) async fn remove(
        &self,
        substrate: Option<&dyn RouteSubstrate>,
        id: &str,
    ) -> Result<(), EgressError> {
        let mut bound = self.bound.lock().await;
        let mirrored = bound.remove(id).is_some();
        match substrate {
            Some(substrate) => substrate.remove(id).await,
            None if mirrored => Ok(()),
            None => Err(EgressError::NotFound),
        }
    }

    pub(crate) async fn reset(&self) -> usize {
        let mut bound = self.bound.lock().await;
        let dropped = bound.len();
        bound.clear();
        dropped
    }
}

/// RFC 026 §4's coded refusals, as the sidecar on truffle's `rfc026-egress`
/// answers them (`packages/sidecar-slim/egress.go`; the core already turns a
/// `NOT_RUNNING` into `NetworkError::NotRunning`), onto the facade's arms.
/// Re-read at the release (2026-10-17): truffle-v0.7.19's `egress.go` answers
/// exactly these sixteen codes, no more and no fewer. The
/// code and message ride verbatim; only the CLASS is decided here, because the
/// class is what the wire's error kind tells a reader: `Refused`
/// (PRECONDITION_FAILED) is the caller's to fix, `Failed` (INTERNAL) is the
/// substrate's.
#[cfg(any(test, feature = "truffle-egress"))]
fn coded_refusal(code: String, message: String) -> EgressError {
    match code.as_str() {
        "NOT_FOUND" => EgressError::NotFound,
        // the node stopped under the call, or its lifecycle ended mid-add
        "NOT_RUNNING" | "NOT_READY" => EgressError::MeshDown,
        // the caller's: a target that is no admitted node, an owner a gate
        // refuses or cannot state, a malformed target or login glob
        "TARGET_NOT_PEER" | "LOGIN_REFUSED" | "LOGIN_UNKNOWN" | "INVALID_TARGET"
        | "INVALID_LOGIN" => EgressError::Refused { code, message },
        // EGRESS_EXISTS names no holder (the sidecar refuses ANY id it holds):
        // `RouteMirror::add` resolves it against the table, where the same
        // target is the route and another is a `Conflict` carrying THAT target;
        // unresolved, it stays here. With it: LISTEN_ERROR, STATUS_UNAVAILABLE,
        // INTERNAL, INVALID_COMMAND, LOOPBACK_ERROR, SERVE_ERROR, DIAL_FAILED,
        // and any code a later sidecar adds.
        _ => EgressError::Failed(format!("[{code}] {message}")),
    }
}

/// THE REAL ARM, against truffle-core as BUILT on truffle's `rfc026-egress`
/// branch (`92ab2b7`, 2026-10-01): `Node::loopback() -> LoopbackConfig`,
/// `egress_add(EgressRoute) -> BoundEgress`, `egress_remove(&str)`,
/// `egress_list() -> Vec<EgressRouteInfo>`, `egress_http_proxy() ->
/// HttpProxyConfig`, every one `Result<_, NodeError>`.
///
/// COMPILED 2026-10-01 (DS-1b) under a local `[patch.crates-io]` that points
/// truffle-core at that branch and never enters this repo; the wave-1 arm,
/// written to a relay, mapped `NetworkError` and did not compile (review D6).
/// ON BY DEFAULT since 2026-10-17 (TB-E), over the released crate (0.7.19):
/// every signature above is unchanged at the tag, and the build is the check.
#[cfg(feature = "truffle-egress")]
#[derive(Default)]
pub struct TruffleEgress {
    /// what THIS floor bound on the current node (see [`RouteMirror`])
    mirror: RouteMirror,
}

/// Every `NodeError` an egress call can carry, onto the facade's arms. Matched
/// EXHAUSTIVELY, both enums, so a variant a later truffle adds fails the build
/// at the pin move instead of landing in a catch-all unread.
#[cfg(feature = "truffle-egress")]
fn truffle_refusal(error: truffle_core::NodeError) -> EgressError {
    use truffle_core::network::NetworkError;
    use truffle_core::NodeError;
    match error {
        // `ensure_not_stopped` (the node was stopped), or the provider is not
        // running (`egress_ready`, or the sidecar's own NOT_RUNNING)
        NodeError::Stopped | NodeError::Network(NetworkError::NotRunning) => EgressError::MeshDown,
        // a sidecar below protocol 7: the core refuses before it asks
        // (`egress_ready`, SIDECAR_V7_EGRESS)
        NodeError::Network(NetworkError::Unsupported(_)) => EgressError::Unsupported,
        NodeError::Network(NetworkError::EgressError { code, message }) => {
            coded_refusal(code, message)
        }
        // The core's 20 s reply budget runs out as `SidecarError("<verb> timed
        // out")`; a dead bridge, an unexpected reply, and every variant no
        // egress call produces today are the substrate's, by their Display.
        failed @ (NodeError::Network(
            NetworkError::AlreadyRunning
            | NetworkError::StartFailed(_)
            | NetworkError::StopFailed(_)
            | NetworkError::AuthRequired { .. }
            | NetworkError::DialFailed(_)
            | NetworkError::DialTimeout(_)
            | NetworkError::ListenFailed(_)
            | NetworkError::PingFailed(_)
            | NetworkError::SidecarError(_)
            | NetworkError::BridgeError(_)
            | NetworkError::Io(_)
            | NetworkError::Serialize(_)
            | NetworkError::Internal(_)
            | NetworkError::ProxyError(_),
        )
        | NodeError::PeerNotFound(_)
        | NodeError::AmbiguousPeer { .. }
        | NodeError::PeerGone(_)
        | NodeError::ConnectionFailed(_)
        | NodeError::SendFailed(_)
        | NodeError::Envelope(_)
        | NodeError::Session(_)
        | NodeError::Transport(_)
        | NodeError::NotImplemented(_)
        | NodeError::ReservedPort(_)
        | NodeError::BuildError(_)
        | NodeError::Io(_)) => EgressError::Failed(failed.to_string()),
    }
}

#[cfg(feature = "truffle-egress")]
#[async_trait::async_trait]
impl RouteSubstrate for MeshNode {
    async fn add(
        &self,
        id: &str,
        target: &str,
        login: Option<&str>,
    ) -> Result<EgressRoute, EgressError> {
        let bound = self
            .egress_add(truffle_core::egress::EgressRoute {
                id: id.to_string(),
                target: target.to_string(),
                login: login.map(str::to_string),
            })
            .await
            .map_err(truffle_refusal)?;
        Ok(EgressRoute {
            id: bound.id,
            target: target.to_string(),
            listen: bound.listen,
        })
    }
    async fn remove(&self, id: &str) -> Result<(), EgressError> {
        self.egress_remove(id).await.map_err(truffle_refusal)
    }
    async fn list(&self) -> Result<Vec<EgressRoute>, EgressError> {
        let mut routes: Vec<EgressRoute> = self
            .egress_list()
            .await
            .map_err(truffle_refusal)?
            .into_iter()
            .map(|route| EgressRoute {
                id: route.id,
                target: route.target,
                listen: route.listen,
            })
            .collect();
        routes.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(routes)
    }
}

#[cfg(feature = "truffle-egress")]
#[async_trait::async_trait]
impl EgressBackend for TruffleEgress {
    fn arm(&self) -> &'static str {
        "truffle"
    }
    fn supported(&self) -> bool {
        true
    }
    async fn loopback_proxy(
        &self,
        node: Option<&Arc<MeshNode>>,
    ) -> Result<ProxyGrant, EgressError> {
        let node = node.ok_or(EgressError::MeshDown)?;
        let config = node.loopback().await.map_err(truffle_refusal)?;
        Ok(ProxyGrant {
            address: config.address,
            username: truffle_core::egress::LOOPBACK_SOCKS5_USERNAME.to_string(),
            credential: config.proxy_credential,
        })
    }
    async fn route_add(
        &self,
        node: Option<&Arc<MeshNode>>,
        id: &str,
        target: &str,
        login: Option<&str>,
    ) -> Result<EgressRoute, EgressError> {
        let node = node.ok_or(EgressError::MeshDown)?;
        self.mirror.add(node.as_ref(), id, target, login).await
    }
    async fn route_remove(
        &self,
        node: Option<&Arc<MeshNode>>,
        id: &str,
    ) -> Result<(), EgressError> {
        let substrate = node.map(|node| node.as_ref() as &dyn RouteSubstrate);
        self.mirror.remove(substrate, id).await
    }
    async fn route_list(
        &self,
        node: Option<&Arc<MeshNode>>,
    ) -> Result<Vec<EgressRoute>, EgressError> {
        match node {
            Some(node) => RouteSubstrate::list(node.as_ref()).await,
            None => Ok(Vec::new()),
        }
    }
    async fn http_proxy(&self, node: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        let node = node.ok_or(EgressError::MeshDown)?;
        let config = node.egress_http_proxy().await.map_err(truffle_refusal)?;
        Ok(ProxyGrant {
            address: config.address,
            // E3's Basic challenge takes ANY username (`Node::egress_http_proxy`,
            // as built), so the SOCKS5's constant serves both answers
            username: truffle_core::egress::LOOPBACK_SOCKS5_USERNAME.to_string(),
            credential: config.credential,
        })
    }
    async fn reset(&self) -> usize {
        self.mirror.reset().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A door the test controls: echoes one line back with a prefix.
    async fn echo_door() -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 64];
                    let Ok(n) = sock.read(&mut buf).await else {
                        return;
                    };
                    let mut reply = b"door:".to_vec();
                    reply.extend_from_slice(&buf[..n]);
                    let _ = sock.write_all(&reply).await;
                });
            }
        });
        (addr, task)
    }

    async fn round_trip(listen: &str, payload: &[u8]) -> std::io::Result<Vec<u8>> {
        let mut sock = tokio::net::TcpStream::connect(listen).await?;
        sock.write_all(payload).await?;
        let mut out = Vec::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let mut buf = [0u8; 64];
            loop {
                let n = sock.read(&mut buf).await?;
                if n == 0 {
                    break;
                }
                out.extend_from_slice(&buf[..n]);
                if out.len() >= payload.len() + 5 {
                    break;
                }
            }
            Ok::<_, std::io::Error>(())
        })
        .await
        .map_err(|_| std::io::Error::other("round trip timed out"))??;
        Ok(out)
    }

    const TARGET: &str = "studio.tail1234.ts.net:9422";

    #[tokio::test]
    async fn the_unsupported_arm_answers_every_verb_the_same_way() {
        let arm = UnsupportedEgress;
        assert!(!arm.supported());
        assert_eq!(arm.arm(), "unsupported");
        assert_eq!(
            arm.loopback_proxy(None).await,
            Err(EgressError::Unsupported)
        );
        assert_eq!(arm.http_proxy(None).await, Err(EgressError::Unsupported));
        assert_eq!(
            arm.route_add(None, "r1", TARGET, None).await,
            Err(EgressError::Unsupported)
        );
        assert_eq!(
            arm.route_remove(None, "r1").await,
            Err(EgressError::Unsupported)
        );
        assert_eq!(arm.route_list(None).await, Err(EgressError::Unsupported));
        assert_eq!(arm.reset().await, 0);
    }

    /// TB-E (2026-10-17) — the DEFAULT build is the truffle arm.
    #[cfg(feature = "truffle-egress")]
    #[test]
    fn production_builds_the_truffle_arm() {
        let arm = default_backend();
        assert_eq!(arm.arm(), "truffle");
        assert!(
            arm.supported(),
            "the facade asks the node; a sidecar below 7 answers per call"
        );
    }

    /// TB-E's revert path (`truffle-egress` out of `default`) builds the
    /// unsupported arm. Runs only in such a build, e.g. `cargo test -p
    /// field-native --no-default-features`.
    #[cfg(not(feature = "truffle-egress"))]
    #[test]
    fn a_build_without_the_feature_answers_from_the_unsupported_arm() {
        assert_eq!(default_backend().arm(), "unsupported");
    }

    /// TB-E — "UnsupportedEgress left only for a sidecar below 7": the floor
    /// cannot read its sidecar's protocol (`Node` publishes none), so the truffle
    /// arm answers that sidecar per call. The core refuses an egress verb below
    /// protocol 7 with `NetworkError::Unsupported` before it asks the sidecar
    /// (truffle-v0.7.19 `provider.rs` `egress_ready`), `truffle_refusal` maps it
    /// to `Unsupported`, and the mirror must hand that through unchanged on both
    /// of its paths: the add, and the table re-read a failed add makes. Anything
    /// else would turn the wire's `egress-unsupported`, which fieldd caches for
    /// the boot and answers with the OS network, into a retryable state.
    #[tokio::test]
    async fn a_sidecar_below_protocol_7_reads_unsupported_through_the_mirror() {
        struct Predates;
        #[async_trait::async_trait]
        impl RouteSubstrate for Predates {
            async fn add(
                &self,
                _: &str,
                _: &str,
                _: Option<&str>,
            ) -> Result<EgressRoute, EgressError> {
                Err(EgressError::Unsupported)
            }
            async fn remove(&self, _: &str) -> Result<(), EgressError> {
                Err(EgressError::Unsupported)
            }
            async fn list(&self) -> Result<Vec<EgressRoute>, EgressError> {
                Err(EgressError::Unsupported)
            }
        }
        let mirror = RouteMirror::default();
        assert_eq!(
            mirror.add(&Predates, "r1", TARGET, None).await,
            Err(EgressError::Unsupported)
        );
        assert_eq!(
            mirror.remove(Some(&Predates), "r1").await,
            Err(EgressError::Unsupported)
        );
        assert_eq!(mirror.reset().await, 0, "nothing was bound");
    }

    #[tokio::test]
    async fn a_fake_route_splices_a_real_connection_to_the_admitted_door() {
        let (door, _door_task) = echo_door().await;
        let fake = FakeEgress::new();
        fake.admit(TARGET, door);
        let route = fake.route_add(None, "r1", TARGET, None).await.unwrap();
        assert_eq!(route.target, TARGET);
        assert!(route.listen.starts_with("127.0.0.1:"), "{}", route.listen);
        assert_ne!(
            route.listen,
            door.to_string(),
            "a route is its own listener"
        );
        let reply = round_trip(&route.listen, b"hello").await.unwrap();
        assert_eq!(reply, b"door:hello");
    }

    #[tokio::test]
    async fn a_re_add_answers_the_bound_route_and_a_re_aim_is_a_conflict() {
        let (door, _door_task) = echo_door().await;
        let fake = FakeEgress::new();
        fake.admit(TARGET, door);
        fake.admit("other.tail1234.ts.net:9422", door);
        let first = fake.route_add(None, "r1", TARGET, None).await.unwrap();
        let again = fake.route_add(None, "r1", TARGET, None).await.unwrap();
        assert_eq!(
            first, again,
            "the same id and target answers the SAME listener"
        );
        assert_eq!(
            fake.route_add(None, "r1", "other.tail1234.ts.net:9422", None)
                .await,
            Err(EgressError::Conflict {
                bound_target: TARGET.into()
            })
        );
        assert_eq!(fake.route_list(None).await.unwrap(), vec![first]);
    }

    #[tokio::test]
    async fn a_target_that_is_not_an_admitted_peer_is_refused_at_add() {
        let fake = FakeEgress::new();
        let refused = fake.route_add(None, "r1", TARGET, None).await;
        assert!(
            matches!(
                refused,
                Err(EgressError::Refused { ref code, ref message })
                    if code == "TARGET_NOT_PEER" && message.contains("not a peer")
            ),
            "{refused:?}"
        );
        assert!(fake.route_list(None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn remove_closes_the_listener_and_an_unknown_id_is_not_found() {
        let (door, _door_task) = echo_door().await;
        let fake = FakeEgress::new();
        fake.admit(TARGET, door);
        let route = fake.route_add(None, "r1", TARGET, None).await.unwrap();
        fake.route_remove(None, "r1").await.unwrap();
        assert_eq!(
            fake.route_remove(None, "r1").await,
            Err(EgressError::NotFound)
        );
        // the listener is gone: a dial is refused or cut before the door answers
        let after = round_trip(&route.listen, b"late").await;
        assert!(
            after.map(|bytes| bytes.is_empty()).unwrap_or(true),
            "a removed route must not reach the door"
        );
    }

    #[tokio::test]
    async fn reset_drops_every_route_and_says_how_many() {
        let (door, _door_task) = echo_door().await;
        let fake = FakeEgress::new();
        fake.admit(TARGET, door);
        fake.admit("other.tail1234.ts.net:9422", door);
        fake.route_add(None, "r1", TARGET, None).await.unwrap();
        fake.route_add(None, "r2", "other.tail1234.ts.net:9422", None)
            .await
            .unwrap();
        assert_eq!(fake.reset().await, 2);
        assert!(fake.route_list(None).await.unwrap().is_empty());
        assert_eq!(fake.reset().await, 0, "an empty table resets to nothing");
    }

    #[test]
    fn a_proxy_grant_never_prints_its_credential() {
        let grant = ProxyGrant {
            address: "127.0.0.1:1080".into(),
            username: "tsnet".into(),
            credential: "hunter2".into(),
        };
        let shown = format!("{grant:?}");
        assert!(shown.contains("127.0.0.1:1080"), "{shown}");
        assert!(!shown.contains("hunter2"), "{shown}");
    }

    // ---- D6: the mirror yields to the sidecar's table ----

    const OTHER: &str = "other.tail1234.ts.net:9422";

    /// The sidecar's route table as `egress.go` keeps it: an add refuses ANY
    /// id it holds (`EGRESS_EXISTS`, the same target included), and an id
    /// reserved by an add still in flight is refused too but NOT listed.
    /// `next_add` scripts one refusal; with `lands` the route binds anyway,
    /// which is the core's 20 s timeout answering while the sidecar finishes.
    #[derive(Default)]
    struct ScriptedSidecar {
        table: std::sync::Mutex<BTreeMap<String, EgressRoute>>,
        in_flight: std::sync::Mutex<Vec<String>>,
        next_add: std::sync::Mutex<Option<(EgressError, bool)>>,
        calls: std::sync::Mutex<Vec<String>>,
        port: std::sync::atomic::AtomicU16,
    }

    impl ScriptedSidecar {
        fn holding(id: &str, target: &str) -> Self {
            let sidecar = Self::default();
            sidecar.table.lock().unwrap().insert(
                id.into(),
                EgressRoute {
                    id: id.into(),
                    target: target.into(),
                    listen: "127.0.0.1:47001".into(),
                },
            );
            sidecar
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
        fn listed(&self) -> Vec<String> {
            self.table.lock().unwrap().keys().cloned().collect()
        }
    }

    #[async_trait::async_trait]
    impl RouteSubstrate for ScriptedSidecar {
        async fn add(
            &self,
            id: &str,
            target: &str,
            _login: Option<&str>,
        ) -> Result<EgressRoute, EgressError> {
            self.calls.lock().unwrap().push(format!("add {id}"));
            let mut table = self.table.lock().unwrap();
            let reserved = self.in_flight.lock().unwrap().iter().any(|held| held == id);
            if table.contains_key(id) || reserved {
                return Err(coded_refusal(
                    "EGRESS_EXISTS".into(),
                    "an egress route with this id already exists".into(),
                ));
            }
            let port = 48_000 + self.port.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let route = EgressRoute {
                id: id.into(),
                target: target.into(),
                listen: format!("127.0.0.1:{port}"),
            };
            match self.next_add.lock().unwrap().take() {
                Some((refusal, lands)) => {
                    if lands {
                        table.insert(id.into(), route);
                    }
                    Err(refusal)
                }
                None => {
                    table.insert(id.into(), route.clone());
                    Ok(route)
                }
            }
        }
        async fn remove(&self, id: &str) -> Result<(), EgressError> {
            self.calls.lock().unwrap().push(format!("remove {id}"));
            match self.table.lock().unwrap().remove(id) {
                Some(_) => Ok(()),
                None => Err(coded_refusal(
                    "NOT_FOUND".into(),
                    "no egress route with this id".into(),
                )),
            }
        }
        async fn list(&self) -> Result<Vec<EgressRoute>, EgressError> {
            self.calls.lock().unwrap().push("list".into());
            Ok(self.table.lock().unwrap().values().cloned().collect())
        }
    }

    /// The core's own words when its 20 s reply budget runs out
    /// (`egress_rpc`), as `truffle_refusal` classes them.
    fn timed_out() -> EgressError {
        EgressError::Failed("network error: sidecar error: egress:add timed out".into())
    }

    #[tokio::test]
    async fn a_timed_out_add_that_landed_is_the_route_and_a_re_add_answers_it() {
        let sidecar = ScriptedSidecar::default();
        *sidecar.next_add.lock().unwrap() = Some((timed_out(), true));
        let mirror = RouteMirror::default();
        let first = mirror.add(&sidecar, "r1", TARGET, None).await;
        let landed = sidecar.table.lock().unwrap().get("r1").cloned();
        let landed = landed.expect("the sidecar bound it");
        assert_eq!(
            first,
            Ok(landed.clone()),
            "the table answers, not the timeout"
        );
        assert_eq!(mirror.add(&sidecar, "r1", TARGET, None).await, Ok(landed));
        assert_eq!(
            sidecar.calls(),
            vec!["add r1", "list"],
            "the re-add is the mirror's answer, never a second bind"
        );
    }

    #[tokio::test]
    async fn an_exists_refusal_names_the_holders_target_never_the_sidecars_message() {
        // a route the sidecar holds and the mirror lost (a late add), aimed elsewhere
        let elsewhere = ScriptedSidecar::holding("r1", OTHER);
        assert_eq!(
            RouteMirror::default()
                .add(&elsewhere, "r1", TARGET, None)
                .await,
            Err(EgressError::Conflict {
                bound_target: OTHER.into()
            })
        );
        // aimed at the same target, it simply IS the route
        let same = ScriptedSidecar::holding("r1", TARGET);
        let mirror = RouteMirror::default();
        let adopted = mirror.add(&same, "r1", TARGET, None).await;
        assert_eq!(
            adopted.map(|route| route.listen),
            Ok("127.0.0.1:47001".into())
        );
        assert_eq!(
            mirror.remove(Some(&same), "r1").await,
            Ok(()),
            "and it is removable"
        );
    }

    #[tokio::test]
    async fn remove_reaches_the_sidecar_for_a_route_the_mirror_never_held() {
        let sidecar = ScriptedSidecar::holding("r1", TARGET);
        let mirror = RouteMirror::default();
        assert_eq!(mirror.remove(Some(&sidecar), "r1").await, Ok(()));
        assert!(sidecar.listed().is_empty(), "the listener left the sidecar");
        assert_eq!(
            mirror.remove(Some(&sidecar), "r1").await,
            Err(EgressError::NotFound),
            "a second remove hears the sidecar's NOT_FOUND"
        );
    }

    #[tokio::test]
    async fn an_add_still_in_flight_on_the_sidecar_stays_the_substrates_refusal() {
        let sidecar = ScriptedSidecar::default();
        sidecar.in_flight.lock().unwrap().push("r1".into());
        let refused = RouteMirror::default()
            .add(&sidecar, "r1", TARGET, None)
            .await;
        assert!(
            matches!(refused, Err(EgressError::Failed(ref m)) if m.starts_with("[EGRESS_EXISTS] ")),
            "no holder is listed, so no conflict can be named: {refused:?}"
        );
    }

    #[tokio::test]
    async fn a_refused_add_stands_verbatim_and_binds_nothing() {
        let sidecar = ScriptedSidecar::default();
        let refusal = coded_refusal(
            "TARGET_NOT_PEER".into(),
            "studio.tail1234.ts.net is not a node of this node's tailnet".into(),
        );
        *sidecar.next_add.lock().unwrap() = Some((refusal.clone(), false));
        let mirror = RouteMirror::default();
        assert_eq!(mirror.add(&sidecar, "r1", TARGET, None).await, Err(refusal));
        assert!(sidecar.listed().is_empty());
        assert!(
            mirror.add(&sidecar, "r1", TARGET, None).await.is_ok(),
            "nothing stale was cached: the next add binds"
        );
    }

    #[tokio::test]
    async fn with_no_node_a_mirrored_route_died_with_it() {
        let sidecar = ScriptedSidecar::default();
        let mirror = RouteMirror::default();
        mirror.add(&sidecar, "r1", TARGET, None).await.unwrap();
        assert_eq!(mirror.remove(None, "r1").await, Ok(()));
        assert_eq!(mirror.remove(None, "r1").await, Err(EgressError::NotFound));
        mirror.add(&sidecar, "r2", OTHER, None).await.unwrap();
        assert_eq!(mirror.reset().await, 1);
        assert_eq!(mirror.reset().await, 0);
    }

    #[test]
    fn the_sidecars_codes_keep_their_class() {
        let class = |code: &str| coded_refusal(code.into(), "m".into());
        assert_eq!(class("NOT_FOUND"), EgressError::NotFound);
        for code in ["NOT_RUNNING", "NOT_READY"] {
            assert_eq!(class(code), EgressError::MeshDown, "{code}");
        }
        for code in [
            "TARGET_NOT_PEER",
            "LOGIN_REFUSED",
            "LOGIN_UNKNOWN",
            "INVALID_TARGET",
            "INVALID_LOGIN",
        ] {
            let refused = EgressError::Refused {
                code: code.into(),
                message: "m".into(),
            };
            assert_eq!(class(code), refused, "{code} is the caller's to fix");
        }
        for code in [
            "EGRESS_EXISTS",
            "LISTEN_ERROR",
            "STATUS_UNAVAILABLE",
            "INTERNAL",
            "INVALID_COMMAND",
            "LOOPBACK_ERROR",
            "SERVE_ERROR",
            "DIAL_FAILED",
            "A_CODE_A_LATER_SIDECAR_ADDS",
        ] {
            let failed = EgressError::Failed(format!("[{code}] m"));
            assert_eq!(class(code), failed, "{code} is the substrate's");
        }
    }

    /// The real arm's error mapping, against the crate as built. Runs only
    /// with the feature on (the local patch): the exhaustive match in
    /// `truffle_refusal` is the compile-time half of the same check.
    #[cfg(feature = "truffle-egress")]
    #[test]
    fn every_node_error_lands_on_one_arm() {
        use truffle_core::network::NetworkError;
        use truffle_core::NodeError;
        let net = NodeError::Network;
        assert_eq!(truffle_refusal(NodeError::Stopped), EgressError::MeshDown);
        assert_eq!(
            truffle_refusal(net(NetworkError::NotRunning)),
            EgressError::MeshDown
        );
        assert_eq!(
            truffle_refusal(net(NetworkError::Unsupported(
                // the core's own words at truffle-v0.7.19 (`egress_ready`)
                "sidecar protocol v6 predates RFC 026 egress (egress:add); upgrade the \
                 sidecar binary (needs v7)"
                    .into()
            ))),
            EgressError::Unsupported
        );
        assert_eq!(
            truffle_refusal(net(NetworkError::EgressError {
                code: "LOGIN_REFUSED".into(),
                message: "the node's login gate refuses it".into(),
            })),
            EgressError::Refused {
                code: "LOGIN_REFUSED".into(),
                message: "the node's login gate refuses it".into(),
            }
        );
        assert_eq!(
            truffle_refusal(net(NetworkError::EgressError {
                code: "NOT_FOUND".into(),
                message: "no egress route with this id".into(),
            })),
            EgressError::NotFound
        );
        assert_eq!(
            truffle_refusal(net(NetworkError::EgressError {
                code: "LISTEN_ERROR".into(),
                message: "address in use".into(),
            })),
            EgressError::Failed("[LISTEN_ERROR] address in use".into())
        );
        assert_eq!(
            truffle_refusal(net(NetworkError::SidecarError(
                "egress:add timed out".into()
            ))),
            timed_out(),
            "the core's timeout reads as the mirror's tests assume"
        );
        for (error, shown) in [
            (
                net(NetworkError::BridgeError("closed".into())),
                "network error: bridge error: closed",
            ),
            (NodeError::PeerGone("p".into()), "peer gone: p"),
            (NodeError::NotImplemented("x".into()), "not implemented: x"),
            (NodeError::BuildError("b".into()), "build error: b"),
        ] {
            assert_eq!(truffle_refusal(error), EgressError::Failed(shown.into()));
        }
    }
}
