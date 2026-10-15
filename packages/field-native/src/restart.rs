//! WP12 L2b (`build-wp12-updater.md` §9 R2/R3) — the floor's restart seam.
//!
//! An app update that touches field-native stops the floor through the paired management channel: the ONE consented
//! exception to the two-planes law (design-00 EL1's 2026-10-15 note). fieldd first records the restart intent
//! (`native.lifecycle.prepareRestart`), then asks the floor to stop itself (`native.lifecycle.shutdown`), which wakes
//! the third arm of main's `shutdown_signal()` and so runs the same drain SIGTERM runs. The next boot TAKES the intent
//! (reads it, removes it) and reports how the previous floor ended as `HelloAck.lastExit`.
//!
//! The intent file is this plane's alone — written and read by field-native, never on a wire — so its shape lives
//! here: `{schemaVersion: 1, reason, toVersion?, bootId, at}`. Its PRESENCE is the encoding.

use crate::contracts::{NativeLastExit, NativePrepareRestartParams, NativeRestartReason};
use crate::secret_file;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;

const INTENT_SCHEMA_VERSION: u64 = 1;

/// Where the intent is recorded, how the floor before this boot ended, and the request that stops this floor.
/// Embedded unit daemons leave it unconfigured: `prepareRestart` then records nothing (`recorded: false`) and the
/// hello carries no `lastExit` — a floor that cannot say, never a claim.
#[derive(Default)]
pub struct RestartControl {
    intent_file: OnceLock<PathBuf>,
    last_exit: OnceLock<NativeLastExit>,
    requested: Notify,
}

impl RestartControl {
    /// Boot wiring, once: the layout's `RESTART_INTENT_FILE` and what `take_last_exit` read from it.
    pub fn configure(&self, intent_file: PathBuf, last_exit: NativeLastExit) {
        let _ = self.intent_file.set(intent_file);
        let _ = self.last_exit.set(last_exit);
    }

    pub fn last_exit(&self) -> Option<NativeLastExit> {
        self.last_exit.get().copied()
    }

    /// `native.lifecycle.prepareRestart`: `Ok(false)` when this floor has nowhere to record (unconfigured).
    pub fn record(
        &self,
        params: &NativePrepareRestartParams,
        boot_id: &str,
    ) -> std::io::Result<bool> {
        let Some(path) = self.intent_file.get() else {
            return Ok(false);
        };
        record_intent(path, params, boot_id)?;
        Ok(true)
    }

    /// `native.lifecycle.shutdown`: wake main's third arm. `notify_one` keeps the permit when nobody is waiting yet,
    /// so a request is never lost to a race with main reaching its `select!`.
    pub fn request_shutdown(&self) {
        self.requested.notify_one();
    }

    /// Resolves when `request_shutdown` has been called.
    pub async fn shutdown_requested(&self) {
        self.requested.notified().await;
    }
}

/// Write the intent atomically: a private temp file beside it (`secret_file::create_private` — no link followed, no
/// overwrite), synced, then renamed over any older intent. One stop, one intent.
pub fn record_intent(
    path: &Path,
    params: &NativePrepareRestartParams,
    boot_id: &str,
) -> std::io::Result<()> {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut body = serde_json::json!({
        "schemaVersion": INTENT_SCHEMA_VERSION,
        "reason": params.reason,
        "bootId": boot_id,
        "at": at,
    });
    if let Some(to_version) = &params.to_version {
        body["toVersion"] = serde_json::json!(to_version);
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("restart-intent.json");
    let tmp = path.with_file_name(format!("{name}.{}.tmp", std::process::id()));
    let _ = fs::remove_file(&tmp);
    let mut file = secret_file::create_private(&tmp)?;
    file.write_all(body.to_string().as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)
}

/// Boot: TAKE the intent. Present and well-formed → `planned`; present and not parseable, or of another schema →
/// `unplanned` (biased safe: a garbled intent never claims the stop was planned); absent → `unplanned` (a crash, a
/// kill, a logout, a reboot or a first boot). A present file is removed either way — an intent describes ONE stop.
pub fn take_last_exit(path: &Path) -> NativeLastExit {
    let Ok(raw) = fs::read(path) else {
        return NativeLastExit::Unplanned;
    };
    let _ = fs::remove_file(path);
    let planned = serde_json::from_slice::<serde_json::Value>(&raw)
        .ok()
        .is_some_and(|intent| {
            intent.get("schemaVersion").and_then(|v| v.as_u64()) == Some(INTENT_SCHEMA_VERSION)
                && intent
                    .get("reason")
                    .and_then(|r| serde_json::from_value::<NativeRestartReason>(r.clone()).ok())
                    .is_some()
        });
    if planned {
        NativeLastExit::Planned
    } else {
        NativeLastExit::Unplanned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(to_version: Option<&str>) -> NativePrepareRestartParams {
        serde_json::from_value(match to_version {
            Some(v) => serde_json::json!({ "reason": "update", "toVersion": v }),
            None => serde_json::json!({ "reason": "update" }),
        })
        .unwrap()
    }

    fn scratch() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native").join("restart-intent.json");
        (dir, path)
    }

    #[test]
    fn a_recorded_intent_reads_planned_once_and_is_taken() {
        let (_dir, path) = scratch();
        record_intent(&path, &params(Some("0.9.0+2490459")), "boot-a").unwrap();
        let intent: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(intent["reason"], "update");
        assert_eq!(intent["toVersion"], "0.9.0+2490459");
        assert_eq!(intent["bootId"], "boot-a");
        assert_eq!(take_last_exit(&path), NativeLastExit::Planned);
        assert!(!path.exists(), "the boot takes the intent");
        assert_eq!(take_last_exit(&path), NativeLastExit::Unplanned);
    }

    #[test]
    fn a_garbled_or_foreign_intent_reads_unplanned_and_is_still_taken() {
        let (_dir, path) = scratch();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        for body in [
            "{not json",
            r#"{"schemaVersion":2,"reason":"update"}"#,
            r#"{"schemaVersion":1,"reason":"whim"}"#,
        ] {
            fs::write(&path, body).unwrap();
            assert_eq!(take_last_exit(&path), NativeLastExit::Unplanned, "{body}");
            assert!(!path.exists(), "{body}");
        }
    }

    #[test]
    fn no_intent_reads_unplanned() {
        let (_dir, path) = scratch();
        assert_eq!(take_last_exit(&path), NativeLastExit::Unplanned);
    }

    #[test]
    fn a_newer_intent_replaces_an_older_one() {
        let (_dir, path) = scratch();
        record_intent(&path, &params(Some("0.9.0")), "boot-a").unwrap();
        record_intent(&path, &params(None), "boot-b").unwrap();
        let intent: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(intent["bootId"], "boot-b");
        assert!(intent.get("toVersion").is_none());
    }

    #[test]
    fn an_unconfigured_floor_records_nothing_and_says_nothing() {
        let control = RestartControl::default();
        assert!(!control.record(&params(None), "boot-a").unwrap());
        assert_eq!(control.last_exit(), None);
    }

    #[tokio::test]
    async fn a_shutdown_request_made_before_anyone_waits_is_kept() {
        let control = RestartControl::default();
        control.request_shutdown();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            control.shutdown_requested(),
        )
        .await
        .expect("the permit was kept");
    }
}
