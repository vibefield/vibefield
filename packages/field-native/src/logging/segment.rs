use serde::Deserialize;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

#[derive(Clone, Debug)]
pub struct RetentionPolicy {
    pub max_segment_bytes: u64,
    pub max_closed_segments: usize,
    pub max_age_ms: u64,
    pub category_cap_bytes: u64,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_segment_bytes: 10 * 1024 * 1024,
            max_closed_segments: 6,
            max_age_ms: 7 * 24 * 60 * 60 * 1_000,
            category_cap_bytes: 250 * 1024 * 1024,
        }
    }
}

type PathHook = Arc<dyn Fn(&Path) -> std::io::Result<()> + Send + Sync>;
type RenameHook = Arc<dyn Fn(&Path, &Path) -> std::io::Result<()> + Send + Sync>;

#[derive(Clone, Default)]
pub struct WriterHooks {
    pub before_open: Option<PathHook>,
    pub before_write: Option<PathHook>,
    pub before_rename: Option<RenameHook>,
    pub before_flush: Option<PathHook>,
    pub before_close: Option<PathHook>,
    pub before_remove: Option<PathHook>,
}

#[derive(Clone)]
pub struct SegmentWriterOptions {
    pub log_root: PathBuf,
    pub boot_id: String,
    pub retention: RetentionPolicy,
    pub now: Arc<dyn Fn() -> u64 + Send + Sync>,
    pub hooks: WriterHooks,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriterOperation {
    Open,
    Write,
    Rename,
    Flush,
    Close,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureKind {
    Enospc,
    Eacces,
    ReadOnly,
    Rename,
    Write,
    Flush,
    Close,
    WriterConflict,
    Unknown,
}

impl FailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Enospc => "enospc",
            Self::Eacces => "eacces",
            Self::ReadOnly => "read-only",
            Self::Rename => "rename",
            Self::Write => "write",
            Self::Flush => "flush",
            Self::Close => "close",
            Self::WriterConflict => "writer-conflict",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug)]
pub struct WriterError {
    pub operation: WriterOperation,
    pub kind: FailureKind,
    pub message: String,
    pub completed_records: usize,
    pub completed_bytes: u64,
    pub rotations: u64,
    pub cleanup_deletions: u64,
}

impl std::fmt::Display for WriterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "field-native log writer {:?} failed: {}",
            self.operation, self.message
        )
    }
}

impl std::error::Error for WriterError {}

#[derive(Clone, Copy, Debug, Default)]
pub struct WriterResult {
    pub records: usize,
    pub bytes: u64,
    pub rotations: u64,
    pub cleanup_deletions: u64,
}

pub struct SegmentWriter {
    pub active_path: PathBuf,
    lock_path: PathBuf,
    category_dir: PathBuf,
    options: SegmentWriterOptions,
    active: Option<File>,
    lock: Option<File>,
    active_bytes: u64,
    active_day: String,
    rotation_sequence: u64,
}

impl SegmentWriter {
    pub fn new(options: SegmentWriterOptions) -> Result<Self, WriterError> {
        if !options.log_root.is_absolute() {
            return Err(writer_error(
                WriterOperation::Open,
                FailureKind::Unknown,
                "log root must be absolute",
            ));
        }
        let category_dir = options.log_root.join("system");
        let active_path = category_dir.join("field-native.ndjson");
        let lock_path = category_dir.join("field-native.ndjson.lock");
        Ok(Self {
            active_path,
            lock_path,
            category_dir,
            options,
            active: None,
            lock: None,
            active_bytes: 0,
            active_day: String::new(),
            rotation_sequence: 0,
        })
    }

    pub fn bytes(&self) -> u64 {
        self.active_bytes
    }

    pub fn is_open(&self) -> bool {
        self.active.is_some()
    }

    pub fn open(&mut self) -> Result<WriterResult, WriterError> {
        if self.active.is_some() {
            return Ok(WriterResult::default());
        }
        let result = self.open_inner();
        if result.is_err() {
            self.invalidate_active();
        }
        result
    }

