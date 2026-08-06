//! GT-4a — the terminal floor's mesh exception, everything of it that is
//! provable WITHOUT a tailnet. The rows that genuinely need two nodes live in
//! `terminal_mesh_probe.rs` and are `#[ignore]`d; these are not, because the
//! claims below are exactly the ones a regression would break silently:
//!
//!   1. the flag is off by default, and off means ABSENT
//!   2. `terminal.v1.hosts` is CONSUMED from the registries, not respelled
//!   3. `allow_tailnet_write` is never true — our config feeds upstream's gate
//!      instead of replacing it
//!   4. terminal-mesh-on + gateway-off is a degraded MESH on a serving floor,
//!      reached fast and explained in the gateway's own words
//!   5. the mirror-write string never reaches a health detail

use field_native::config::{NativeConfig, TERMINAL_MIRROR_WRITE_ENV};
use field_native::registries;
use field_native::services::terminal_client::ControlClient;
use field_native::services::terminal_mesh::{self, MeshPlan};
use field_native::{bootstrap, RunningDaemon};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

/// macOS caps a Unix socket path at ~104 bytes and these sockets sit three
/// levels under the data dir, so tests root at /tmp (the `sun_path` law from
/// tests/terminal_unit.rs, which this file follows rather than rediscovers).
fn short_tempdir() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("vfgt4")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let probe = dir.path().join("native/run/termctl.sock");
    assert!(
        probe.as_os_str().len() < 100,
        "socket path would risk sun_path truncation: {}",
        probe.display()
    );
    dir
}

fn unit<'a>(health: &'a Value, name: &str) -> &'a Value {
    health["units"]
        .as_array()
        .expect("units")
        .iter()
        .find(|u| u["unit"] == name)
        .unwrap_or_else(|| panic!("unit {name} missing from {health}"))
}

/// The terminal unit's health once it has stopped saying `starting`. The unit
/// builds its text engine off the boot path, and with GT-4a it may also be
/// waiting on a node, so a test that reads the first snapshot reads a
/// half-built floor.
async fn settled_terminal(daemon: &RunningDaemon) -> Value {
    let mut rx = daemon.state.health_tx.subscribe();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let health = serde_json::to_value(&*rx.borrow_and_update()).expect("health json");
        let terminal = unit(&health, "terminal").clone();
        if terminal["state"] != "starting" {
            return terminal;
        }
        tokio::select! {
            changed = rx.changed() => changed.expect("health channel closed"),
            _ = tokio::time::sleep_until(deadline.into()) => {
                panic!("the terminal unit never left starting: {terminal}")
            }
        }
    }
}

fn detail(unit: &Value) -> String {
    unit["detail"]
        .as_str()
        .unwrap_or_else(|| panic!("the unit owes a detail: {unit}"))
        .to_owned()
}

// ---- 1/2/3: the plan and the mapping, no daemon required --------------------

#[test]
fn the_advertisement_store_is_the_registry_constant_in_both_directions() {
    let name = terminal_mesh::service_name().expect("the store id ends in the derived suffix");
    // Upstream builds `{service_name}.hosts`; we hold the STORE as law and hand
    // it the name. Asserting the round trip is what makes the constant
    // consumed rather than mirrored.
    assert_eq!(
        format!("{name}.hosts"),
        registries::stores::TERMINAL_HOSTS,
        "the service name must be the one whose derived store IS STORES.TERMINAL_HOSTS"
    );
    assert_eq!(name, "terminal.v1");

    let config = terminal_mesh::truffle_config(None).expect("upstream config");
    assert_eq!(config.service_name, name);
}

#[test]
fn the_ports_come_from_the_registries_and_never_from_upstream_defaults() {
    let config = terminal_mesh::truffle_config(None).expect("upstream config");
    assert_eq!(config.quic_port, registries::ports::GHOSTTEA_TSP1_QUIC);
    assert_eq!(config.compact_port, registries::ports::GHOSTTEA_TSP1_TCP);
}

#[test]
fn write_is_gated_by_the_capability_and_never_opened_to_the_whole_tailnet() {
    // GT-D7: view without the string, control with it. Upstream's `access_for`
    // short-circuits to ReadWrite for EVERY viewer when `allow_tailnet_write`
    // is set, so this field is the one that must never flip — with or without a
    // mirror-write string configured.
    let view_only = terminal_mesh::truffle_config(None).expect("upstream config");
    assert!(!view_only.allow_tailnet_write);
    assert!(view_only.capability.is_none());

    let gated = terminal_mesh::truffle_config(Some("shibboleth".into())).expect("upstream config");
    assert!(
        !gated.allow_tailnet_write,
        "a configured mirror-write must gate write, never open it"
    );
    assert_eq!(gated.capability.as_deref(), Some("shibboleth"));
}

