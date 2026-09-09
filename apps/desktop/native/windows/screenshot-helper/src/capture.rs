use crate::d3d;
use crate::monitors::{self, Monitor};
use crate::protocol::HelperError;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::GetLastError;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateDCW, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
    DIB_RGB_COLORS, ROP_CODE, SRCCOPY,
};

use windows::core::HSTRING;
use windows::core::{IInspectable, Interface};
use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

const FRAME_TIMEOUT: Duration = Duration::from_secs(3);
const CAPTURE_BUDGET: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Wgc,
    Dxgi,
    Gdi,
    Synthetic,
}

#[derive(Debug, Clone)]
pub struct DisplaySnapshot {
    pub display_id: u32,
    pub x: i32,
    pub y: i32,
    pub screen_width: u32,
    pub screen_height: u32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub pixels_bgra: Vec<u8>,
    pub source: Source,
}

pub fn capture_all_displays(allow_synthetic: bool) -> Result<Vec<DisplaySnapshot>, HelperError> {
    let access = request_capture_access();
    let monitors = monitors::enumerate()?;
    for monitor in &monitors {
        eprintln!(
            "monitor {} {} {}x{} @ {},{} scale {}",
            monitor.display_id,
            monitor.device,
            monitor.width,
            monitor.height,
            monitor.x,
            monitor.y,
            monitor.scale
        );
    }
    let deadline = Instant::now() + CAPTURE_BUDGET;
    let wgc = WgcContext::new();
    let mut snapshots = Vec::with_capacity(monitors.len());
    let mut last_error = None;
    for monitor in monitors {
        match capture_monitor(&monitor, wgc.as_ref(), allow_synthetic, deadline) {
            Ok(snapshot) => snapshots.push(snapshot),
            Err(error) => {
                eprintln!(
                    "skipping display {} ({}): {error}",
                    monitor.display_id, monitor.device
                );
                last_error = Some(format!(
                    "Capture failed for display {}: {error}",
                    monitor.display_id
                ));
            }
        }
    }
    if snapshots.is_empty() {
        if allow_synthetic {
            eprintln!(
                "live capture produced no stills ({}); using helper-owned synthetic",
                last_error.unwrap_or_else(|| "no displays".into())
            );
            snapshots.push(synthetic_snapshot(1, 0, 0, 1280, 720, 1.0));
        } else {
            return Err(no_live_still(
                access,
                last_error.unwrap_or_else(|| "screen capture failed".into()),
            ));
        }
    }
    if !allow_synthetic && snapshots.iter().any(|s| s.source == Source::Synthetic) {
        return Err(no_live_still(
            access,
            "screen capture produced no live still",
        ));
    }
    Ok(snapshots)
}

/// What the OS said about programmatic capture. Only an explicit refusal is a
/// denial: an unpackaged helper normally gets `NotDeclaredByApp` and captures
/// perfectly well, so anything that is not a Denied* status is `Open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureAccess {
    Open,
    Denied(&'static str),
}

fn request_capture_access() -> CaptureAccess {
    use windows::Graphics::Capture::{GraphicsCaptureAccess, GraphicsCaptureAccessKind};
    use windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
    match GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Programmatic) {
        Ok(op) => match op.get() {
            Ok(status) => {
                eprintln!("graphics capture access: {status:?}");
                if status == AppCapabilityAccessStatus::DeniedBySystem {
                    CaptureAccess::Denied("screen capture is denied by system policy")
                } else if status == AppCapabilityAccessStatus::DeniedByUser {
                    CaptureAccess::Denied("screen capture was denied for this app")
                } else {
                    CaptureAccess::Open
                }
            }
            Err(error) => {
                eprintln!("graphics capture access get: {error}");
                CaptureAccess::Open
            }
        },
        Err(error) => {
            eprintln!("graphics capture access request: {error}");
            CaptureAccess::Open
        }
    }
}

/// Nothing live came back. If the OS refused capture, PermissionDenied is the
/// honest code and the host can say so; otherwise the chain simply failed.
fn no_live_still(access: CaptureAccess, message: impl Into<String>) -> HelperError {
    match access {
        CaptureAccess::Denied(reason) => {
            HelperError::permission_denied(format!("{} ({reason})", message.into()))
        }
        CaptureAccess::Open => HelperError::capture_failed(message),
    }
}

