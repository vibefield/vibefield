mod record;
mod segment;
mod stderr;

use crate::config::NativeConfig;
use anyhow::{anyhow, Context as _, Result};
use record::{encode_event, epoch_millis, CapturedFields, EncodedRecord, PathAliases};
use segment::{
    FailureKind, RetentionPolicy, SegmentWriter, SegmentWriterOptions, WriterError, WriterHooks,
    WriterResult,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::str::FromStr;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Subscriber};
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::{LookupSpan, Registry};
use tracing_subscriber::{reload, Layer};

const QUEUE_RECORDS: usize = 8_192;
const QUEUE_BYTES: usize = 8 * 1024 * 1024;
const RESERVED_RECORDS: usize = 256;
const RESERVED_BYTES: usize = 512 * 1024;
const RING_RECORDS: usize = 2_000;
const RING_BYTES: usize = 2 * 1024 * 1024;
const BATCH_RECORDS: usize = 128;
const BATCH_BYTES: usize = 256 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const EMERGENCY_MIN_INTERVAL_MS: u64 = 60_000;

type FilterHandle = reload::Handle<Targets, Registry>;
type Emergency = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
pub struct NativeLogging {
    core: Arc<Core>,
    filter: Arc<FilterHandle>,
    base_targets: Arc<Mutex<Targets>>,
    base_level: Arc<Mutex<String>>,
    leases: Arc<Mutex<HashMap<String, NativeDiagnosticLease>>>,
    worker: Arc<Mutex<Option<JoinHandle<()>>>>,
    stderr_route: Arc<Mutex<Option<stderr::StderrRoute>>>,
    active_path: Arc<std::path::PathBuf>,
}

#[derive(Clone)]
struct NativeDiagnosticLease {
    value: Value,
    level: String,
    expires_at: u64,
}

#[derive(Clone, Debug)]
pub struct NativeLogQuery {
    source_selected: bool,
    since_time: Option<u64>,
    min_level: u64,
    components: Option<HashSet<String>>,
    text: Option<String>,
    plugin_selected: bool,
    limit: usize,
}

struct NativeLayer {
    core: Arc<Core>,
    boot_id: String,
    instance_id: String,
    aliases: PathAliases,
}

#[derive(Clone)]
struct QueuedRecord {
    line: Vec<u8>,
    level: u64,
}

#[derive(Clone)]
struct RingRecord {
    cursor: u64,
    value: Value,
    bytes: usize,
}

#[derive(Clone, Debug, Default)]
struct Counters {
    accepted: u64,
    rejected: u64,
    truncated: u64,
    dropped_trace: u64,
    dropped_debug: u64,
    dropped_info: u64,
    dropped_warn: u64,
    dropped_error: u64,
    bytes_written: u64,
    rotations: u64,
    cleanup_deletions: u64,
    emergency_fallbacks: u64,
}

#[derive(Clone, Debug)]
struct LastFailure {
    kind: FailureKind,
    time: u64,
    message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WriterState {
    Starting,
    Healthy,
    Degraded,
    Closed,
    WriterConflict,
}

impl WriterState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Closed => "closed",
            Self::WriterConflict => "writer-conflict",
        }
    }
}

struct State {
    queue: VecDeque<QueuedRecord>,
    queue_bytes: usize,
    in_flight_records: usize,
    in_flight_bytes: usize,
    queue_high_water_records: usize,
    queue_high_water_bytes: usize,
    ring: VecDeque<RingRecord>,
    ring_bytes: usize,
    ring_high_water_records: usize,
    ring_high_water_bytes: usize,
    next_cursor: u64,
    dropped_before: u64,
    accepting: bool,
    close_requested: bool,
    closed: bool,
    flush_requested: u64,
    flush_completed: u64,
    writer_state: WriterState,
    current_level: String,
    active_lease_count: usize,
    active_segment_bytes: u64,
    last_write_at: Option<u64>,
    last_failure: Option<LastFailure>,
    counters: Counters,
    retry_attempt: u32,
    emergency_emitted: bool,
    last_emergency_at: Option<u64>,
}

struct Core {
    state: Mutex<State>,
    sequence: Mutex<u64>,
    changed: Condvar,
    updates: watch::Sender<u64>,
    emergency: Emergency,
    boot_id: String,
    instance_id: String,
}

enum WorkerAction {
    Batch(Vec<QueuedRecord>),
    Open,
    Flush(u64),
    Close,
}

