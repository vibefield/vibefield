//! FW (`draft/thinking-freeway.md` v0.3) — the freeway host's library: one link per peer, every
//! plane a stream on it, ending in `field-freeway-host`, a binary of this crate the floor
//! supervises as it runs cells (FW-D4). The host's own Rust is the link wire, as the cell's is
//! TPv3: the contracts transcribe it (`packages/contracts/src/freeway.ts`) and their fixtures pin
//! both sides (EL9); its numbers are the generated `registries::freeway*` modules.
//!
//! Module map — each file owns one concern:
//! - `approval` — the phone's approval, verified at its hello: fieldd's envelope under the floor's
//!   freeway key (pinned by `freeway-approval-mac.vector.json`);
//! - `door` — the WebSocket on the floor-held listener: the secret path, the injected identity, the
//!   hello within its deadline, answered on stream 0;
//! - `frame` — the frame codec (`u8 frameType` · LEB128 `streamId` · payload) and one stream's
//!   reassembly of a fragmented message (pinned by `freeway-frames.vector.json`);
//! - `hello` — the link's first frame, decided: the two forms, the admit table, a phone's approval
//!   bound to THIS connection's node, the welcome or the refusal and its close code;
//! - `keyring` — a phone's tickets and renewals, fieldd's minter ported onto the host's boot and keys;
//! - `mint` — a phone's two cell grants, TPv3's envelopes under the host's own issuer and the
//!   cell's key (FW-D1);
//! - `mux` — the link's streams: ids by parity, never reused; each frame's meaning for its
//!   stream; one reassembly per stream; the WINDOW grants a receiver owes;
//! - `writer` — which frame goes next: the four classes, the in-flight cap, each stream's order,
//!   fragments and WINDOW.

pub mod approval;
pub mod door;
pub mod frame;
pub mod hello;
pub mod keyring;
pub mod mint;
pub mod mux;
pub mod writer;
