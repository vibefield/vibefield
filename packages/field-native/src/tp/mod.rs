//! TP-S3a — the cell-side T1 door layer (terminal-pipeline-v3 §5.1/§8,
//! TP-D26 as RATIFIED 2026-08-22: the door is OURS, in this harness, over
//! ghosttea's public `Session` API).
//!
//! This slice is the CONNECTION layer only: two loopback WebSocket doors per
//! cell (`/control`, `/frames` on one ephemeral 127.0.0.1 port), Origin checked
//! at the HTTP upgrade, the silent-`1008` pre-auth class, HMAC-SHA256/JCS grant
//! verification against the per-cell-boot key the floor minted (TP-S1b) and
//! delivers at spawn, the transport generation high-water + nonce ledger with
//! its tombstones, one leg per channel per connection set with higher-
//! generation replacement, and `LegHeartbeat/Ack` with a receipt deadline. NO
//! session attaches and NO terminal frames yet — those are TP-S3b; until then
//! any other message on an accepted leg is an honest `4003 PROTOCOL` close
//! naming `unsupported-at-s3a`, never a pretended acceptance.
//!
//! Module map — each file owns one concern and restates nothing of another's:
//! - `jcs` — RFC 8785 canonical JSON, the grant MAC input (pinned by the
//!   contracts' `tp-jcs.vector.json`);
//! - `grant` — the authenticated-grant envelope, its two verification outcome
//!   classes and the typed claims (pinned by `tp-grant-mac.vector.json`);
//! - `ledger` — the cell-side transport rules: high-water, nonces, tombstones;
//! - `wire` — the tagged JSON messages of this slice (serde mirrors of the
//!   contracts' zod shapes; golden fixtures pin both sides — EL9);
//! - `door` — the WebSocket server: accept → hello → verify → admit → heartbeat.
//!
//! Every number comes from the generated `registries::terminal_pipeline` (one
//! authority with fieldd and the renderer; provisional until the numeric
//! checkpoint). The cell logs the audit line for every refusal and NEVER the
//! grant, the key, or a claim value (EL7).

pub mod activation;
pub mod crc32c;
pub mod door;
pub mod grant;
pub mod jcs;
pub mod ledger;
pub mod presentation;
pub mod source;
pub mod wire;

/// Wall-clock milliseconds since the Unix epoch — grant validity is the ONLY
/// thing in this layer that compares clocks (spec §5.1: timestamps are for
/// validity; nothing else compares clocks).
pub fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
