#!/usr/bin/env python3
"""Exercise the built macOS desktop on a disposable board and two new iPhone 11 guests."""
import argparse
import datetime as dt
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
import os
from pathlib import Path
import platform
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
MODEL = "com.apple.CoreSimulator.SimDeviceType.iPhone-11"
BUNDLE = "dev.vibefield.bench.interaction"


@contextmanager
def benchmark_site():
    handler = partial(SimpleHTTPRequestHandler, directory=REPO / "fixtures/live-panes")
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/gpu.html"
        finally:
            server.shutdown()
            thread.join()


def command(*args, timeout=240):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=timeout).stdout.strip()


def sim(*args):
    return command("/usr/bin/xcrun", "simctl", *args, timeout=450)


def inventory(runtime):
    return json.loads(sim("list", "devices", "-j"))["devices"].get(runtime, [])


def compile_probe(directory):
    app = directory / "InteractionProbe.app"
    app.mkdir()
    sdk = command("/usr/bin/xcrun", "--sdk", "iphonesimulator", "--show-sdk-path")
    command("/usr/bin/xcrun", "--sdk", "iphonesimulator", "clang", "-target",
            "arm64-apple-ios16.0-simulator", "-isysroot", sdk, "-fobjc-arc", "-O2",
            "-framework", "UIKit", "-framework", "QuartzCore", "-framework", "Foundation",
            HERE / "InteractionProbe.m", "-o", app / "InteractionProbe")
    (app / "Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": BUNDLE, "CFBundleName": "InteractionProbe",
        "CFBundleExecutable": "InteractionProbe", "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1", "CFBundleVersion": "1", "MinimumOSVersion": "16.0",
        "UIDeviceFamily": [1], "LSRequiresIPhoneOS": True, "UILaunchScreen": {},
    }))
    command("/usr/bin/codesign", "--force", "--sign", "-", app)
    return app


def install_probe(app, phone, udid):
    sim("bootstatus", udid, "-b")
    sim("install", udid, app)
    sim("launch", "--terminate-running-process", udid, BUNDLE)
    container = Path(sim("get_app_container", udid, BUNDLE, "data"))
    log = container / "Documents" / "interaction.json"
    deadline = time.monotonic() + 20
    while not log.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("The guest did not start its display link")
        time.sleep(.25)
    return {**phone, "udid": udid, "guestLog": str(log)}


def fixture_phones(directory):
    file = directory / "phones.json"
    return json.loads(file.read_text()) if file.exists() else []


def new_devices(runtime, original, phones):
    names = {p["name"] for p in phones}
    return {d["name"]: d for d in inventory(runtime)
            if d["udid"] not in original and d["name"] in names and d.get("deviceTypeIdentifier") == MODEL}


def prepare_guests(desktop, directory, app, runtime, original):
    deadline = time.monotonic() + 450
    while time.monotonic() < deadline:
        if desktop.poll() is not None:
            raise RuntimeError("The benchmark window closed before both guests were ready")
        phones = fixture_phones(directory)
        devices = new_devices(runtime, original, phones)
        if len(phones) == len(devices) == 2 and all(d["state"] == "Booted" for d in devices.values()):
            with ThreadPoolExecutor(max_workers=2) as executor:
                guests = list(executor.map(lambda p: install_probe(app, p, devices[p["name"]]["udid"]), phones))
            (directory / "guests.json").write_text(json.dumps(guests))
            (directory / "guest-ready").touch()
            return
        time.sleep(1)
    raise RuntimeError("Timed out waiting for the two dedicated benchmark guests")


def remove_fixtures(runtime, original, directory):
    for device in new_devices(runtime, original, fixture_phones(directory)).values():
        if device["state"] != "Shutdown":
            sim("shutdown", device["udid"])
        sim("delete", device["udid"])