#[test]
fn the_mirror_write_variable_stays_inside_the_el7_strip_class() {
    // EL7: ghosttea's strip list is prefix-based, so the variable is protected
    // by its NAME. fieldd's kill-matrix proves the class is actually stripped
    // from a live PTY; this proves our secret is in that class, which is the
    // half a rename could silently break.
    assert!(
        registries::ENV_PREFIXES
            .iter()
            .any(|prefix| TERMINAL_MIRROR_WRITE_ENV.starts_with(prefix)),
        "{TERMINAL_MIRROR_WRITE_ENV} must start with one of {:?}",
        registries::ENV_PREFIXES
    );
}

// ---- 4/5: the degraded state, through a real daemon -------------------------

/// The default floor: no mesh clause anywhere in the terminal unit's face. This
/// is the surface half of "off means absent" — the structural half is that the
/// unit drops the mesh handle at construction.
#[tokio::test]
async fn the_default_floor_says_nothing_about_a_mesh() {
    let dir = short_tempdir();
    let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
    assert_eq!(MeshPlan::resolve(&config), MeshPlan::Off);
    let daemon = bootstrap(config).await.expect("bootstrap");

    let terminal = settled_terminal(&daemon).await;
    assert_eq!(terminal["state"], "up");
    let detail = detail(&terminal);
    assert!(
        !detail.contains("mesh"),
        "the flag-off floor must be its pre-GT-4 self: {detail}"
    );

    daemon.shutdown().await;
}

/// The two flags' relationship, made honest: terminal mesh on, gateway off.
/// The floor SERVES — PTYs are unaffected — and the mesh reports off in the
/// gateway's own words. The elapsed assertion is the point: a run that spent
/// the attach budget would mean the gateway's surrender went unnoticed.
#[tokio::test]
async fn terminal_mesh_without_a_gateway_degrades_the_mesh_and_not_the_floor() {
    let dir = short_tempdir();
    let config = NativeConfig {
        terminal_mesh_enabled: true,
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    assert!(!config.mesh_enabled, "the gateway is off in this scenario");

    let started = Instant::now();
    let daemon = bootstrap(config).await.expect("bootstrap");
    let terminal = settled_terminal(&daemon).await;
    let elapsed = started.elapsed();

    assert_eq!(
        terminal["state"], "up",
        "the floor serves whatever the mesh does: {terminal}"
    );
    let detail = detail(&terminal);
    assert!(
        detail.contains("terminal mesh off"),
        "the mesh must say it is off: {detail}"
    );
    assert!(
        detail.contains("FIELD_NATIVE_MESH"),
        "the reason must be the gateway's own detail, not a guess: {detail}"
    );
    assert!(
        elapsed < terminal_mesh::ATTACH_BUDGET,
        "a gateway that can never lend a node must not cost the attach budget \
         (spent {elapsed:?} of {:?})",
        terminal_mesh::ATTACH_BUDGET
    );

    // And the floor is a floor: a real PTY still starts on it.
    let endpoints = daemon.state.terminal.get().expect("terminal endpoints");
    let (client, _events) =
        ControlClient::connect(Path::new(&endpoints.control_socket), &endpoints.auth_token)
            .await
            .expect("dial the control socket");
    let session = client
        .create_session(json!({
            "executable": "/bin/cat",
            "args": [],
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            "environment": {"mode": "clean", "variables": {}},
        }))
        .await
        .expect("create a session on the degraded-mesh floor");
    assert!(session.pid.is_some(), "the PTY leader owes a pid");

    daemon.shutdown().await;
}

/// The capability is a secret. It is configured, the mesh cannot come up, and
/// the reason is published — the one path where a careless `{config:?}` would
/// put the string in front of every health reader.
#[tokio::test]
async fn a_configured_mirror_write_never_reaches_the_health_detail() {
    const CAPABILITY: &str = "vf-gt4-capability-canary";
    let dir = short_tempdir();
    let config = NativeConfig {
        terminal_mesh_enabled: true,
        terminal_mirror_write: Some(CAPABILITY.into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.expect("bootstrap");

    let health = serde_json::to_value(&*daemon.state.health_tx.borrow()).expect("health json");
    let terminal = settled_terminal(&daemon).await;
    assert!(
        !detail(&terminal).contains(CAPABILITY),
        "the terminal detail leaked the capability: {terminal}"
    );
    assert!(
        !health.to_string().contains(CAPABILITY),
        "no unit may publish the capability: {health}"
    );

    daemon.shutdown().await;
}
