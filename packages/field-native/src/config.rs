use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// The terminal mesh's master switch, named once so the strip-list claim below
/// can be asserted against the string this file actually reads.
pub const TERMINAL_MESH_ENV: &str = "FIELD_NATIVE_TERMINAL_MESH";

/// The mirror-write capability's home. Deliberately `FIELD_`-prefixed: EL7's
/// strip list is prefix-based (`registries::ENV_PREFIXES`), so naming the
/// variable inside that class is what keeps it out of every agent PTY — the
/// test below binds the two together so a rename cannot quietly move the secret
/// outside the class.
pub const TERMINAL_MIRROR_WRITE_ENV: &str = "FIELD_NATIVE_TERMINAL_MIRROR_WRITE";

/// TM-1 — what the flag asks of the mesh, and the ONLY thing it asks: are this
/// floor's terminal doors published on the tailnet?
///
/// It used to choose a SERVE SHAPE. Until 2026-09-14 `FIELD_NATIVE_TERMINAL_MESH`
/// kept the pre-cell in-process floor — one embedded ghosttea service hosting
/// every class with `ghosttea-truffle`'s TSP1 adapter borrowing the gateway's
/// node — because a cell cannot borrow that node across a process boundary. The
/// cost was cell isolation XOR the phone, and worse: with the flag set the
/// desktop deck could not open a pane at all (no route rows, no T1 doors, no
/// grant keys, so fieldd could mint no routed ticket). TM-D7 retired that path
/// whole rather than fencing it — it was the pre-TP-S3e product, not "the
/// product minus isolation". Cells now serve unconditionally, and this type
/// answers one question about them.
///
/// Two variants and no payload. The mirror-write capability lives in
/// `NativeConfig::terminal_mirror_write` and reaches the paired client through
/// the mgmt door; a second copy riding this enum would be a second place for a
/// secret to leak from, for a reader that no longer exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshPlan {
    /// The doors stay loopback-only: local windows reach them, the tailnet
    /// does not.
    Off,
    /// The floor was asked to publish its terminal doors on the tailnet. Asked,
    /// not achieved — publishing also needs the gateway's node to be up, which
    /// is a live fact the hello re-reads rather than a config one (TM-1's
    /// `HelloAck.terminalMesh`).
    Requested,
}

impl MeshPlan {
    pub fn resolve(config: &NativeConfig) -> Self {
        if config.terminal_mesh_enabled {
            Self::Requested
        } else {
            Self::Off
        }
    }