    fn open_inner(&mut self) -> Result<WriterResult, WriterError> {
        create_private_dir(&self.options.log_root)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        assert_safe_directory(&self.options.log_root)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        create_private_dir(&self.category_dir)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        assert_safe_directory(&self.category_dir)
            .map_err(|error| from_io(WriterOperation::Open, error))?;

        if self.lock.is_none() {
            self.acquire_lock()?;
        }
        reject_unsafe_file(&self.active_path)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        call_path_hook(&self.options.hooks.before_open, &self.active_path)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        let mut active = open_private_append(&self.active_path)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        enforce_private_file(&self.active_path)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        let metadata = active
            .metadata()
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        self.active_bytes = metadata.len();
        self.active_day = utc_day(if metadata.len() == 0 {
            (self.options.now)()
        } else {
            modified_millis(&metadata).unwrap_or_else(|| (self.options.now)())
        });
        let partial = self.active_bytes > 0
            && !ends_with_newline(&mut active, self.active_bytes)
                .map_err(|error| from_io(WriterOperation::Open, error))?;
        self.active = Some(active);
        if partial {
            let cleanup_deletions = self.rotate("partial-recovery")?;
            return Ok(WriterResult {
                rotations: 1,
                cleanup_deletions,
                ..WriterResult::default()
            });
        }
        Ok(WriterResult::default())
    }

    pub fn append(&mut self, lines: &[Vec<u8>]) -> Result<WriterResult, WriterError> {
        let opened = self.open()?;
        let mut result = opened;
        for line in lines {
            let now = (self.options.now)();
            let current_day = utc_day(now);
            if self.active_bytes > 0
                && (self.active_day != current_day
                    || self.active_bytes.saturating_add(line.len() as u64)
                        > self.options.retention.max_segment_bytes)
            {
                let reason = if self.active_day != current_day {
                    "utc-day"
                } else {
                    "size"
                };
                match self.rotate(reason) {
                    Ok(deletions) => {
                        result.rotations = result.rotations.saturating_add(1);
                        result.cleanup_deletions =
                            result.cleanup_deletions.saturating_add(deletions);
                    }
                    Err(mut error) => {
                        error.completed_records = result.records;
                        error.completed_bytes = result.bytes;
                        error.rotations = result.rotations;
                        error.cleanup_deletions = result.cleanup_deletions;
                        return Err(error);
                    }
                }
            }

            if let Err(error) = call_path_hook(&self.options.hooks.before_write, &self.active_path)
                .and_then(|()| {
                    self.active
                        .as_mut()
                        .ok_or_else(|| std::io::Error::other("active log is closed"))?
                        .write_all(line)
                })
            {
                self.invalidate_active();
                let mut failure = from_io(WriterOperation::Write, error);
                failure.completed_records = result.records;
                failure.completed_bytes = result.bytes;
                failure.rotations = result.rotations;
                failure.cleanup_deletions = result.cleanup_deletions;
                return Err(failure);
            }
            self.active_bytes = self.active_bytes.saturating_add(line.len() as u64);
            result.records += 1;
            result.bytes = result.bytes.saturating_add(line.len() as u64);
        }
        Ok(result)
    }

    pub fn flush(&mut self) -> Result<(), WriterError> {
        let Some(active) = self.active.as_mut() else {
            return Ok(());
        };
        call_path_hook(&self.options.hooks.before_flush, &self.active_path)
            .and_then(|()| active.sync_all())
            .map_err(|error| from_io(WriterOperation::Flush, error))
    }

    pub fn close(&mut self) -> Result<(), WriterError> {
        let failure = if let Some(active) = self.active.take() {
            active
                .sync_all()
                .and_then(|()| call_path_hook(&self.options.hooks.before_close, &self.active_path))
                .map_err(|error| from_io(WriterOperation::Close, error))
        } else {
            Ok(())
        };
        self.release_lock();
        failure
    }

    fn rotate(&mut self, reason: &str) -> Result<u64, WriterError> {
        let Some(active) = self.active.take() else {
            return Err(writer_error(
                WriterOperation::Rename,
                FailureKind::Rename,
                "cannot rotate a closed active segment",
            ));
        };
        let closed_path = self.next_closed_path(reason)?;
        if let Err(error) = active.sync_all() {
            self.active = Some(active);
            return Err(from_io(WriterOperation::Flush, error));
        }
        drop(active);
        if let Err(error) = call_rename_hook(
            &self.options.hooks.before_rename,
            &self.active_path,
            &closed_path,
        )
        .and_then(|()| fs::rename(&self.active_path, &closed_path))
        {
            self.reopen_after_rotation_failure();
            return Err(from_io(WriterOperation::Rename, error));
        }
        let reopened = call_path_hook(&self.options.hooks.before_open, &self.active_path)
            .and_then(|()| open_private_append(&self.active_path));
        match reopened {
            Ok(active) => self.active = Some(active),
            Err(error) => {
                self.active = None;
                self.active_bytes = 0;
                return Err(from_io(WriterOperation::Open, error));
            }
        }
        enforce_private_file(&self.active_path)
            .map_err(|error| from_io(WriterOperation::Open, error))?;
        self.active_bytes = 0;
        self.active_day = utc_day((self.options.now)());
        self.cleanup()
    }

