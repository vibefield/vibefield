//! Test-side TPv3 grant minting — what fieldd does (`terminal-grants.ts`), so
//! the door rows can present REAL grants MAC'd with the cell's key. Included
//! by `#[path]` from the test crates that need it (cargo compiles nothing in
//! `tests/support/` on its own). Never a production module: the cell VERIFIES,
//! it does not mint for others.
#![allow(dead_code)]

use data_encoding::BASE64URL_NOPAD;
use field_native::tp::jcs::canonical_json;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

pub struct TestMinter {
    pub cell_boot_id: String,
    pub key_generation: u64,
    pub key: Vec<u8>,
}

impl TestMinter {
    pub fn new(cell_boot_id: &str) -> Self {
        Self {
            cell_boot_id: cell_boot_id.to_string(),
            key_generation: 1,
            key: vec![0x5e; 32],
        }
    }

    pub fn key_hex(&self) -> String {
        hex::encode(&self.key)
    }

    fn protected(&self, typ: &str) -> Value {
        json!({
            "v": 1,
            "typ": typ,
            "iss": "fieldd",
            "alg": "HS256",
            "kid": { "cellBootId": self.cell_boot_id, "keyGeneration": self.key_generation },
        })
    }

    pub fn sign(&self, protected: &Value, claims: &Value) -> String {
        let input = canonical_json(&json!({ "protected": protected, "claims": claims })).unwrap();
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).unwrap();
        mac.update(input.as_bytes());
        BASE64URL_NOPAD.encode(&mac.finalize().into_bytes())
    }

    /// A transport grant valid NOW (issued 1 s ago, 60 s establishment window).
    pub fn transport(&self, spec: TransportSpec<'_>) -> Value {
        let now = field_native::tp::unix_ms();
        let issued_at = spec.issued_at.unwrap_or(now - 1_000);
        let claims = json!({
            "audienceCellBootId": spec.audience.unwrap_or(self.cell_boot_id.as_str()),
            "clientId": spec.client_id,
            "connectionSetId": spec.connection_set_id,
            "allowedChannels": spec.channels,
            "transportGrantGeneration": spec.generation,
            "issuedAt": issued_at,
            "expiresAt": spec.expires_at.unwrap_or(issued_at + 60_000),
            "nonce": spec.nonce,
        });
        let protected = self.protected("CellTransportGrant");
        let mac = self.sign(&protected, &claims);
        json!({ "protected": protected, "claims": claims, "mac": mac })
    }

    /// A session attach grant valid NOW. Rights must already be sorted, just
    /// as fieldd's production minter emits them.
    pub fn attach(&self, session_id: &str, generation: u64, rights: &[&str]) -> Value {
        let now = field_native::tp::unix_ms();
        let claims = json!({
            "audienceCellBootId": self.cell_boot_id,
            "clientId": "win:1#1",
            "sessionId": session_id,
            "routeRevision": 1,
            "grantGeneration": generation,
            "rights": rights,
            "issuedAt": now - 1_000,
            "expiresAt": now + 599_000,
        });
        let protected = self.protected("SessionAttachGrant");
        let mac = self.sign(&protected, &claims);
        json!({ "protected": protected, "claims": claims, "mac": mac })
    }
}

pub struct TransportSpec<'a> {
    pub client_id: &'a str,
    pub connection_set_id: &'a str,
    pub channels: &'a [&'a str],
    pub generation: u64,
    pub nonce: &'a str,
    pub issued_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub audience: Option<&'a str>,
}

impl<'a> TransportSpec<'a> {
    pub fn basic(set: &'a str, generation: u64, nonce: &'a str) -> Self {
        Self {
            client_id: "win:1#1",
            connection_set_id: set,
            channels: &["control", "frames"],
            generation,
            nonce,
            issued_at: None,
            expires_at: None,
            audience: None,
        }
    }
}

/// The tagged ConnectionHello text frame.
pub fn hello(channel: &str, grant: &Value, receiver_capacities: Option<Value>) -> String {
    hello_with_capabilities(
        channel,
        grant,
        receiver_capacities,
        json!(["resume", "something-unknown"]),
    )
}

/// TP-S3f: a hello whose capability advertisement the test chooses — the
/// `session-events` negotiation rides here.
pub fn hello_with_capabilities(
    channel: &str,
    grant: &Value,
    receiver_capacities: Option<Value>,
    capabilities: Value,
) -> String {
    let mut v = json!({
        "type": "ConnectionHello",
        "protocolMajor": 1,
        "protocolMinor": 0,
        "channel": channel,
        "transportGrant": grant,
        "capabilities": capabilities,
    });
    if let Some(caps) = receiver_capacities {
        v["receiverCapacities"] = caps;
    }
    v.to_string()
}

/// The receiver capacities a REAL client declares — `DEFAULT_CELL_RECEIVER_CAPS`
/// (contracts, `terminal-pipeline.ts`), read from the generated registry rather
/// than transcribed, so this can never drift from the product again.
///
/// CORRECTED 2026-09-14 (N-H1). These were invented numbers, an eighth of the
/// real ones — `connectionCreditBytes: 1 MiB` against a product value of 16 MiB
/// — and a 1 MiB connection window is BELOW the cell's `URGENT_RESERVE_BYTES`
/// (2 MiB). Bulk admission may draw the window only down to that reserve
/// (§8/TP-S3d, `CreditLedger::connection_limit_for`), so bulk headroom was
/// exactly ZERO, the seed transfer was never admissible, and every client built
/// on this helper silently got NO SEED: the pump waited out
/// `MAX_ACTIVATION_CATCHUP_MS` and reported `presentation: stopped {overload}`
/// on the control leg — a leg no caller was reading. That is the whole of what
/// `terminal_cell_route_probe` had been attributing to its own attach grant.
/// A DELIBERATELY SMALL advertisement, for the one row that pins the window
/// negotiation itself (`tp_door.rs` — "advertised < cell cap → advertised").
///
/// N-H1 — kept separate from [`worker_capacities`] and never the default,
/// because these numbers are not merely small, they are UNSEEDABLE: a 1 MiB
/// connection window is below the cell's 2 MiB `URGENT_RESERVE_BYTES`, so the
/// clamp leaves bulk at most half of it and a client declaring this is asking
/// for a window no real one asks for. A row that wants to watch the MIN being
/// taken should say so; a row that wants a client should use the product's.
pub fn small_capacities() -> Value {
    json!({
        "connectionCreditBytes": 1_048_576,
        "perActivationCreditBytes": 262_144,
        "stagingBytesPerSession": 4_194_304,
        "stagingBytesTotal": 16_777_216,
        "maxConcurrentActivations": 32,
        "maxConcurrentSeeds": 2,
    })
}

pub fn worker_capacities() -> Value {
    use field_native::registries::terminal_pipeline as tp;
    json!({
        "connectionCreditBytes": tp::CELL_CONNECTION_CREDIT_BYTES,
        "perActivationCreditBytes": tp::CELL_PER_ACTIVATION_CREDIT_BYTES,
        "stagingBytesPerSession": tp::CELL_STAGING_BYTES_PER_SESSION,
        "stagingBytesTotal": tp::CELL_STAGING_BYTES_TOTAL,
        "maxConcurrentActivations": tp::CELL_MAX_CONCURRENT_ACTIVATIONS,
        "maxConcurrentSeeds": tp::CELL_MAX_CONCURRENT_SEEDS,
    })
}
