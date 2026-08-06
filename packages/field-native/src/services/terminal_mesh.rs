//! GT-4a / NF-remote (native-floor §7) — the terminal floor's NAMED EXCEPTION
//! to "no mesh coupling". Everything that knows `ghosttea-truffle` exists lives
//! in this file; `terminal.rs` gains one seam and one honest sentence of health.
//!
//! THE NODE IS BORROWED, NEVER MINTED. design-02's v0.5 law is that truffle
//! lives only in the mesh-gateway, and this does not bend it: the gateway owns
//! the single `Node`, `MeshHandle` hands out an `Arc` of it, and
//! `TruffleTerminalMesh::new` takes exactly that `Arc` — which is the entire
//! reason `truffle-core` had to be one exact version across both crates (the
//! GT-4a2 pin event). A second node would be a second tailnet identity for one
//! device: two device IDs, two sidecars, two advertisement stores, and a peer
//! with no way to tell which of them is us.
//!
//! THE TWO FLAGS, AND WHICH WAY THE DEPENDENCY RUNS. `FIELD_NATIVE_MESH` says
//! this device has a tailnet identity. `FIELD_NATIVE_TERMINAL_MESH` says the
//! terminal floor publishes itself on it. The second REQUIRES the first, and
//! the honest answer to "terminal mesh on, gateway off" is a degraded terminal
//! mesh on a floor that keeps serving locally — never a panic, never a refusal
//! to serve PTYs, and never a node of our own. The reason surfaced is the
//! gateway's own health detail, quoted rather than guessed at.
//!
//! WHY THE WAIT IS BOUNDED. Upstream takes the adapter BEFORE the service
//! serves (`with_terminal_mesh` consumes the builder, and the runtime the
//! service dispatches remote ops to is the one inside the adapter), so the node
//! has to exist at construction time. Blocking PTYs on a tailnet login is the
//! worse failure, so the wait has a budget and losing it costs the mesh, not
//! the floor. Named residual: a node that arrives after the budget does not
//! attach until the pair bounces — an upstream `attach mesh later` seam
//! (injecting the `MeshRuntime` rather than owning it) is what would delete
//! that, and it is a petition candidate, not a workaround we can write here.

use crate::config::NativeConfig;
use crate::contracts::UnitState;
use crate::registries;
use crate::services::mesh::{MeshHandle, MeshNode};
use ghosttea_truffle::{TruffleTerminalConfig, TruffleTerminalMesh};
use std::sync::Arc;
use std::time::Duration;

/// How long the floor waits for the gateway's node before serving without it.
///
/// It covers the steady state — a device whose tailnet identity is already
/// authenticated brings a node up in seconds — and deliberately not the first
/// interactive login, which is unbounded by nature. The gateway reaching
/// `disabled`/`degraded` short-circuits this, so the budget is only ever spent
/// on a node that is genuinely still coming.
pub const ATTACH_BUDGET: Duration = Duration::from_secs(20);

/// How often the gateway's health is re-read while waiting. The node itself
/// arrives on a watch channel and needs no poll; this only catches the gateway
/// giving up, which is a rare, terminal transition.
const GATEWAY_POLL: Duration = Duration::from_millis(250);

/// Upstream derives its advertisement store id as `{service_name}.hosts`
/// (`ghosttea-truffle` 0.9.2, `TruffleTerminalMesh::serve`). We hold the store
/// id as law (`STORES.TERMINAL_HOSTS`) and hand upstream the service name that
/// produces it, so the registry constant is CONSUMED rather than mirrored — the
/// derivation is asserted in both directions by `tests/terminal_mesh.rs`.
const HOSTS_STORE_SUFFIX: &str = ".hosts";

/// What the config asks of the mesh, resolved before a single upstream type is
/// constructed. `Off` is the default and means absent, not idle.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MeshPlan {
    /// The pre-GT-4 floor, bit for bit: the crate is linked and never touched.
    Off,
    /// The floor should publish itself. Carries the mirror-write capability,
    /// which is `None` for a view-only host.
    Requested { mirror_write: Option<String> },
}

impl MeshPlan {
    pub fn resolve(config: &NativeConfig) -> Self {
        if !config.terminal_mesh_enabled {
            return Self::Off;
        }
        Self::Requested {
            mirror_write: config.terminal_mirror_write.clone(),
        }
    }

    pub fn is_off(&self) -> bool {
        matches!(self, Self::Off)
    }

    /// Whether a remote viewer can earn WRITE at all on this host. Never the
    /// value — a log line or a health detail carrying the capability would be
    /// the leak the constant-time compare exists to prevent.
    pub fn offers_mirror_write(&self) -> bool {
        matches!(
            self,
            Self::Requested {
                mirror_write: Some(_)
            }
        )
    }
}

