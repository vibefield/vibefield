//! The tagged JSON messages of the connection layer (terminal-pipeline-v3
//! §5.1; contracts `terminal-pipeline.ts` — `TpMessageType`, `ConnectionHello`,
//! `ConnectionAccepted`, `ConnectionRefused`, `LegHeartbeat`, `LegHeartbeatAck`,
//! `ReceiverCapacities`, `ProtocolLimits`). Every JSON text message on either
//! leg is `{ "type": <MessageName>, ...body }`; the cell reads the tag FIRST and
//! parses the body with the tag's shape. These are serde mirrors of the zod
//! schemas — the golden fixtures (`fixtures/tp-*.json`) pin both sides (EL9),
//! and `contracts/fixtures/tp-protocol-limits.defaults.json` pins that the
//! numbers this cell announces are the numbers registries.ts declares.
//!
//! Tolerant reader: inbound structs ignore unknown fields (serde default); the
//! door logs nothing about them — a renderer ahead of this cell is not an error.

use super::grant::Channel;
use crate::registries::terminal_pipeline as tp;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The tag of every JSON text message (contracts `TpMessageType`).
#[derive(Debug, Deserialize)]
pub struct Tagged {
    #[serde(rename = "type")]
    pub message_type: String,
}

/// Which tags a leg accepts INBOUND (contracts `TP_LEG_INBOUND`). Anything
/// else on an accepted leg is `4003 PROTOCOL`; before acceptance, anything
/// but `ConnectionHello` is `HELLO_MALFORMED`.
pub fn inbound_tags(channel: Channel) -> &'static [&'static str] {
    match channel {
        Channel::Control => &[
            "ConnectionHello",
            "LegHeartbeat",
            "AttachControlLeg",
            "DeclareDemand",
            "ClaimGeometry",
            "ReleaseGeometry",
            "TransferGeometry",
        ],
        Channel::Frames => &[
            "ConnectionHello",
            "LegHeartbeat",
            "AttachFramesLeg",
            "TransportCredit",
            "SceneApplied",
            "CalibrationPing",
        ],
    }
}

/// Serialize an outbound body under its tag: `{ "type": name, ...body }`.
pub fn tagged<T: Serialize>(name: &str, body: &T) -> String {
    let mut value = serde_json::to_value(body).expect("outbound wire shapes serialize");
    if let Value::Object(map) = &mut value {
        map.insert("type".to_string(), Value::String(name.to_string()));
    }
    serde_json::to_string(&value).expect("serialize tagged message")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolVersion {
    pub major: u64,
    pub minor: u64,
}

/// The version this cell speaks (registries). Selection: the highest mutually
/// supported minor within the client's major, else `VERSION_UNSUPPORTED`.
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion {
    major: tp::PROTOCOL_MAJOR,
    minor: tp::PROTOCOL_MINOR,
};

// The cell's minor is 0 today, so clippy sees a `min` with a constant floor; the
// rule is written for the release that raises it (the highest MUTUALLY supported
// minor), and a `0` here is the contracts' number, not a literal.
#[allow(clippy::unnecessary_min_or_max)]
pub fn select_version(client_major: u64, client_minor: u64) -> Option<ProtocolVersion> {
    if client_major != PROTOCOL_VERSION.major {
        return None;
    }
    Some(ProtocolVersion {
        major: PROTOCOL_VERSION.major,
        minor: client_minor.min(PROTOCOL_VERSION.minor),
    })
}

/// Receive capacity belongs to the WORKER (contracts `ReceiverCapacities`); the
/// cell accepts the MIN of what was advertised and its own caps.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverCapacities {
    pub connection_credit_bytes: u64,
    pub per_activation_credit_bytes: u64,
    pub staging_bytes_per_session: u64,
    pub staging_bytes_total: u64,
    pub max_concurrent_activations: u64,
    pub max_concurrent_seeds: u64,
}