fn remaining_ms(deadline: Instant) -> u32 {
    deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .min(u128::from(u32::MAX)) as u32
}

fn capture_monitor(
    monitor: &Monitor,
    wgc: Option<&WgcContext>,
    allow_synthetic: bool,
    deadline: Instant,
) -> Result<DisplaySnapshot, String> {
    if Instant::now() < deadline {
        if let Some(wgc) = wgc {
            match wgc.capture(monitor, deadline) {
                Ok(snapshot) => return Ok(snapshot),
                Err(error) => eprintln!("WGC failed on {} ({})", monitor.device, error),
            }
        }
    }
    if Instant::now() < deadline {
        match capture_dxgi(monitor, remaining_ms(deadline).min(2500)) {
            Ok(snapshot) => return Ok(snapshot),
            Err(error) => eprintln!("DXGI failed on {}: {error}", monitor.device),
        }
    }
    match capture_gdi(monitor) {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => recover_monitor_still(monitor, error, allow_synthetic),
    }
}

fn recover_monitor_still(
    monitor: &Monitor,
    error: String,
    allow_synthetic: bool,
) -> Result<DisplaySnapshot, String> {
    if allow_synthetic {
        eprintln!(
            "GDI failed on {} ({}); using helper-owned synthetic still",
            monitor.device, error
        );
        Ok(synthetic_snapshot(
            monitor.display_id,
            monitor.x,
            monitor.y,
            monitor.width,
            monitor.height,
            monitor.scale,
        ))
    } else {
        Err(error)
    }
}

/// Packed BGRA still owned by the helper when the OS blocks live capture.
pub fn synthetic_bgra(width: u32, height: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            pixels[i] = (x % 256) as u8;
            pixels[i + 1] = (y % 256) as u8;
            pixels[i + 2] = (((x / 2) + (y / 3)) % 256) as u8;
            pixels[i + 3] = 255;
        }
    }
    pixels
}

fn synthetic_snapshot(
    display_id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> DisplaySnapshot {
    DisplaySnapshot {
        display_id,
        x,
        y,
        screen_width: width,
        screen_height: height,
        width,
        height,
        scale,
        pixels_bgra: synthetic_bgra(width, height),
        source: Source::Synthetic,
    }
}

struct WgcContext {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice,
    _queue: Option<windows::System::DispatcherQueueController>,
}

impl WgcContext {
    fn new() -> Option<Self> {
        let queue = windows::System::DispatcherQueueController::CreateOnDedicatedThread().ok();
        let device = d3d::create_d3d_device().ok()?;
        let context = unsafe { device.GetImmediateContext().ok()? };
        let winrt_device = d3d::create_direct3d_device(&device).ok()?;
        Some(Self {
            device,
            context,
            winrt_device,
            _queue: queue,
        })
    }

    fn capture(&self, monitor: &Monitor, deadline: Instant) -> Result<DisplaySnapshot, String> {
        let item = create_item_for_monitor(monitor.handle)?;
        self.capture_item(monitor, item, deadline)
    }

    fn capture_item(
        &self,
        monitor: &Monitor,
        item: GraphicsCaptureItem,
        deadline: Instant,
    ) -> Result<DisplaySnapshot, String> {
        let size = item.Size().map_err(|error| format!("item size: {error}"))?;
        if size.Width <= 0 || size.Height <= 0 {
            return Err("capture item has empty size".into());
        }

        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &self.winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            size,
        )
        .map_err(|error| format!("frame pool: {error}"))?;
        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(|error| format!("session: {error}"))?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);

        let (sender, receiver) = mpsc::channel();
        frame_pool
            .FrameArrived(
                &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new({
                    move |pool, _| {
                        if let Some(pool) = pool.as_ref() {
                            if let Ok(frame) = pool.TryGetNextFrame() {
                                let _ = sender.send(frame);
                            }
                        }
                        Ok(())
                    }
                }),
            )
            .map_err(|error| format!("FrameArrived: {error}"))?;
        session
            .StartCapture()
            .map_err(|error| format!("StartCapture: {error}"))?;

        let timeout = FRAME_TIMEOUT.min(deadline.saturating_duration_since(Instant::now()));
        if timeout.is_zero() {
            return Err("capture budget exhausted".into());
        }
        let frame = wait_for_frame(&receiver, timeout)?;

        let surface = frame
            .Surface()
            .map_err(|error| format!("surface: {error}"))?;
        let source_texture: ID3D11Texture2D = get_d3d_interface(&surface)?;
        let pixels = copy_texture_bgra(&self.device, &self.context, &source_texture)?;

        let _ = session.Close();
        let _ = frame_pool.Close();

        if pixels.width == 0 || pixels.height == 0 {
            return Err("WGC returned an empty texture".into());
        }

        Ok(DisplaySnapshot {
            display_id: monitor.display_id,
            x: monitor.x,
            y: monitor.y,
            screen_width: monitor.width,
            screen_height: monitor.height,
            width: pixels.width,
            height: pixels.height,
            scale: monitor.scale,
            pixels_bgra: pixels.bytes,
            source: Source::Wgc,
        })
    }
}