    pub fn is_off(&self) -> bool {
        matches!(self, Self::Off)
    }
}

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env overrides (dev):
/// FIELD_NATIVE_DATA_DIR · FIELD_NATIVE_MESH=1 · FIELD_NATIVE_SIDECAR_PATH ·
/// FIELD_NATIVE_TERMINAL_MESH=1 · FIELD_NATIVE_TERMINAL_MIRROR_WRITE.
#[derive(Clone, Debug)]
pub struct NativeConfig {
    pub data_dir: PathBuf,
    /// Shared application log root. `None` is reserved for embedded/unit tests
    /// that deliberately do not install a process-global tracing subscriber.
    pub log_root: Option<PathBuf>,
    /// Development/test-only target filter, admitted only by an explicit
    /// caller decision. Production defaults to INFO.
    pub log_filter: Option<String>,
    /// mesh-gateway master switch (C1: off by default until the tailnet story
    /// is wired end to end; the unit reports "disabled" honestly).
    pub mesh_enabled: bool,
    /// explicit sidecar binary path; falls back to the truffle search order.
    pub sidecar_override: Option<PathBuf>,
    /// TM-1 — the terminal floor publishes its doors on the tailnet. OFF by
    /// default. It selects no serve shape: cells serve either way (TM-D7), and
    /// this asks only whether their doors are reachable from off-device.
    ///
    /// It is a SEPARATE switch from `mesh_enabled` because the two are not the
    /// same question — one asks whether this device has a tailnet identity at
    /// all, the other whether the terminal floor publishes itself on it. The
    /// dependency runs one way: publishing needs the gateway's node, so on
    /// without the gateway publishes nothing, and the floor says so on its
    /// hello (`HelloAck.terminalMesh`) rather than degrading a PTY.
    pub terminal_mesh_enabled: bool,
    /// Mirror-write v1 (GT-D7): the single string a remote viewer must present
    /// to gain WRITE on a mirrored session. `None` — the default — means every
    /// peer is view-only. Per-device scoped tokens are the named upgrade
    /// (design-00 §4.8).
    ///
    /// MF-2a (GM-D5): a floor whose terminal mesh is ON always has one. The
    /// env wins when it is set; otherwise `ensure_terminal_mirror_write` mints
    /// one at boot and keeps it in `terminal-mirror-write.key`, so the phone
    /// can be GRANTED the capability over the door instead of being handed a
    /// string to type. A mesh-off floor stays `None`: nothing is published, so
    /// there is nothing to gate.
    ///
    /// TM-1 (2026-09-14): nothing in this process READS the value any more —
    /// the TSP1 adapter that compared it retired with the in-process serve. It
    /// is kept, minted and answered for because the phone still calls
    /// `terminal.mirrorWriteGrant` until TM-5 moves it onto T1; TM-3 deletes
    /// the capability, the file, the env var and the mgmt door together, once
    /// an expiring per-client attach grant carries the write right instead.
    ///
    /// EL7, twice over: it is `FIELD_`-prefixed, so it rides
    /// `registries::ENV_PREFIXES` into ghosttea's strip list and cannot reach an
    /// agent PTY even in inherit mode; and it is never logged — the log records
    /// only whether one is configured. The value travels as an opaque string
    /// rather than anything we compare here, because upstream owns the compare.
    ///
    /// HISTORICAL since TM-1 (2026-09-14) — kept because the STRING is still
    /// handed to a phone that presents it to a pre-TM-1 floor, and because the
    /// property is what TM-D3's replacement has to beat: that compare was
    /// constant-time in its CONTENTS and not in its length.
    /// `TruffleTerminalConfig::access_for` (re-read 2026-09-13 against the
    /// CURRENT pin, ghosttea-truffle 0.11.1 lib.rs:3972-3989 — this line said
    /// 0.9.2 lib.rs:3962-3979 until the pin moved; the code is unchanged)
    /// tests `expected.len() == supplied.len()` before reaching `subtle::ct_eq`,
    /// so a peer that may attach repeatedly can learn how long this string is —
    /// it cannot learn a byte of it. Length is the one fact the timing leaks, and
    /// a capability worth guessing at is long enough for that to buy nothing;
    /// per-device scoped tokens retire the question along with the shared secret.
    pub terminal_mirror_write: Option<String>,
    /// TC-S2 — explicit `field-terminal-host` binary path (test/dev seam,
    /// FIELD_NATIVE_CELL_BIN, the sidecar-override pattern); production falls
    /// back to the sibling of this executable — cargo and the packaged app
    /// both place the two binaries side by side.
    pub cell_bin_override: Option<PathBuf>,
    /// TC-S3 — spawn-isolation window override in ms (test seam,
    /// FIELD_NATIVE_ISOLATION_WINDOW_MS): the kill matrix cannot wait out the
    /// production five minutes to watch a class LEAVE isolation. Floor-side
    /// env is our own domain — EL7's strip discipline is about what enters
    /// CELLS, and this value never does.
    pub isolation_window_override: Option<u64>,
    /// TP-S3a — the renderer `Origin` values the cells' T1 doors admit at the
    /// HTTP upgrade (terminal-pipeline-v3 §8 door hygiene): the packaged app
    /// origin plus the dev renderer's, comma-separated in
    /// FIELD_NATIVE_ALLOWED_ORIGINS (fieldd passes its own list down at spawn —
    /// one allow-list for both doors). Empty = browser sockets are refused,
    /// non-browser sockets (no Origin) still admitted — the grant is the
    /// authority, the list is hygiene. Rides the cell bootstrap line (a
    /// non-secret), never the cell's env.
    pub allowed_origins: Vec<String>,
}

