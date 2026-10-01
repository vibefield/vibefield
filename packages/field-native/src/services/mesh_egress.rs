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
//! THREE ARMS, one trait, because the substrate does not exist yet:
//!
//!   [`UnsupportedEgress`] — PRODUCTION TODAY. truffle-core 0.7.14's sidecar
//!       has no egress verb, so every call answers `egress-unsupported`: a
//!       capability fact that holds for the floor's life, which is what lets
//!       fieldd fall back to the OS network without retrying.
//!   [`FakeEgress`] — TESTS. Real loopback listeners that splice to an address
//!       the test controls, so the facade, the table, the reset and fieldd's
//!       consumers are exercised without a tailnet.
//!   `TruffleEgress` — written against the API the wave plan names
//!       (`Node::loopback`, `egress_add/remove/list`, `egress_http_proxy`),
//!       behind the cargo feature `truffle-egress`, OFF by default. It does
//!       not compile against the pinned 0.7.14 and must not: the pin moves
//!       only as a deliberate EL8 event, on James's petition window.
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

/// The arm production builds today (see the module note).
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

/// PRODUCTION TODAY — the sidecar truffle-core 0.7.14 ships has no egress verb
/// (petition T7), so every call is the same honest answer.
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

/// THE REAL ARM, against truffle-core's RFC 026 API as the truffle lane built
/// it (`draft/work/ds-wave1-2026-09-30.md`, 2026-10-01 00:06):
/// `Node::loopback() -> LoopbackConfig {address, proxy_credential,
/// local_api_credential: Option}`, `egress_add(EgressRoute {id, target, login:
/// Option}) -> BoundEgress {id, listen}`, `egress_remove(&str)`,
/// `egress_list() -> Vec<EgressRouteInfo {id, target, listen, login}>`,
/// `egress_http_proxy() -> HttpProxyConfig {address, credential}`; the SOCKS5
/// username is the constant `LOOPBACK_SOCKS5_USERNAME` ("tsnet"); a protocol-5
/// sidecar makes the core refuse locally with `NetworkError::Unsupported`, a
/// stopped node is `NotRunning`, and the sidecar's refusals are
/// `NetworkError::EgressError {code, message}`.
///
/// UNCOMPILED on purpose: the feature is off by default and truffle-core
/// 0.7.14 has none of it. The NAMES above are relayed facts; the module paths
/// (`truffle_core::egress`, `truffle_core::network::NetworkError`), whether
/// each call is async, and the error type each returns are this lane's
/// reading, not a checked fact — the first build with `--features
/// truffle-egress` against the RFC 026 crate, on the petition window (which
/// moves truffle-core AND the npm sidecars together, protocol 5 → 6, EL8), is
/// the check, and it will name whatever differs.
#[cfg(feature = "truffle-egress")]
#[derive(Default)]
pub struct TruffleEgress {
    /// what THIS floor bound on the current node, for the idempotent re-add
    /// and the conflict rule (the sidecar keeps its own table; this mirror
    /// never outlives the node — `reset` clears it with the teardown)
    bound: tokio::sync::Mutex<BTreeMap<String, EgressRoute>>,
}

/// The core's refusal → the facade's. Classified only as far as the wire
/// needs; the sidecar's code and message ride verbatim.
#[cfg(feature = "truffle-egress")]
fn truffle_refusal(error: truffle_core::network::NetworkError) -> EgressError {
    use truffle_core::network::NetworkError;
    match error {
        // a protocol-5 sidecar: the core refuses before asking
        NetworkError::Unsupported { .. } => EgressError::Unsupported,
        NetworkError::NotRunning => EgressError::MeshDown,
        NetworkError::EgressError { code, message } => match code.as_str() {
            "NOT_FOUND" => EgressError::NotFound,
            // our mirror is checked first, so the sidecar holding an id we did
            // not bind is a desync worth naming, not a re-aim
            "EGRESS_EXISTS" => EgressError::Conflict {
                bound_target: message,
            },
            "LISTEN_ERROR" => EgressError::Failed(format!("[{code}] {message}")),
            // TARGET_NOT_PEER · LOGIN_REFUSED · LOGIN_UNKNOWN · INVALID_TARGET ·
            // INVALID_LOGIN — the caller's to fix, verbatim
            _ => EgressError::Refused { code, message },
        },
        other => EgressError::Failed(other.to_string()),
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
        let mut bound = self.bound.lock().await;
        if let Some(existing) = bound.get(id) {
            if existing.target == target {
                return Ok(existing.clone());
            }
            return Err(EgressError::Conflict {
                bound_target: existing.target.clone(),
            });
        }
        let answer = node
            .egress_add(truffle_core::egress::EgressRoute {
                id: id.to_string(),
                target: target.to_string(),
                login: login.map(str::to_string),
            })
            .await
            .map_err(truffle_refusal)?;
        let route = EgressRoute {
            id: answer.id,
            target: target.to_string(),
            listen: answer.listen,
        };
        bound.insert(id.to_string(), route.clone());
        Ok(route)
    }
    async fn route_remove(
        &self,
        node: Option<&Arc<MeshNode>>,
        id: &str,
    ) -> Result<(), EgressError> {
        let mut bound = self.bound.lock().await;
        if bound.remove(id).is_none() {
            return Err(EgressError::NotFound);
        }
        // No node = the route died with it; the mirror entry was all that was left.
        let Some(node) = node else { return Ok(()) };
        node.egress_remove(id).await.map_err(truffle_refusal)
    }
    async fn route_list(
        &self,
        node: Option<&Arc<MeshNode>>,
    ) -> Result<Vec<EgressRoute>, EgressError> {
        let Some(node) = node else {
            return Ok(Vec::new());
        };
        let mut routes: Vec<EgressRoute> = node
            .egress_list()
            .await
            .map_err(truffle_refusal)?
            .into_iter()
            .map(|r| EgressRoute {
                id: r.id,
                target: r.target,
                listen: r.listen,
            })
            .collect();
        routes.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(routes)
    }
    async fn http_proxy(&self, node: Option<&Arc<MeshNode>>) -> Result<ProxyGrant, EgressError> {
        let node = node.ok_or(EgressError::MeshDown)?;
        let config = node.egress_http_proxy().await.map_err(truffle_refusal)?;
        Ok(ProxyGrant {
            address: config.address,
            // the plan names no username for E3's Basic challenge; this lane
            // assumes the same fixed one — the petition window's build checks it
            username: truffle_core::egress::LOOPBACK_SOCKS5_USERNAME.to_string(),
            credential: config.credential,
        })
    }
    async fn reset(&self) -> usize {
        let mut bound = self.bound.lock().await;
        let dropped = bound.len();
        bound.clear();
        dropped
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

    #[cfg(not(feature = "truffle-egress"))]
    #[test]
    fn production_builds_the_unsupported_arm_until_the_petition_window() {
        assert_eq!(default_backend().arm(), "unsupported");
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
}
