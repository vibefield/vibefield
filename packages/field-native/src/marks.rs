//! OB custody (C5) — MARKS: what this floor remembers for fieldd, so a store put back as it was earlier is seen to be
//! stale (contracts mgmt.ts `NativeMarksSet*`, envelope.ts `HelloAck.marks`).
//!
//! A mark is a named number that ONLY RISES. fieldd tells the floor a value (`native.marks.set`), the floor keeps the
//! highest it was ever told under that name and answers what it keeps, and every hello ack carries what is held. The
//! floor outlives fieldd, so a fieldd started beside a living floor reads here what the one before it wrote: a store
//! whose own count is below its mark was put back, and nothing in it is honoured.
//!
//! The marks are the FLOOR'S, never a connection's: they stand while no fieldd is attached, and a superseding client
//! reads what the client before it wrote. They are in memory alone and die with the floor (a mark on disk would be one
//! more file the same user can put back). Only the management channel writes here (EL7): `mgmt/marks.rs` answers the
//! verb, behind the pairing and the single-client rule, and nothing a caller does at the door reaches it.
//!
//! The floor does not know what a mark counts. A name is the contract's pattern, checked where the params are parsed;
//! the bound here is on how many names are held at once.

use crate::registries::custody::MARKS_MAX;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Why `native.marks.set` refused a name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkRefused {
    /// the floor already holds `MARKS_MAX` names, and this is none of them
    Full,
}

impl MarkRefused {
    /// The refusal's `details.reason` on the wire.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Full => "marks-full",
        }
    }
}

/// The floor's marks, by name. Ordered, so the hello ack lists them the same way every time.
#[derive(Debug, Default)]
pub struct Marks(Mutex<BTreeMap<String, u64>>);

impl Marks {
    /// Keep the higher of what is held under `name` and `value`, and answer what is kept: a value below the mark
    /// changes nothing and reads the mark back. A name already held always rises; a new one is refused once
    /// `MARKS_MAX` are held, and changes nothing.
    pub fn set(&self, name: &str, value: u64) -> Result<u64, MarkRefused> {
        let mut marks = self.0.lock().unwrap();
        if let Some(kept) = marks.get_mut(name) {
            *kept = (*kept).max(value);
            return Ok(*kept);
        }
        if marks.len() as u64 >= MARKS_MAX {
            return Err(MarkRefused::Full);
        }
        marks.insert(name.to_owned(), value);
        Ok(value)
    }

    /// Every mark held, for the hello ack. Empty when none is.
    pub fn snapshot(&self) -> BTreeMap<String, u64> {
        self.0.lock().unwrap().clone()
    }
}
