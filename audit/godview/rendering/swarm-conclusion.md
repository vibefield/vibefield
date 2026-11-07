# Swarm conclusion

Pinned source `748d015a7e393112e0a91dad80111fdf5abe6583`, unmodified. Chrome `156.0.8078.47`. The repro is `swarm-repro.html` and the trace is `swarm-lifecycle.json`. This note is the root-cause finding. It is separate from the matrix counts.

## Established: this host cannot create an adapter

On this machine, with `--enable-unsafe-webgpu --enable-unsafe-swiftshader` and Puppeteer's `--disable-gpu` removed, `navigator.gpu.requestAdapter({ powerPreference: "high-performance" })` returns null in 1–2 ms. `requestDevice` is not called. No shader is compiled. `device.destroy` is not called. `device.lost` does not fire.

The page console is exactly `Failed to create WebGPU Context Provider`. The GPU process exits during startup:

- `Extension not supported: VK_KHR_surface`
- `Extension not supported: VK_KHR_xcb_surface`
- `eglInitialize SwANGLE failed with error EGL_NOT_INITIALIZED`
- `Exiting GPU process due to errors during initialization`

The same null adapter happens headless and headed on Xvfb `:1`. `--use-angle=swiftshader`, `--use-gl=swiftshader`, `--use-vulkan=swiftshader` with `--disable-vulkan-surface`, and `--use-webgpu-adapter=swiftshader` also returned no adapter. `/opt/google/chrome/libvk_swiftshader.so` contains those extension names as strings. The instance ANGLE brought up did not advertise them.

Unmodified `createSwarmRenderer` then returns `{ ok: false, reason: "No WebGPU adapter on this GPU" }` from `swarm-renderer.ts:293-294`. That sentence is only returned there. Production makes one adapter request. Development StrictMode makes two. Neither gets a device, so the double-mount note at `swarm-renderer.ts:969-971` is not this failure.

This is a host GPU-process failure. It is not a shader error and not a cleanup race in the pinned source.

## Inconclusive: the earlier device-loss log

An earlier run on the same Chrome and the same flags, recorded in `webgpu-diagnostic.json`, is a different event:

- A bare page created a high-performance adapter and a device. That page did not call `getContext("webgpu")`.
- The integration swarm then logged exactly `[swarm] WebGPU device lost, rebuilding Device was destroyed.` and `A valid external Instance reference no longer exists.`
- Absent from that console: `[swarm] the renderer could not be built` and `[swarm] no WebGPU device`.
- The stage text was `WEBGPU UNAVAILABLE` / `No WebGPU adapter on this GPU`.

`AgentSwarm.tsx:511` is the only rebuild log. It runs only after `createSwarmRenderer` returned ok, and only while that effect is still alive and still owns the renderer. `Device was destroyed` is the lost message after `device.destroy()` (`swarm-renderer.ts:311`, `:327`, or `:972`). Effect cleanup at `AgentSwarm.tsx:525-528` sets `alive` false before `destroy()`, so that path does not log the rebuild. A shader failure returns `RENDERER_UNBUILT` after the warning at line 322, and that warning was not in the console.

So the recorded line means a renderer had been handed to a live effect and then its device was destroyed, and the rebuild's `requestAdapter` returned null. This session could not take a destroy stack: no adapter is created, so `device.destroy` is not called. It is not established whether that earlier destroy was the pinned source calling `device.destroy()` or the GPU process dying with the same message. That question is inconclusive.

## Untested

Shader and pipeline validation, resize (`swarm-renderer.ts:856`), and unmount against a live device. Whether an explicit `device.destroy()` makes the next `requestAdapter` null. A hardware GPU.