impl NativeConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let data_dir = std::env::var_os("FIELD_NATIVE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_data_dir);
        let log_root = Some(resolve_log_root()?);
        let log_filter = (std::env::var("FIELD_NATIVE_ALLOW_LOG_FILTER").as_deref() == Ok("1"))
            .then(|| std::env::var("FIELD_NATIVE_LOG_FILTER").ok())
            .flatten();
        let mesh_enabled = std::env::var("FIELD_NATIVE_MESH")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let sidecar_override = std::env::var_os("FIELD_NATIVE_SIDECAR_PATH")
            .or_else(|| std::env::var_os("TRUFFLE_SIDECAR_PATH"))
            .map(PathBuf::from);
        let terminal_mesh_enabled = std::env::var(TERMINAL_MESH_ENV)
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        // Trimmed and emptiness-checked: an exported-but-empty variable is a
        // shell accident, and reading it as "the capability is the empty
        // string" would hand write access to any viewer that supplies nothing.
        let terminal_mirror_write = std::env::var(TERMINAL_MIRROR_WRITE_ENV)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let cell_bin_override = std::env::var_os("FIELD_NATIVE_CELL_BIN").map(PathBuf::from);
        let isolation_window_override = std::env::var("FIELD_NATIVE_ISOLATION_WINDOW_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok());
        let allowed_origins = std::env::var("FIELD_NATIVE_ALLOWED_ORIGINS")
            .ok()
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|origin| !origin.is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(Self {
            data_dir,
            log_root,
            log_filter,
            mesh_enabled,
            sidecar_override,
            terminal_mesh_enabled,
            terminal_mirror_write,
            cell_bin_override,
            isolation_window_override,
            allowed_origins,
        })
    }

    /// Test/dev constructor: mesh off, no overrides.
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            log_root: None,
            log_filter: None,
            mesh_enabled: false,
            sidecar_override: None,
            terminal_mesh_enabled: false,
            terminal_mirror_write: None,
            cell_bin_override: None,
            isolation_window_override: None,
            allowed_origins: Vec::new(),
        }
    }

    /// Integration-test constructor that exercises the production logging
    /// lifecycle without consulting ambient process environment.
    pub fn for_data_and_log_dir(data_dir: PathBuf, log_root: PathBuf) -> Self {
        Self {
            data_dir,
            log_root: Some(log_root),
            log_filter: None,
            mesh_enabled: false,
            sidecar_override: None,
            terminal_mesh_enabled: false,
            terminal_mirror_write: None,
            cell_bin_override: None,
            isolation_window_override: None,
            allowed_origins: Vec::new(),
        }
    }

    pub fn native_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::NATIVE_DIR)
    }
    /// 0700 — sockets live here; stable paths across fieldd restarts (external-mode law).
    pub fn run_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::NATIVE_RUN_DIR)
    }
    /// 0600 — the D8 pairing secret, created by field-native on first boot.
    pub fn pairing_file(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::PAIRING_FILE)
    }

    /// 0600 — MF-2a's minted mirror-write capability, beside the pairing
    /// secret. In the native dir rather than the run dir for the reason the
    /// Ghostty overlay below is: a boot creates the run dir's contents, and
    /// this string must survive a boot (a phone that was granted it yesterday
    /// still holds it today).
    pub fn terminal_mirror_write_file(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::TERMINAL_MIRROR_WRITE_FILE)
    }

    /// MF-2a — make "a publishing floor always has a capability" true.
    ///
    /// Called once at boot, BEFORE the units are built, and idempotent after
    /// that: the env value wins and nothing is written, a mesh-off floor mints
    /// nothing, and a floor that has minted before reads the same string back.
    ///
    /// Never fatal. A floor that cannot write the file keeps serving
    /// VIEW-ONLY and says so through the mesh face it already publishes —
    /// refusing to boot over a key file would take the PTYs down with it,
    /// which is precisely the two-planes law's inversion.
    pub fn ensure_terminal_mirror_write(&mut self) {
        if !self.terminal_mesh_enabled || self.terminal_mirror_write.is_some() {
            return;
        }
        let path = self.terminal_mirror_write_file();
        match load_or_mint_mirror_write(&path) {
            Ok(capability) => self.terminal_mirror_write = Some(capability),
            Err(error) => {
                // The PATH is operational news; the capability never is.
                tracing::warn!(
                    event = "field_native.terminal.mirror_write_unavailable",
                    component = "terminal",
                    path = %path.display(),
                    error = %format!("{error:#}"),
                    "The floor could not mint or read its mirror-write capability; \
                     remote viewers stay view-only until it can"
                );
            }
        }
    }

    /// The app-owned Ghostty config overlay the terminal unit loads after the
    /// user's own Ghostty files (GT-3). It sits in the native dir, not the run
    /// dir: a user's configuration outlives a boot, and the run dir holds only
    /// what a boot creates. The segments come from the generated LAYOUT — one
    /// spelling, and this plane owns the file, so every reader asks the service
    /// where it is rather than deriving the path a second time.
    pub fn terminal_config_file(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::TERMINAL_CONFIG_FILE)
    }
    pub fn mgmt_socket(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MGMT_SOCKET)
    }

    /// The MeshData bridge's byte plane (D5). A SECOND socket beside mgmt on
    /// purpose: control and bytes must not share a queue, and this one carries
    /// product data while mgmt carries decisions.
    pub fn meshdata_socket(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MESHDATA_SOCKET)
    }

    /// WIN-D1 — the endpoint-resolution law. On unix an endpoint IS the joined
    /// LAYOUT path (byte-for-byte the pre-Windows behavior); on win32 it is a
    /// named pipe carrying a scope hash of the data root (crate::endpoints,
    /// pinned by contracts' endpoint vector), because the flat pipe namespace
    /// has no run-directory boundary. `None` = the root cannot be spelled as
    /// the UTF-8 the contract requires — callers degrade honestly (the terminal
    /// unit's Endpoints comment states the same law for its pair).
    pub fn mgmt_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::MGMT,
            crate::registries::layout::MGMT_SOCKET,
        )
    }
    pub fn meshdata_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::MESHDATA,
            crate::registries::layout::MESHDATA_SOCKET,
        )
    }
    pub fn terminal_control_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::TERMINAL_CONTROL,
            crate::registries::layout::TERMINAL_CONTROL_SOCKET,
        )
    }
    pub fn terminal_frame_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::TERMINAL_FRAME,
            crate::registries::layout::TERMINAL_FRAME_SOCKET,
        )
    }

    /// TC-S2 — a cell's per-instance terminal endpoints: the SAME resolution
    /// law with the instance-suffixed file name (`endpoints::cell_socket_file`,
    /// vector-pinned). Fresh names per instance are what make a cell restart
    /// never a rebind. `None` = the same non-UTF-8 refusal as every endpoint.
    pub fn terminal_cell_control_endpoint(&self, instance: u32) -> Option<String> {
        self.local_endpoint_for_file(&crate::endpoints::cell_socket_file(
            crate::registries::sockets::TERMINAL_CONTROL,
            instance,
        ))
    }
    pub fn terminal_cell_frame_endpoint(&self, instance: u32) -> Option<String> {
        self.local_endpoint_for_file(&crate::endpoints::cell_socket_file(
            crate::registries::sockets::TERMINAL_FRAME,
            instance,
        ))
    }

    /// TC-S3 — a cell's crash-breadcrumb file (TC-D4's attribution seam): the
    /// floor passes this path to the cell via `--crumb`; the cell writes it on
    /// the way down when it can say anything, and the floor reads-and-deletes
    /// it after the wait. A run-dir artifact of one boot, floor↔cell internal —
    /// never a cross-plane contract, so the ONE spelling lives here. Unlinked
    /// before every spawn so a stale generation cannot color a fresh death.
    pub fn terminal_cell_crumb_file(&self, instance: u32) -> PathBuf {
        self.run_dir().join(format!("termcell.{instance}.crumb"))
    }

    /// TC-S3 — how long a class stays in spawn-isolation after an intensity
    /// breach with an Exact offender. The genned registry is the production
    /// authority; the override is the kill matrix's clock.
    pub fn isolation_window(&self) -> std::time::Duration {
        std::time::Duration::from_millis(
            self.isolation_window_override
                .unwrap_or(crate::registries::cell_isolation::ISOLATION_WINDOW_MS),
        )
    }

    /// TC-S2 — where `field-terminal-host` lives: the explicit override
    /// (FIELD_NATIVE_CELL_BIN — the sidecar-override pattern), else this
    /// executable's sibling. cargo and the packaged app both place the two
    /// binaries side by side; a missing sibling is the supervisor's honest
    /// degraded state, not a panic.
    pub fn cell_binary(&self) -> Option<PathBuf> {
        if let Some(explicit) = &self.cell_bin_override {
            return Some(explicit.clone());
        }
        let exe = std::env::current_exe().ok()?;
        let name = if cfg!(windows) {
            "field-terminal-host.exe"
        } else {
            "field-terminal-host"
        };
        // Sibling first (the packaged and `cargo run` layout), then one level
        // up: an EMBEDDED test's current_exe lives in target/debug/deps/ while
        // cargo puts bin targets in target/debug/ — existence-checked so the
        // supervisor's "cannot be located" detail stays honest when neither
        // holds a binary.
        let parent = exe.parent()?;
        let candidates = [parent.join(name), parent.parent()?.join(name)];
        candidates.into_iter().find(|candidate| candidate.exists())
    }

    #[cfg(windows)]
    fn local_endpoint_for_file(&self, socket_file: &str) -> Option<String> {
        let root = self.data_dir.to_str()?;
        Some(crate::endpoints::pipe_endpoint_for(root, socket_file))
    }
    #[cfg(not(windows))]
    fn local_endpoint_for_file(&self, socket_file: &str) -> Option<String> {
        self.run_dir().join(socket_file).to_str().map(str::to_owned)
    }

    #[cfg(windows)]
    fn local_endpoint(&self, socket_file: &str, _segments: &[&str]) -> Option<String> {
        let root = self.data_dir.to_str()?;
        Some(crate::endpoints::pipe_endpoint_for(root, socket_file))
    }
    #[cfg(not(windows))]
    fn local_endpoint(&self, _socket_file: &str, segments: &[&str]) -> Option<String> {
        self.join_layout(segments).to_str().map(str::to_owned)
    }
    /// truffle node state (device identity + tsnet keys) — mesh identity lives
    /// in the longer-lived plane and survives fieldd restarts (design-02 §2.4).
    pub fn mesh_state_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MESH_STATE_DIR)
    }

    /// UA-D10: every path under the data root derives from the generated
    /// LAYOUT segments — this is the only join site in the native plane.
    fn join_layout(&self, segments: &[&str]) -> PathBuf {
        segments
            .iter()
            .fold(self.data_dir.clone(), |path, segment| path.join(segment))
    }
}

