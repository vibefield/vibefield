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

/// TC-S2 — the per-instance socket FILE name for a terminal-host cell:
/// `termctl.sock` + 2 → `termctl.2.sock`. Fresh names per cell instance make
/// a restart never a rebind (the unix stale-unlink hazard and win32's
/// first-pipe-instance hold both dissolve); the derived name then flows
/// through the same resolution law as any SOCKETS name. TS twin:
/// `cellSocketFile` in contracts/src/endpoints.ts, pinned by the instance
/// rows in fixtures/endpoint.vector.json.
pub fn cell_socket_file(socket_file: &str, instance: u32) -> String {
    debug_assert!(socket_file.ends_with(".sock"), "wants a SOCKETS name");
    debug_assert!(instance >= 1, "wants a 1-based instance ordinal");
    let base = socket_file.strip_suffix(".sock").unwrap_or(socket_file);
    format!("{base}.{instance}.sock")
}

/// Item 345 (PLAN-345-r2): macOS's `sun_path` holds 104 bytes with the NUL.
pub const SUN_PATH_MAX_BYTES: usize = 103;
/// The largest cell ordinal the allocator can hand out (`AtomicU32`).
pub const CELL_INSTANCE_MAX: u32 = u32::MAX;
/// Where the aliases of roots over the line live: one 0700 folder per uid.
pub const SOCKET_ALIAS_PARENT: &str = "/tmp";

fn trim_trailing_slashes(root: &str) -> &str {
    let mut trimmed = root;
    while trimmed.len() > 1 && trimmed.ends_with('/') {
        trimmed = &trimmed[..trimmed.len() - 1];
    }
    trimmed
}

/// `<root>/native/run` (trailing slashes on the root dropped), the unix run dir the law joins.
pub fn native_run_dir_for(data_root: &str) -> String {
    let mut out = trim_trailing_slashes(data_root).to_owned();
    for segment in crate::registries::layout::NATIVE_RUN_DIR {
        out.push('/');
        out.push_str(segment);
    }
    out
}

/// The longest socket file any plane binds: every LAYOUT `.sock` row, and the cells' two at `CELL_INSTANCE_MAX`.
/// Derived from `registries::layout::ALL` (the generated table the layout vector walks), never typed.
pub fn longest_socket_file() -> String {
    let mut longest = String::new();
    for (_, segments) in crate::registries::layout::ALL {
        let Some(last) = segments.last() else {
            continue;
        };
        if !last.ends_with(".sock") {
            continue;
        }
        let mut names = vec![(*last).to_owned()];
        if *last == crate::registries::sockets::TERMINAL_CONTROL
            || *last == crate::registries::sockets::TERMINAL_FRAME
        {
            names.push(cell_socket_file(last, CELL_INSTANCE_MAX));
        }
        for name in names {
            if name.len() > longest.len() {
                longest = name;
            }
        }
    }
    longest
}

/// The alias's scope: FNV-1a 64 over the root's bytes, trailing slashes dropped, NO case fold.
pub fn unix_alias_scope(data_root: &str) -> String {
    fnv1a64_hex(trim_trailing_slashes(data_root))
}

pub fn socket_alias_for(uid: u32, data_root: &str, parent: &str) -> String {
    format!("{parent}/vf-{uid}/{}", unix_alias_scope(data_root))
}

/// Item 345's ONE decision, the twin of contracts' `unixSocketDir`.
pub fn unix_socket_dir(uid: u32, data_root: &str, parent: &str) -> String {
    let real = native_run_dir_for(data_root);
    if format!("{real}/{}", longest_socket_file()).len() <= SUN_PATH_MAX_BYTES {
        real
    } else {
        socket_alias_for(uid, data_root, parent)
    }
}

pub fn unix_endpoint_for(uid: u32, data_root: &str, socket_file: &str, parent: &str) -> String {
    format!("{}/{socket_file}", unix_socket_dir(uid, data_root, parent))
}

pub fn worst_unix_endpoint(uid: u32, data_root: &str, parent: &str) -> String {
    unix_endpoint_for(uid, data_root, &longest_socket_file(), parent)
}