impl ReceiverCapacities {
    /// The cell's own caps (registries `CELL_*`).
    pub const CELL_CAPS: ReceiverCapacities = ReceiverCapacities {
        connection_credit_bytes: tp::CELL_CONNECTION_CREDIT_BYTES,
        per_activation_credit_bytes: tp::CELL_PER_ACTIVATION_CREDIT_BYTES,
        staging_bytes_per_session: tp::CELL_STAGING_BYTES_PER_SESSION,
        staging_bytes_total: tp::CELL_STAGING_BYTES_TOTAL,
        max_concurrent_activations: tp::CELL_MAX_CONCURRENT_ACTIVATIONS,
        max_concurrent_seeds: tp::CELL_MAX_CONCURRENT_SEEDS,
    };

    /// Field-wise minimum — the initial windows of a frames leg.
    pub fn min_with(self, other: ReceiverCapacities) -> ReceiverCapacities {
        ReceiverCapacities {
            connection_credit_bytes: self
                .connection_credit_bytes
                .min(other.connection_credit_bytes),
            per_activation_credit_bytes: self
                .per_activation_credit_bytes
                .min(other.per_activation_credit_bytes),
            staging_bytes_per_session: self
                .staging_bytes_per_session
                .min(other.staging_bytes_per_session),
            staging_bytes_total: self.staging_bytes_total.min(other.staging_bytes_total),
            max_concurrent_activations: self
                .max_concurrent_activations
                .min(other.max_concurrent_activations),
            max_concurrent_seeds: self.max_concurrent_seeds.min(other.max_concurrent_seeds),
        }
    }
}

/// Cell-owned limits announced on accept (contracts `ProtocolLimits`; §20
/// item 5 — names carry their unit; the numbers are registries').
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolLimits {
    pub max_control_message_bytes: u64,
    pub max_presentation_chunk_bytes: u64,
    pub max_batch_latency_ms: u64,
    pub max_credit_return_delay_ms: u64,
    pub max_scene_applied_delay_ms: u64,
    pub scene_applied_refresh_ms: u64,
    pub presentation_status_refresh_ms: u64,
    pub activation_attach_deadline_ms: u64,
    pub max_activation_catchup_ms: u64,
    pub max_catchup_bytes: u64,
    pub credit_account_drain_ttl_ms: u64,
}

impl ProtocolLimits {
    pub const DEFAULTS: ProtocolLimits = ProtocolLimits {
        max_control_message_bytes: tp::MAX_CONTROL_MESSAGE_BYTES,
        max_presentation_chunk_bytes: tp::MAX_PRESENTATION_CHUNK_BYTES,
        max_batch_latency_ms: tp::MAX_BATCH_LATENCY_MS,
        max_credit_return_delay_ms: tp::MAX_CREDIT_RETURN_DELAY_MS,
        max_scene_applied_delay_ms: tp::MAX_SCENE_APPLIED_DELAY_MS,
        scene_applied_refresh_ms: tp::SCENE_APPLIED_REFRESH_MS,
        presentation_status_refresh_ms: tp::PRESENTATION_STATUS_REFRESH_MS,
        activation_attach_deadline_ms: tp::ACTIVATION_ATTACH_DEADLINE_MS,
        max_activation_catchup_ms: tp::MAX_ACTIVATION_CATCHUP_MS,
        max_catchup_bytes: tp::MAX_CATCHUP_BYTES,
        credit_account_drain_ttl_ms: tp::CREDIT_ACCOUNT_DRAIN_TTL_MS,
    };
}

/// The first frame on either socket (contracts `ConnectionHello`). The grant
/// stays a `Value` here: it is verified over its RECEIVED bytes (grant.rs) and
/// only then typed — nothing in it is read before the MAC holds.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHello {
    pub protocol_major: u64,
    pub protocol_minor: u64,
    pub channel: Channel,
    pub transport_grant: Value,
    #[serde(default)]
    pub receiver_capacities: Option<ReceiverCapacities>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// Contracts `ConnectionAccepted`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionAccepted {
    pub selected_protocol_version: ProtocolVersion,
    pub connection_set_id: String,
    pub channel: Channel,
    pub leg_generation: u64,
    pub heartbeat_ttl_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_windows: Option<ReceiverCapacities>,
    pub protocol_limits: ProtocolLimits,
    pub capabilities: Vec<String>,
}

/// Contracts `ConnectionRefused` — POST-verification only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRefused {
    pub code: String,
    pub retryable: bool,
}

/// Contracts `LegHeartbeat` (client → cell, either leg).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegHeartbeat {
    pub connection_set_id: String,
    pub channel: Channel,
    pub leg_generation: u64,
    pub sequence: u64,
}

