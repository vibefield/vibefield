use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Write as _};
use std::path::Path;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Metadata};

pub const MAX_RECORD_BYTES: usize = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_STRING_BYTES: usize = 16 * 1024;
const MAX_ATTRIBUTE_KEYS: usize = 100;
const CAPTURE_TAIL_GUARD_BYTES: usize = 64;
const CAPTURE_TRUNCATION_MARKER: &str = "…[truncated]";

#[derive(Clone, Debug, Default)]
pub struct PathAliases {
    values: Vec<(String, &'static str)>,
}

impl PathAliases {
    pub fn new(home: Option<&Path>, temp: Option<&Path>, logs: &Path, data: &Path) -> Self {
        let mut values = Vec::new();
        if let Some(path) = home {
            push_alias(&mut values, path, "<home>");
        }
        if let Some(path) = temp {
            push_alias(&mut values, path, "<temp>");
        }
        push_alias(&mut values, logs, "<logs>");
        push_alias(&mut values, data, "<data>");
        values.sort_by_key(|value| std::cmp::Reverse(value.0.len()));
        Self { values }
    }

    fn apply(&self, input: &str) -> String {
        self.values
            .iter()
            .fold(input.to_owned(), |value, (path, alias)| {
                value.replace(path, alias)
            })
    }
}

fn push_alias(values: &mut Vec<(String, &'static str)>, path: &Path, alias: &'static str) {
    let value = path.to_string_lossy();
    if !value.is_empty() {
        values.push((value.into_owned(), alias));
    }
}

#[derive(Clone, Debug)]
pub struct EncodedRecord {
    pub value: Value,
    pub line: Vec<u8>,
    pub level: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default)]
pub struct CapturedFields {
    pub values: BTreeMap<String, Value>,
    truncated_fields: BTreeSet<String>,
}

impl CapturedFields {
    pub fn merge(&mut self, other: &Self) {
        for (key, value) in &other.values {
            self.values.insert(key.clone(), value.clone());
            if other.truncated_fields.contains(key) {
                self.truncated_fields.insert(key.clone());
            } else {
                self.truncated_fields.remove(key);
            }
        }
    }

    fn insert(&mut self, field: &Field, value: Value, truncated: bool) {
        let key = field.name().to_owned();
        self.values.insert(key.clone(), value);
        if truncated {
            self.truncated_fields.insert(key);
        } else {
            self.truncated_fields.remove(&key);
        }
    }
}

impl Visit for CapturedFields {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.insert(field, Value::Bool(value), false);
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.insert(field, value.into(), false);
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.insert(field, value.into(), false);
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        let normalized = if value.is_finite() {
            Value::from(value)
        } else {
            Value::String("<non-finite>".into())
        };
        self.insert(field, normalized, false);
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        let (value, truncated) = capture_string(value);
        self.insert(field, Value::String(value), truncated);
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        let (value, truncated) = capture_display(value);
        self.insert(field, Value::String(value), truncated);
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        let (value, truncated) = capture_debug(value);
        self.insert(field, Value::String(value), truncated);
    }
}

struct BoundedFormat {
    value: String,
    truncated: bool,
}

impl BoundedFormat {
    fn new() -> Self {
        Self {
            value: String::new(),
            truncated: false,
        }
    }

    fn finish(mut self) -> (String, bool) {
        if self.truncated {
            self.value.push_str(CAPTURE_TRUNCATION_MARKER);
        }
        (self.value, self.truncated)
    }
}

impl fmt::Write for BoundedFormat {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        let maximum = MAX_STRING_BYTES
            .saturating_sub(CAPTURE_TAIL_GUARD_BYTES)
            .saturating_sub(CAPTURE_TRUNCATION_MARKER.len());
        let remaining = maximum.saturating_sub(self.value.len());
        if value.len() <= remaining {
            self.value.push_str(value);
            return Ok(());
        }
        let mut end = remaining;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        self.value.push_str(&value[..end]);
        self.truncated = true;
        Err(fmt::Error)
    }
}

fn capture_string(value: &str) -> (String, bool) {
    let mut output = BoundedFormat::new();
    let _ = output.write_str(value);
    output.finish()
}

fn capture_display(value: &(dyn std::error::Error + 'static)) -> (String, bool) {
    let mut output = BoundedFormat::new();
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        write!(&mut output, "{value}")
    }))
    .is_err()
    {
        return ("<error-format-panicked>".into(), true);
    }
    output.finish()
}

fn capture_debug(value: &dyn fmt::Debug) -> (String, bool) {
    let mut output = BoundedFormat::new();
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        write!(&mut output, "{value:?}")
    }))
    .is_err()
    {
        return ("<debug-format-panicked>".into(), true);
    }
    output.finish()
}