/// Logging is an observability boundary, not a reason to abort the product.
/// Recover the protected value after a panic instead of propagating mutex
/// poison through an unrelated caller or through the panic hook itself.
fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl NativeLogging {
    /// Installs the production process-global tracing subscriber after the
    /// field-native stream has been opened, but before any Tokio service is
    /// composed. A process may install this exactly once.
    pub fn install(config: &NativeConfig, boot_id: &str) -> Result<Self> {
        let log_root = config.log_root.as_ref().ok_or_else(|| {
            anyhow!("field-native production logging requires an absolute log root")
        })?;
        let mut stderr_route =
            stderr::StderrRoute::install().context("install field-native stderr route")?;
        let (logging, subscriber) = build_logging(
            log_root,
            &config.data_dir,
            boot_id,
            config.log_filter.as_deref(),
            RetentionPolicy::default(),
            WriterHooks::default(),
            stderr_route.emergency(),
        )?;
        if let Err(error) = tracing::subscriber::set_global_default(subscriber) {
            stderr_route.close(Duration::from_millis(250));
            let _ = logging.close(Duration::from_secs(2));
            return Err(anyhow!("install field-native tracing subscriber: {error}"));
        }
        *lock_recover(&logging.stderr_route) = Some(stderr_route);
        Ok(logging)
    }

    pub fn active_path(&self) -> &std::path::Path {
        self.active_path.as_ref()
    }

    pub fn set_level(&self, level: &str) -> Result<()> {
        let filter_level = parse_level(level)?;
        *lock_recover(&self.base_targets) = Targets::new().with_default(filter_level);
        *lock_recover(&self.base_level) = level.to_ascii_lowercase();
        self.refresh_diagnostic_filter()
    }

    pub fn health(&self) -> Value {
        let _ = self.refresh_diagnostic_filter();
        self.core.health()
    }

    pub fn create_diagnostic_lease(&self, raw: &Value) -> std::result::Result<Value, String> {
        let (lease_id, level, expires_at) = parse_native_diagnostic_lease(raw)?;
        {
            let mut leases = lock_recover(&self.leases);
            prune_native_leases(&mut leases, epoch_millis());
            if leases.len() >= 256 {
                return Err("native diagnostic lease limit reached".into());
            }
            if leases.contains_key(&lease_id) {
                return Err("native diagnostic lease id already exists".into());
            }
            leases.insert(
                lease_id.clone(),
                NativeDiagnosticLease {
                    value: raw.clone(),
                    level,
                    expires_at,
                },
            );
        }
        if let Err(error) = self.refresh_diagnostic_filter() {
            lock_recover(&self.leases).remove(&lease_id);
            let _ = self.refresh_diagnostic_filter();
            return Err(error.to_string());
        }
        Ok(raw.clone())
    }

    pub fn list_diagnostic_leases(&self) -> std::result::Result<Vec<Value>, String> {
        self.refresh_diagnostic_filter()
            .map_err(|error| error.to_string())?;
        let mut leases = lock_recover(&self.leases)
            .values()
            .map(|lease| lease.value.clone())
            .collect::<Vec<_>>();
        leases.sort_by(|left, right| {
            left.get("expiresAt")
                .and_then(Value::as_u64)
                .cmp(&right.get("expiresAt").and_then(Value::as_u64))
                .then_with(|| {
                    left.get("leaseId")
                        .and_then(Value::as_str)
                        .cmp(&right.get("leaseId").and_then(Value::as_str))
                })
        });
        Ok(leases)
    }

    pub fn revoke_diagnostic_lease(&self, lease_id: &str) -> std::result::Result<bool, String> {
        let removed = lock_recover(&self.leases).remove(lease_id).is_some();
        self.refresh_diagnostic_filter()
            .map_err(|error| error.to_string())?;
        Ok(removed)
    }

    pub fn prune_diagnostic_leases(&self) -> std::result::Result<(), String> {
        self.refresh_diagnostic_filter()
            .map_err(|error| error.to_string())
    }

    fn refresh_diagnostic_filter(&self) -> Result<()> {
        let now = epoch_millis();
        let (active_count, leased_level) = {
            let mut leases = lock_recover(&self.leases);
            prune_native_leases(&mut leases, now);
            let minimum = leases
                .values()
                .filter_map(|lease| level_number(&lease.level).map(|level| (level, &lease.level)))
                .min_by_key(|(level, _)| *level)
                .map(|(_, level)| level.clone());
            (leases.len(), minimum)
        };
        let base_level = lock_recover(&self.base_level).clone();
        let effective_level = match leased_level {
            Some(level)
                if level_number(&level).unwrap_or(30) < level_number(&base_level).unwrap_or(30) =>
            {
                level
            }
            _ => base_level,
        };
        let targets = if active_count == 0 {
            lock_recover(&self.base_targets).clone()
        } else {
            Targets::new().with_default(parse_level(&effective_level)?)
        };
        self.filter
            .reload(targets)
            .map_err(|error| anyhow!("reload field-native diagnostic lease filter: {error}"))?;
        let mut state = lock_recover(&self.core.state);
        state.current_level = effective_level;
        state.active_lease_count = active_count;
        Ok(())
    }

    pub fn parse_query(params: &Value) -> std::result::Result<NativeLogQuery, String> {
        let object = params
            .as_object()
            .ok_or_else(|| "expected a diagnostic query object".to_owned())?;
        let sources = object
            .get("sources")
            .and_then(Value::as_array)
            .ok_or_else(|| "sources must be an array".to_owned())?;
        if sources.is_empty() || sources.len() > 8 {
            return Err("sources must contain 1..8 entries".into());
        }
        let mut source_selected = false;
        for source in sources {
            let value = source
                .as_str()
                .ok_or_else(|| "source entries must be strings".to_owned())?;
            if !matches!(
                value,
                "system/desktop"
                    | "system/renderer"
                    | "system/utility"
                    | "system/fieldd"
                    | "system/field-native"
                    | "plugins/renderer"
                    | "plugins/service"
                    | "plugins/utility"
            ) {
                return Err("sources contain an unknown diagnostic stream".into());
            }
            if value == "system/field-native" {
                source_selected = true;
            }
        }
        let limit = object
            .get("limit")
            .and_then(Value::as_u64)
            .ok_or_else(|| "limit must be an integer".to_owned())?;
        if !(1..=1_000).contains(&limit) {
            return Err("limit must be within 1..1000".into());
        }
        let since_time = optional_safe_integer(object.get("sinceTime"), "sinceTime")?;
        let min_level = match object.get("minLevel") {
            None => 10,
            Some(Value::String(level)) => level_number(level)
                .ok_or_else(|| "minLevel must be a known log level".to_owned())?,
            Some(_) => return Err("minLevel must be a known log level".into()),
        };
        let components = match object.get("components") {
            None => None,
            Some(Value::Array(values)) if values.len() <= 64 => {
                let mut components = HashSet::new();
                for value in values {
                    let component = value
                        .as_str()
                        .filter(|component| !component.is_empty() && component.len() <= 160)
                        .ok_or_else(|| "components contain an invalid value".to_owned())?;
                    components.insert(component.to_owned());
                }
                Some(components)
            }
            Some(_) => return Err("components must be an array with at most 64 entries".into()),
        };
        let text = match object.get("text") {
            None => None,
            Some(Value::String(value)) if value.len() <= 500 => Some(value.to_lowercase()),
            Some(_) => return Err("text must be a string of at most 500 bytes".into()),
        };
        let plugin_selected = match object.get("pluginId") {
            None => false,
            Some(Value::String(value)) if !value.is_empty() && value.len() <= 256 => true,
            Some(_) => return Err("pluginId is invalid".into()),
        };
        Ok(NativeLogQuery {
            source_selected,
            since_time,
            min_level,
            components,
            text,
            plugin_selected,
            limit: limit as usize,
        })
    }

    pub fn snapshot(&self, query: &NativeLogQuery) -> Value {
        self.core.snapshot(query)
    }

    pub fn delta(&self, query: &NativeLogQuery, cursor: u64) -> Value {
        self.core.delta(query, cursor)
    }

    pub fn cursor_from(value: &str) -> Option<u64> {
        value.rsplit_once(':')?.1.parse().ok()
    }

    pub fn subscribe_updates(&self) -> watch::Receiver<u64> {
        self.core.updates.subscribe()
    }

    /// Requests a worker fsync and waits only to the supplied deadline. This
    /// is safe for panic/fatal paths: it never waits on an unbounded join.
    pub fn flush(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = lock_recover(&self.core.state);
        if state.closed {
            return false;
        }
        state.flush_requested = state.flush_requested.saturating_add(1);
        let request = state.flush_requested;
        self.core.changed.notify_one();
        while state.flush_completed < request && !state.closed {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (next, result) = self
                .core
                .changed
                .wait_timeout(state, deadline.saturating_duration_since(now))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next;
            if result.timed_out() && state.flush_completed < request {
                return false;
            }
        }
        state.flush_completed >= request
            && matches!(
                state.writer_state,
                WriterState::Healthy | WriterState::Closed
            )
    }

    /// Stops admission, drains to a bounded deadline, and releases the
    /// per-stream writer lease. A timed-out worker is detached rather than
    /// blocking process shutdown forever.
    pub fn close(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        if let Some(mut route) = lock_recover(&self.stderr_route).take() {
            route.close(timeout.min(Duration::from_millis(250)));
        }
        let mut state = lock_recover(&self.core.state);
        if !state.closed {
            state.accepting = false;
            state.close_requested = true;
            self.core.changed.notify_one();
            while !state.closed {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                let (next, result) = self
                    .core
                    .changed
                    .wait_timeout(state, deadline.saturating_duration_since(now))
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state = next;
                if result.timed_out() && !state.closed {
                    break;
                }
            }
        }
        let closed = state.closed;
        drop(state);
        if closed {
            if let Some(worker) = lock_recover(&self.worker).take() {
                let _ = worker.join();
            }
        }
        closed
    }
}

