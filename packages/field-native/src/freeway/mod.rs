//! FW (`draft/thinking-freeway.md` v0.3) — the freeway host's library: one link per peer, every
//! plane a stream on it, ending in `field-freeway-host`, a binary of this crate the floor
//! supervises as it runs cells (FW-D4). The host's own Rust is the link wire, as the cell's is
//! TPv3: the contracts transcribe it (`packages/contracts/src/freeway.ts`) and their fixtures pin
//! both sides (EL9); its numbers are the generated `registries::freeway*` modules.
//!
//! Module map — each file owns one concern:
//! - `frame` — the frame codec (`u8 frameType` · LEB128 `streamId` · payload) and one stream's
//!   reassembly of a fragmented message (pinned by `freeway-frames.vector.json`).

pub mod frame;