/// Contracts `LegHeartbeatAck`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegHeartbeatAck {
    pub sequence: u64,
}

/// The wire capabilities this cell speaks in the v1 core profile: none of the
/// three (`resume`, `snapshot-demand`, `profiling-envelope`) yet — the
/// intersection it echoes is therefore empty; a client's unknown strings are
/// ignored (tolerant reader).
pub const CELL_CAPABILITIES: &[&str] = &[];

pub fn capability_intersection(client: &[String]) -> Vec<String> {
    client
        .iter()
        .filter(|c| CELL_CAPABILITIES.contains(&c.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(&p).expect("fixture read")).expect("json")
    }

    #[test]
    fn the_announced_limits_are_the_contracts_defaults_fixture() {
        let v = fixture("tp-protocol-limits.defaults.json");
        let parsed: ProtocolLimits = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(parsed, ProtocolLimits::DEFAULTS);
        // and they re-serialize to the SAME JSON (strict both ways: the cell emits this)
        assert_eq!(serde_json::to_value(ProtocolLimits::DEFAULTS).unwrap(), v);
    }

    #[test]
    fn the_tagged_fixtures_parse_with_their_tags() {
        let hello = fixture("tp-tagged-message.hello-control.json");
        let tag: Tagged = serde_json::from_value(hello.clone()).unwrap();
        assert_eq!(tag.message_type, "ConnectionHello");
        let body: ConnectionHello = serde_json::from_value(hello).unwrap();
        assert_eq!(body.channel, Channel::Control);
        assert!(body.receiver_capacities.is_none());
        let frames: ConnectionHello =
            serde_json::from_value(fixture("tp-connection-hello.frames.json")).unwrap();
        assert!(frames.receiver_capacities.is_some());

        let accepted = fixture("tp-tagged-message.accepted-control.json");
        let tag: Tagged = serde_json::from_value(accepted.clone()).unwrap();
        assert_eq!(tag.message_type, "ConnectionAccepted");
        let body: ConnectionAccepted = serde_json::from_value(accepted.clone()).unwrap();
        // strict re-serialization: the cell EMITS this shape
        let mut back = serde_json::to_value(&body).unwrap();
        back["type"] = Value::String("ConnectionAccepted".into());
        assert_eq!(back, accepted);

        let hb: LegHeartbeat =
            serde_json::from_value(fixture("tp-tagged-message.heartbeat.json")).unwrap();
        assert_eq!(hb.sequence, 42);
        let ack: LegHeartbeatAck =
            serde_json::from_value(fixture("tp-tagged-message.heartbeat-ack.json")).unwrap();
        assert_eq!(
            tagged("LegHeartbeatAck", &ack),
            "{\"sequence\":42,\"type\":\"LegHeartbeatAck\"}"
        );
        let refused: ConnectionRefused =
            serde_json::from_value(fixture("tp-tagged-message.refused.json")).unwrap();
        assert!(!refused.code.is_empty());
    }

    #[test]
    fn version_selection_and_window_minimum() {
        assert_eq!(select_version(1, 0), Some(PROTOCOL_VERSION));
        assert_eq!(
            select_version(1, 99).map(|v| v.minor),
            Some(PROTOCOL_VERSION.minor),
            "the highest mutually supported minor"
        );
        assert_eq!(select_version(2, 0), None);
        let advertised = ReceiverCapacities {
            connection_credit_bytes: 1,
            per_activation_credit_bytes: u64::MAX,
            staging_bytes_per_session: 5,
            staging_bytes_total: u64::MAX,
            max_concurrent_activations: 1_000,
            max_concurrent_seeds: 1,
        };
        let windows = advertised.min_with(ReceiverCapacities::CELL_CAPS);
        assert_eq!(windows.connection_credit_bytes, 1);
        assert_eq!(
            windows.per_activation_credit_bytes,
            tp::CELL_PER_ACTIVATION_CREDIT_BYTES
        );
        assert_eq!(windows.max_concurrent_seeds, 1);
        assert_eq!(
            windows.max_concurrent_activations,
            tp::CELL_MAX_CONCURRENT_ACTIVATIONS
        );
    }
}
