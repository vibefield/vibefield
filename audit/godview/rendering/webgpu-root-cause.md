# Swarm WebGPU root cause

Pinned source `748d015a7e393112e0a91dad80111fdf5abe6583`, unmodified. Chrome `156.0.8078.47`. No swarm body was drawn. The 73 / 302 / 35 figures were the matrix at the time of this note. They are not a validated not-applicable count. The matrix correction is separate (`matrix-correction.md`).

The trace is `swarm-lifecycle.json`. The instrumentation in `src/swarm-repro.ts` records adapter, device, destroy, lost, and uncaptured-error events and then calls the original functions. `createSwarmRenderer` and `AgentSwarm` are the pinned sources.

## What this session reproduced

Bare `requestAdapter({ powerPreference: 'high-performance' })` returns null in 1–2 ms. `requestDevice` is not called. Nothing destroys a device, `device.lost` does not fire, and no shader is compiled.

The page console is exactly `Failed to create WebGPU Context Provider`. The GPU process exits during startup:

- `Extension not supported: VK_KHR_surface`
- `Extension not supported: VK_KHR_xcb_surface`
- `eglInitialize SwANGLE failed with error EGL_NOT_INITIALIZED`
- `Exiting GPU process due to errors during initialization`

`/opt/google/chrome/libvk_swiftshader.so` contains those extension names as strings. The instance ANGLE brought up did not advertise them. The same null adapter happens headless and headed on the live Xvfb display `:1`. These flag sets also returned no adapter: `--use-angle=swiftshader`, `--use-gl=swiftshader`, `--use-vulkan=swiftshader` with `--disable-vulkan-surface`, and `--use-webgpu-adapter=swiftshader`.

`createSwarmRenderer` then returns `{ ok: false, reason: "No WebGPU adapter on this GPU" }` from `swarm-renderer.ts:293-294`. The React host, production and Vite development, shows `WEBGPU UNAVAILABLE` plus that sentence. Development StrictMode issues the adapter request twice. Production issues it once. Neither reaches a device, so the double-mount note at `swarm-renderer.ts:969-971` was not the failure.

This is a host GPU-process failure. It is not a shader error and not a cleanup race.

## What the earlier launch actually logged

Preserved, same Chrome and the same unsafe-WebGPU flags, before this GPU process started exiting:

- Bare page: high-performance adapter true, device true. That page did not call `getContext('webgpu')`.
- Integration swarm console, exactly: `[swarm] WebGPU device lost, rebuilding Device was destroyed.` and `A valid external Instance reference no longer exists.`
- Absent from that console: `[swarm] the renderer could not be built` and `[swarm] no WebGPU device`.
- Visible text: `WEBGPU UNAVAILABLE` / `No WebGPU adapter on this GPU`.

`No WebGPU adapter on this GPU` is only returned at `swarm-renderer.ts:294`. A shader or pipeline failure returns `RENDERER_UNBUILT` (`swarm-renderer.ts:145`) after the warning at line 322, and a missing canvas context returns `The canvas has no WebGPU context` at line 312. Neither of those sentences was the recorded stage text, and the shader warning was not in the console.

The rebuild line is `AgentSwarm.tsx:511`. It runs only after `createSwarmRenderer` has returned ok, and only while that effect is still alive and still owns the renderer. `Device was destroyed` is the lost message after `device.destroy()` (`swarm-renderer.ts:311`, `:327`, or `:972`). Effect cleanup at `AgentSwarm.tsx:525-528` sets `alive` false before `destroy()`, so that path does not log the rebuild. The recorded line means a renderer that had already been handed to a live effect then had its device destroyed, and the rebuild's `requestAdapter` returned null. The Dawn line `A valid external Instance reference no longer exists.` is that instance dying with it.

This session could not take a destroy stack for that launch. No adapter was created, so `device.destroy` was not called.

## Untested

Shader and pipeline validation, resize (`swarm-renderer.ts:856`), and unmount against a live device. Whether an explicit `device.destroy()` makes the next `requestAdapter` null. A hardware GPU. The destroy stack of the earlier process.