pub fn encode_event(
    event: &Event<'_>,
    metadata: &Metadata<'_>,
    mut fields: CapturedFields,
    boot_id: &str,
    instance_id: &str,
    sequence: u64,
    aliases: &PathAliases,
) -> Option<EncodedRecord> {
    event.record(&mut fields);
    let mut captured_truncated = fields.truncated_fields;

    let supplied_event = take_string(&mut fields.values, "event");
    let dependency_event = supplied_event.is_none() && trusted_dependency_target(metadata.target());
    let event_name = match supplied_event {
        Some(value) if valid_event_name(&value) => value,
        Some(_) => return None,
        None if dependency_event => {
            fields.values.insert(
                "dependency_target".into(),
                Value::String(metadata.target().to_owned()),
            );
            "field_native.sidecar.runtime_log".into()
        }
        None => return None,
    };
    let component = take_string(&mut fields.values, "component")
        .map(|value| normalize_component(&value))
        .unwrap_or_else(|| {
            if dependency_event {
                "sidecar".into()
            } else {
                component_from_target(metadata.target())
            }
        });
    if !valid_component(&component) {
        return None;
    }

    let fatal = fields
        .values
        .remove("fatal")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let (level, severity) = if fatal {
        (60, "FATAL")
    } else {
        level_fields(metadata.level())
    };
    let message_capture_truncated = captured_truncated.remove("message");
    let mut message = take_string(&mut fields.values, "message").unwrap_or_default();
    message = sanitize_string("message", &message, aliases);
    let (message, message_truncated) = truncate_utf8(&message, MAX_MESSAGE_BYTES);

    let error_capture_truncated =
        captured_truncated.remove("error") || captured_truncated.remove("err");
    let (error, error_truncated) =
        take_first_string(&mut fields.values, &["error", "err"]).map_or((None, false), |value| {
            let (message, truncated) = truncate_utf8(
                &sanitize_string("error", &value, aliases),
                MAX_MESSAGE_BYTES,
            );
            (
                Some(json!({
                    "type": "Error",
                    "message": message
                })),
                truncated,
            )
        });

    let mut top_level = BTreeMap::new();
    let mut string_fields_truncated = Vec::new();
    for (input, output) in [
        ("trace_id", "traceId"),
        ("traceId", "traceId"),
        ("span_id", "spanId"),
        ("spanId", "spanId"),
        ("operation_id", "operationId"),
        ("operationId", "operationId"),
        ("request_id", "requestId"),
        ("requestId", "requestId"),
        ("session_id", "sessionId"),
        ("sessionId", "sessionId"),
        ("doc_id", "docId"),
        ("docId", "docId"),
        ("device_id", "deviceId"),
        ("deviceId", "deviceId"),
    ] {
        if let Some(value) = take_string(&mut fields.values, input) {
            if captured_truncated.remove(input) {
                string_fields_truncated.push(output.to_owned());
            }
            let clean = truncate_utf8(&sanitize_string(output, &value, aliases), 256).0;
            if !clean.is_empty() {
                top_level.insert(output.to_owned(), Value::String(clean));
            }
        }
    }

    let object_keys_truncated = fields.values.len() > MAX_ATTRIBUTE_KEYS;
    let mut attributes = Map::new();
    for (key, value) in fields.values.into_iter().take(MAX_ATTRIBUTE_KEYS) {
        if reserved_key(&key) {
            continue;
        }
        let (value, truncated) = sanitize_value(&key, value, aliases);
        if truncated || captured_truncated.contains(&key) {
            string_fields_truncated.push(key.clone());
        }
        attributes.insert(key, value);
    }

    let time = epoch_millis();
    let mut record = Map::new();
    record.insert("v".into(), 1.into());
    record.insert("time".into(), time.into());
    record.insert("level".into(), level.into());
    record.insert("severity".into(), severity.into());
    record.insert("event".into(), event_name.into());
    record.insert("msg".into(), message.into());
    record.insert("service".into(), "field-native".into());
    record.insert("role".into(), "daemon".into());
    record.insert("component".into(), component.into());
    record.insert("pid".into(), u64::from(std::process::id()).into());
    record.insert("bootId".into(), bounded_identity(boot_id).into());
    record.insert("instanceId".into(), bounded_identity(instance_id).into());
    record.insert("seq".into(), sequence.into());
    for (key, value) in top_level {
        record.insert(key, value);
    }
    if let Some(error) = error {
        record.insert("err".into(), error);
    }
    if !attributes.is_empty() {
        record.insert("attrs".into(), Value::Object(attributes));
    }
    let mut initial_reasons = Vec::new();
    let mut initial_fields = Vec::new();
    if message_truncated || message_capture_truncated {
        initial_reasons.push("message-bytes");
        initial_fields.push("msg".to_owned());
    }
    if error_truncated || error_capture_truncated || !string_fields_truncated.is_empty() {
        initial_reasons.push("string-bytes");
        if error_truncated {
            initial_fields.push("err.message".to_owned());
        }
        initial_fields.extend(string_fields_truncated);
    }
    if object_keys_truncated {
        initial_reasons.push("object-keys");
    }
    if !initial_reasons.is_empty() {
        record.insert(
            "truncation".into(),
            json!({"reasons":initial_reasons,"fields":initial_fields}),
        );
    }

    bound_record(record)
}