    fn reopen_after_rotation_failure(&mut self) {
        self.active = open_private_append(&self.active_path).ok();
        if let Some(active) = &self.active {
            self.active_bytes = active.metadata().map_or(0, |metadata| metadata.len());
        }
    }

    fn next_closed_path(&mut self, reason: &str) -> Result<PathBuf, WriterError> {
        for _ in 0..10_000 {
            self.rotation_sequence = self.rotation_sequence.saturating_add(1);
            let name = format!(
                "field-native.{}.{}.{:04}.{}.ndjson",
                closed_stamp((self.options.now)()),
                safe_boot_id(&self.options.boot_id),
                self.rotation_sequence,
                reason
            );
            let path = self.category_dir.join(name);
            match fs::symlink_metadata(&path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(path),
                Ok(_) => {}
                Err(error) => return Err(from_io(WriterOperation::Rename, error)),
            }
        }
        Err(writer_error(
            WriterOperation::Rename,
            FailureKind::Rename,
            "could not allocate a unique closed segment name",
        ))
    }

    fn cleanup(&self) -> Result<u64, WriterError> {
        let now = (self.options.now)();
        let mut total_bytes = 0_u64;
        let mut closed = Vec::new();
        let entries = fs::read_dir(&self.category_dir)
            .map_err(|error| from_io(WriterOperation::Write, error))?;
        for entry in entries {
            let entry = entry.map_err(|error| from_io(WriterOperation::Write, error))?;
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(from_io(WriterOperation::Write, error)),
            };
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".ndjson") {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(from_io(WriterOperation::Write, error)),
            };
            total_bytes = total_bytes.saturating_add(metadata.len());
            if is_closed_segment(&name) {
                closed.push(ClosedSegment {
                    path: entry.path(),
                    name,
                    modified_ms: modified_millis(&metadata).unwrap_or(0),
                    bytes: metadata.len(),
                });
            }
        }
        closed.sort_by(|left, right| {
            left.modified_ms
                .cmp(&right.modified_ms)
                .then_with(|| left.name.cmp(&right.name))
        });

        let mut remove = HashSet::new();
        let own: Vec<_> = closed
            .iter()
            .filter(|segment| segment.name.starts_with("field-native."))
            .collect();
        let excess = own
            .len()
            .saturating_sub(self.options.retention.max_closed_segments);
        for segment in own.into_iter().take(excess) {
            remove.insert(segment.path.clone());
        }
        for segment in &closed {
            if now.saturating_sub(segment.modified_ms) > self.options.retention.max_age_ms {
                remove.insert(segment.path.clone());
            }
        }
        for segment in &closed {
            if remove.contains(&segment.path) {
                total_bytes = total_bytes.saturating_sub(segment.bytes);
            }
        }
        for segment in &closed {
            if total_bytes <= self.options.retention.category_cap_bytes {
                break;
            }
            if remove.insert(segment.path.clone()) {
                total_bytes = total_bytes.saturating_sub(segment.bytes);
            }
        }

        let mut deletions = 0_u64;
        for segment in closed {
            if !remove.contains(&segment.path) {
                continue;
            }
            match call_path_hook(&self.options.hooks.before_remove, &segment.path)
                .and_then(|()| fs::remove_file(&segment.path))
            {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(from_io(WriterOperation::Write, error)),
            }
            deletions = deletions.saturating_add(1);
        }
        Ok(deletions)
    }

    fn acquire_lock(&mut self) -> Result<(), WriterError> {
        for _ in 0..2 {
            match create_private_lock(&self.lock_path) {
                Ok(mut file) => {
                    let identity = serde_json::json!({
                        "pid": std::process::id(),
                        "bootId": safe_boot_id(&self.options.boot_id)
                    });
                    if let Err(error) = writeln!(file, "{identity}").and_then(|()| file.sync_all())
                    {
                        drop(file);
                        let _ = fs::remove_file(&self.lock_path);
                        return Err(from_io(WriterOperation::Open, error));
                    }
                    self.lock = Some(file);
                    return Ok(());
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if !self.lock_is_stale() {
                        return Err(writer_error(
                            WriterOperation::Open,
                            FailureKind::WriterConflict,
                            "system/field-native already has a live writer",
                        ));
                    }
                    fs::remove_file(&self.lock_path)
                        .map_err(|error| from_io(WriterOperation::Open, error))?;
                }
                Err(error) => return Err(from_io(WriterOperation::Open, error)),
            }
        }
        Err(writer_error(
            WriterOperation::Open,
            FailureKind::WriterConflict,
            "could not acquire system/field-native writer lock",
        ))
    }

    fn lock_is_stale(&self) -> bool {
        let Ok(metadata) = fs::symlink_metadata(&self.lock_path) else {
            return true;
        };
        if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
            return false;
        }
        let parsed = fs::read_to_string(&self.lock_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LockIdentity>(&raw).ok());
        if let Some(identity) = parsed {
            return !pid_is_alive(identity.pid);
        }
        let modified = modified_millis(&metadata).unwrap_or_else(epoch_millis);
        epoch_millis().saturating_sub(modified) > 30_000
    }

    fn release_lock(&mut self) {
        if self.lock.take().is_some() {
            let _ = fs::remove_file(&self.lock_path);
        }
    }

    fn invalidate_active(&mut self) {
        self.active.take();
    }
}