/// MF-2a — read the capability back, or mint one on first use.
///
/// HEX, and 32 random bytes of it: the pairing secret already spells a 32-byte
/// secret this way (`pairing::load_or_create_secret`), and hex survives every
/// shell, QR code and paste without an alphabet or padding question — the
/// phone's own sheet trims whitespace and stores whatever is left
/// (`WriteKeySheet.swift:124-126`), so a hex string reaches its Keychain
/// unharmed. The value is opaque to everything downstream — upstream's
/// `access_for` compares bytes — so a hand-written file holding some other
/// string is honored as-is.
///
/// The file's CONTENTS are a secret; its path is not. Nothing here logs the
/// string, and the two `with_context` messages below name the path only.
fn load_or_mint_mirror_write(path: &Path) -> Result<String> {
    if path.exists() {
        let raw =
            std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let existing = raw.trim().to_owned();
        if !existing.is_empty() {
            // A file this floor wrote with a looser mode (an older boot, a
            // restore from a backup, an editor's rewrite) is tightened rather
            // than trusted: the same-uid adversary is EL7's, but another
            // account on the box is not one we hand a capability to.
            crate::secret_file::harden(path)?;
            return Ok(existing);
        }
        // An empty file is a truncated write, never a capability: minting over
        // it beats wedging a floor that can never grant write again. The phone
        // re-asks for a grant and gets the new one.
        tracing::warn!(
            event = "field_native.terminal.mirror_write_reminted",
            component = "terminal",
            path = %path.display(),
            "The mirror-write capability file was empty; minting a fresh capability"
        );
    }
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    let capability = hex::encode(bytes);
    if let Some(parent) = path.parent() {
        let fresh = !parent.exists();
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        // 0700 only on a directory this call created — the boot creates the
        // native dir before this runs, and silently re-moding a directory the
        // pairing secret and the Ghostty overlay also live in is not this
        // function's decision to make.
        #[cfg(unix)]
        if fresh {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .with_context(|| format!("chmod 0700 {}", parent.display()))?;
        }
    }
    // An empty file from a truncated write is REMOVED before the mint rather
    // than written over: `create_private` refuses an existing path on purpose
    // (that refusal is what stops a planted symlink), so the stale inode has to
    // go first. Nothing is lost — the file held no capability, which is why we
    // are here.
    if path.exists() {
        std::fs::remove_file(path)
            .with_context(|| format!("remove the empty {}", path.display()))?;
    }
    let mut file = match crate::secret_file::create_private(path) {
        Ok(file) => file,
        // Another boot of this floor won the race between the check above and
        // this create. Its capability is as good as ours and it is the one on
        // disk, so read it back rather than fight for the path.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let raw = std::fs::read_to_string(path)
                .with_context(|| format!("read {}", path.display()))?;
            let existing = raw.trim().to_owned();
            if !existing.is_empty() {
                crate::secret_file::harden(path)?;
                return Ok(existing);
            }
            anyhow::bail!("{} was recreated empty under us", path.display())
        }
        Err(error) => {
            return Err(anyhow::Error::new(error))
                .with_context(|| format!("create {}", path.display()))
        }
    };
    use std::io::Write as _;
    file.write_all(capability.as_bytes())
        .with_context(|| format!("write {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("sync {}", path.display()))?;
    Ok(capability)
}

/// `HOME` is a unix fact — Windows has `USERPROFILE`. One resolver so no
/// default below quietly lands on `"."` (a CWD-relative data root would carry
/// the pairing secret and every endpoint to wherever the process was launched).
fn home_dir() -> PathBuf {
    #[cfg(windows)]
    let var = "USERPROFILE";
    #[cfg(not(windows))]
    let var = "HOME";
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home_dir().join("Library/Application Support/VibeField")
    }
    // %APPDATA% (roaming), in lockstep with fieldd's bin.ts default — the two
    // planes must hash ONE root string into ONE pipe scope (WIN-D1).
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData/Roaming"))
            .join("VibeField")
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        home_dir().join(".local/share/VibeField")
    }
}