fn bound_record(mut record: Map<String, Value>) -> Option<EncodedRecord> {
    let original_bytes = serde_json::to_vec(&record).ok()?.len();
    let mut reasons: Vec<String> = record
        .get("truncation")
        .and_then(Value::as_object)
        .and_then(|truncation| truncation.get("reasons"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect();
    let mut dropped_fields: Vec<String> = record
        .get("truncation")
        .and_then(Value::as_object)
        .and_then(|truncation| truncation.get("fields"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect();
    record.remove("truncation");

    while serialized_len(&record) > MAX_RECORD_BYTES.saturating_sub(1_024) {
        let removed = record
            .get_mut("attrs")
            .and_then(Value::as_object_mut)
            .and_then(|attributes| {
                let key = attributes.keys().next_back()?.clone();
                attributes.remove(&key);
                Some(key)
            });
        match removed {
            Some(key) => dropped_fields.push(key),
            None => break,
        }
    }
    if record
        .get("attrs")
        .and_then(Value::as_object)
        .is_some_and(Map::is_empty)
    {
        record.remove("attrs");
    }
    if !dropped_fields.is_empty() {
        reasons.push("record-bytes".into());
    }

    if serialized_len(&record) > MAX_RECORD_BYTES {
        if let Some(error) = record.get_mut("err").and_then(Value::as_object_mut) {
            error.remove("stack");
            error.remove("causes");
            if let Some(message) = error
                .get("message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
            {
                error.insert("message".into(), truncate_utf8(&message, 2 * 1024).0.into());
            }
        }
        reasons.push("record-bytes".into());
    }
    if serialized_len(&record) > MAX_RECORD_BYTES {
        record.remove("attrs");
        record.remove("err");
        if let Some(message) = record.get("msg").and_then(Value::as_str) {
            record.insert("msg".into(), truncate_utf8(message, 1024).0.into());
        }
        reasons.push("record-bytes".into());
    }

    reasons.sort_unstable();
    reasons.dedup();
    if !reasons.is_empty() {
        let mut truncation = Map::new();
        truncation.insert(
            "reasons".into(),
            Value::Array(reasons.iter().cloned().map(Value::String).collect()),
        );
        truncation.insert("originalBytes".into(), original_bytes.into());
        if !dropped_fields.is_empty() {
            for field in &mut dropped_fields {
                *field = truncate_utf8(field, 160).0;
            }
            dropped_fields.sort();
            dropped_fields.dedup();
            dropped_fields.truncate(32);
            truncation.insert(
                "fields".into(),
                Value::Array(dropped_fields.into_iter().map(Value::String).collect()),
            );
        }
        record.insert("truncation".into(), Value::Object(truncation));
    }

    let value = Value::Object(record);
    let level = value.get("level").and_then(Value::as_u64).unwrap_or(30);
    let mut line = serde_json::to_vec(&value).ok()?;
    if line.len() > MAX_RECORD_BYTES {
        return None;
    }
    line.push(b'\n');
    Some(EncodedRecord {
        value,
        line,
        level,
        truncated: !reasons.is_empty(),
    })
}

fn serialized_len(record: &Map<String, Value>) -> usize {
    serde_json::to_vec(record).map_or(usize::MAX, |bytes| bytes.len())
}

fn sanitize_value(key: &str, value: Value, aliases: &PathAliases) -> (Value, bool) {
    if secret_key(key) {
        return (Value::String("<redacted>".into()), false);
    }
    match value {
        Value::String(value) => {
            let (value, truncated) =
                truncate_utf8(&sanitize_string(key, &value, aliases), MAX_STRING_BYTES);
            (Value::String(value), truncated)
        }
        Value::Number(value) => (Value::Number(value), false),
        Value::Bool(value) => (Value::Bool(value), false),
        Value::Null => (Value::Null, false),
        other => {
            let (value, truncated) = truncate_utf8(&other.to_string(), MAX_STRING_BYTES);
            (Value::String(value), truncated)
        }
    }
}

fn sanitize_string(key: &str, value: &str, aliases: &PathAliases) -> String {
    if secret_key(key) {
        return "<redacted>".into();
    }
    let mut output = aliases.apply(value).replace(['\r', '\n'], " ");
    if contains_private_key(&output) {
        return "<redacted-private-key>".into();
    }
    output = redact_urls(&output);
    output = redact_named_secrets(&output);
    output = redact_bearer(&output);
    redact_secret_runs(&output)
}

fn redact_named_secrets(input: &str) -> String {
    static PATH_SECRET: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::new(r"/t/[A-Za-z0-9_-]{16,}").expect("valid path-secret regex")
    });
    static NAMED_SECRET: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::with_flags(
            r"\b(token|access[_-]?token|refresh[_-]?token|credential|password|secret|private[_-]?key|pairing|api[_-]?key|session[_-]?cookie)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,}",
            "i",
        )
        .expect("valid named-secret regex")
    });
    static HEADER_SECRET: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::with_flags(
            r"\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]{8,}",
            "i",
        )
        .expect("valid header-secret regex")
    });

    let output = PATH_SECRET.replace_all(input, "/t/<redacted>");
    let output = NAMED_SECRET.replace_all(&output, "$1=<redacted>");
    HEADER_SECRET.replace_all(&output, "$1=<redacted>")
}