// Scalars, not a RECT and a Monitor, so the DXGI/monitor match stays unit-
// testable on a host with no Win32 types to hand.
#[allow(clippy::too_many_arguments)]
pub fn output_matches_monitor(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> bool {
    left == monitor_x
        && top == monitor_y
        && (right - left) as u32 == monitor_width
        && (bottom - top) as u32 == monitor_height
}

fn capture_dxgi(monitor: &Monitor, timeout_ms: u32) -> Result<DisplaySnapshot, String> {
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1, IDXGIResource,
        DXGI_OUTDUPL_FRAME_INFO,
    };

    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1() }.map_err(|error| format!("CreateDXGIFactory1: {error}"))?;
    let mut last = "no DXGI outputs".to_string();
    let mut adapter_index = 0u32;
    loop {
        let adapter: IDXGIAdapter1 = match unsafe { factory.EnumAdapters1(adapter_index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        adapter_index += 1;
        let mut output_index = 0u32;
        loop {
            let output = match unsafe { adapter.EnumOutputs(output_index) } {
                Ok(output) => output,
                Err(_) => break,
            };
            output_index += 1;
            let desc = match unsafe { output.GetDesc() } {
                Ok(desc) => desc,
                Err(error) => {
                    last = format!("GetDesc: {error}");
                    continue;
                }
            };
            let rect = desc.DesktopCoordinates;
            eprintln!(
                "dxgi adapter {adapter_index} output {output_index} {}x{} @ {},{}",
                rect.right - rect.left,
                rect.bottom - rect.top,
                rect.left,
                rect.top
            );
            if !output_matches_monitor(
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                monitor.x,
                monitor.y,
                monitor.width,
                monitor.height,
            ) {
                continue;
            }
            let mut device: Option<ID3D11Device> = None;
            if unsafe {
                D3D11CreateDevice(
                    &adapter,
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    Some(&[D3D_FEATURE_LEVEL_11_0]),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    None,
                )
            }
            .is_err()
            {
                last = "D3D11CreateDevice on output adapter failed".into();
                continue;
            }
            let Some(device) = device else {
                last = "D3D device on output adapter was null".into();
                continue;
            };
            let context = match unsafe { device.GetImmediateContext() } {
                Ok(context) => context,
                Err(error) => {
                    last = format!("GetImmediateContext: {error}");
                    continue;
                }
            };
            let output1: IDXGIOutput1 = match output.cast() {
                Ok(item) => item,
                Err(error) => {
                    last = format!("IDXGIOutput1: {error}");
                    continue;
                }
            };
            let dup = match unsafe { output1.DuplicateOutput(&device) } {
                Ok(dup) => dup,
                Err(error) => {
                    last = format!("DuplicateOutput: {error}");
                    continue;
                }
            };
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            let wait = timeout_ms.clamp(1, 2500);
            if let Err(error) = unsafe { dup.AcquireNextFrame(wait, &mut info, &mut resource) } {
                last = format!("AcquireNextFrame: {error}");
                continue;
            }
            let Some(resource) = resource else {
                last = "AcquireNextFrame returned no resource".into();
                let _ = unsafe { dup.ReleaseFrame() };
                continue;
            };
            let texture: ID3D11Texture2D = match resource.cast() {
                Ok(texture) => texture,
                Err(error) => {
                    last = format!("desktop texture: {error}");
                    let _ = unsafe { dup.ReleaseFrame() };
                    continue;
                }
            };
            let pixels = copy_texture_bgra(&device, &context, &texture);
            let _ = unsafe { dup.ReleaseFrame() };
            let pixels = pixels?;
            return Ok(DisplaySnapshot {
                display_id: monitor.display_id,
                x: monitor.x,
                y: monitor.y,
                screen_width: monitor.width,
                screen_height: monitor.height,
                width: pixels.width,
                height: pixels.height,
                scale: monitor.scale,
                pixels_bgra: pixels.bytes,
                source: Source::Dxgi,
            });
        }
    }
    Err(last)
}

struct PackedBgra {
    width: u32,
    height: u32,
    bytes: Vec<u8>,
}

fn wait_for_frame(
    receiver: &std::sync::mpsc::Receiver<windows::Graphics::Capture::Direct3D11CaptureFrame>,
    timeout: Duration,
) -> Result<windows::Graphics::Capture::Direct3D11CaptureFrame, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };
    let start = Instant::now();
    loop {
        if let Ok(frame) = receiver.try_recv() {
            return Ok(frame);
        }
        if start.elapsed() > timeout {
            return Err("timed out waiting for a capture frame".into());
        }
        let mut message = MSG::default();
        unsafe {
            if PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

fn create_item_for_monitor(
    handle: windows::Win32::Graphics::Gdi::HMONITOR,
) -> Result<GraphicsCaptureItem, String> {
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|error| format!("capture interop: {error}"))?;
    unsafe { interop.CreateForMonitor(handle) }
        .map_err(|error| format!("CreateForMonitor: {error}"))
}

fn get_d3d_interface<T: Interface>(object: &impl Interface) -> Result<T, String> {
    let access: IDirect3DDxgiInterfaceAccess = object
        .cast()
        .map_err(|error| format!("DxgiInterfaceAccess: {error}"))?;
    unsafe { access.GetInterface::<T>() }.map_err(|error| format!("GetInterface: {error}"))
}

fn copy_texture_bgra(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    source: &ID3D11Texture2D,
) -> Result<PackedBgra, String> {
    unsafe {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        source.GetDesc(&mut desc);
        desc.BindFlags = 0;
        desc.MiscFlags = 0;
        desc.Usage = D3D11_USAGE_STAGING;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;

        let mut staging = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut staging))
            .map_err(|error| format!("CreateTexture2D: {error}"))?;
        let staging = staging.ok_or_else(|| "staging texture was null".to_string())?;

        let dest: ID3D11Resource = staging
            .cast()
            .map_err(|error| format!("staging resource: {error}"))?;
        let src: ID3D11Resource = source
            .cast()
            .map_err(|error| format!("source resource: {error}"))?;
        context.CopyResource(Some(&dest), Some(&src));

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context
            .Map(Some(&dest), 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(|error| format!("Map: {error}"))?;

        let width = desc.Width;
        let height = desc.Height;
        let stride = mapped.RowPitch as usize;
        let row_bytes = (width as usize) * 4;
        let src_slice =
            std::slice::from_raw_parts(mapped.pData as *const u8, stride * height as usize);
        let mut bytes = vec![0u8; row_bytes * height as usize];
        for row in 0..height as usize {
            let src = &src_slice[row * stride..row * stride + row_bytes];
            let dest = &mut bytes[row * row_bytes..(row + 1) * row_bytes];
            dest.copy_from_slice(src);
        }
        context.Unmap(Some(&dest), 0);

        Ok(PackedBgra {
            width,
            height,
            bytes,
        })
    }
}

