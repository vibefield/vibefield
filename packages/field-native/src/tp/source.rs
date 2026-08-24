//! Where the door's sessions come from (terminal-pipeline-v3 TP-D26 / G22).
//! The door layer needs exactly three things of a session: the live
//! `ghosttea::Session` by id, its `FrameHub` (the TRF1 packets the engine
//! publishes), and its model generation. `SessionSource` names that seam once;
//! two implementations are expected to stand behind it:
//!
//! - `DirectSessions` (here, TP-S3b): sessions a focused harness spawns ITSELF
//!   with `Session::spawn` and a per-session hub.
//! - `ServiceSessions` (G22, production): the SAME session set the UDS plane
//!   serves — sessions by id, their hubs, spawn-through-the-service with the
//!   service's private-env strip. The production cell installs this source;
//!   there is no mirror and no second session registry.

use ghosttea::{FrameHub, ServiceSessions, Session, SessionLifecycleEvent};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// `DirectSessions`' lifecycle-bus capacity. Small on purpose: the harness bus
/// exists so tests can drive (and overflow) the same `Lagged` → resync path
/// production takes; G22's service bus has its own capacity upstream.
pub const DIRECT_LIFECYCLE_CAPACITY: usize = 16;

/// The one seam between the door layer and the engine's session set.
pub trait SessionSource: Send + Sync {
    /// The live session, or None — the door answers `SESSION_UNKNOWN`.
    fn session(&self, session_id: &str) -> Option<Arc<Session>>;
    /// The hub the session's frames are published on. With one hub per session
    /// every packet is this session's; with a shared hub the door filters by
    /// the packet's `session_handle` (it does so either way).
    fn frames(&self, session_id: &str) -> Option<FrameHub>;
    /// TP-S3f/G24 — the lifecycle bus behind the `session-events` capability.
    /// `None` means this source has no bus (`NoSessions`) and the door never
    /// emits `SessionEvent`. The receiver is BOUNDED: when it reports `Lagged`,
    /// the door answers on the wire with `{kind: "resync"}` rather than
    /// pretending it saw every death.
    fn subscribe_lifecycle(&self) -> Option<broadcast::Receiver<SessionLifecycleEvent>> {
        None
    }
}

/** G22's production adapter. The trait is ours and `ServiceSessions` is
 * Ghosttea's, so this direct implementation keeps the shared registry free of
 * wrapper state. */
impl SessionSource for ServiceSessions {
    fn session(&self, session_id: &str) -> Option<Arc<Session>> {
        ServiceSessions::session(self, session_id)
    }

    fn frames(&self, session_id: &str) -> Option<FrameHub> {
        self.frames_for(session_id)
    }

    fn subscribe_lifecycle(&self) -> Option<broadcast::Receiver<SessionLifecycleEvent>> {
        Some(ServiceSessions::subscribe_lifecycle(self))
    }
}

/// Sessions spawned directly by this harness, each with its own hub.
pub struct DirectSessions {
    inner: Mutex<HashMap<String, (Arc<Session>, FrameHub)>>,
    lifecycle: broadcast::Sender<SessionLifecycleEvent>,
}

impl Default for DirectSessions {
    fn default() -> Self {
        Self::with_lifecycle_capacity(DIRECT_LIFECYCLE_CAPACITY)
    }
}

impl DirectSessions {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// A harness that wants to force the `Lagged` path shrinks the bus.
    pub fn with_lifecycle_capacity(capacity: usize) -> Self {
        let (lifecycle, _) = broadcast::channel(capacity);
        Self {
            inner: Mutex::new(HashMap::new()),
            lifecycle,
        }
    }

    /// Publish a lifecycle fact onto the harness bus — the harness IS the
    /// engine here, so it also owns the ordering discipline (an `Exited`
    /// before its `Removed` on the ordinary path, as the service publishes).
    pub fn publish_lifecycle(&self, event: SessionLifecycleEvent) {
        let _ = self.lifecycle.send(event);
    }

    /// Adopt a session spawned with `hub` (the caller spawned it, so it also
    /// chose the spawn options, the env strip and the exit callback).
    pub fn insert(&self, session: Arc<Session>, hub: FrameHub) {
        let id = session.id();
        self.inner.lock().unwrap().insert(id, (session, hub));
    }

    pub fn remove(&self, session_id: &str) -> Option<Arc<Session>> {
        self.inner
            .lock()
            .unwrap()
            .remove(session_id)
            .map(|(s, _)| s)
    }

    pub fn ids(&self) -> Vec<String> {
        self.inner.lock().unwrap().keys().cloned().collect()
    }
}