fn redact_bearer(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find("bearer ") {
        let start = cursor + relative;
        output.push_str(&input[cursor..start]);
        output.push_str("Bearer <redacted>");
        let token_start = start + "bearer ".len();
        let token_end = input[token_start..]
            .find(char::is_whitespace)
            .map_or(input.len(), |index| token_start + index);
        cursor = token_end;
    }
    output.push_str(&input[cursor..]);
    output
}

fn redact_secret_runs(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut index = 0;
    while index < bytes.len() {
        if secret_run_byte(bytes[index]) {
            let start = index;
            while index < bytes.len() && secret_run_byte(bytes[index]) {
                index += 1;
            }
            let run = &input[start..index];
            let hex_secret = run.len() >= 64 && run.bytes().all(|byte| byte.is_ascii_hexdigit());
            let token_secret = matches!(run.len(), 32 | 43)
                || (run.len() > 43
                    && run.bytes().any(|byte| byte.is_ascii_lowercase())
                    && run.bytes().any(|byte| byte.is_ascii_uppercase())
                    && run.bytes().any(|byte| byte.is_ascii_digit()));
            if hex_secret || token_secret {
                output.push_str(&input[cursor..start]);
                output.push_str("<redacted>");
                cursor = index;
            }
        } else {
            index += 1;
        }
    }
    output.push_str(&input[cursor..]);
    output
}

fn secret_run_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

fn redact_urls(input: &str) -> String {
    static URL: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::with_flags(r#"\b[a-z][a-z0-9+.-]*://[^\s<>"']+"#, "i")
            .expect("valid URL regex")
    });
    URL.replace_all_with(input, |matched| sanitize_url(matched.as_str(input)))
}

fn sanitize_url(input: &str) -> String {
    let Some(scheme_end) = input.find("://") else {
        return input.to_owned();
    };
    let scheme = &input[..scheme_end];
    let rest = &input[scheme_end + 3..];
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let mut path = rest.get(authority_end..).unwrap_or_default();
    if let Some(end) = path.find(['?', '#']) {
        path = &path[..end];
    }
    let mut segments = path.split('/').peekable();
    let mut safe_path = String::new();
    while let Some(segment) = segments.next() {
        safe_path.push_str(segment);
        if segment == "t" && segments.peek().is_some() {
            safe_path.push_str("/<redacted>");
            segments.next();
        }
        if segments.peek().is_some() {
            safe_path.push('/');
        }
    }
    format!("{scheme}://{host}{safe_path}")
}

fn contains_private_key(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    upper.contains("-----BEGIN") && upper.contains("PRIVATE KEY-----")
}

fn secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if normalized.ends_with("count")
        || normalized.ends_with("duration")
        || normalized.ends_with("present")
    {
        return false;
    }
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "credential"
            | "password"
            | "secret"
            | "privatekey"
            | "pairing"
            | "apikey"
            | "sessioncookie"
            | "pathsecret"
            | "environment"
            | "env"
            | "commandline"
            | "prompt"
            | "terminalbytes"
    )
}