impl Core {
    fn accept(&self, encoded: EncodedRecord) {
        let mut emergency = false;
        let cursor;
        {
            let mut state = lock_recover(&self.state);
            if !state.accepting {
                state.counters.rejected = state.counters.rejected.saturating_add(1);
                return;
            }
            let high_severity = encoded.level >= 40;
            let record_limit = if high_severity {
                QUEUE_RECORDS
            } else {
                QUEUE_RECORDS - RESERVED_RECORDS
            };
            let byte_limit = if high_severity {
                QUEUE_BYTES
            } else {
                QUEUE_BYTES - RESERVED_BYTES
            };
            if high_severity {
                while state.total_queue_records().saturating_add(1) > record_limit
                    || state.total_queue_bytes().saturating_add(encoded.line.len()) > byte_limit
                {
                    if !state.evict_lower_severity() {
                        break;
                    }
                }
            }
            if state.total_queue_records().saturating_add(1) > record_limit
                || state.total_queue_bytes().saturating_add(encoded.line.len()) > byte_limit
            {
                state.note_drop(encoded.level);
                if high_severity {
                    emergency = state.begin_emergency_episode();
                }
                drop(state);
                if emergency {
                    self.emit_emergency("VibeField field-native logging queue exhausted");
                }
                return;
            }

            let ring_bytes = encoded.line.len();
            state.queue_bytes = state.queue_bytes.saturating_add(ring_bytes);
            state.queue.push_back(QueuedRecord {
                line: encoded.line,
                level: encoded.level,
            });
            let queue_records = state.total_queue_records();
            let queue_bytes = state.total_queue_bytes();
            state.queue_high_water_records = state.queue_high_water_records.max(queue_records);
            state.queue_high_water_bytes = state.queue_high_water_bytes.max(queue_bytes);
            state.counters.accepted = state.counters.accepted.saturating_add(1);
            if encoded.truncated {
                state.counters.truncated = state.counters.truncated.saturating_add(1);
            }

            state.next_cursor = state.next_cursor.saturating_add(1);
            cursor = state.next_cursor;
            state.ring_bytes = state.ring_bytes.saturating_add(ring_bytes);
            state.ring.push_back(RingRecord {
                cursor,
                value: encoded.value,
                bytes: ring_bytes,
            });
            while state.ring.len() > RING_RECORDS || state.ring_bytes > RING_BYTES {
                if let Some(evicted) = state.ring.pop_front() {
                    state.ring_bytes = state.ring_bytes.saturating_sub(evicted.bytes);
                    state.dropped_before = state.dropped_before.saturating_add(1);
                } else {
                    break;
                }
            }
            state.ring_high_water_records = state.ring_high_water_records.max(state.ring.len());
            state.ring_high_water_bytes = state.ring_high_water_bytes.max(state.ring_bytes);
        }
        self.updates.send_if_modified(|current| {
            if cursor > *current {
                *current = cursor;
                true
            } else {
                false
            }
        });
        self.changed.notify_one();
    }

    fn reject(&self) {
        let mut state = lock_recover(&self.state);
        state.counters.rejected = state.counters.rejected.saturating_add(1);
    }

    fn health(&self) -> Value {
        let state = lock_recover(&self.state);
        health_value(&state, &self.boot_id, &self.instance_id)
    }

    fn snapshot(&self, query: &NativeLogQuery) -> Value {
        let state = lock_recover(&self.state);
        let newest = state.next_cursor;
        let records = snapshot_records(&state.ring, query);
        let oldest = state.ring.front().map_or(newest, |entry| entry.cursor);
        json!({
            "v": 1,
            "producers": [{
                "producerId": format!("field-native:{}", self.boot_id),
                "service": "field-native",
                "stream": "system/field-native",
                "bootId": self.boot_id,
                "instanceId": self.instance_id,
                "oldestCursor": safe_integer(oldest),
                "newestCursor": safe_integer(newest),
                "droppedBefore": safe_integer(state.dropped_before),
                "health": health_value(&state, &self.boot_id, &self.instance_id)
            }],
            "records": records,
            "nextCursor": format!("native:{}:{}", self.boot_id, newest),
            "droppedBefore": safe_integer(state.dropped_before)
        })
    }

    fn delta(&self, query: &NativeLogQuery, cursor: u64) -> Value {
        let state = lock_recover(&self.state);
        let newest = state.next_cursor;
        let oldest = state
            .ring
            .front()
            .map_or(newest.saturating_add(1), |entry| entry.cursor);
        let dropped = oldest.saturating_sub(cursor.saturating_add(1));
        let (records, next_cursor) = delta_records(&state.ring, query, cursor, newest);
        json!({
            "v": 1,
            "cursor": format!("native:{}:{}", self.boot_id, next_cursor),
            "records": records,
            "droppedSincePrevious": safe_integer(dropped)
        })
    }

    fn note_failure(&self, error: &WriterError) -> bool {
        let mut state = lock_recover(&self.state);
        state.writer_state = if error.kind == FailureKind::WriterConflict {
            WriterState::WriterConflict
        } else {
            WriterState::Degraded
        };
        state.last_failure = Some(LastFailure {
            kind: error.kind,
            time: epoch_millis(),
            message: error.message.chars().take(500).collect(),
        });
        if !state.begin_emergency_episode() {
            return false;
        }
        true
    }

    fn note_opened(&self, writer: &SegmentWriter, result: WriterResult) {
        let mut state = lock_recover(&self.state);
        apply_writer_result(&mut state, writer, result);
        if state.total_queue_records() == 0 {
            state.writer_state = WriterState::Healthy;
            state.last_failure = None;
            state.retry_attempt = 0;
            state.emergency_emitted = false;
        }
    }

    fn emit_emergency(&self, message: &str) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            (self.emergency)(message);
        }));
    }
}

impl State {
    fn total_queue_records(&self) -> usize {
        self.queue.len().saturating_add(self.in_flight_records)
    }

    fn total_queue_bytes(&self) -> usize {
        self.queue_bytes.saturating_add(self.in_flight_bytes)
    }

    fn evict_lower_severity(&mut self) -> bool {
        for maximum in [10, 20, 30] {
            if let Some(index) = self.queue.iter().position(|record| record.level <= maximum) {
                if let Some(record) = self.queue.remove(index) {
                    self.queue_bytes = self.queue_bytes.saturating_sub(record.line.len());
                    self.note_drop(record.level);
                    return true;
                }
            }
        }
        false
    }

    fn note_drop(&mut self, level: u64) {
        let counter = if level <= 10 {
            &mut self.counters.dropped_trace
        } else if level <= 20 {
            &mut self.counters.dropped_debug
        } else if level <= 30 {
            &mut self.counters.dropped_info
        } else if level <= 40 {
            &mut self.counters.dropped_warn
        } else {
            &mut self.counters.dropped_error
        };
        *counter = counter.saturating_add(1);
    }

    fn begin_emergency_episode(&mut self) -> bool {
        if self.emergency_emitted {
            return false;
        }
        self.emergency_emitted = true;
        let now = epoch_millis();
        if self
            .last_emergency_at
            .is_some_and(|previous| now.saturating_sub(previous) < EMERGENCY_MIN_INTERVAL_MS)
        {
            return false;
        }
        self.last_emergency_at = Some(now);
        self.counters.emergency_fallbacks = self.counters.emergency_fallbacks.saturating_add(1);
        true
    }

    fn below_emergency_low_watermark(&self) -> bool {
        self.total_queue_records() <= (QUEUE_RECORDS - RESERVED_RECORDS) / 2
            && self.total_queue_bytes() <= (QUEUE_BYTES - RESERVED_BYTES) / 2
    }
}

impl<S> Layer<S> for NativeLayer
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    fn on_new_span(&self, attributes: &Attributes<'_>, id: &Id, context: Context<'_, S>) {
        let mut fields = CapturedFields::default();
        attributes.record(&mut fields);
        if let Some(span) = context.span(id) {
            span.extensions_mut().insert(fields);
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, context: Context<'_, S>) {
        if let Some(span) = context.span(id) {
            let mut update = CapturedFields::default();
            values.record(&mut update);
            let mut extensions = span.extensions_mut();
            if let Some(fields) = extensions.get_mut::<CapturedFields>() {
                fields.merge(&update);
            } else {
                extensions.insert(update);
            }
        }
    }

    fn on_event(&self, event: &Event<'_>, context: Context<'_, S>) {
        let mut fields = CapturedFields::default();
        if let Some(scope) = context.event_scope(event) {
            for span in scope.from_root() {
                if let Some(span_fields) = span.extensions().get::<CapturedFields>() {
                    fields.merge(span_fields);
                }
            }
        }
        // Keep sequence assignment, normalization, ring insertion, and queue
        // admission in one producer order. Cross-thread timestamps may tie or
        // wall time may move, so readers rely on `(bootId, seq)`.
        let mut sequence = lock_recover(&self.core.sequence);
        *sequence = sequence.saturating_add(1);
        match encode_event(
            event,
            event.metadata(),
            fields,
            &self.boot_id,
            &self.instance_id,
            *sequence,
            &self.aliases,
        ) {
            Some(encoded) => self.core.accept(encoded),
            None => self.core.reject(),
        }
    }
}