impl Drop for SegmentWriter {
    fn drop(&mut self) {
        if let Some(active) = self.active.take() {
            let _ = active.sync_all();
        }
        self.release_lock();
    }
}

#[derive(Deserialize)]
struct LockIdentity {
    pid: u32,
}

struct ClosedSegment {
    path: PathBuf,
    name: String,
    modified_ms: u64,
    bytes: u64,
}

fn writer_error(operation: WriterOperation, kind: FailureKind, message: &str) -> WriterError {
    WriterError {
        operation,
        kind,
        message: message.chars().take(500).collect(),
        completed_records: 0,
        completed_bytes: 0,
        rotations: 0,
        cleanup_deletions: 0,
    }
}

fn from_io(operation: WriterOperation, error: std::io::Error) -> WriterError {
    // One classification on every platform: std already folds the errnos this
    // used to name (ENOSPC, EACCES/EPERM, EROFS) and their win32 twins
    // (ERROR_DISK_FULL, ERROR_ACCESS_DENIED, ERROR_WRITE_PROTECT) into these
    // kinds, so the code table stays in std instead of forking here.
    // `classifies_real_os_error_codes` pins the mapping we rely on.
    let kind = match error.kind() {
        ErrorKind::StorageFull => FailureKind::Enospc,
        ErrorKind::PermissionDenied => FailureKind::Eacces,
        ErrorKind::ReadOnlyFilesystem => FailureKind::ReadOnly,
        _ => match operation {
            WriterOperation::Rename => FailureKind::Rename,
            WriterOperation::Write => FailureKind::Write,
            WriterOperation::Flush => FailureKind::Flush,
            WriterOperation::Close => FailureKind::Close,
            WriterOperation::Open => FailureKind::Unknown,
        },
    };
    writer_error(operation, kind, &error.to_string())
}

fn create_private_dir(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(std::io::Error::other("unsafe log directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
            assert_safe_directory(path)?;
        }
        Err(error) => return Err(error),
    }
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn assert_safe_directory(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(std::io::Error::other("unsafe log directory"));
    }
    Ok(())
}

fn reject_unsafe_file(path: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(std::io::Error::other("unsafe active log path"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn open_private_append(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true).read(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)
}

fn create_private_lock(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)
}

fn enforce_private_file(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    // There are no mode bits off unix: the segment keeps whatever the log
    // directory's ACL granted it and this call enforces nothing. Binding the
    // argument names that instead of letting an unused parameter imply it — the
    // explicit owner-only DACL for the write sites is booked work, not landed.
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn call_path_hook(hook: &Option<PathHook>, path: &Path) -> std::io::Result<()> {
    hook.as_ref().map_or(Ok(()), |callback| callback(path))
}

fn call_rename_hook(hook: &Option<RenameHook>, from: &Path, to: &Path) -> std::io::Result<()> {
    hook.as_ref().map_or(Ok(()), |callback| callback(from, to))
}

fn ends_with_newline(file: &mut File, bytes: u64) -> std::io::Result<bool> {
    if bytes == 0 {
        return Ok(true);
    }
    file.seek(SeekFrom::Start(bytes - 1))?;
    let mut byte = [0_u8; 1];
    file.read_exact(&mut byte)?;
    file.seek(SeekFrom::End(0))?;
    Ok(byte[0] == b'\n')
}

fn safe_boot_id(value: &str) -> String {
    let value: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    if value.is_empty() {
        "unknown".into()
    } else {
        value
    }
}

fn utc_day(millis: u64) -> String {
    let datetime = datetime(millis);
    format!(
        "{:04}-{:02}-{:02}",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day()
    )
}

fn closed_stamp(millis: u64) -> String {
    let datetime = datetime(millis);
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}{:03}Z",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day(),
        datetime.hour(),
        datetime.minute(),
        datetime.second(),
        datetime.millisecond()
    )
}

