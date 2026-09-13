//! The helper's stdout line protocol — SNAP-D2, version 1.
//!
//! One JSON object per line, `\n`-terminated, lowerCamel keys, `"v": 1` on every
//! line, `status` the discriminant. Stdout carries ONLY these lines; diagnostics
//! go to stderr, because a non-JSON stdout line is a protocol violation and the
//! host kills the helper.
//!
//! `packages/contracts/src/screenshot.ts` is the wire truth. This crate is not in
//! the Rust gen bundle (field-native has no reader), so the shapes here are kept
//! honest by the fixtures under `packages/contracts/fixtures/` instead: zod parses
//! them, the Swift harness parses them, and `contract_fixtures_decode` below parses
//! them. EL9 in three languages.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::io::{self, Write};

/// The `v` every line carries. Bump only when a v1 reader could not tolerate the
/// shape; additive fields ride the tolerant reader instead.
pub const PROTOCOL_VERSION: u32 = 1;

/// Why the helper could not answer with a still. Typed at the SOURCE — the
/// prototype's host classified free prose with a regex, and the knowledge of what
/// went wrong lives here. The spelling is the contract's
/// (`ScreenshotHelperErrorCode` in `screenshot.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostErrorCode {
    /// The OS refused screen capture (`AppCapabilityAccessStatus::DeniedBy*`).
    PermissionDenied,
    /// Displays exist but no live still came back — WGC, DXGI and GDI all failed,
    /// or the overlay itself could not run.
    CaptureFailed,
    /// Nothing to capture: the monitor enumeration came back empty.
    NoDisplays,
    /// The still could not be encoded for, or written to, the temp directory.
    WriteFailed,
}

impl fmt::Display for HostErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::PermissionDenied => "permission-denied",
            Self::CaptureFailed => "capture-failed",
            Self::NoDisplays => "no-displays",
            Self::WriteFailed => "write-failed",
        })
    }
}

/// A failure on its way to the wire: the code, and the sentence a human reads.
/// Internal helpers keep returning `String` (a Win32 call's own words); the
/// boundaries that know WHAT was being attempted attach the code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperError {
    pub code: HostErrorCode,
    pub message: String,
}

impl HelperError {
    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self {
            code: HostErrorCode::PermissionDenied,
            message: message.into(),
        }
    }

    pub fn capture_failed(message: impl Into<String>) -> Self {
        Self {
            code: HostErrorCode::CaptureFailed,
            message: message.into(),
        }
    }

    pub fn no_displays(message: impl Into<String>) -> Self {
        Self {
            code: HostErrorCode::NoDisplays,
            message: message.into(),
        }
    }

    pub fn write_failed(message: impl Into<String>) -> Self {
        Self {
            code: HostErrorCode::WriteFailed,
            message: message.into(),
        }
    }
}

impl fmt::Display for HelperError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One stdout line. Optionals are skipped on emit, so `cancel` is exactly
/// `{"v":1,"status":"cancel"}` — key ORDER is serde's business, never a caller's.
/// On decode, unknown fields are ignored (serde's default): the tolerant reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostResult {
    /// Always `PROTOCOL_VERSION` on emit, and REQUIRED on decode — a v0 line (the
    /// prototype's, which carried no `v`) must fail loudly, not half-parse.
    pub v: u32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(rename = "displayId", skip_serializing_if = "Option::is_none")]
    pub display_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<HostBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<HostErrorCode>,
    /// The human sentence. The prototype called this `error`; `message` is the
    /// name now, because `code` carries the meaning (SNAP-D2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl HostResult {
    pub fn ok(
        path: String,
        width: i32,
        height: i32,
        scale: f64,
        display_id: u32,
        bounds: HostBounds,
    ) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            status: "ok".into(),
            path: Some(path),
            width: Some(width),
            height: Some(height),
            scale: Some(scale),
            display_id: Some(display_id),
            bounds: Some(bounds),
            code: None,
            message: None,
        }
    }

    pub fn ready() -> Self {
        Self::status_only("ready")
    }

    pub fn cancel() -> Self {
        Self::status_only("cancel")
    }

    pub fn error(code: HostErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: Some(code),
            message: Some(message.into()),
            ..Self::status_only("error")
        }
    }

    fn status_only(status: &str) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            status: status.into(),
            path: None,
            width: None,
            height: None,
            scale: None,
            display_id: None,
            bounds: None,
            code: None,
            message: None,
        }
    }
}