fn capture_gdi(monitor: &Monitor) -> Result<DisplaySnapshot, String> {
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("GetDC failed".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        if mem.is_invalid() {
            ReleaseDC(None, screen);
            return Err("CreateCompatibleDC failed".into());
        }
        let bitmap = CreateCompatibleBitmap(screen, monitor.width as i32, monitor.height as i32);
        if bitmap.is_invalid() {
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            return Err("CreateCompatibleBitmap failed".into());
        }
        let old = SelectObject(mem, bitmap.into());
        let copied = blit_monitor(mem, screen, monitor);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: monitor.width as i32,
                biHeight: -(monitor.height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (monitor.width as usize) * (monitor.height as usize) * 4];
        let lines = if copied {
            GetDIBits(
                mem,
                bitmap,
                0,
                monitor.height,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        SelectObject(mem, old);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);

        if !copied {
            return Err("BitBlt failed".into());
        }
        if lines == 0 {
            return Err("GetDIBits failed".into());
        }

        Ok(DisplaySnapshot {
            display_id: monitor.display_id,
            x: monitor.x,
            y: monitor.y,
            screen_width: monitor.width,
            screen_height: monitor.height,
            width: monitor.width,
            height: monitor.height,
            scale: monitor.scale,
            pixels_bgra: pixels,
            source: Source::Gdi,
        })
    }
}

unsafe fn blit_monitor(
    dest: windows::Win32::Graphics::Gdi::HDC,
    screen: windows::Win32::Graphics::Gdi::HDC,
    monitor: &Monitor,
) -> bool {
    let w = monitor.width as i32;
    let h = monitor.height as i32;
    let capture = ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0);
    let try_blit =
        |src: windows::Win32::Graphics::Gdi::HDC, x: i32, y: i32, rop: ROP_CODE, tag: &str| {
            match BitBlt(dest, 0, 0, w, h, Some(src), x, y, rop) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("blit {tag} failed: {error} last={}", GetLastError().0);
                    false
                }
            }
        };

    let device = HSTRING::from(monitor.device.as_str());
    let device_dc = CreateDCW(None, &device, None, None);
    if !device_dc.is_invalid() {
        let ok = try_blit(device_dc, 0, 0, SRCCOPY, "createdc-src")
            || try_blit(device_dc, 0, 0, capture, "createdc-capture");
        let _ = DeleteDC(device_dc);
        if ok {
            return true;
        }
    } else {
        eprintln!(
            "CreateDCW({}) failed last={}",
            monitor.device,
            GetLastError().0
        );
    }

    try_blit(screen, monitor.x, monitor.y, SRCCOPY, "screendc-src")
        || try_blit(screen, monitor.x, monitor.y, capture, "screendc-capture")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{Point, Rect};

    #[test]
    fn dxgi_output_must_match_this_monitor() {
        assert!(output_matches_monitor(0, 0, 1920, 1080, 0, 0, 1920, 1080));
        assert!(!output_matches_monitor(
            1920, 0, 3840, 1080, 0, 0, 1920, 1080
        ));
        assert!(!output_matches_monitor(0, 0, 800, 600, 0, 0, 1920, 1080));
    }

    fn dummy_monitor() -> Monitor {
        Monitor {
            handle: windows::Win32::Graphics::Gdi::HMONITOR::default(),
            display_id: 1,
            x: 0,
            y: 0,
            width: 64,
            height: 48,
            scale: 1.0,
            device: r"\\.\DISPLAY1".into(),
        }
    }

    #[test]
    fn once_path_does_not_invent_a_still() {
        let monitor = dummy_monitor();
        assert!(recover_monitor_still(&monitor, "BitBlt failed".into(), false).is_err());
        let still = recover_monitor_still(&monitor, "BitBlt failed".into(), true).unwrap();
        assert_eq!(still.source, Source::Synthetic);
        assert_eq!((still.width, still.height), (64, 48));
    }

    #[test]
    fn live_once_capture_never_returns_synthetic() {
        // A host with no capturable display answers Err; the claim is only about
        // what a SUCCESSFUL once-capture may contain.
        if let Ok(shots) = capture_all_displays(false) {
            assert!(!shots.is_empty());
            assert!(shots.iter().all(|shot| shot.source != Source::Synthetic));
        }
    }

    #[test]
    fn synthetic_still_encodes_png_and_samples() {
        let width = 48u32;
        let height = 32u32;
        let pixels = synthetic_bgra(width, height);
        assert_eq!(pixels.len(), (width * height * 4) as usize);
        assert_ne!(&pixels[0..4], &pixels[4..8]);
        let png = crate::png::encode_bgra(width, height, &pixels).expect("encode synthetic");
        assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G']);
        let view = Rect::from_xywh(0.0, 0.0, width as f64, height as f64);
        let at = crate::sample::sample(&pixels, width, height, view, Point { x: 3.2, y: 1.1 })
            .expect("sample synthetic");
        assert_eq!((at.x, at.y), (3, 1));
        assert_eq!(at.b, 3);
        assert_eq!(at.g, 1);
    }
}