fn resolve_log_root() -> anyhow::Result<PathBuf> {
    if std::env::var("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE").as_deref() == Ok("1") {
        if let Some(value) = std::env::var_os("FIELD_LOG_DIR") {
            let path = PathBuf::from(value);
            anyhow::ensure!(path.is_absolute(), "FIELD_LOG_DIR must be absolute");
            return Ok(path);
        }
    }

    let home = home_dir();
    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library/Logs/VibeField"))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"))
            .join("VibeField/Logs"))
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Ok(std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/state"))
            .join("vibefield/logs"))
    }
}

/// MF-2a — the mint, its idempotence, its refusals and its mode. Driven
/// through `ensure_terminal_mirror_write` on constructed configs rather than
/// `from_env`: the process environment is shared by every test in this binary,
/// and the law under test ("the env wins") is a branch, not a variable.
#[cfg(test)]
mod tests {
    use super::*;

    /// TM-1 — the plan is a two-state answer to ONE question, and `Off` is the
    /// default. It used to select a serve shape; the row that asserted that is
    /// gone with the shape (`tests/terminal_mesh.rs`, deleted), and what is
    /// left is the derivation this file owns.
    #[test]
    fn the_plan_is_off_unless_the_flag_asks_for_the_tailnet_door() {
        let mut config = NativeConfig::for_data_dir(std::path::PathBuf::from("/tmp/vf-plan"));
        assert_eq!(MeshPlan::resolve(&config), MeshPlan::Off);
        assert!(MeshPlan::resolve(&config).is_off());

        config.terminal_mesh_enabled = true;
        assert_eq!(MeshPlan::resolve(&config), MeshPlan::Requested);
        assert!(!MeshPlan::resolve(&config).is_off());
    }