fn build_logging(
    log_root: &std::path::Path,
    data_dir: &std::path::Path,
    boot_id: &str,
    filter: Option<&str>,
    retention: RetentionPolicy,
    hooks: WriterHooks,
    emergency: Emergency,
) -> Result<(NativeLogging, impl Subscriber + Send + Sync + 'static)> {
    if !log_root.is_absolute() {
        return Err(anyhow!("field-native log root must be absolute"));
    }
    let targets = filter
        .map(Targets::from_str)
        .transpose()
        .map_err(|error| anyhow!("invalid field-native log filter: {error}"))?
        .unwrap_or_else(|| Targets::new().with_default(LevelFilter::INFO));
    let instance_id = boot_id.to_owned();
    let (updates, _) = watch::channel(0_u64);
    let current_level = filter.map_or_else(|| "info".to_owned(), most_verbose_level);
    let state = State {
        queue: VecDeque::new(),
        queue_bytes: 0,
        in_flight_records: 0,
        in_flight_bytes: 0,
        queue_high_water_records: 0,
        queue_high_water_bytes: 0,
        ring: VecDeque::new(),
        ring_bytes: 0,
        ring_high_water_records: 0,
        ring_high_water_bytes: 0,
        next_cursor: 0,
        dropped_before: 0,
        accepting: true,
        close_requested: false,
        closed: false,
        flush_requested: 0,
        flush_completed: 0,
        writer_state: WriterState::Starting,
        current_level,
        active_lease_count: 0,
        active_segment_bytes: 0,
        last_write_at: None,
        last_failure: None,
        counters: Counters::default(),
        retry_attempt: 0,
        emergency_emitted: false,
        last_emergency_at: None,
    };
    let core = Arc::new(Core {
        state: Mutex::new(state),
        sequence: Mutex::new(0),
        changed: Condvar::new(),
        updates,
        emergency,
        boot_id: boot_id.to_owned(),
        instance_id: instance_id.clone(),
    });
    let mut writer = SegmentWriter::new(SegmentWriterOptions {
        log_root: log_root.to_path_buf(),
        boot_id: boot_id.to_owned(),
        retention,
        now: Arc::new(epoch_millis),
        hooks,
    })
    .map_err(|error| anyhow!(error))?;
    match writer.open() {
        Ok(result) => core.note_opened(&writer, result),
        Err(error) => {
            if core.note_failure(&error) {
                core.emit_emergency(&format!(
                    "VibeField field-native logging open failed ({})",
                    error.kind.as_str()
                ));
            }
        }
    }
    let active_path = Arc::new(writer.active_path.clone());
    let worker_core = core.clone();
    let worker = std::thread::Builder::new()
        .name("vf-native-log".into())
        .spawn(move || worker_loop(worker_core, writer))
        .context("spawn field-native logging worker")?;

    let (filter_layer, filter_handle) = reload::Layer::new(targets);
    let filter_handle = Arc::new(filter_handle);
    let base_targets = Arc::new(Mutex::new(
        filter
            .map(Targets::from_str)
            .transpose()
            .map_err(|error| anyhow!("invalid field-native log filter: {error}"))?
            .unwrap_or_else(|| Targets::new().with_default(LevelFilter::INFO)),
    ));
    let base_level = Arc::new(Mutex::new(
        filter.map_or_else(|| "info".to_owned(), most_verbose_level),
    ));
    let leases = Arc::new(Mutex::new(HashMap::new()));
    // `HOME` is a unix fact; Windows keeps the profile in `USERPROFILE`. Twin of
    // `config.rs home_dir()`, repeated here because this layer sits below config
    // (`build_logging` takes roots, never a `NativeConfig`). No `"."` default:
    // an unset var means no `<home>` alias at all, never a CWD-rooted one that
    // would rewrite unrelated relative paths in every record.
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    let layer = NativeLayer {
        core: core.clone(),
        boot_id: boot_id.to_owned(),
        instance_id,
        aliases: PathAliases::new(
            home.as_deref().map(std::path::Path::new),
            Some(std::env::temp_dir().as_path()),
            log_root,
            data_dir,
        ),
    };
    let subscriber = Registry::default().with(filter_layer).with(layer);
    Ok((
        NativeLogging {
            core,
            filter: filter_handle,
            base_targets,
            base_level,
            leases,
            worker: Arc::new(Mutex::new(Some(worker))),
            stderr_route: Arc::new(Mutex::new(None)),
            active_path,
        },
        subscriber,
    ))
}