def run(args):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("This benchmark requires Apple Silicon macOS and Xcode.")
    # xcodebuild and CoreSimulator resolve the same developer directory as the desktop.
    if "DEVELOPER_DIR" not in os.environ:
        selected = Path(command("/usr/bin/xcode-select", "-p"))
        if not (selected / "usr/bin/simctl").is_file():
            selected = Path("/Applications/Xcode.app/Contents/Developer")
        os.environ["DEVELOPER_DIR"] = str(selected)
    if not any(r["identifier"] == args.runtime and r["isAvailable"] for r in json.loads(sim("list", "runtimes", "-j"))["runtimes"]):
        raise SystemExit(f"Install the requested iOS runtime first: {args.runtime}")
    original = {d["udid"] for d in inventory(args.runtime)}
    electron = REPO / "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    for build in (electron, REPO / "packages/electron-shell/dist/main/index.cjs",
                  REPO / "apps/desktop/build/native/macos/live-surface-capture-helper",
                  REPO / "plugins/browser-pane/dist/renderer.js", REPO / "plugins/simulator/dist/renderer.js"):
        if not build.is_file():
            raise SystemExit(f"Build the desktop and its plugins first: {build}")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    reports = args.output or REPO / ".vibefield/simulator-perf" / f"interaction-{stamp}"
    reports.mkdir(parents=True, exist_ok=False)
    print(f"Writing results to {reports}", flush=True)
    with tempfile.TemporaryDirectory(prefix="vibefield-interaction-") as tmp, benchmark_site() as page_url:
        directory = Path(tmp)
        profile = directory / "profile"
        profile.mkdir()
        # This synthetic, onboarded user exists solely in the temporary profile.
        user = "0" + "".join(secrets.choice("0123456789ABCDEFGHJKMNPQRSTVWXYZ") for _ in range(25))
        row = {"userId": user, "fuid": 1, "name": "Pane benchmark",
               "face": {"emoji": "📱", "frame": "sticker"}, "resident": True,
               "onboarded": True, "createdAt": dt.datetime.now(dt.timezone.utc).isoformat()}
        (profile / "users.json").write_text(json.dumps({"version": 1, "nextFuid": 2, "lastAttached": user, "users": [row]}))
        (directory / "package.json").write_text(json.dumps({"name": "vibefield-interaction", "main": "entry.cjs"}))
        (directory / "entry.cjs").write_text("require(" + json.dumps(str(HERE / "host.cjs")) + ");\n")
        app = compile_probe(directory)
        variant = args.workload
        env = {**os.environ, "VF_PANE_FIXTURE_URL": page_url, "FIELDD_DATA_DIR": str(profile), "VIBEFIELD_DEV_REPO_ROOT": str(REPO),
               "VF_SIMULATOR_FRAMEBUFFER": "1", "VF_PANE_OUTPUT": str(directory), "VF_PANE_RUN": variant, "VF_PANE_RUNTIME": args.runtime,
               "VF_PANE_TRACE_DPR": str(args.trace_dpr)}
        with (reports / "desktop.log").open("w") as log:
            desktop = subprocess.Popen([electron, directory, f"--user-data-dir={profile}"],
                                       cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                prepare_guests(desktop, directory, app, args.runtime, original)
                desktop.wait(timeout=550)
                result = directory / f"{variant}-result.json"
                if not result.exists() or not json.loads(result.read_text())["ok"]:
                    raise RuntimeError(f"Benchmark did not finish. See {reports}")
            finally:
                if desktop.poll() is None:
                    desktop.terminate()
                    try:
                        desktop.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        desktop.kill()
                        desktop.wait()
                for suffix in ("result.json", "partial.json", "failed.json", "grid.png", "error.png"):
                    src = directory / f"{variant}-{suffix}"
                    if src.is_file():
                        shutil.copy2(src, reports / suffix)
                trace = directory / f"{variant}.jsonl"
                if trace.is_file():
                    shutil.copy2(trace, reports / "progress.jsonl")
                remove_fixtures(args.runtime, original, directory)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", default="com.apple.CoreSimulator.SimRuntime.iOS-26-5")
    parser.add_argument("--output", type=Path, help="new directory for per-window, per-tap measurements and the grid image")
    workloads = parser.add_mutually_exclusive_group()
    workloads.add_argument("--compare-batching", dest="workload", action="store_const", const="compare-batching",
                           help="also compare immediate and grouped preview redraws in ABBA order")
    workloads.add_argument("--tap-trace", dest="workload", action="store_const", const="tap-trace",
                           help="record 72 taps on a held phone with a second guest running, including delivery and readback timing")
    workloads.add_argument("--source-trace", dest="workload", action="store_const", const="source-trace",
                           help="profile both browser sources while two simulator previews animate")
    parser.add_argument("--trace-dpr", choices=(1, 2), default=2, type=int,
                        help="desktop browser pixel ratio for the source trace (default: 2)")
    parser.set_defaults(workload="standard")
    try:
        run(parser.parse_args())
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        raise