pub fn encode(result: &HostResult) -> Result<String, String> {
    serde_json::to_string(result).map_err(|error| error.to_string())
}

/// The other half of the seam. Only the tests read lines today — the host is
/// TypeScript — but decode is what pins this crate to the contract fixtures.
#[allow(dead_code)]
pub fn decode(text: &str) -> Result<HostResult, String> {
    serde_json::from_str(text).map_err(|error| error.to_string())
}

pub fn emit(result: &HostResult) {
    let line = match encode(result) {
        Ok(line) => line,
        // serde_json only fails here on a non-finite float — a scale or a bound
        // that a capture invented. Say so in the vocabulary the host knows.
        Err(_) => {
            r#"{"v":1,"status":"error","code":"capture-failed","message":"encode failed"}"#.into()
        }
    };
    let mut out = io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

pub fn ok(path: String, width: i32, height: i32, scale: f64, display_id: u32, bounds: HostBounds) {
    emit(&HostResult::ok(
        path, width, height, scale, display_id, bounds,
    ));
}

pub fn ready() {
    emit(&HostResult::ready());
}

pub fn cancel() {
    emit(&HostResult::cancel());
}

pub fn error(code: HostErrorCode, message: impl Into<String>) {
    emit(&HostResult::error(code, message));
}

/// Emit a boundary failure with the code it already carries.
pub fn fail(error: &HelperError) {
    self::error(error.code, error.message.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn sample_bounds() -> HostBounds {
        HostBounds {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        }
    }

    /// `packages/contracts/fixtures` from this crate's directory: five hops up
    /// (screenshot-helper → windows → native → desktop → apps → repo root).
    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../../packages/contracts/fixtures")
    }

    #[test]
    fn ok_round_trip() {
        let result = HostResult::ok(
            r"C:\tmp\shot.png".into(),
            1920,
            1080,
            1.5,
            1,
            sample_bounds(),
        );
        let json = encode(&result).unwrap();
        assert!(json.contains(r#""status":"ok""#));
        assert!(json.contains(r#""path":"C:\\tmp\\shot.png""#));
        assert!(json.contains(r#""width":1920"#));
        assert!(json.contains(r#""scale":1.5"#));
        assert!(!json.contains("code"));
        assert!(!json.contains("message"));
        let decoded = decode(&json).unwrap();
        assert_eq!(decoded, result);
        assert_eq!(decoded.v, PROTOCOL_VERSION);
    }

    #[test]
    fn cancel_omits_optional_fields() {
        let json = encode(&HostResult::cancel()).unwrap();
        // Structure, never key order — serde owns the order.
        let decoded = decode(&json).unwrap();
        assert_eq!(decoded, HostResult::cancel());
        assert_eq!(decoded.status, "cancel");
        assert_eq!(decoded.v, PROTOCOL_VERSION);
        assert!(decoded.path.is_none());
        assert!(decoded.width.is_none());
        assert!(decoded.height.is_none());
        assert!(decoded.scale.is_none());
        assert!(decoded.display_id.is_none());
        assert!(decoded.bounds.is_none());
        assert!(decoded.code.is_none());
        assert!(decoded.message.is_none());
        assert_eq!(json.matches(':').count(), 2, "only v and status: {json}");
    }

    #[test]
    fn error_carries_a_typed_code_and_a_message() {
        let json = encode(&HostResult::error(
            HostErrorCode::PermissionDenied,
            "Screen Recording permission is required",
        ))
        .unwrap();
        assert!(json.contains(r#""code":"permission-denied""#), "{json}");
        let decoded = decode(&json).unwrap();
        assert_eq!(decoded.status, "error");
        assert_eq!(decoded.v, PROTOCOL_VERSION);
        assert_eq!(decoded.code, Some(HostErrorCode::PermissionDenied));
        assert_eq!(
            decoded.message.as_deref(),
            Some("Screen Recording permission is required")
        );
    }

    #[test]
    fn every_code_spells_itself_the_way_the_contract_does() {
        for (code, wire) in [
            (HostErrorCode::PermissionDenied, "permission-denied"),
            (HostErrorCode::CaptureFailed, "capture-failed"),
            (HostErrorCode::NoDisplays, "no-displays"),
            (HostErrorCode::WriteFailed, "write-failed"),
        ] {
            let json = encode(&HostResult::error(code, "x")).unwrap();
            assert!(json.contains(&format!(r#""code":"{wire}""#)), "{json}");
            assert_eq!(code.to_string(), wire);
        }
    }

    #[test]
    fn ready_status() {
        let decoded = decode(&encode(&HostResult::ready()).unwrap()).unwrap();
        assert_eq!(decoded.status, "ready");
        assert_eq!(decoded.v, PROTOCOL_VERSION);
    }

    #[test]
    fn ok_line_carries_version() {
        let json = encode(&HostResult::ok(
            r"C:\tmp\shot.png".into(),
            640,
            480,
            1.0,
            2,
            sample_bounds(),
        ))
        .unwrap();
        assert!(json.contains(r#""v":1"#), "{json}");
    }

    /// EL9: the SAME fixture files zod parses must decode here. A silent skip is
    /// not a test, so a short count panics.
    #[test]
    fn contract_fixtures_decode() {
        let dir = fixtures_dir();
        let entries = std::fs::read_dir(&dir)
            .unwrap_or_else(|error| panic!("read {}: {error}", dir.display()));
        let mut seen = 0usize;
        for entry in entries {
            let entry = entry.expect("fixture dir entry");
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = name.strip_prefix("screenshot-helper-event.") else {
                continue;
            };
            let Some(segment) = rest.strip_suffix(".json") else {
                continue;
            };
            seen += 1;
            let text = std::fs::read_to_string(entry.path())
                .unwrap_or_else(|error| panic!("read {name}: {error}"));
            let decoded =
                decode(&text).unwrap_or_else(|error| panic!("decode {name}: {error}\n{text}"));
            assert_eq!(
                decoded.v, PROTOCOL_VERSION,
                "{name}: every line carries v:1"
            );
            let expected = match segment {
                // the tolerant-reader fixture and the Windows one are `ok` lines
                "ok-windows" | "unknown-field" => "ok",
                other => other,
            };
            assert_eq!(decoded.status, expected, "{name}: status");
            match expected {
                "ok" => {
                    let path = decoded.path.as_deref().unwrap_or_default();
                    assert!(!path.is_empty(), "{name}: ok names a still");
                    assert!(decoded.width.unwrap_or_default() > 0, "{name}: width");
                    assert!(decoded.height.unwrap_or_default() > 0, "{name}: height");
                    assert!(decoded.scale.unwrap_or_default() > 0.0, "{name}: scale");
                    assert!(decoded.bounds.is_some(), "{name}: bounds");
                    if segment == "ok-windows" {
                        assert!(path.contains('\\'), "{name}: a Windows path is backslashed");
                    }
                }
                "error" => {
                    assert_eq!(
                        decoded.code,
                        Some(HostErrorCode::PermissionDenied),
                        "{name}: code"
                    );
                    assert!(
                        !decoded.message.as_deref().unwrap_or_default().is_empty(),
                        "{name}: message"
                    );
                }
                "ready" | "cancel" => {
                    assert!(decoded.path.is_none(), "{name}: carries no still");
                    assert!(decoded.code.is_none(), "{name}: carries no code");
                }
                other => panic!("{name}: unexpected status {other}"),
            }
        }
        assert!(
            seen >= 6,
            "found {seen} screenshot-helper-event fixtures under {} — expected at least 6",
            dir.display()
        );
    }
}