fn datetime(millis: u64) -> OffsetDateTime {
    let seconds = i64::try_from(millis / 1_000).unwrap_or(i64::MAX);
    let nanos = i128::from(millis % 1_000) * 1_000_000;
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(seconds) * 1_000_000_000 + nanos)
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

fn is_closed_segment(name: &str) -> bool {
    let parts: Vec<_> = name.split('.').collect();
    if parts.len() != 6 || parts[5] != "ndjson" {
        return false;
    }
    let stream = parts[0];
    let stamp = parts[1];
    let boot = parts[2];
    let sequence = parts[3];
    let reason = parts[4];
    !stream.is_empty()
        && stream
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && stamp.len() == 19
        && stamp.ends_with('Z')
        && stamp[..8].bytes().all(|byte| byte.is_ascii_digit())
        && &stamp[8..9] == "T"
        && stamp[9..18].bytes().all(|byte| byte.is_ascii_digit())
        && !boot.is_empty()
        && boot
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && sequence.len() == 4
        && sequence.bytes().all(|byte| byte.is_ascii_digit())
        && matches!(reason, "size" | "utc-day" | "partial-recovery")
}

fn modified_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

fn pid_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) performs permission/existence probing only and
        // does not deliver a signal.
        let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        // SAFETY: a query-only open of a pid, with no handle inheritance. A null
        // return is the documented failure; the handle is closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            // A process we are not allowed to query still exists and still holds
            // the lock — the unix twin reads EPERM exactly this way. Anything
            // else (chiefly ERROR_INVALID_PARAMETER for an unknown pid) is dead.
            return std::io::Error::last_os_error().raw_os_error()
                == Some(ERROR_ACCESS_DENIED as i32);
        }
        let mut exit_code = 0_u32;
        // SAFETY: `process` is live and `exit_code` points at live storage.
        let queried = unsafe { GetExitCodeProcess(process, &mut exit_code) };
        // SAFETY: `process` came from `OpenProcess` and is not used again.
        unsafe { CloseHandle(process) };
        // An unreadable exit code counts as alive. Refusing to reclaim a lock
        // costs this process its log stream (WriterConflict, reported); stealing
        // one from a live writer interleaves two writers into one segment.
        queried == 0 || exit_code == STILL_ACTIVE as u32
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use tempfile::TempDir;

    fn make_writer(
        root: &TempDir,
        now: Arc<AtomicU64>,
        retention: RetentionPolicy,
        hooks: WriterHooks,
    ) -> SegmentWriter {
        SegmentWriter::new(SegmentWriterOptions {
            log_root: root.path().join("logs"),
            boot_id: "native-boot".into(),
            retention,
            now: Arc::new(move || now.load(Ordering::Relaxed)),
            hooks,
        })
        .unwrap()
    }

    fn closed_names(root: &TempDir) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(root.path().join("logs/system"))
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| is_closed_segment(name))
            .collect();
        names.sort();
        names
    }

    fn padded_line(label: &str) -> Vec<u8> {
        format!(
            "{{\"label\":\"{label}\",\"padding\":\"{}\"}}\n",
            "x".repeat(55)
        )
        .into_bytes()
    }

    #[test]
    fn size_day_count_and_partial_recovery_match_the_node_names() {
        let root = tempfile::tempdir().unwrap();
        let now = Arc::new(AtomicU64::new(1_784_764_799_000));
        let mut writer = make_writer(
            &root,
            now.clone(),
            RetentionPolicy {
                max_segment_bytes: 100,
                max_closed_segments: 2,
                ..RetentionPolicy::default()
            },
            WriterHooks::default(),
        );
        writer.open().unwrap();
        for index in 0..6 {
            writer
                .append(&[
                    format!("{{\"index\":{index},\"padding\":\"{}\"}}\n", "x".repeat(55))
                        .into_bytes(),
                ])
                .unwrap();
        }
        now.store(1_784_764_801_000, Ordering::Relaxed);
        writer
            .append(&[b"{\"after\":\"midnight\"}\n".to_vec()])
            .unwrap();
        writer.close().unwrap();

        let directory = root.path().join("logs/system");
        let names: Vec<String> = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".ndjson"))
            .collect();
        assert!(names.contains(&"field-native.ndjson".into()));
        assert_eq!(
            names
                .iter()
                .filter(|name| *name != "field-native.ndjson")
                .count(),
            2
        );
        assert!(names.iter().any(|name| is_closed_segment(name)));

        fs::write(directory.join("field-native.ndjson"), "{\"partial\":").unwrap();
        let mut recovered = make_writer(
            &root,
            now,
            RetentionPolicy::default(),
            WriterHooks::default(),
        );
        let result = recovered.open().unwrap();
        assert_eq!(result.rotations, 1);
        recovered.close().unwrap();
        assert!(fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains(".partial-recovery.ndjson")));
    }

    #[test]
    fn writer_lock_admits_one_owner_and_recovers_a_dead_pid() {
        let root = tempfile::tempdir().unwrap();
        let now = Arc::new(AtomicU64::new(epoch_millis()));
        let mut first = make_writer(
            &root,
            now.clone(),
            RetentionPolicy::default(),
            WriterHooks::default(),
        );
        first.open().unwrap();
        let mut second = make_writer(
            &root,
            now.clone(),
            RetentionPolicy::default(),
            WriterHooks::default(),
        );
        assert_eq!(second.open().unwrap_err().kind, FailureKind::WriterConflict);
        first.close().unwrap();

        let lock = root.path().join("logs/system/field-native.ndjson.lock");
        fs::write(&lock, "{\"pid\":4294967294}\n").unwrap();
        let mut recovered = make_writer(
            &root,
            now,
            RetentionPolicy::default(),
            WriterHooks::default(),
        );
        recovered.open().unwrap();
        recovered.close().unwrap();
    }

    #[test]
    fn age_and_category_cleanup_never_delete_active_files() {
        let root = tempfile::tempdir().unwrap();
        let log_root = root.path().join("logs");
        let system = log_root.join("system");
        fs::create_dir_all(&system).unwrap();
        let desktop_active = system.join("desktop.ndjson");
        let old_closed = system.join("desktop.20200101T000000000Z.desktop-boot.0001.size.ndjson");
        fs::write(&desktop_active, "a".repeat(400)).unwrap();
        fs::write(&old_closed, "b".repeat(400)).unwrap();
        let old_time = std::fs::FileTimes::new().set_modified(
            UNIX_EPOCH
                + std::time::Duration::from_millis(
                    epoch_millis().saturating_sub(8 * 24 * 60 * 60 * 1_000),
                ),
        );
        OpenOptions::new()
            .write(true)
            .open(&old_closed)
            .unwrap()
            .set_times(old_time)
            .unwrap();

        let now = Arc::new(AtomicU64::new(epoch_millis()));
        let mut writer = make_writer(
            &root,
            now,
            RetentionPolicy {
                max_segment_bytes: 100,
                max_closed_segments: 20,
                max_age_ms: 7 * 24 * 60 * 60 * 1_000,
                category_cap_bytes: 600,
            },
            WriterHooks::default(),
        );
        writer.open().unwrap();
        writer.append(&[padded_line("one")]).unwrap();
        let result = writer.append(&[padded_line("two")]).unwrap();
        assert!(result.cleanup_deletions >= 1);
        assert!(!old_closed.exists());
        assert_eq!(fs::read_to_string(&desktop_active).unwrap().len(), 400);
        assert!(writer.active_path.exists());
        writer.close().unwrap();
    }

    #[test]
    fn concurrent_janitor_deletion_is_successful_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let log_root = root.path().join("logs");
        let system = log_root.join("system");
        fs::create_dir_all(&system).unwrap();
        let old_closed = system.join("desktop.20200101T000000000Z.desktop-boot.0001.size.ndjson");
        fs::write(&old_closed, "old").unwrap();
        let old_time =
            std::fs::FileTimes::new().set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1));
        OpenOptions::new()
            .write(true)
            .open(&old_closed)
            .unwrap()
            .set_times(old_time)
            .unwrap();

        let raced = Arc::new(AtomicBool::new(false));
        let target = old_closed.clone();
        let mut writer = make_writer(
            &root,
            Arc::new(AtomicU64::new(epoch_millis())),
            RetentionPolicy {
                max_segment_bytes: 100,
                max_closed_segments: 20,
                max_age_ms: 1_000,
                ..RetentionPolicy::default()
            },
            WriterHooks {
                before_remove: Some({
                    let raced = raced.clone();
                    Arc::new(move |path| {
                        if path == target && !raced.swap(true, Ordering::Relaxed) {
                            fs::remove_file(path)?;
                        }
                        Ok(())
                    })
                }),
                ..WriterHooks::default()
            },
        );
        writer.append(&[padded_line("one")]).unwrap();
        let result = writer.append(&[padded_line("two")]).unwrap();

        assert!(raced.load(Ordering::Relaxed));
        assert!(!old_closed.exists());
        assert!(result.cleanup_deletions >= 1);
        writer.append(&[padded_line("still-healthy")]).unwrap();
        writer.close().unwrap();
    }

    #[test]
    fn repeated_clock_and_boot_identity_never_overwrite_a_closed_segment() {
        let root = tempfile::tempdir().unwrap();
        let now = Arc::new(AtomicU64::new(1_784_721_600_000));
        let policy = RetentionPolicy {
            max_segment_bytes: 100,
            max_closed_segments: 10,
            ..RetentionPolicy::default()
        };
        let mut first = make_writer(&root, now.clone(), policy.clone(), WriterHooks::default());
        first.append(&[padded_line("first")]).unwrap();
        first.append(&[padded_line("second")]).unwrap();
        first.close().unwrap();
        let first_names = closed_names(&root);
        assert_eq!(first_names.len(), 1);
        let original = fs::read(root.path().join("logs/system").join(&first_names[0])).unwrap();

        let mut second = make_writer(&root, now, policy, WriterHooks::default());
        second.append(&[padded_line("third")]).unwrap();
        second.close().unwrap();
        let second_names = closed_names(&root);
        assert_eq!(second_names.len(), 2);
        assert_eq!(
            fs::read(root.path().join("logs/system").join(&first_names[0])).unwrap(),
            original
        );
    }

    #[test]
    fn classifies_open_rename_flush_and_close_faults_and_recovers() {
        for (injected, expected) in [
            (ErrorKind::PermissionDenied, FailureKind::Eacces),
            (ErrorKind::ReadOnlyFilesystem, FailureKind::ReadOnly),
        ] {
            let root = tempfile::tempdir().unwrap();
            let fail = Arc::new(AtomicBool::new(true));
            let mut writer = make_writer(
                &root,
                Arc::new(AtomicU64::new(epoch_millis())),
                RetentionPolicy::default(),
                WriterHooks {
                    before_open: Some({
                        let fail = fail.clone();
                        Arc::new(move |_| {
                            if fail.load(Ordering::Relaxed) {
                                Err(std::io::Error::from(injected))
                            } else {
                                Ok(())
                            }
                        })
                    }),
                    ..WriterHooks::default()
                },
            );
            assert_eq!(writer.open().unwrap_err().kind, expected);
            fail.store(false, Ordering::Relaxed);
            writer.open().unwrap();
            writer.close().unwrap();
        }

        let root = tempfile::tempdir().unwrap();
        let rename_fail = Arc::new(AtomicBool::new(true));
        let mut writer = make_writer(
            &root,
            Arc::new(AtomicU64::new(epoch_millis())),
            RetentionPolicy {
                max_segment_bytes: 100,
                ..RetentionPolicy::default()
            },
            WriterHooks {
                before_rename: Some({
                    let rename_fail = rename_fail.clone();
                    Arc::new(move |_, _| {
                        if rename_fail.load(Ordering::Relaxed) {
                            Err(std::io::Error::other("rename fault"))
                        } else {
                            Ok(())
                        }
                    })
                }),
                ..WriterHooks::default()
            },
        );
        writer.append(&[padded_line("one")]).unwrap();
        assert_eq!(
            writer.append(&[padded_line("two")]).unwrap_err().kind,
            FailureKind::Rename
        );
        rename_fail.store(false, Ordering::Relaxed);
        writer.append(&[padded_line("recovered")]).unwrap();
        writer.close().unwrap();

        let root = tempfile::tempdir().unwrap();
        let mut flush_writer = make_writer(
            &root,
            Arc::new(AtomicU64::new(epoch_millis())),
            RetentionPolicy::default(),
            WriterHooks {
                before_flush: Some(Arc::new(|_| Err(std::io::Error::other("flush fault")))),
                ..WriterHooks::default()
            },
        );
        flush_writer.open().unwrap();
        assert_eq!(flush_writer.flush().unwrap_err().kind, FailureKind::Flush);
        let _ = flush_writer.close();

        let root = tempfile::tempdir().unwrap();
        let mut close_writer = make_writer(
            &root,
            Arc::new(AtomicU64::new(epoch_millis())),
            RetentionPolicy::default(),
            WriterHooks {
                before_close: Some(Arc::new(|_| Err(std::io::Error::other("close fault")))),
                ..WriterHooks::default()
            },
        );
        close_writer.open().unwrap();
        assert_eq!(close_writer.close().unwrap_err().kind, FailureKind::Close);
        assert!(!root
            .path()
            .join("logs/system/field-native.ndjson.lock")
            .exists());
    }

    /// `from_io` reads `ErrorKind`, which means std owns the code table. Pin the
    /// codes the writer actually meets, per platform, so a mapping that moves
    /// under us fails here instead of silently reclassifying a full disk as a
    /// generic write fault.
    #[test]
    fn classifies_real_os_error_codes() {
        #[cfg(unix)]
        let cases = [
            (libc::ENOSPC, FailureKind::Enospc),
            (libc::EACCES, FailureKind::Eacces),
            (libc::EPERM, FailureKind::Eacces),
            (libc::EROFS, FailureKind::ReadOnly),
        ];
        #[cfg(windows)]
        let cases = {
            use windows_sys::Win32::Foundation::{
                ERROR_ACCESS_DENIED, ERROR_DISK_FULL, ERROR_WRITE_PROTECT,
            };
            [
                (ERROR_DISK_FULL as i32, FailureKind::Enospc),
                (ERROR_ACCESS_DENIED as i32, FailureKind::Eacces),
                (ERROR_WRITE_PROTECT as i32, FailureKind::ReadOnly),
            ]
        };
        for (code, expected) in cases {
            assert_eq!(
                from_io(
                    WriterOperation::Write,
                    std::io::Error::from_raw_os_error(code)
                )
                .kind,
                expected,
                "os error {code} must classify as {expected:?}"
            );
        }
    }

    /// The stale-lock takeover in `lock_is_stale` is only as good as this probe:
    /// before WIN-2b the non-unix arm answered `true` for every pid, so a dead
    /// writer's `.lock` was never reclaimable off unix.
    #[test]
    fn pid_liveness_separates_this_process_from_a_reaped_child() {
        assert!(pid_is_alive(std::process::id()));

        #[cfg(unix)]
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        #[cfg(windows)]
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/d", "/s", "/c", "exit 0"])
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        // Unix reaped it, so the pid is gone. Windows keeps the process object
        // alive while `child` holds a handle, but an exited process reports its
        // real exit code rather than STILL_ACTIVE — dead either way.
        assert!(!pid_is_alive(pid));
    }

    #[test]
    fn private_permissions_are_independent_of_umask() {
        #[cfg(unix)]
        {
            let root = tempfile::tempdir().unwrap();
            let now = Arc::new(AtomicU64::new(epoch_millis()));
            let mut writer = make_writer(
                &root,
                now,
                RetentionPolicy::default(),
                WriterHooks::default(),
            );
            writer.open().unwrap();
            assert_eq!(
                fs::metadata(root.path().join("logs"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&writer.active_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            writer.close().unwrap();
        }
    }

    #[test]
    fn symlink_active_path_is_refused_without_touching_the_target() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let root = tempfile::tempdir().unwrap();
            let log_root = root.path().join("logs");
            fs::create_dir_all(log_root.join("system")).unwrap();
            let outside = root.path().join("outside");
            fs::write(&outside, "untouched").unwrap();
            symlink(&outside, log_root.join("system/field-native.ndjson")).unwrap();
            let now = Arc::new(AtomicU64::new(epoch_millis()));
            let mut writer = make_writer(
                &root,
                now,
                RetentionPolicy::default(),
                WriterHooks::default(),
            );
            assert!(writer.open().is_err());
            assert_eq!(fs::read_to_string(outside).unwrap(), "untouched");
        }
    }

    #[test]
    fn symlink_log_root_is_refused_before_creating_a_category() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let container = tempfile::tempdir().unwrap();
            let target = container.path().join("target");
            let linked = container.path().join("linked");
            fs::create_dir(&target).unwrap();
            symlink(&target, &linked).unwrap();
            let mut writer = SegmentWriter::new(SegmentWriterOptions {
                log_root: linked,
                boot_id: "native-boot".into(),
                retention: RetentionPolicy::default(),
                now: Arc::new(epoch_millis),
                hooks: WriterHooks::default(),
            })
            .unwrap();
            assert!(writer.open().is_err());
            assert!(!target.join("system").exists());
        }
    }
}