fn worker_loop(core: Arc<Core>, mut writer: SegmentWriter) {
    let mut retry_at = (!writer.is_open()).then(|| Instant::now() + retry_delay(&core));
    loop {
        let needs_open = !writer.is_open();
        let action = {
            let mut state = lock_recover(&core.state);
            loop {
                if state.close_requested && retry_at.is_some() {
                    drop_queued(&mut state);
                    retry_at = None;
                }
                if let Some(deadline) = retry_at {
                    if Instant::now() < deadline {
                        let duration = deadline.saturating_duration_since(Instant::now());
                        let (next, _) = core
                            .changed
                            .wait_timeout(state, duration)
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        state = next;
                        continue;
                    }
                    retry_at = None;
                }
                if !state.queue.is_empty() {
                    break WorkerAction::Batch(take_batch(&mut state));
                }
                if needs_open && !state.close_requested {
                    break WorkerAction::Open;
                }
                if state.in_flight_records == 0 && state.close_requested {
                    break WorkerAction::Close;
                }
                if state.in_flight_records == 0 && state.flush_requested > state.flush_completed {
                    break WorkerAction::Flush(state.flush_requested);
                }
                state = core
                    .changed
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };

        match action {
            WorkerAction::Open => match writer.open() {
                Ok(result) => {
                    core.note_opened(&writer, result);
                    retry_at = None;
                }
                Err(error) => {
                    retry_at = Some(Instant::now() + retry_delay(&core));
                    report_failure(&core, &error);
                }
            },
            WorkerAction::Batch(batch) => {
                if !writer.is_open() {
                    match writer.open() {
                        Ok(result) => core.note_opened(&writer, result),
                        Err(error) => {
                            requeue_after_failure(&core, &batch, 0);
                            retry_at = Some(Instant::now() + retry_delay(&core));
                            report_failure(&core, &error);
                            continue;
                        }
                    }
                }
                let lines: Vec<Vec<u8>> = batch.iter().map(|record| record.line.clone()).collect();
                match writer.append(&lines) {
                    Ok(result) => {
                        complete_batch(&core, &writer, result);
                        retry_at = None;
                    }
                    Err(error) => {
                        apply_partial_result(&core, &writer, &error);
                        requeue_after_failure(&core, &batch, error.completed_records);
                        retry_at = Some(Instant::now() + retry_delay(&core));
                        report_failure(&core, &error);
                    }
                }
            }
            WorkerAction::Flush(request) => {
                let success = if !writer.is_open() {
                    match writer.open() {
                        Ok(result) => {
                            core.note_opened(&writer, result);
                            writer.flush()
                        }
                        Err(error) => {
                            report_failure(&core, &error);
                            Err(error)
                        }
                    }
                } else {
                    writer.flush()
                };
                if let Err(error) = success {
                    report_failure(&core, &error);
                }
                let mut state = lock_recover(&core.state);
                state.flush_completed = state.flush_completed.max(request);
                core.changed.notify_all();
            }
            WorkerAction::Close => {
                if let Err(error) = writer.flush() {
                    report_failure(&core, &error);
                }
                if let Err(error) = writer.close() {
                    report_failure(&core, &error);
                }
                let mut state = lock_recover(&core.state);
                state.writer_state = WriterState::Closed;
                state.closed = true;
                state.flush_completed = state.flush_requested;
                core.changed.notify_all();
                break;
            }
        }
    }
}

fn take_batch(state: &mut State) -> Vec<QueuedRecord> {
    let mut batch = Vec::new();
    let mut bytes = 0_usize;
    while batch.len() < BATCH_RECORDS {
        let Some(next) = state.queue.front() else {
            break;
        };
        if !batch.is_empty() && bytes.saturating_add(next.line.len()) > BATCH_BYTES {
            break;
        }
        let record = state.queue.pop_front().expect("front exists");
        state.queue_bytes = state.queue_bytes.saturating_sub(record.line.len());
        bytes = bytes.saturating_add(record.line.len());
        batch.push(record);
    }
    state.in_flight_records = batch.len();
    state.in_flight_bytes = bytes;
    batch
}

fn complete_batch(core: &Core, writer: &SegmentWriter, result: WriterResult) {
    let mut state = lock_recover(&core.state);
    state.in_flight_records = 0;
    state.in_flight_bytes = 0;
    apply_writer_result(&mut state, writer, result);
    state.writer_state = WriterState::Healthy;
    state.last_failure = None;
    state.retry_attempt = 0;
    if state.below_emergency_low_watermark() {
        state.emergency_emitted = false;
    }
    core.changed.notify_all();
}

fn apply_partial_result(core: &Core, writer: &SegmentWriter, error: &WriterError) {
    let mut state = lock_recover(&core.state);
    apply_writer_result(
        &mut state,
        writer,
        WriterResult {
            records: error.completed_records,
            bytes: error.completed_bytes,
            rotations: error.rotations,
            cleanup_deletions: error.cleanup_deletions,
        },
    );
}

fn requeue_after_failure(core: &Core, batch: &[QueuedRecord], completed: usize) {
    let mut state = lock_recover(&core.state);
    state.in_flight_records = 0;
    state.in_flight_bytes = 0;
    for record in batch.iter().skip(completed).rev() {
        state.queue_bytes = state.queue_bytes.saturating_add(record.line.len());
        state.queue.push_front(record.clone());
    }
    core.changed.notify_all();
}

fn apply_writer_result(state: &mut State, writer: &SegmentWriter, result: WriterResult) {
    state.counters.bytes_written = state.counters.bytes_written.saturating_add(result.bytes);
    state.counters.rotations = state.counters.rotations.saturating_add(result.rotations);
    state.counters.cleanup_deletions = state
        .counters
        .cleanup_deletions
        .saturating_add(result.cleanup_deletions);
    state.active_segment_bytes = writer.bytes();
    if result.records > 0 {
        state.last_write_at = Some(epoch_millis());
    }
}

fn report_failure(core: &Core, error: &WriterError) {
    if core.note_failure(error) {
        core.emit_emergency(&format!(
            "VibeField field-native logging {:?} failed ({})",
            error.operation,
            error.kind.as_str()
        ));
    }
}

fn retry_delay(core: &Core) -> Duration {
    let mut state = lock_recover(&core.state);
    let exponent = state.retry_attempt.min(7);
    state.retry_attempt = state.retry_attempt.saturating_add(1).min(16);
    Duration::from_millis((250_u64.saturating_mul(1_u64 << exponent)).min(30_000))
}

fn drop_queued(state: &mut State) {
    while let Some(record) = state.queue.pop_front() {
        state.note_drop(record.level);
    }
    state.queue_bytes = 0;
    state.in_flight_records = 0;
    state.in_flight_bytes = 0;
}

fn health_value(state: &State, boot_id: &str, instance_id: &str) -> Value {
    let last_failure = state.last_failure.as_ref().map(|failure| {
        json!({
            "kind": failure.kind.as_str(),
            "time": safe_integer(failure.time),
            "message": failure.message
        })
    });
    let mut health = json!({
        "v": 1,
        "stream": "system/field-native",
        "service": "field-native",
        "bootId": boot_id,
        "instanceId": instance_id,
        "writerState": state.writer_state.as_str(),
        "currentLevel": state.current_level,
        "activeLeaseCount": state.active_lease_count,
        "activeSegmentBytes": safe_integer(state.active_segment_bytes),
        "queue": {
            "records": safe_integer(state.total_queue_records() as u64),
            "bytes": safe_integer(state.total_queue_bytes() as u64),
            "highWaterRecords": safe_integer(state.queue_high_water_records as u64),
            "highWaterBytes": safe_integer(state.queue_high_water_bytes as u64),
            "capacityRecords": QUEUE_RECORDS,
            "capacityBytes": QUEUE_BYTES
        },
        "ring": {
            "records": safe_integer(state.ring.len() as u64),
            "bytes": safe_integer(state.ring_bytes as u64),
            "highWaterRecords": safe_integer(state.ring_high_water_records as u64),
            "highWaterBytes": safe_integer(state.ring_high_water_bytes as u64),
            "capacityRecords": RING_RECORDS,
            "capacityBytes": RING_BYTES
        },
        "counters": {
            "accepted": safe_integer(state.counters.accepted),
            "rejected": safe_integer(state.counters.rejected),
            "truncated": safe_integer(state.counters.truncated),
            "droppedTrace": safe_integer(state.counters.dropped_trace),
            "droppedDebug": safe_integer(state.counters.dropped_debug),
            "droppedInfo": safe_integer(state.counters.dropped_info),
            "droppedWarn": safe_integer(state.counters.dropped_warn),
            "droppedError": safe_integer(state.counters.dropped_error),
            "bytesWritten": safe_integer(state.counters.bytes_written),
            "rotations": safe_integer(state.counters.rotations),
            "cleanupDeletions": safe_integer(state.counters.cleanup_deletions),
            "emergencyFallbacks": safe_integer(state.counters.emergency_fallbacks)
        }
    });
    if let Some(last_write_at) = state.last_write_at {
        health["lastWriteAt"] = safe_integer(last_write_at).into();
    }
    if let Some(last_failure) = last_failure {
        health["lastFailure"] = last_failure;
    }
    health
}

fn snapshot_records(ring: &VecDeque<RingRecord>, query: &NativeLogQuery) -> Vec<Value> {
    if !query.source_selected || query.plugin_selected {
        return Vec::new();
    }
    let mut records: Vec<Value> = ring
        .iter()
        .rev()
        .filter(|entry| record_matches(entry, query))
        .take(query.limit)
        .map(|entry| entry.value.clone())
        .collect();
    records.reverse();
    records
}

fn delta_records(
    ring: &VecDeque<RingRecord>,
    query: &NativeLogQuery,
    after_cursor: u64,
    newest: u64,
) -> (Vec<Value>, u64) {
    if !query.source_selected || query.plugin_selected {
        return (Vec::new(), newest);
    }
    let mut records = Vec::new();
    let mut scanned_cursor = after_cursor;
    for entry in ring.iter().filter(|entry| entry.cursor > after_cursor) {
        scanned_cursor = entry.cursor;
        if record_matches(entry, query) {
            records.push(entry.value.clone());
            if records.len() == query.limit {
                break;
            }
        }
    }
    if records.len() < query.limit {
        scanned_cursor = newest;
    }
    (records, scanned_cursor)
}

fn record_matches(entry: &RingRecord, query: &NativeLogQuery) -> bool {
    query.since_time.is_none_or(|minimum| {
        entry
            .value
            .get("time")
            .and_then(Value::as_u64)
            .is_some_and(|time| time >= minimum)
    }) && entry
        .value
        .get("level")
        .and_then(Value::as_u64)
        .is_some_and(|level| level >= query.min_level)
        && query.components.as_ref().is_none_or(|components| {
            entry
                .value
                .get("component")
                .and_then(Value::as_str)
                .is_some_and(|component| components.contains(component))
        })
        && query.text.as_ref().is_none_or(|needle| {
            let event = entry
                .value
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let message = entry
                .value
                .get("msg")
                .and_then(Value::as_str)
                .unwrap_or_default();
            event.to_lowercase().contains(needle) || message.to_lowercase().contains(needle)
        })
}

fn optional_safe_integer(
    value: Option<&Value>,
    name: &str,
) -> std::result::Result<Option<u64>, String> {
    match value {
        None => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .map(Some)
            .ok_or_else(|| format!("{name} must be a non-negative safe integer")),
    }
}

fn safe_integer(value: u64) -> u64 {
    value.min(MAX_SAFE_INTEGER)
}

fn parse_native_diagnostic_lease(
    raw: &Value,
) -> std::result::Result<(String, String, u64), String> {
    if serde_json::to_vec(raw).map_or(true, |bytes| bytes.len() > 16 * 1024) {
        return Err("native diagnostic lease exceeds its byte limit".into());
    }
    let object = raw
        .as_object()
        .ok_or_else(|| "expected a diagnostic lease object".to_owned())?;
    if object.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("native diagnostic lease version must be 1".into());
    }
    let lease_id = object
        .get("leaseId")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 256
                && !value.chars().any(|character| character.is_control())
        })
        .ok_or_else(|| "native diagnostic lease id is invalid".to_owned())?
        .to_owned();
    let selector = object
        .get("selector")
        .and_then(Value::as_object)
        .ok_or_else(|| "native diagnostic lease selector is invalid".to_owned())?;
    if selector.get("kind").and_then(Value::as_str) != Some("service")
        || selector.get("service").and_then(Value::as_str) != Some("field-native")
    {
        return Err("field-native supports only its service-wide diagnostic lease".into());
    }
    let level = object
        .get("level")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "trace" | "debug" | "info" | "warn" | "error"))
        .ok_or_else(|| "native diagnostic lease level is invalid".to_owned())?
        .to_owned();
    let created_at = object
        .get("createdAt")
        .and_then(Value::as_u64)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or_else(|| "native diagnostic lease createdAt is invalid".to_owned())?;
    let expires_at = object
        .get("expiresAt")
        .and_then(Value::as_u64)
        .filter(|value| *value <= MAX_SAFE_INTEGER && *value > created_at)
        .ok_or_else(|| "native diagnostic lease expiresAt is invalid".to_owned())?;
    if expires_at <= epoch_millis() {
        return Err("native diagnostic lease is already expired".into());
    }
    if !object
        .get("createdBy")
        .is_some_and(|value| value.is_object())
    {
        return Err("native diagnostic lease principal is invalid".into());
    }
    Ok((lease_id, level, expires_at))
}