fn reserved_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    matches!(
        normalized.as_str(),
        "v" | "time"
            | "observedtime"
            | "level"
            | "severity"
            | "event"
            | "message"
            | "msg"
            | "service"
            | "role"
            | "component"
            | "pid"
            | "bootid"
            | "instanceid"
            | "seq"
            | "plugin"
            | "truncation"
    )
}

fn take_string(values: &mut BTreeMap<String, Value>, key: &str) -> Option<String> {
    match values.remove(key) {
        Some(Value::String(value)) => Some(value),
        Some(value) => Some(value.to_string()),
        None => None,
    }
}

fn take_first_string(values: &mut BTreeMap<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| take_string(values, key))
}

fn bounded_identity(value: &str) -> String {
    truncate_utf8(value, 256).0
}

fn level_fields(level: &Level) -> (u64, &'static str) {
    match *level {
        Level::TRACE => (10, "TRACE"),
        Level::DEBUG => (20, "DEBUG"),
        Level::INFO => (30, "INFO"),
        Level::WARN => (40, "WARN"),
        Level::ERROR => (50, "ERROR"),
    }
}

fn component_from_target(target: &str) -> String {
    let without_root = target.strip_prefix("field_native::").unwrap_or(target);
    normalize_component(&without_root.replace("::", "."))
}

fn trusted_dependency_target(target: &str) -> bool {
    target == "truffle_core" || target.starts_with("truffle_core::")
}

fn normalize_component(input: &str) -> String {
    let mut output = String::with_capacity(input.len().min(160));
    for character in input.chars().take(160) {
        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | ':') {
            output.push(character.to_ascii_lowercase());
        } else {
            output.push('_');
        }
    }
    if !output
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
    {
        output.insert_str(0, "native.");
    }
    output
}

fn valid_event_name(value: &str) -> bool {
    value.len() >= 3
        && value.len() <= 192
        && value.split('.').count() >= 2
        && value.split('.').all(valid_name_segment)
}

fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .split(['.', ':'])
            .all(|segment| !segment.is_empty() && valid_component_segment(segment))
}

fn valid_name_segment(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn valid_component_segment(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && value.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '_'
                || character == '-'
        })
}

fn truncate_utf8(value: &str, maximum: usize) -> (String, bool) {
    if value.len() <= maximum {
        return (value.to_owned(), false);
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), true)
}

pub fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_and_secret_sanitization_is_bounded() {
        let aliases = PathAliases::new(
            Some(Path::new("/Users/james")),
            None,
            Path::new("/logs"),
            Path::new("/data"),
        );
        let raw = "https://user:pass@example.test/t/abcdefghijklmnopqrstuvwx?q=secret#frag \
            (https://alice:password@example.test?token=canary#frag) \
            /t/vf-secret-token-1234567890 password=abcdefghijklmnop \
            Cookie: abcdefghijklmnop /Users/james/file \
            Bearer abcdefghijklmnopqrstuvwxyzABCDEFGH123456";
        let clean = sanitize_string("detail", raw, &aliases);
        assert!(clean.contains("https://example.test/t/<redacted>"));
        assert!(clean.contains("(https://example.test"));
        assert!(clean.contains("/t/<redacted>"));
        assert!(clean.contains("password=<redacted>"));
        assert!(clean.contains("Cookie=<redacted>"));
        assert!(clean.contains("<home>/file"));
        assert!(clean.contains("Bearer <redacted>"));
        assert!(!clean.contains("secret"), "{clean}");
        assert!(!clean.contains("user:pass"));
        assert!(!clean.contains("alice:password"));
        assert!(!clean.contains("canary"));
        assert!(!clean.contains("abcdefghijklmnop"));
    }

    #[test]
    fn key_policy_redacts_exact_secret_names_but_not_counters() {
        assert!(secret_key("accessToken"));
        assert!(secret_key("path_secret"));
        assert!(!secret_key("tokenCount"));
        assert!(!secret_key("secretPresent"));
    }

    #[test]
    fn utf8_truncation_never_splits_a_character() {
        let (value, truncated) = truncate_utf8("abc🧊def", 5);
        assert_eq!(value, "abc");
        assert!(truncated);
    }

    #[test]
    fn tracing_capture_is_bounded_before_debug_values_are_materialized() {
        struct HugeDebug;
        impl fmt::Debug for HugeDebug {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                for _ in 0..100_000 {
                    formatter.write_str("🧊")?;
                }
                Ok(())
            }
        }

        let (value, truncated) = capture_debug(&HugeDebug);
        assert!(truncated);
        assert!(value.len() <= MAX_STRING_BYTES);
        assert!(value.ends_with(CAPTURE_TRUNCATION_MARKER));
        assert!(std::str::from_utf8(value.as_bytes()).is_ok());
    }
}
