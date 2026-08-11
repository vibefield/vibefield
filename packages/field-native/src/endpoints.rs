//! WIN-D1 — the endpoint-resolution law's Rust half. On unix a local IPC
//! endpoint is the LAYOUT path joined under the data root (config::join_layout,
//! unchanged); on win32 it is a named pipe whose name carries a scope hash of
//! the data root, because the flat `\\.\pipe\` namespace has no run-directory
//! boundary to lean on. This module is a HAND-WRITTEN twin of
//! `@vibefield/contracts src/endpoints.ts` — same ASCII-only case fold, same
//! separator/trailing-slash normalization, same FNV-1a 64 — and the two are
//! pinned to one vector (`contracts/fixtures/endpoint.vector.json`, the
//! layout.vector.json pattern) by `tests/endpoint_vector.rs`. A deliberate law
//! change edits both languages and the vector in one commit.

use crate::registries::APP_ID;

pub const PIPE_PREFIX: &str = r"\\.\pipe\";

/// Canonical form of a data root FOR SCOPE HASHING ONLY (never a filesystem
/// path): `\` → `/`, trailing slashes stripped, ASCII letters folded to
/// lowercase. Two spellings of one Windows directory hash alike; non-ASCII is
/// left untouched (JS and Rust Unicode folds are not bit-identical — a missed
/// fold costs a redundant scope, never a collision).
fn canonical_data_root_for_scope(data_root: &str) -> String {
    let slashed = data_root.replace('\\', "/");
    let mut trimmed: &str = &slashed;
    while trimmed.len() > 1 && trimmed.ends_with('/') {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

/// FNV-1a 64-bit over the UTF-8 bytes, 16 lowercase hex chars.
fn fnv1a64_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The scope tag a data root contributes to its pipe names.
pub fn pipe_scope(data_root: &str) -> String {
    fnv1a64_hex(&canonical_data_root_for_scope(data_root))
}

/// The win32 endpoint for one of the `registries::sockets` names under
/// `data_root`: `\\.\pipe\vibefield-<scope>-<base>` (`mgmt.sock` → `mgmt`).
/// Callers pass registry constants; anything else is a contract violation.
pub fn pipe_endpoint_for(data_root: &str, socket_file: &str) -> String {
    let base = socket_file.strip_suffix(".sock").unwrap_or_else(|| {
        panic!("pipe_endpoint_for wants a sockets name (*.sock), got {socket_file}")
    });
    format!("{PIPE_PREFIX}{APP_ID}-{}-{base}", pipe_scope(data_root))
}

/// The tolerant-reader check for code handed an endpoint string.
pub fn is_pipe_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with(PIPE_PREFIX)
}