fn prune_native_leases(leases: &mut HashMap<String, NativeDiagnosticLease>, now: u64) {
    leases.retain(|_, lease| lease.expires_at > now);
}

fn parse_level(level: &str) -> Result<LevelFilter> {
    match level.to_ascii_lowercase().as_str() {
        "trace" => Ok(LevelFilter::TRACE),
        "debug" => Ok(LevelFilter::DEBUG),
        "info" => Ok(LevelFilter::INFO),
        "warn" => Ok(LevelFilter::WARN),
        "error" | "fatal" => Ok(LevelFilter::ERROR),
        _ => Err(anyhow!("invalid field-native log level: {level}")),
    }
}

fn level_number(level: &str) -> Option<u64> {
    match level {
        "trace" => Some(10),
        "debug" => Some(20),
        "info" => Some(30),
        "warn" => Some(40),
        "error" => Some(50),
        "fatal" => Some(60),
        _ => None,
    }
}

fn most_verbose_level(filter: &str) -> String {
    ["trace", "debug", "info", "warn", "error"]
        .into_iter()
        .find(|level| {
            filter.split(',').any(|directive| {
                directive
                    .rsplit_once('=')
                    .map_or(directive, |(_, value)| value)
                    .trim()
                    .eq_ignore_ascii_case(level)
            })
        })
        .unwrap_or("info")
        .to_owned()
}

pub fn new_boot_id() -> String {
    let mut bytes = [0_u8; 16];
    rand::fill(&mut bytes);
    format!("field-native-{}", hex::encode(bytes))
}

