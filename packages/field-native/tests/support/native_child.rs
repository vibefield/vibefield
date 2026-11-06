//! Test-side: the REAL field-native binary as a child of the test, at a LOW soft descriptor limit, and the wait
//! for its management socket. Included by `#[path]` from the rows that need it (`resource_governance.rs`,
//! `listener_accept_pressure.rs`); cargo compiles nothing in `tests/support/` on its own. Moved here from
//! `resource_governance.rs` unchanged (item 198), with the limit now the caller's.
#![allow(dead_code)] // each test binary uses a different subset

use field_native::rlimit::TEST_NO_RLIMIT_ENV;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio::net::UnixStream;

pub struct NativeProcess {
    child: Option<Child>,
}

impl NativeProcess {
    /// Spawn the real binary with a LOW soft descriptor limit imposed on the
    /// child — the inherited-limit condition, reproduced without touching this
    /// test process (whose limit its sibling tests are also using).
    pub fn spawn(data_dir: &Path, log_root: &Path, sabotage: bool, soft_limit: u64) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_field-native"));
        command
            .env("FIELD_NATIVE_DATA_DIR", data_dir)
            .env("FIELD_LOG_DIR", log_root)
            .env("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE", "1")
            .env_remove("FIELD_NATIVE_MESH")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if sabotage {
            command.env(TEST_NO_RLIMIT_ENV, "1");
        } else {
            command.env_remove(TEST_NO_RLIMIT_ENV);
        }
        // SAFETY: runs in the forked child before exec. `getrlimit`/`setrlimit`
        // are async-signal-safe, allocate nothing, and touch only this child's
        // own limits. Only the SOFT half is lowered — leaving the hard limit
        // alone is what gives the real arm something to raise back to, which is
        // exactly the production shape under launchd.
        unsafe {
            command.pre_exec(move || {
                let mut limit = libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                limit.rlim_cur = (soft_limit as libc::rlim_t).min(limit.rlim_max);
                if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let child = command.spawn().expect("spawn field-native");
        Self { child: Some(child) }
    }

    pub fn id(&self) -> u32 {
        self.child.as_ref().expect("child available").id()
    }

    pub fn is_running(&mut self) -> bool {
        self.child
            .as_mut()
            .expect("child available")
            .try_wait()
            .expect("query child")
            .is_none()
    }

    pub async fn terminate(mut self) {
        if self.child.is_none() {
            return;
        }
        // SAFETY: this pid belongs to the child this fixture retains.
        unsafe { libc::kill(self.id() as libc::pid_t, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.is_running() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub async fn wait_for_native(data_dir: &Path, process: &mut NativeProcess) -> PathBuf {
    let socket = data_dir.join("native/run/mgmt.sock");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        assert!(
            process.is_running(),
            "field-native exited before binding mgmt"
        );
        if socket.exists()
            && data_dir.join("native/pairing").exists()
            && UnixStream::connect(&socket).await.is_ok()
        {
            return socket;
        }
        assert!(Instant::now() < deadline, "field-native did not bind mgmt");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
