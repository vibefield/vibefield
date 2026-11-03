#!/usr/bin/env python3
"""Run opt-in Truffle qualification in an isolated iPhone QA app.

The caller authorizes installing the QA app and transferring the test tailnet
key. The app consumes and deletes its config immediately; this runner also
uninstalls the isolated app in finally, including when Xcode fails to launch it.
No credential is written into source, build products, or test-result metadata.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True, help="Host fixture directory with ready.json")
    parser.add_argument("--app", type=Path, required=True, help="Built isolated VibeField.app")
    parser.add_argument("--xctestrun", type=Path, required=True)
    parser.add_argument("--device", required=True, help="Physical device UDID")
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--result", type=Path, required=True, help="New .xcresult path; log shares its stem")
    parser.add_argument("--test-env-file", type=Path, help="Read only TRUFFLE_TEST_AUTHKEY; otherwise use the environment")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9.-]+\.ghosttyqualification\.(baseline|candidate)", args.bundle_id):
        parser.error("Only isolated .ghosttyqualification.baseline/candidate apps are supported")
    with (args.app / "Info.plist").open("rb") as source:
        if plistlib.load(source).get("CFBundleIdentifier") != args.bundle_id:
            parser.error("The built app must have the requested isolated QA bundle identifier")
    if args.result.exists():
        parser.error("Result path already exists; preserve it and choose a new path")
    config = json.loads((args.fixture / "ready.json").read_text())
    key = os.environ.get("TRUFFLE_TEST_AUTHKEY")
    if args.test_env_file:
        match = re.search(r"^TRUFFLE_TEST_AUTHKEY\s*=\s*(.+)$", args.test_env_file.read_text(), re.M)
        key = match.group(1).strip().strip("\"'") if match else None
    if not key:
        parser.error("TRUFFLE_TEST_AUTHKEY is unavailable")
    config["authKey"] = key
    args.result.parent.mkdir(parents=True, exist_ok=True)
    log_path = args.result.with_suffix(".log")
    environment = dict(os.environ)
    environment.pop("TRUFFLE_TEST_AUTHKEY", None)
    installed = False
    try:
        subprocess.run(
            ["xcrun", "devicectl", "device", "install", "app", "--device", args.device, str(args.app)],
            env=environment, check=True, stdout=subprocess.DEVNULL,
        )
        installed = True
        with tempfile.TemporaryDirectory(prefix="vf-ghostty-phone-") as temporary:
            private = Path(temporary) / "config.json"
            descriptor = os.open(private, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w") as output:
                json.dump(config, output)
            try:
                subprocess.run([
                    "xcrun", "devicectl", "device", "copy", "to", "--device", args.device,
                    "--domain-type", "appDataContainer", "--domain-identifier", args.bundle_id,
                    "--source", str(private), "--destination", "Documents/ghostty-qualification.json",
                ], env=environment, check=True, stdout=subprocess.DEVNULL)
            finally:
                private.unlink(missing_ok=True)
                config.clear()
                key = None
        # The already-written config is the sole transfer. Do not pass the
        # test key through Xcode's process environment or its result bundle.
        with log_path.open("w") as log:
            result = subprocess.run([
                "xcodebuild", "test-without-building", "-xctestrun", str(args.xctestrun),
                "-destination", "platform=iOS,id=" + args.device,
                "-resultBundlePath", str(args.result),
                "-only-testing:FieldTerminalTests/GhosttyMigrationRemoteTests",
                "-parallel-testing-enabled", "NO",
            ], env=environment, stdout=log, stderr=subprocess.STDOUT)
        return result.returncode
    finally:
        config.clear()
        if installed:
            # This also removes an unconsumed config if the test runner never
            # started. The shipping app is excluded by bundle-id validation.
            subprocess.run([
                "xcrun", "devicectl", "device", "uninstall", "app", "--device", args.device, args.bundle_id,
            ], env=environment, check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    raise SystemExit(main())