pub fn install_panic_hook(logging: NativeLogging) {
    std::panic::set_hook(Box::new(move |panic_info| {
        let panic_type = if panic_info.payload().is::<&str>() {
            "&str"
        } else if panic_info.payload().is::<String>() {
            "String"
        } else {
            "unknown"
        };
        let (file, line) = panic_info.location().map_or(("<unknown>", 0), |location| {
            (
                std::path::Path::new(location.file())
                    .file_name()
                    .and_then(std::ffi::OsStr::to_str)
                    .unwrap_or("<unknown>"),
                location.line(),
            )
        });
        tracing::error!(
            event = "field_native.lifecycle.panic",
            component = "lifecycle",
            panic_type,
            file,
            line,
            "field-native panicked"
        );
        let _ = logging.flush(Duration::from_millis(500));
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        DiagnosticLogDeltaV1, DiagnosticLogSnapshotV1, LogRecordV1, LoggingHealthV1,
    };
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;

    fn test_logging(
        root: &tempfile::TempDir,
        hooks: WriterHooks,
        emergency: Emergency,
    ) -> Result<(NativeLogging, impl Subscriber + Send + Sync + 'static)> {
        build_logging(
            &root.path().join("logs"),
            &root.path().join("data"),
            "field-native-test",
            None,
            RetentionPolicy::default(),
            hooks,
            emergency,
        )
    }

    /// The writer classifies by `ErrorKind`, so the injected fault is a kind and
    /// not a platform errno. `segment.rs::classifies_real_os_error_codes` pins
    /// the OS codes that decode to this one.
    fn storage_full() -> std::io::Error {
        std::io::Error::from(std::io::ErrorKind::StorageFull)
    }

    fn eventually(predicate: impl Fn() -> bool, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while !predicate() {
            assert!(Instant::now() < deadline, "condition did not become true");
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn tracing_layer_writes_contract_records_and_ring_snapshots() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                event = "field_native.test.ready",
                component = "test",
                token = "must-not-land",
                port = 9412_u64,
                "native ready"
            );
        });
        assert!(logging.flush(Duration::from_secs(2)));

        let raw = fs::read_to_string(logging.active_path()).unwrap();
        let value: Value = serde_json::from_str(raw.trim()).unwrap();
        let _: LogRecordV1 = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(value["event"], "field_native.test.ready");
        assert_eq!(value["attrs"]["token"], "<redacted>");
        assert!(!raw.contains("must-not-land"));

        let query =
            NativeLogging::parse_query(&json!({"sources":["system/field-native"],"limit":1000}))
                .unwrap();
        let snapshot = logging.snapshot(&query);
        let _: DiagnosticLogSnapshotV1 = serde_json::from_value(snapshot.clone()).unwrap();
        assert_eq!(snapshot["records"].as_array().unwrap().len(), 1);
        let cursor = NativeLogging::cursor_from(snapshot["nextCursor"].as_str().unwrap()).unwrap();
        let delta = logging.delta(&query, cursor);
        let _: DiagnosticLogDeltaV1 = serde_json::from_value(delta).unwrap();
        let _: LoggingHealthV1 = serde_json::from_value(logging.health()).unwrap();
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn trusted_truffle_events_receive_stable_host_identity() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        tracing::subscriber::with_default(subscriber, || {
            tracing::warn!(
                target: "truffle_core::network::tailscale::sidecar",
                token = "must-not-land",
                "sidecar protocol warning"
            );
        });
        assert!(logging.flush(Duration::from_secs(2)));

        let raw = fs::read_to_string(logging.active_path()).unwrap();
        let value: Value = serde_json::from_str(raw.trim()).unwrap();
        let _: LogRecordV1 = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(value["event"], "field_native.sidecar.runtime_log");
        assert_eq!(value["component"], "sidecar");
        assert_eq!(
            value["attrs"]["dependency_target"],
            "truffle_core::network::tailscale::sidecar"
        );
        assert_eq!(value["attrs"]["token"], "<redacted>");
        assert!(!raw.contains("must-not-land"));
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn poisoned_state_and_panicking_emergency_sink_do_not_escape_logging() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) = test_logging(
            &root,
            WriterHooks::default(),
            Arc::new(|_| panic!("test emergency sink panic")),
        )
        .unwrap();
        let core = logging.core.clone();
        let poisoned = thread::spawn(move || {
            let _state = core.state.lock().unwrap();
            panic!("poison logging state for recovery test");
        })
        .join();
        assert!(poisoned.is_err());
        logging
            .core
            .emit_emergency("exercise guarded emergency sink");

        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                event = "field_native.test.poison_recovered",
                component = "test",
                "logging recovered from mutex poison"
            );
        });
        assert!(logging.flush(Duration::from_secs(2)));
        assert_eq!(logging.health()["writerState"], "healthy");
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn record_bounds_redaction_and_host_identity_survive_hostile_fields() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let huge = "🧊".repeat(30_000);
        let route_secret = "abcdefghijklmnopqrstuvwxyzabcdef";
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                event = "field_native.test.bounded",
                component = "test",
                service = "forged-renderer",
                boot_id = "forged-boot",
                authorization = "Bearer raw-secret",
                detail = %format!("route {route_secret} {huge}"),
                "{}", huge
            );
            let invalid_event = "dynamic-event";
            tracing::info!(
                event = invalid_event,
                component = "test",
                "must be rejected"
            );
        });
        assert!(logging.flush(Duration::from_secs(2)));
        let raw = fs::read_to_string(logging.active_path()).unwrap();
        let line = raw.lines().next().unwrap();
        assert!(line.len() <= record::MAX_RECORD_BYTES);
        let value: Value = serde_json::from_str(line).unwrap();
        let _: LogRecordV1 = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(value["service"], "field-native");
        assert_eq!(value["bootId"], "field-native-test");
        assert!(value["attrs"].get("service").is_none());
        assert!(value["attrs"].get("boot_id").is_none());
        assert_eq!(value["attrs"]["authorization"], "<redacted>");
        assert!(value["attrs"]["detail"]
            .as_str()
            .unwrap()
            .contains("<redacted>"));
        assert!(value["truncation"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason == "message-bytes"));
        assert!(!raw.contains(route_secret));
        assert!(!raw.contains("raw-secret"));
        assert_eq!(logging.health()["counters"]["rejected"], 1);
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn writer_failure_retries_once_without_recursive_emergency_volume() {
        let root = tempfile::tempdir().unwrap();
        let failing = Arc::new(AtomicBool::new(false));
        let emergencies = Arc::new(Mutex::new(Vec::new()));
        let (logging, subscriber) = test_logging(
            &root,
            WriterHooks {
                before_write: Some({
                    let failing = failing.clone();
                    Arc::new(move |_| {
                        if failing.load(Ordering::Relaxed) {
                            Err(storage_full())
                        } else {
                            Ok(())
                        }
                    })
                }),
                ..WriterHooks::default()
            },
            {
                let emergencies = emergencies.clone();
                Arc::new(move |message| {
                    emergencies.lock().unwrap().push(message.to_owned());
                })
            },
        )
        .unwrap();
        failing.store(true, Ordering::Relaxed);
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(
                event = "field_native.test.write_failed",
                component = "test",
                "important"
            );
        });
        std::thread::sleep(Duration::from_millis(700));
        assert_eq!(emergencies.lock().unwrap().len(), 1);
        assert_eq!(logging.health()["lastFailure"]["kind"], "enospc");
        failing.store(false, Ordering::Relaxed);
        assert!(logging.flush(Duration::from_secs(3)));
        assert_eq!(logging.health()["writerState"], "healthy");
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn concurrent_callers_are_serialized_without_corrupting_ndjson() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let dispatch = tracing::Dispatch::new(subscriber);
        let threads: Vec<_> = (0..8)
            .map(|worker| {
                let dispatch = dispatch.clone();
                thread::spawn(move || {
                    tracing::dispatcher::with_default(&dispatch, || {
                        for index in 0..250 {
                            tracing::info!(
                                event = "field_native.test.concurrent",
                                component = "test",
                                worker,
                                index,
                                "concurrent record"
                            );
                        }
                    });
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert!(logging.flush(Duration::from_secs(3)));
        let raw = fs::read_to_string(logging.active_path()).unwrap();
        let records: Vec<LogRecordV1> = raw
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(records.len(), 2_000);
        assert!(
            records.windows(2).all(|pair| pair[0].seq.0 < pair[1].seq.0),
            "file order must preserve the producer's sequence order"
        );
        assert_eq!(logging.health()["counters"]["accepted"], 2_000);
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn queue_and_ring_stay_bounded_and_reserve_high_severity_capacity() {
        let root = tempfile::tempdir().unwrap();
        let failing = Arc::new(AtomicBool::new(false));
        let (logging, subscriber) = test_logging(
            &root,
            WriterHooks {
                before_write: Some({
                    let failing = failing.clone();
                    Arc::new(move |_| {
                        if failing.load(Ordering::Relaxed) {
                            Err(storage_full())
                        } else {
                            Ok(())
                        }
                    })
                }),
                ..WriterHooks::default()
            },
            Arc::new(|_| {}),
        )
        .unwrap();
        failing.store(true, Ordering::Relaxed);
        tracing::subscriber::with_default(subscriber, || {
            for index in 0..9_000 {
                tracing::info!(
                    event = "field_native.test.pressure",
                    component = "test",
                    index,
                    "low-priority pressure"
                );
            }
            for index in 0..256 {
                tracing::error!(
                    event = "field_native.test.pressure",
                    component = "test",
                    index,
                    "high-priority pressure"
                );
            }
        });
        eventually(
            || logging.health()["lastFailure"]["kind"] == "enospc",
            Duration::from_secs(2),
        );
        let health = logging.health();
        assert!(health["queue"]["records"].as_u64().unwrap() <= QUEUE_RECORDS as u64);
        assert!(health["queue"]["bytes"].as_u64().unwrap() <= QUEUE_BYTES as u64);
        assert!(health["ring"]["records"].as_u64().unwrap() <= RING_RECORDS as u64);
        assert!(health["ring"]["bytes"].as_u64().unwrap() <= RING_BYTES as u64);
        assert!(health["counters"]["droppedInfo"].as_u64().unwrap() > 0);
        assert_eq!(health["ring"]["records"], RING_RECORDS);

        failing.store(false, Ordering::Relaxed);
        assert!(logging.flush(Duration::from_secs(4)));
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn reloadable_filter_and_fatal_close_keep_the_contract_honest() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let dispatch = tracing::Dispatch::new(subscriber);
        tracing::dispatcher::with_default(&dispatch, || {
            tracing::debug!(
                event = "field_native.test.disabled",
                component = "test",
                "not accepted"
            );
        });
        logging.set_level("debug").unwrap();
        tracing::dispatcher::with_default(&dispatch, || {
            tracing::debug!(
                event = "field_native.test.enabled",
                component = "test",
                "accepted after reload"
            );
            tracing::error!(
                event = "field_native.test.fatal",
                component = "test",
                fatal = true,
                error = "fatal cause",
                "process cannot continue"
            );
        });
        let started = Instant::now();
        assert!(logging.close(Duration::from_secs(2)));
        assert!(started.elapsed() < Duration::from_millis(2_500));

        let raw = fs::read_to_string(logging.active_path()).unwrap();
        assert!(!raw.contains("field_native.test.disabled"));
        assert!(raw.contains("field_native.test.enabled"));
        let fatal: Value = raw
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .find(|record: &Value| record["event"] == "field_native.test.fatal")
            .unwrap();
        assert_eq!(fatal["level"], 60);
        assert_eq!(fatal["severity"], "FATAL");
        assert_eq!(fatal["err"]["message"], "fatal cause");
    }

    #[test]
    fn native_diagnostic_leases_widen_and_restore_the_producer_filter() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let lease = |id: &str, expires_at: u64| {
            json!({
                "v": 1,
                "leaseId": id,
                "selector": {"kind":"service","service":"field-native"},
                "level": "debug",
                "createdAt": epoch_millis(),
                "expiresAt": expires_at,
                "createdBy": {"kind":"shell-main","id":"fieldd-test"}
            })
        };

        tracing::subscriber::with_default(subscriber, || {
            tracing::debug!(
                event = "field_native.test.before_lease",
                component = "test",
                "not admitted"
            );
            let active = lease("lease-native-active", epoch_millis() + 60_000);
            logging.create_diagnostic_lease(&active).unwrap();
            assert_eq!(logging.health()["currentLevel"], "debug");
            assert_eq!(logging.health()["activeLeaseCount"], 1);
            tracing::debug!(
                event = "field_native.test.during_lease",
                component = "test",
                "admitted"
            );
            assert!(logging
                .revoke_diagnostic_lease("lease-native-active")
                .unwrap());
            assert_eq!(logging.health()["currentLevel"], "info");
            tracing::debug!(
                event = "field_native.test.after_revoke",
                component = "test",
                "not admitted"
            );

            let expiring = lease("lease-native-expiring", epoch_millis() + 20);
            logging.create_diagnostic_lease(&expiring).unwrap();
            std::thread::sleep(Duration::from_millis(30));
            assert_eq!(logging.health()["activeLeaseCount"], 0);
            assert_eq!(logging.health()["currentLevel"], "info");
            tracing::debug!(
                event = "field_native.test.after_expiry",
                component = "test",
                "not admitted"
            );
        });

        let query =
            NativeLogging::parse_query(&json!({"sources":["system/field-native"],"limit":1000}))
                .unwrap();
        let snapshot = logging.snapshot(&query);
        let events = snapshot["records"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|record| record["event"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(events, vec!["field_native.test.during_lease"]);
        assert!(logging.close(Duration::from_secs(2)));
    }

    #[test]
    fn ring_reports_cursor_loss_and_query_filters_without_reading_files() {
        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        tracing::subscriber::with_default(subscriber, || {
            for index in 0..2_105 {
                tracing::info!(
                    event = "field_native.test.ring",
                    component = "ring",
                    index,
                    "ring record"
                );
            }
        });
        let query = NativeLogging::parse_query(&json!({
            "sources":["system/field-native"],
            "components":["ring"],
            "text":"ring record",
            "limit":1000
        }))
        .unwrap();
        let snapshot = logging.snapshot(&query);
        assert_eq!(snapshot["droppedBefore"], 105);
        assert_eq!(snapshot["records"].as_array().unwrap().len(), 1_000);
        assert_eq!(snapshot["records"][0]["attrs"]["index"], 1_105);
        assert_eq!(snapshot["records"][999]["attrs"]["index"], 2_104);

        let first_delta = logging.delta(&query, 0);
        assert_eq!(first_delta["droppedSincePrevious"], 105);
        assert_eq!(first_delta["records"].as_array().unwrap().len(), 1_000);
        assert_eq!(first_delta["records"][0]["attrs"]["index"], 105);
        assert_eq!(first_delta["records"][999]["attrs"]["index"], 1_104);
        let first_cursor =
            NativeLogging::cursor_from(first_delta["cursor"].as_str().unwrap()).unwrap();
        assert_eq!(first_cursor, 1_105);

        let second_delta = logging.delta(&query, first_cursor);
        assert_eq!(second_delta["droppedSincePrevious"], 0);
        assert_eq!(second_delta["records"].as_array().unwrap().len(), 1_000);
        assert_eq!(second_delta["records"][0]["attrs"]["index"], 1_105);
        assert_eq!(second_delta["records"][999]["attrs"]["index"], 2_104);
        assert_eq!(
            NativeLogging::cursor_from(second_delta["cursor"].as_str().unwrap()),
            Some(2_105)
        );
        let _: DiagnosticLogSnapshotV1 = serde_json::from_value(snapshot).unwrap();
        let _: DiagnosticLogDeltaV1 = serde_json::from_value(first_delta).unwrap();
        let _: DiagnosticLogDeltaV1 = serde_json::from_value(second_delta).unwrap();
        assert!(logging.close(Duration::from_secs(3)));
    }

    #[test]
    fn second_runtime_reports_writer_conflict_without_touching_the_owner() {
        let root = tempfile::tempdir().unwrap();
        let (first, _first_subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let emergencies = Arc::new(Mutex::new(Vec::new()));
        let (second, _second_subscriber) = test_logging(&root, WriterHooks::default(), {
            let emergencies = emergencies.clone();
            Arc::new(move |message| emergencies.lock().unwrap().push(message.to_owned()))
        })
        .unwrap();
        assert_eq!(second.health()["writerState"], "writer-conflict");
        assert_eq!(second.health()["lastFailure"]["kind"], "writer-conflict");
        assert_eq!(emergencies.lock().unwrap().len(), 1);
        assert!(second.close(Duration::from_secs(2)));
        assert!(first.close(Duration::from_secs(2)));
    }

    #[test]
    #[ignore = "versioned LOG-L2 reference benchmark; run through pnpm bench:logging-native"]
    fn logging_reference_benchmark() {
        const ITERATIONS: usize = 50_000;
        const BATCH: usize = 5_000;

        fn percentile(samples: &mut [u128], numerator: usize, denominator: usize) -> f64 {
            samples.sort_unstable();
            let index = (samples.len() * numerator).div_ceil(denominator) - 1;
            samples[index] as f64 / 1_000.0
        }

        let root = tempfile::tempdir().unwrap();
        let (logging, subscriber) =
            test_logging(&root, WriterHooks::default(), Arc::new(|_| {})).unwrap();
        let dispatch = tracing::Dispatch::new(subscriber);

        let mut disabled = Vec::with_capacity(ITERATIONS);
        tracing::dispatcher::with_default(&dispatch, || {
            for index in 0..ITERATIONS {
                let started = Instant::now();
                tracing::debug!(
                    event = "field_native.bench.disabled",
                    component = "benchmark",
                    index,
                    "disabled"
                );
                disabled.push(started.elapsed().as_nanos());
            }
        });

        let mut accepted = Vec::with_capacity(ITERATIONS);
        for batch in 0..(ITERATIONS / BATCH) {
            tracing::dispatcher::with_default(&dispatch, || {
                for index in 0..BATCH {
                    let started = Instant::now();
                    tracing::info!(
                        event = "field_native.bench.accepted",
                        component = "benchmark",
                        batch,
                        index,
                        "accepted"
                    );
                    accepted.push(started.elapsed().as_nanos());
                }
            });
            assert!(logging.flush(Duration::from_secs(3)));
        }
        let health = logging.health();
        let disabled_p95 = percentile(&mut disabled, 95, 100);
        let disabled_p99 = percentile(&mut disabled, 99, 100);
        let accepted_p95 = percentile(&mut accepted, 95, 100);
        let accepted_p99 = percentile(&mut accepted, 99, 100);
        println!(
            "{{\"harness\":\"vibefield.logging.native\",\"version\":1,\
             \"iterations\":{ITERATIONS},\"disabledP95Us\":{disabled_p95:.3},\
             \"disabledP99Us\":{disabled_p99:.3},\"acceptedP95Us\":{accepted_p95:.3},\
             \"acceptedP99Us\":{accepted_p99:.3},\"accepted\":{},\"dropped\":{},\
             \"queueHighWaterRecords\":{}}}",
            health["counters"]["accepted"],
            health["counters"]["droppedInfo"],
            health["queue"]["highWaterRecords"]
        );
        assert!(logging.close(Duration::from_secs(3)));
    }
}
