//! CP-1a — the floor's door (`thinking-roled-agents.md` §16; the CO lead's brief, 2026-10-29): `door.sock`, which a
//! spark's MCP bridge dials, and which names its caller by the kernel's word and the pane the floor walks it to.
//!
//! - `peer`: what the kernel says about a caller and its processes.
//! - `walk`: from a caller up its parents to the pane it was started in.

pub mod peer;
pub mod walk;