/// The service name whose `{name}.hosts` store IS `STORES.TERMINAL_HOSTS`.
///
/// Fallible rather than `expect`ing: if the registry constant is ever respelled
/// without the suffix upstream derives from, the floor degrades its mesh with a
/// legible reason instead of aborting a daemon over a naming change.
pub fn service_name() -> anyhow::Result<&'static str> {
    registries::stores::TERMINAL_HOSTS
        .strip_suffix(HOSTS_STORE_SUFFIX)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "registries STORES.TERMINAL_HOSTS ({}) no longer ends in {HOSTS_STORE_SUFFIX}, \
                 which is how ghosttea-truffle derives the advertisement store from the service name",
                registries::stores::TERMINAL_HOSTS
            )
        })
}

/// Map our config onto upstream's. Ports come from the generated registries;
/// the capability is the mirror-write string verbatim.
///
/// `allow_tailnet_write` is FALSE and stays false. Upstream's `access_for`
/// short-circuits to `ReadWrite` for EVERY viewer when it is set, which is
/// precisely the posture GT-D7 refuses: view without the string, control with
/// it. Our config feeds their gate; it does not replace it.
pub fn truffle_config(mirror_write: Option<String>) -> anyhow::Result<TruffleTerminalConfig> {
    Ok(TruffleTerminalConfig {
        service_name: service_name()?.to_owned(),
        quic_port: registries::ports::GHOSTTEA_TSP1_QUIC,
        compact_port: registries::ports::GHOSTTEA_TSP1_TCP,
        capability: mirror_write,
        allow_tailnet_write: false,
        ..TruffleTerminalConfig::default()
    })
}

/// What the floor got when it asked for a mesh.
pub enum Attachment {
    /// Hand this to `TerminalService::with_terminal_mesh`.
    Attached(Box<TruffleTerminalMesh>),
    /// Serve locally and say this. The string is a health detail and a log
    /// field, so it never carries a capability or a token.
    Unavailable(String),
}

/// Why a bounded wait ended without a node.
enum Lapse {
    /// The gateway will never produce one; its own detail says why.
    Gateway(String),
    Budget,
}

/// Borrow the gateway's node and build the adapter, or say honestly why not.
/// Never constructs a node, and never returns `Err` — a floor that cannot join
/// the mesh is a degraded mesh, not a failed floor.
///
/// Owned arguments because the caller spawns this: the wait runs beside font
/// discovery rather than after it, so the budget overlaps a cost the boot was
/// already paying.
pub async fn attach(
    mirror_write: Option<String>,
    mesh: MeshHandle,
    budget: Duration,
) -> Attachment {
    let node = match wait_for_node(&mesh, budget).await {
        Ok(node) => node,
        Err(Lapse::Gateway(reason)) => {
            return Attachment::Unavailable(format!(
                "the mesh gateway owns the tailnet node and has none to lend: {reason}"
            ));
        }
        Err(Lapse::Budget) => {
            return Attachment::Unavailable(format!(
                "the tailnet node was not up within {}s; restart the pair once the mesh is up",
                budget.as_secs()
            ));
        }
    };
    let config = match truffle_config(mirror_write) {
        Ok(config) => config,
        Err(error) => return Attachment::Unavailable(format!("{error:#}")),
    };
    match TruffleTerminalMesh::new(node, config) {
        Ok(mesh) => Attachment::Attached(Box::new(mesh)),
        Err(error) => {
            Attachment::Unavailable(format!("the terminal mesh adapter was refused: {error:#}"))
        }
    }
}

/// The node, the gateway's surrender, or the budget — whichever comes first.
async fn wait_for_node(mesh: &MeshHandle, budget: Duration) -> Result<Arc<MeshNode>, Lapse> {
    tokio::select! {
        // Biased so a node that is already present wins over a gateway health
        // that has not caught up with it yet.
        biased;
        node = mesh.wait_for_node() => Ok(node),
        reason = gateway_gave_up(mesh) => Err(Lapse::Gateway(reason)),
        _ = tokio::time::sleep(budget) => Err(Lapse::Budget),
    }
}

/// Resolves only when the gateway reaches a state from which no node can come.
async fn gateway_gave_up(mesh: &MeshHandle) -> String {
    loop {
        let health = mesh.health();
        if matches!(
            health.state,
            UnitState::Disabled | UnitState::Degraded | UnitState::Crashed
        ) {
            return health
                .detail
                .unwrap_or_else(|| format!("the mesh gateway is {}", health.state));
        }
        tokio::time::sleep(GATEWAY_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plan_is_off_unless_the_flag_asks_for_it() {
        let config = NativeConfig::for_data_dir(std::path::PathBuf::from("/tmp/vf-plan"));
        assert_eq!(MeshPlan::resolve(&config), MeshPlan::Off);
        assert!(MeshPlan::resolve(&config).is_off());
    }

    #[test]
    fn the_plan_carries_the_mirror_write_string_and_never_advertises_the_value() {
        let mut config = NativeConfig::for_data_dir(std::path::PathBuf::from("/tmp/vf-plan"));
        config.terminal_mesh_enabled = true;
        assert!(!MeshPlan::resolve(&config).offers_mirror_write());
        config.terminal_mirror_write = Some("shibboleth".into());
        let plan = MeshPlan::resolve(&config);
        assert!(plan.offers_mirror_write());
        assert_eq!(
            plan,
            MeshPlan::Requested {
                mirror_write: Some("shibboleth".into())
            }
        );
    }
}
