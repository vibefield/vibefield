// vibefield-terminal-perf-lab-only
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { BrowserWindow } from "electron";
import { pasteTerminalLine } from "./terminal-startup-benchmark";

const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shellWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = now() + 10_000;
  while (!(await check())) {
    if (now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

// Each PTY keeps a known color on screen between switches, even while detached.
// Only that PTY can acknowledge its new color and return the input nonce.
const fixture = String.raw`set -eu
out=$1
i=$2
paint() {
  printf '\033[48;2;%sm\033[2J\033[H' "$1"
  row=1
  while [ "$row" -le 6 ]; do
    printf '\033[%s;1H%40s' "$row" ''
    row=$((row+1))
  done
  printf '\033[7;1H'
}
trap 'printf "\033[0m\033[?1049l"' 0
printf '\033[?1049h'
paint "$3"
: > "$out/attach-$i.armed"
while [ "$i" -lt 8 ]; do
  prefix=$out/attach-$i
  while [ ! -s "$prefix.go" ]; do sleep 0.02; done
  paint "$(cat "$prefix.go")"
  : > "$prefix.frame"
  IFS= read -r reply
  printf '%s' "$reply" > "$prefix.input"
  i=$((i+2))
done
while [ ! -f "$out/attach.finish" ]; do sleep 0.02; done
`;

type Geometry = {
  session: string;
  sameCanvas: boolean;
  cssWidth: number;
  bitmapWidth: number;
  dpr: number;
};

/** Target identity, changing screen contents and the first input are all observed independently. */
export async function measurePaneSwitches(options: {
  win: BrowserWindow;
  out: string;
  sessions: [string, string];
  whenInputAllowed(id: string): Promise<void>;
  inputAllowed(id: string): boolean;
  activationId(id: string): string | undefined;
}) {
  const { win, sessions, out } = options;
  const read = <T>(source: string): Promise<T> => win.webContents.executeJavaScript(source);
  const script = join(out, "attach-fixture.sh");
  writeFileSync(script, fixture);
  const colors = [
    [224, 25, 24],
    [27, 47, 238],
    [240, 155, 25],
    [25, 204, 62],
  ];
  const prefix = (i: number) => join(out, `attach-${i}`);
  const arm = async (i: number) => {
    await pasteTerminalLine(
      win,
      sessions[i % 2]!,
      ["/bin/sh", script, out, String(i), colors[(i + 2) % 4]!.join(";")].map(shellWord).join(" "),
    );
    await until(() => existsSync(`${prefix(i)}.armed`), "the target fixture to start");
  };
  let view: "list" | "swarm" = "list";
  const rowSelector = (target: string) =>
    view === "list"
      ? ".vf-monitor-list-row:not(.is-linked)"
      : `.vf-monitor-swarm-list button[data-agent-bubble-id="${target}"]`;
  const click = (target: string) =>
    read<number>(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector(target))});
    if (!row) throw Error('Detached session control missing');
    const at = performance.timeOrigin + performance.now(); row.click(); return at;
  })()`);
  const linked = () =>
    read<boolean>("document.querySelectorAll('.vf-monitor-list-row.is-linked').length === 1");
  const active = () =>
    read<string>(
      "document.querySelector('.ghostty-pane.is-active canvas')?.getAttribute('aria-label')",
    );
  await until(linked, "a single linked row");
  await arm(0);
  await click(sessions[1]);
  await options.whenInputAllowed(sessions[1]);
  await until(
    async () => (await active()) === `Terminal session ${sessions[1]}`,
    "the other session to open",
  );
  await arm(1);
  const points = await read<{ x: number; y: number }[]>(`(() => {
    const rect = document.querySelector('.ghostty-pane.is-active canvas').getBoundingClientRect();
    return [[30,36],[242,90]].map(([x,y]) => ({ x:(rect.left+x)/innerWidth, y:(rect.top+y)/innerHeight }));
  })()`);
  type Frame = { at: number; color: number };
  let latestColor = -1;
  let observing: Frame[] | undefined;
  const continuity: {
    view: "list" | "swarm";
    outgoing: number;
    cachedTarget: number;
    target: number;
    frames: number[];
  }[] = [];
  const switches: Geometry[][] = [];
  const latency: {
    sessionId: string;
    attachment: "reused" | "fresh";
    clickToInputReadyMs: number;
    clickToCurrentCaptureMs: number;
  }[] = [];
  win.webContents.beginFrameSubscription(false, (image) => {
    const at = now();
    const { width, height } = image.getSize();
    // Both points sit inside the color swatch. A split or unpainted frame
    // must not qualify as either terminal. Allow for the window's color profile.
    const samples = points.map((point) => {
      const px = image
        .crop({
          x: Math.floor(point.x * width),
          y: Math.floor(point.y * height),
          width: 1,
          height: 1,
        })
        .toBitmap();
      const distances = colors.map(
        ([r, g, b]) => (px[2]! - r!) ** 2 + (px[1]! - g!) ** 2 + (px[0]! - b!) ** 2,
      );
      const nearest = Math.min(...distances);
      return nearest < 96 ** 2 ? distances.indexOf(nearest) : -1;
    });
    latestColor = samples[0] === samples[1] ? samples[0]! : -1;
    observing?.push({ at, color: latestColor });
  });
  try {
    for (let i = 0; i < 8; i++) {
      const target = sessions[i % 2]!;
      if (i === 4) {
        await read(`document.querySelector('[aria-label="SWARM view"]').click()`);
        view = "swarm";
      }
      const outgoing = (i + 3) % colors.length;
      const current = i % colors.length;
      const cachedTarget = (i + 2) % colors.length;
      await until(() => latestColor === outgoing, "the outgoing terminal color in the window");
      await until(
        async () =>
          !options.inputAllowed(target) &&
          (await read<boolean>(
            `Boolean(document.querySelector(${JSON.stringify(rowSelector(target))}))`,
          )),
        "the target to detach",
      );
      const previous = options.activationId(target);
      if (i === 7) {
        await until(
          () => options.activationId(target) === undefined,
          "the retained attachment to expire",
        );
      }
      writeFileSync(`${prefix(i)}.go`, colors[current]!.join(";"));
      await until(() => existsSync(`${prefix(i)}.frame`), "the hidden PTY to write its new screen");
      const frames: Frame[] = [];
      observing = frames;
      const geometry = read<Geometry[]>(`new Promise(resolve => {
        const before = document.querySelector('.ghostty-pane.is-active canvas');
        const samples = [];
        let frames = 0;
        function tick() {
          const c = document.querySelector('.ghostty-pane.is-active canvas');
          if (c) samples.push({session:c.getAttribute('aria-label'), sameCanvas:c === before, cssWidth:c.clientWidth * new DOMMatrixReadOnly(getComputedStyle(c).transform).a, bitmapWidth:c.width, dpr:devicePixelRatio});
          if (++frames < 12) requestAnimationFrame(tick); else resolve(samples);
        }
        requestAnimationFrame(tick);
      })`);
      const [clicked, ready] = await Promise.all([
        click(target),
        options.whenInputAllowed(target).then(now),
      ]);
      await until(
        async () => (await active()) === `Terminal session ${target}`,
        "the chosen canvas",
      );
      const nonce = `switch-input-${i}`;
      await pasteTerminalLine(win, target, nonce);
      await until(
        () =>
          existsSync(`${prefix(i)}.input`) && readFileSync(`${prefix(i)}.input`, "utf8") === nonce,
        "first input in the chosen PTY",
      );
      await until(
        () => frames.some((frame) => frame.at >= clicked && frame.color === current),
        "the chosen PTY's new color in the Electron window",
      );
      const samples = await geometry;
      if (!samples.some((s) => s.session === `Terminal session ${target}`)) {
        throw Error("The selected canvas did not appear during the first twelve frames");
      }
      if (samples.some((s) => Math.abs(s.cssWidth - s.bitmapWidth / s.dpr) >= 0.1))
        throw Error("Attach stretched the terminal bitmap");
      observing = undefined;
      const captured = frames.filter((frame) => frame.at >= clicked);
      continuity.push({
        view,
        outgoing,
        cachedTarget,
        target: current,
        frames: captured.map((frame) => frame.color),
      });
      switches.push(samples);
      latency.push({
        sessionId: target,
        attachment: options.activationId(target) === previous ? "reused" : "fresh",
        clickToInputReadyMs: ready - clicked,
        clickToCurrentCaptureMs: captured.find((frame) => frame.color === current)!.at - clicked,
      });
    }
    if (
      !latency.some((sample) => sample.attachment === "reused") ||
      latency.at(-1)?.attachment !== "fresh"
    ) {
      throw Error("Expected a reused attachment and a fresh attachment after expiry");
    }
    writeFileSync(join(out, "attach-continuity.json"), JSON.stringify(continuity, null, 2));
    for (const [index, { outgoing, cachedTarget, target, frames }] of continuity.entries()) {
      const phases = [outgoing, cachedTarget, target];
      let phase = 0;
      for (const color of frames) {
        const next = phases.indexOf(color);
        if (next < phase)
          throw Error(`Switch ${index} displayed an intermediate or superseded frame: ${frames}`);
        phase = next;
      }
    }
    if (switches.some((samples) => samples.some((sample) => !sample.sameCanvas))) {
      throw Error("An attach replaced the pane's physical canvas");
    }
  } finally {
    win.webContents.endFrameSubscription();
    writeFileSync(join(out, "attach.finish"), "");
  }
  if (view === "swarm") {
    await read(`document.querySelector('[aria-label="LIST view"]').click()`);
    await until(linked, "the active session in the list");
  }
  return { switches, latency };
}
