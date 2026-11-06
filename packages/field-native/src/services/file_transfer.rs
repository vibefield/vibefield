//! DR-3a (W3, VF-FLOOR) — the file transfer's backend behind
//! `native.mesh.fileTransfer.*` (contracts mgmt.ts, the file transfer's
//! header; the facade is `mgmt/file_transfer.rs`).
//!
//! The drive moves an object between desktops by truffle's own file transfer,
//! pulled by a NAMED ROOT and a path relative to it (truffle T-3, RFC 032), so
//! no desktop names another's folders (EL7). The floor only asks for a pull and
//! reports what became of it; the bytes go Rust to Rust through the node (EL2).
//!
//! ONE ARM today, and the trait is the seam the next ones take:
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
//!
//! The named-root arm over a VibeField `PullSubstrate` is W3's stack B; the
//! truffle substrate and the default flip (a `truffle-named-pull` default
//! feature, egress's `Cargo.toml` shape) are EL8-TRUFFLE's, when truffle
//! releases T-3.

use std::sync::Arc;

/// The facade's substrate. Held on the mesh unit (`services/mesh.rs`'s
/// `Shared`) beside egress's, and read per request through
/// `MeshHandle::file_transfer`.
#[async_trait::async_trait]
pub trait FileTransferBackend: Send + Sync {
    /// Which arm answers: logged at boot, asserted by tests, never shown.
    fn arm(&self) -> &'static str;
    /// `false` = every verb answers `file-transfer-unsupported`, first, node or
    /// no node (the refusal order's step 1).
    fn supported(&self) -> bool;
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
}