impl SessionSource for DirectSessions {
    fn session(&self, session_id: &str) -> Option<Arc<Session>> {
        self.inner
            .lock()
            .unwrap()
            .get(session_id)
            .map(|(s, _)| s.clone())
    }

    fn frames(&self, session_id: &str) -> Option<FrameHub> {
        self.inner
            .lock()
            .unwrap()
            .get(session_id)
            .map(|(_, h)| h.clone())
    }

    fn subscribe_lifecycle(&self) -> Option<broadcast::Receiver<SessionLifecycleEvent>> {
        Some(self.lifecycle.subscribe())
    }
}

/// The empty source: every attach is `SESSION_UNKNOWN`. Kept as the DoorConfig
/// default for connection-only harnesses; production replaces it with G22.
#[derive(Default)]
pub struct NoSessions;

impl SessionSource for NoSessions {
    fn session(&self, _: &str) -> Option<Arc<Session>> {
        None
    }
    fn frames(&self, _: &str) -> Option<FrameHub> {
        None
    }
}

/// The TRF1 header fields the door reads (ghosttea-core `frame.rs`, little-
/// endian): magic u32 @0 · version u16 @4 · flags u16 @6 · session handle u64
/// @8 · view handle u64 @16 (today the session handle again) · session epoch
/// u64 @24 · layout epoch u64 @32 · sequence u64 @40 · revision u64 @48 · cols
/// u16 @56 · rows u16 @58. The door never decodes sections — it stamps, routes
/// and forwards; the decoder stays the worker's (spec §8: TRF1 is unchanged).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trf1Header {
    pub full_snapshot: bool,
    pub session_handle: u64,
    pub view_handle: u64,
    pub session_epoch: u64,
    pub layout_epoch: u64,
    pub sequence: u64,
    pub revision: u64,
    pub cols: u16,
    pub rows: u16,
}

pub const TRF1_MAGIC: u32 = 0x3146_5254;
pub const TRF1_HEADER_BYTES: usize = 64;
const TRF1_FULL_SNAPSHOT: u16 = 1;

impl Trf1Header {
    pub fn parse(frame: &[u8]) -> Option<Trf1Header> {
        if frame.len() < TRF1_HEADER_BYTES {
            return None;
        }
        let u16_at = |o: usize| u16::from_le_bytes([frame[o], frame[o + 1]]);
        let u32_at = |o: usize| u32::from_le_bytes(frame[o..o + 4].try_into().unwrap());
        let u64_at = |o: usize| u64::from_le_bytes(frame[o..o + 8].try_into().unwrap());
        if u32_at(0) != TRF1_MAGIC || u16_at(4) != 1 {
            return None;
        }
        Some(Trf1Header {
            full_snapshot: u16_at(6) & TRF1_FULL_SNAPSHOT != 0,
            session_handle: u64_at(8),
            view_handle: u64_at(16),
            session_epoch: u64_at(24),
            layout_epoch: u64_at(32),
            sequence: u64_at(40),
            revision: u64_at(48),
            cols: u16_at(56),
            rows: u16_at(58),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trf1_header_parses_the_documented_offsets() {
        let mut frame = vec![0u8; 80];
        frame[0..4].copy_from_slice(&TRF1_MAGIC.to_le_bytes());
        frame[4..6].copy_from_slice(&1u16.to_le_bytes());
        frame[6..8].copy_from_slice(&(1u16 | 4u16).to_le_bytes()); // full + catalog reset
        frame[8..16].copy_from_slice(&77u64.to_le_bytes());
        frame[16..24].copy_from_slice(&77u64.to_le_bytes());
        frame[24..32].copy_from_slice(&3u64.to_le_bytes());
        frame[32..40].copy_from_slice(&9u64.to_le_bytes());
        frame[40..48].copy_from_slice(&41u64.to_le_bytes());
        frame[48..56].copy_from_slice(&1234u64.to_le_bytes());
        frame[56..58].copy_from_slice(&120u16.to_le_bytes());
        frame[58..60].copy_from_slice(&40u16.to_le_bytes());
        let h = Trf1Header::parse(&frame).unwrap();
        assert_eq!(
            h,
            Trf1Header {
                full_snapshot: true,
                session_handle: 77,
                view_handle: 77,
                session_epoch: 3,
                layout_epoch: 9,
                sequence: 41,
                revision: 1234,
                cols: 120,
                rows: 40,
            }
        );
        frame[0] = 0;
        assert!(Trf1Header::parse(&frame).is_none(), "bad magic");
        assert!(Trf1Header::parse(&frame[..10]).is_none(), "short");
    }
}