    /// EL7, moved here at TM-1 from `tests/terminal_mesh.rs` (deleted with the
    /// TSP1 adapter): ghosttea's strip list is prefix-based, so this variable
    /// is protected by its NAME. fieldd's kill matrix proves the class is
    /// actually stripped from a live PTY; this proves our secret is IN that
    /// class, which is the half a rename could silently break. It outlives the
    /// adapter because the variable does — TM-3 deletes both together.
    #[test]
    fn the_mirror_write_variable_stays_inside_the_el7_strip_class() {
        assert!(
            crate::registries::ENV_PREFIXES
                .iter()
                .any(|prefix| TERMINAL_MIRROR_WRITE_ENV.starts_with(prefix)),
            "{TERMINAL_MIRROR_WRITE_ENV} must start with one of {:?}",
            crate::registries::ENV_PREFIXES
        );
    }

    fn serving(dir: &std::path::Path) -> NativeConfig {
        NativeConfig {
            terminal_mesh_enabled: true,
            ..NativeConfig::for_data_dir(dir.to_path_buf())
        }
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).expect("stat").permissions().mode() & 0o777
    }

    #[test]
    fn a_serving_floor_mints_a_capability_once_and_reads_it_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut first = serving(dir.path());
        first.ensure_terminal_mirror_write();
        let minted = first
            .terminal_mirror_write
            .clone()
            .expect("a serving floor always has a capability");
        assert_eq!(minted.len(), 64, "32 random bytes as hex: {minted}");
        assert!(
            minted.chars().all(|c| c.is_ascii_hexdigit()),
            "the minted capability must be hex: {minted}"
        );

        // The second boot is the same floor, not a rotation — a phone granted
        // the capability yesterday must still be able to write today.
        let mut second = serving(dir.path());
        second.ensure_terminal_mirror_write();
        assert_eq!(
            second.terminal_mirror_write.as_deref(),
            Some(minted.as_str())
        );

        // And the call is idempotent WITHIN a boot.
        second.ensure_terminal_mirror_write();
        assert_eq!(
            second.terminal_mirror_write.as_deref(),
            Some(minted.as_str())
        );

        let file = first.terminal_mirror_write_file();
        assert_eq!(
            std::fs::read_to_string(&file)
                .expect("read the key file")
                .trim(),
            minted
        );
        assert_eq!(
            file.file_name().and_then(|n| n.to_str()),
            Some("terminal-mirror-write.key"),
            "the name is LAYOUT's, never respelled here"
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_minted_capability_file_is_0600() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = serving(dir.path());
        config.ensure_terminal_mirror_write();
        let file = config.terminal_mirror_write_file();
        assert_eq!(mode(&file), 0o600, "the capability is a secret on disk");

        // A file loosened underneath us is tightened on the way back in, not
        // trusted: another ACCOUNT on the box is not a principal we grant.
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).expect("chmod");
        let mut reboot = serving(dir.path());
        reboot.ensure_terminal_mirror_write();
        assert_eq!(mode(&file), 0o600, "a loose capability file is re-hardened");
        assert_eq!(reboot.terminal_mirror_write, config.terminal_mirror_write);
    }

    #[test]
    fn the_environment_wins_and_nothing_is_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = NativeConfig {
            terminal_mirror_write: Some("  exported-by-hand  ".trim().to_owned()),
            ..serving(dir.path())
        };
        config.ensure_terminal_mirror_write();
        assert_eq!(
            config.terminal_mirror_write.as_deref(),
            Some("exported-by-hand")
        );
        assert!(
            !config.terminal_mirror_write_file().exists(),
            "an exported capability must leave no file behind — rotation stays the env's"
        );
    }

    #[test]
    fn a_mesh_off_floor_mints_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = NativeConfig::for_data_dir(dir.path().to_path_buf());
        assert!(!config.terminal_mesh_enabled);
        config.ensure_terminal_mirror_write();
        assert_eq!(
            config.terminal_mirror_write, None,
            "nothing serves, nothing is gated"
        );
        assert!(
            !config.terminal_mirror_write_file().exists(),
            "a floor that publishes nothing writes no capability"
        );
    }

    #[test]
    fn an_empty_capability_file_is_reminted_rather_than_honored() {
        // A truncated write must not hand WRITE to a viewer that supplies the
        // empty string, and must not wedge the floor either.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = serving(dir.path());
        let file = config.terminal_mirror_write_file();
        std::fs::create_dir_all(file.parent().expect("parent")).expect("mkdir");
        std::fs::write(&file, "   \n").expect("write an empty capability");

        config.ensure_terminal_mirror_write();
        let minted = config
            .terminal_mirror_write
            .clone()
            .expect("a fresh capability");
        assert_eq!(minted.len(), 64);
        assert_eq!(std::fs::read_to_string(&file).expect("read").trim(), minted);
    }

    #[test]
    fn a_hand_written_capability_is_honored_verbatim() {
        // The value is opaque downstream (upstream compares bytes), so an
        // operator's own string in the file is the floor's capability.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = serving(dir.path());
        let file = config.terminal_mirror_write_file();
        std::fs::create_dir_all(file.parent().expect("parent")).expect("mkdir");
        std::fs::write(&file, "a-capability-a-human-chose\n").expect("write");

        config.ensure_terminal_mirror_write();
        assert_eq!(
            config.terminal_mirror_write.as_deref(),
            Some("a-capability-a-human-chose")
        );
    }
}
