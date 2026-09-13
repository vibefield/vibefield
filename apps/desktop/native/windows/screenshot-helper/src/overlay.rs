use crate::annotate::{self, Annotation, Tool};
use crate::capture::DisplaySnapshot;
use crate::clipboard;
use crate::geometry::{self, Handle, Point, Rect};
use crate::protocol::HostBounds;
use crate::sample;
use crate::snap::WindowSnap;
use crate::toolbar::{self, Action};
use std::mem::size_of;
use std::ptr::null_mut;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT as WinRect, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, CreatePen,
    CreateRoundRectRgn, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, Ellipse, EndPaint,
    GetDC, GetStockObject, InvalidateRect, LineTo, MoveToEx, ReleaseDC, SelectClipRgn,
    SelectObject, SetBkMode, SetStretchBltMode, SetTextColor, StretchBlt, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, COLORONCOLOR, DIB_RGB_COLORS, DT_CENTER, DT_SINGLELINE, DT_VCENTER,
    HBITMAP, HDC, HGDIOBJ, NULL_BRUSH, NULL_PEN, PAINTSTRUCT, PS_SOLID, SRCCOPY, SYSTEM_FONT,
    TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, ReleaseCapture, SetCapture, SetFocus, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
    VK_CONTROL, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
    GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowThreadProcessId, LoadCursorW,
    PostMessageW, PostQuitMessage, RegisterClassExW, SetCursor, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, TranslateMessage, CS_DBLCLKS, CS_HREDRAW,
    CS_VREDRAW, GWLP_USERDATA, HWND_TOPMOST, IDC_ARROW, IDC_CROSS, IDC_SIZEALL, IDC_SIZENESW,
    IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE, MSG, SWP_SHOWWINDOW, SW_SHOW, WM_APP, WM_DESTROY,
    WM_ERASEBKGND, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SETCURSOR, WNDCLASSEXW,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

const CLASS: PCWSTR = w!("VibeFieldScreenshotOverlay");
const HANDLE_SIZE: f64 = 8.0;
const SELECT_COLOR: COLORREF = COLORREF(74 | (144 << 8) | (217 << 16));
const HANDLE_FILL: COLORREF = COLORREF(0x00FFFFFF);
const BADGE_BG: COLORREF = COLORREF(28 | (28 << 8) | (30 << 16));
const BADGE_FG: COLORREF = COLORREF(0x00FFFFFF);
const WM_SMOKE: u32 = WM_APP + 1;
const WM_MOUSELEAVE: u32 = 675;

#[derive(Clone, Copy)]
pub enum Smoke {
    Confirm,
    Cancel,
    Snap,
}

pub struct ConfirmedShot {
    pub display_id: u32,
    pub scale: f64,
    pub bounds: HostBounds,
    pub width: u32,
    pub height: u32,
    pub pixels_bgra: Vec<u8>,
}

pub enum OverlayOutcome {
    Confirmed(ConfirmedShot),
    Cancelled,
}

enum Mode {
    Idle,
    Dragging,
    Selected,
    Annotating,
}

struct GdiBitmap {
    handle: HBITMAP,
    width: i32,
    height: i32,
    bits: *mut u8,
}

struct MarkedCache {
    selection: Rect,
    marks: usize,
    bitmap: GdiBitmap,
}

impl GdiBitmap {
    fn from_bgra(width: u32, height: u32, bgra: &[u8]) -> Result<Self, String> {
        let expected = width as usize * height as usize * 4;
        if bgra.len() != expected {
            return Err("bitmap pixel length mismatch".into());
        }
        unsafe {
            let hdc = GetDC(None);
            if hdc.is_invalid() {
                return Err("GetDC failed for DIB".into());
            }
            let mut bits = null_mut();
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let handle = CreateDIBSection(Some(hdc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                .map_err(|error| {
                    ReleaseDC(None, hdc);
                    format!("CreateDIBSection: {error}")
                })?;
            ReleaseDC(None, hdc);
            if bits.is_null() {
                return Err("CreateDIBSection bits were null".into());
            }
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
            Ok(Self {
                handle,
                width: width as i32,
                height: height as i32,
                bits: bits as *mut u8,
            })
        }
    }

    fn blank(width: u32, height: u32) -> Result<Self, String> {
        unsafe {
            let hdc = GetDC(None);
            if hdc.is_invalid() {
                return Err("GetDC failed for DIB".into());
            }
            let mut bits = null_mut();
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let handle = CreateDIBSection(Some(hdc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                .map_err(|error| {
                    ReleaseDC(None, hdc);
                    format!("CreateDIBSection: {error}")
                })?;
            ReleaseDC(None, hdc);
            if bits.is_null() {
                return Err("CreateDIBSection bits were null".into());
            }
            Ok(Self {
                handle,
                width: width as i32,
                height: height as i32,
                bits: bits as *mut u8,
            })
        }
    }

    fn write_bgra(&mut self, bgra: &[u8]) -> bool {
        let expected = self.width as usize * self.height as usize * 4;
        if bgra.len() != expected || self.bits.is_null() {
            return false;
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), self.bits, bgra.len());
        }
        true
    }
}

impl Drop for GdiBitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.handle.into());
        }
    }
}

struct Overlay {
    hwnd: HWND,
    snapshot: DisplaySnapshot,
    original: GdiBitmap,
    dimmed: GdiBitmap,
    snap: WindowSnap,
    hover: Option<Rect>,
    tracking: bool,
    mode: Mode,
    selection: Option<Rect>,
    drag_start: Point,
    drag_current: Point,
    active_handle: Option<Handle>,
    moving: bool,
    space_held: bool,
    last_mouse: Point,
    tool: Tool,
    annotations: Vec<Annotation>,
    current: Option<Annotation>,
    toolbar_pressed: bool,
    pending_action: Option<Action>,
    backbuffer: Option<GdiBitmap>,
    marked: Option<MarkedCache>,
    loupe_bitmap: Option<GdiBitmap>,
}

struct Session {
    overlays: Vec<Overlay>,
    outcome: Option<Outcome>,
    saving: bool,
}

enum Outcome {
    Confirm(usize),
    Cancel,
}

pub fn run(
    snapshots: Vec<DisplaySnapshot>,
    smoke: Option<Smoke>,
) -> Result<OverlayOutcome, String> {
    if snapshots.is_empty() {
        return Err("no snapshots".into());
    }
    register_class()?;

    let displays: Vec<Rect> = snapshots
        .iter()
        .map(|snapshot| {
            Rect::from_xywh(
                snapshot.x as f64,
                snapshot.y as f64,
                snapshot.screen_width as f64,
                snapshot.screen_height as f64,
            )
        })
        .collect();
    let snap = WindowSnap::capture_excluding_self(&displays);

    let mut session = Session {
        overlays: Vec::new(),
        outcome: None,
        saving: false,
    };

    for snapshot in snapshots {
        let overlay = create_overlay(snapshot, &mut session as *mut Session, snap.clone())?;
        session.overlays.push(overlay);
    }

    if let Some(first) = session.overlays.first() {
        force_foreground(first.hwnd);
    }
    crate::protocol::ready();

    if let Some(kind) = smoke {
        if let Some(first) = session.overlays.first() {
            let _ = unsafe {
                PostMessageW(
                    Some(first.hwnd),
                    WM_SMOKE,
                    WPARAM(kind_to_wparam(kind)),
                    LPARAM(0),
                )
            };
        }
    }

    let mut message = MSG::default();
    unsafe {
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    match session.outcome {
        Some(Outcome::Cancel) | None => Ok(OverlayOutcome::Cancelled),
        Some(Outcome::Confirm(index)) => confirm_overlay(&session.overlays[index]),
    }
}

fn kind_to_wparam(kind: Smoke) -> usize {
    match kind {
        Smoke::Confirm => 1,
        Smoke::Cancel => 2,
        Smoke::Snap => 3,
    }
}

fn register_class() -> Result<(), String> {
    unsafe {
        let instance =
            GetModuleHandleW(None).map_err(|error| format!("GetModuleHandleW: {error}"))?;
        let class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: CS_DBLCLKS | CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            hCursor: LoadCursorW(None, IDC_CROSS).unwrap_or_default(),
            lpszClassName: CLASS,
            ..Default::default()
        };
        if RegisterClassExW(&class) == 0 {
            let err = windows::core::Error::from_win32();
            if err.code().0 & 0xFFFF == 1410 {
                Ok(())
            } else {
                Err(format!("RegisterClassExW: {err}"))
            }
        } else {
            Ok(())
        }
    }
}

fn create_overlay(
    snapshot: DisplaySnapshot,
    session: *mut Session,
    snap: WindowSnap,
) -> Result<Overlay, String> {
    let dimmed_pixels = dim_bgra(&snapshot.pixels_bgra);
    let original = GdiBitmap::from_bgra(snapshot.width, snapshot.height, &snapshot.pixels_bgra)?;
    let dimmed = GdiBitmap::from_bgra(snapshot.width, snapshot.height, &dimmed_pixels)?;

    let instance =
        unsafe { GetModuleHandleW(None).map_err(|error| format!("GetModuleHandleW: {error}"))? };
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            CLASS,
            w!(""),
            WS_POPUP,
            snapshot.x,
            snapshot.y,
            snapshot.screen_width as i32,
            snapshot.screen_height as i32,
            None,
            None,
            Some(instance.into()),
            Some(session as *const _),
        )
        .map_err(|error| format!("CreateWindowExW: {error}"))?
    };

    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, session as isize);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            snapshot.x,
            snapshot.y,
            snapshot.screen_width as i32,
            snapshot.screen_height as i32,
            SWP_SHOWWINDOW,
        );
        let _ = ShowWindow(hwnd, SW_SHOW);
    }

    Ok(Overlay {
        hwnd,
        snapshot,
        original,
        dimmed,
        snap,
        hover: None,
        tracking: false,
        mode: Mode::Idle,
        selection: None,
        drag_start: Point { x: 0.0, y: 0.0 },
        drag_current: Point { x: 0.0, y: 0.0 },
        active_handle: None,
        moving: false,
        space_held: false,
        last_mouse: Point { x: 0.0, y: 0.0 },
        tool: Tool::None,
        annotations: Vec::new(),
        current: None,
        toolbar_pressed: false,
        pending_action: None,
        backbuffer: None,
        marked: None,
        loupe_bitmap: None,
    })
}

impl Drop for Overlay {
    fn drop(&mut self) {
        self.destroy();
    }
}

impl Overlay {
    fn destroy(&mut self) {
        if self.hwnd.is_invalid() {
            return;
        }
        unsafe {
            SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
            let hwnd = self.hwnd;
            self.hwnd = HWND::default();
            let _ = DestroyWindow(hwnd);
        }
    }
}

fn dim_bgra(src: &[u8]) -> Vec<u8> {
    let mut out = src.to_vec();
    for pixel in out.chunks_exact_mut(4) {
        pixel[0] = ((pixel[0] as u16 * 153) / 255) as u8;
        pixel[1] = ((pixel[1] as u16 * 153) / 255) as u8;
        pixel[2] = ((pixel[2] as u16 * 153) / 255) as u8;
        pixel[3] = 255;
    }
    out
}

fn force_foreground(hwnd: HWND) {
    unsafe {
        let foreground = GetForegroundWindow();
        let mut fg_pid = 0u32;
        let fg_thread = GetWindowThreadProcessId(foreground, Some(&mut fg_pid));
        let this_thread = GetCurrentThreadId();
        let _ = AttachThreadInput(fg_thread, this_thread, true);
        let _ = SetForegroundWindow(hwnd);
        let _ = SetFocus(Some(hwnd));
        let _ = AttachThreadInput(fg_thread, this_thread, false);
    }
}

fn view_bounds(overlay: &Overlay) -> Rect {
    Rect::from_xywh(
        0.0,
        0.0,
        overlay.snapshot.screen_width as f64,
        overlay.snapshot.screen_height as f64,
    )
}

fn confirm_overlay(overlay: &Overlay) -> Result<OverlayOutcome, String> {
    let selection = overlay
        .selection
        .filter(|rect| rect.width >= 4.0 && rect.height >= 4.0)
        .ok_or_else(|| "no selection".to_string())?;
    let (width, height, pixels) = annotate::composite(
        &overlay.snapshot.pixels_bgra,
        overlay.snapshot.width,
        overlay.snapshot.height,
        view_bounds(overlay),
        selection,
        &overlay.annotations,
    )?;
    Ok(OverlayOutcome::Confirmed(ConfirmedShot {
        display_id: overlay.snapshot.display_id,
        scale: overlay.snapshot.scale,
        bounds: HostBounds {
            x: selection.x,
            y: selection.y,
            width: selection.width,
            height: selection.height,
        },
        width,
        height,
        pixels_bgra: pixels,
    }))
}

unsafe extern "system" fn wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == windows::Win32::UI::WindowsAndMessaging::WM_NCCREATE {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
    let session = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut Session;
    if session.is_null() {
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    }
    unsafe { (*session).on_message(hwnd, message, wparam, lparam) }
}

impl Session {
    fn input_locked(&self) -> bool {
        self.saving || self.outcome.is_some()
    }

    fn overlay_index(&self, hwnd: HWND) -> Option<usize> {
        self.overlays
            .iter()
            .position(|overlay| overlay.hwnd == hwnd)
    }

    unsafe fn on_message(
        &mut self,
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_ERASEBKGND => LRESULT(1),
            WM_PAINT => {
                if let Some(index) = self.overlay_index(hwnd) {
                    paint(&mut self.overlays[index]);
                }
                LRESULT(0)
            }
            WM_SETCURSOR => {
                if let Some(index) = self.overlay_index(hwnd) {
                    update_cursor(&self.overlays[index]);
                }
                LRESULT(1)
            }
            WM_LBUTTONDOWN => {
                if self.input_locked() {
                    return LRESULT(0);
                }
                if let Some(index) = self.overlay_index(hwnd) {
                    let point = point_from_lparam(lparam);
                    if self.overlays[index].toolbar_contains(point) {
                        unsafe {
                            let _ = SetCapture(hwnd);
                        }
                        self.overlays[index].toolbar_pressed = true;
                        self.overlays[index].pending_action =
                            self.overlays[index].toolbar_hit(point);
                        invalidate(hwnd);
                    } else {
                        self.overlays[index].toolbar_pressed = false;
                        self.overlays[index].pending_action = None;
                        self.overlays[index].mouse_down(point, false);
                        invalidate(hwnd);
                    }
                }
                LRESULT(0)
            }
            WM_LBUTTONDBLCLK => {
                if self.input_locked() {
                    return LRESULT(0);
                }
                if let Some(index) = self.overlay_index(hwnd) {
                    let point = point_from_lparam(lparam);
                    if self.overlays[index].toolbar_contains(point) {
                        return LRESULT(0);
                    }
                    self.overlays[index].mouse_down(point, true);
                    if self.overlays[index].tool == Tool::None
                        && matches!(self.overlays[index].mode, Mode::Selected)
                        && self.overlays[index].selection.is_some()
                    {
                        self.finish(Outcome::Confirm(index));
                    } else {
                        invalidate(hwnd);
                    }
                }
                LRESULT(0)
            }
            WM_MOUSEMOVE => {
                if let Some(index) = self.overlay_index(hwnd) {
                    let point = point_from_lparam(lparam);
                    self.overlays[index].ensure_track();
                    self.overlays[index].mouse_move(point);
                    invalidate(hwnd);
                }
                LRESULT(0)
            }
            WM_MOUSELEAVE => {
                if let Some(index) = self.overlay_index(hwnd) {
                    self.overlays[index].tracking = false;
                    if matches!(self.overlays[index].mode, Mode::Idle) {
                        self.overlays[index].hover = None;
                        invalidate(hwnd);
                    }
                }
                LRESULT(0)
            }
            WM_LBUTTONUP => {
                if let Some(index) = self.overlay_index(hwnd) {
                    let point = point_from_lparam(lparam);
                    if self.overlays[index].toolbar_pressed {
                        self.overlays[index].toolbar_pressed = false;
                        unsafe {
                            let _ = ReleaseCapture();
                        }
                        let pressed = self.overlays[index].pending_action.take();
                        if !self.input_locked() {
                            if let Some(action) = toolbar::commit(
                                self.overlays[index].toolbar_origin(),
                                pressed,
                                point,
                            ) {
                                self.apply_action(index, action);
                            }
                        }
                    } else if !self.input_locked() {
                        self.overlays[index].mouse_up(point);
                        invalidate(hwnd);
                    }
                }
                LRESULT(0)
            }
            WM_RBUTTONDOWN => LRESULT(0),
            WM_RBUTTONUP => {
                if !self.input_locked() {
                    self.finish(Outcome::Cancel);
                }
                LRESULT(0)
            }
            WM_KEYDOWN => {
                if self.input_locked() {
                    return LRESULT(0);
                }
                let vk = wparam.0 as i32;
                if vk == VK_ESCAPE.0 as i32 {
                    self.finish(Outcome::Cancel);
                    return LRESULT(0);
                }
                if let Some(index) = self.overlay_index(hwnd) {
                    if vk == VK_SPACE.0 as i32 {
                        self.overlays[index].space_held = true;
                        return LRESULT(0);
                    }
                    if vk == VK_RETURN.0 as i32 {
                        if self.overlays[index].selection.is_some() {
                            self.finish(Outcome::Confirm(index));
                        }
                        return LRESULT(0);
                    }
                    if self.overlays[index].loupe_visible()
                        && (vk == 0x31 || vk == 0x32 || vk == 0x33)
                    {
                        self.overlays[index].copy_sample_field(vk);
                        return LRESULT(0);
                    }
                    let control = GetKeyState(VK_CONTROL.0 as i32) < 0;
                    if control && vk == 0x5A {
                        annotate::undo(&mut self.overlays[index].annotations);
                        invalidate(hwnd);
                        return LRESULT(0);
                    }
                    if control && vk == 0x53 {
                        self.save_overlay(index);
                        return LRESULT(0);
                    }
                    if matches!(
                        vk,
                        x if x == VK_LEFT.0 as i32
                            || x == VK_RIGHT.0 as i32
                            || x == VK_UP.0 as i32
                            || x == VK_DOWN.0 as i32
                    ) {
                        let shift = GetKeyState(VK_SHIFT.0 as i32) < 0;
                        self.overlays[index].nudge(vk, shift);
                        invalidate(hwnd);
                        return LRESULT(0);
                    }
                }
                LRESULT(0)
            }
            WM_KEYUP => {
                if wparam.0 as i32 == VK_SPACE.0 as i32 {
                    if let Some(index) = self.overlay_index(hwnd) {
                        self.overlays[index].space_held = false;
                    }
                }
                LRESULT(0)
            }
            WM_SMOKE => {
                match wparam.0 {
                    1 => {
                        if let Some(index) = self.overlay_index(hwnd) {
                            self.apply_fixed_smoke(index);
                            self.finish(Outcome::Confirm(index));
                        }
                    }
                    3 => {
                        if let Some(index) = self.overlay_index(hwnd) {
                            self.apply_snap_smoke(index);
                            self.finish(Outcome::Confirm(index));
                        }
                    }
                    _ => self.finish(Outcome::Cancel),
                }
                LRESULT(0)
            }
            WM_DESTROY => LRESULT(0),
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn apply_action(&mut self, index: usize, action: Action) {
        match action {
            Action::Tool(tool) => {
                let overlay = &mut self.overlays[index];
                overlay.tool = if overlay.tool == tool {
                    Tool::None
                } else {
                    tool
                };
                if overlay.tool == Tool::None {
                    overlay.mode = Mode::Selected;
                }
                invalidate(overlay.hwnd);
            }
            Action::Undo => {
                annotate::undo(&mut self.overlays[index].annotations);
                invalidate(self.overlays[index].hwnd);
            }
            Action::Save => self.save_overlay(index),
            Action::Cancel => self.finish(Outcome::Cancel),
            Action::Confirm => {
                if self.overlays[index].selection.is_some() {
                    self.finish(Outcome::Confirm(index));
                }
            }
        }
    }

    fn save_overlay(&mut self, index: usize) {
        if self.saving {
            return;
        }
        let overlay = &self.overlays[index];
        let Some(selection) = overlay.selection else {
            return;
        };
        let Ok((width, height, pixels)) = annotate::composite(
            &overlay.snapshot.pixels_bgra,
            overlay.snapshot.width,
            overlay.snapshot.height,
            view_bounds(overlay),
            selection,
            &overlay.annotations,
        ) else {
            return;
        };
        let owner = overlay.hwnd;
        self.saving = true;
        let path = save_dialog(owner);
        self.saving = false;
        if let Some(path) = path {
            let _ = crate::png::write_bgra(&path, width, height, &pixels);
        }
    }

    fn apply_fixed_smoke(&mut self, index: usize) {
        let bounds = view_bounds(&self.overlays[index]);
        let width = 200.0_f64.min(bounds.width - 16.0).max(16.0);
        let height = 120.0_f64.min(bounds.height - 16.0).max(16.0);
        self.overlays[index].selection = Some(geometry::clamp(
            Rect::from_xywh(40.0, 40.0, width, height),
            bounds,
        ));
        self.overlays[index].mode = Mode::Selected;
    }

    fn apply_snap_smoke(&mut self, index: usize) {
        let bounds = view_bounds(&self.overlays[index]);
        let origin = self.overlays[index].monitor_origin();
        let snapped = self.overlays[index]
            .snap
            .windows
            .iter()
            .find_map(|window| crate::snap::view_rect(window.frame, origin, bounds));
        if let Some(rect) = snapped {
            self.overlays[index].selection = Some(rect);
            self.overlays[index].mode = Mode::Selected;
        } else {
            self.apply_fixed_smoke(index);
        }
    }

    fn finish(&mut self, outcome: Outcome) {
        if self.saving || self.outcome.is_some() {
            return;
        }
        self.outcome = Some(outcome);
        for overlay in &mut self.overlays {
            overlay.destroy();
        }
        unsafe {
            PostQuitMessage(0);
        }
    }
}

impl Overlay {
    fn mouse_down(&mut self, point: Point, double_click: bool) {
        unsafe {
            let _ = SetCapture(self.hwnd);
        }
        let _ = unsafe { SetFocus(Some(self.hwnd)) };
        self.last_mouse = point;

        if double_click && self.selection.is_some() && self.tool == Tool::None {
            return;
        }

        if let Some(selection) = self.selection {
            if self.tool == Tool::None {
                if let Some(handle) = Handle::ALL
                    .iter()
                    .copied()
                    .find(|handle| handle.hit(selection, point))
                {
                    self.active_handle = Some(handle);
                    self.drag_start = point;
                    return;
                }
                if selection.contains(point) {
                    self.moving = true;
                    self.drag_start = point;
                    return;
                }
            } else if selection.contains(point) {
                self.mode = Mode::Annotating;
                self.current = Some(Annotation::new(self.tool, point));
                return;
            }
        }

        self.mode = Mode::Dragging;
        self.drag_start = point;
        self.drag_current = point;
        self.selection = None;
        self.hover = None;
        self.active_handle = None;
        self.moving = false;
        self.annotations.clear();
        self.current = None;
        self.tool = Tool::None;
    }

    fn mouse_move(&mut self, point: Point) {
        self.last_mouse = point;
        let bounds = view_bounds(self);
        if matches!(self.mode, Mode::Annotating) {
            if let Some(annotation) = self.current.as_mut() {
                annotation.end = point;
                if annotation.tool == Tool::Pen {
                    annotation.points.push(point);
                }
            }
            return;
        }
        if let (Some(handle), Some(selection)) = (self.active_handle, self.selection) {
            let delta = Point {
                x: point.x - self.drag_start.x,
                y: point.y - self.drag_start.y,
            };
            self.selection = Some(handle.apply(selection, delta, bounds));
            self.drag_start = point;
            return;
        }
        if self.moving {
            if let Some(mut selection) = self.selection {
                selection.x += point.x - self.drag_start.x;
                selection.y += point.y - self.drag_start.y;
                self.selection = Some(geometry::clamp(selection, bounds));
                self.drag_start = point;
            }
            return;
        }
        if matches!(self.mode, Mode::Dragging) {
            if self.space_held {
                if let Some(mut selection) = self.selection {
                    let delta = Point {
                        x: point.x - self.drag_current.x,
                        y: point.y - self.drag_current.y,
                    };
                    selection.x += delta.x;
                    selection.y += delta.y;
                    self.selection = Some(geometry::clamp(selection, bounds));
                    self.drag_start.x += delta.x;
                    self.drag_start.y += delta.y;
                }
            } else {
                self.selection =
                    Some(geometry::normalized_rect(self.drag_start, point).intersection(bounds));
            }
            self.drag_current = point;
            return;
        }
        if matches!(self.mode, Mode::Idle) {
            self.update_hover(point);
        }
    }

    fn mouse_up(&mut self, point: Point) {
        unsafe {
            let _ = ReleaseCapture();
        }
        self.last_mouse = point;
        self.active_handle = None;
        self.moving = false;
        if matches!(self.mode, Mode::Annotating) {
            if let Some(annotation) = self.current.take() {
                self.annotations.push(annotation);
            }
            self.mode = Mode::Selected;
            return;
        }
        if !matches!(self.mode, Mode::Dragging) {
            return;
        }
        let bounds = view_bounds(self);
        let rect = geometry::normalized_rect(self.drag_start, point).intersection(bounds);
        if rect.width >= 4.0 && rect.height >= 4.0 {
            self.selection = Some(rect);
            self.hover = None;
            self.mode = Mode::Selected;
        } else if let Some(hover) = self.hover_at(point) {
            self.selection = Some(hover);
            self.hover = None;
            self.mode = Mode::Selected;
        } else {
            self.selection = None;
            self.mode = Mode::Idle;
            self.update_hover(point);
        }
    }

    fn monitor_origin(&self) -> Point {
        Point {
            x: self.snapshot.x as f64,
            y: self.snapshot.y as f64,
        }
    }

    fn screen_point(&self, client: Point) -> Point {
        Point {
            x: client.x + self.snapshot.x as f64,
            y: client.y + self.snapshot.y as f64,
        }
    }

    fn hover_at(&self, client: Point) -> Option<Rect> {
        self.snap.view_rect_at(
            self.screen_point(client),
            self.monitor_origin(),
            view_bounds(self),
        )
    }

    fn update_hover(&mut self, client: Point) {
        self.hover = self.hover_at(client);
    }

    fn ensure_track(&mut self) {
        if self.tracking {
            return;
        }
        let mut event = TRACKMOUSEEVENT {
            cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE,
            hwndTrack: self.hwnd,
            dwHoverTime: 0,
        };
        if unsafe { TrackMouseEvent(&mut event) }.is_ok() {
            self.tracking = true;
        }
    }

    fn toolbar_origin(&self) -> Point {
        if let Some(selection) = self.selection {
            toolbar::layout_origin(selection, view_bounds(self))
        } else {
            Point { x: 8.0, y: 8.0 }
        }
    }

    fn toolbar_contains(&self, point: Point) -> bool {
        if self.selection.is_none() || matches!(self.mode, Mode::Dragging) {
            return false;
        }
        toolbar::frame(self.toolbar_origin()).contains(point)
    }

    fn toolbar_hit(&self, point: Point) -> Option<Action> {
        if !self.toolbar_contains(point) {
            return None;
        }
        toolbar::hit(self.toolbar_origin(), point)
    }

    fn loupe_visible(&self) -> bool {
        matches!(self.mode, Mode::Idle | Mode::Dragging)
    }

    fn copy_sample_field(&self, vk: i32) {
        let view = view_bounds(self);
        let Some(sample) = sample::sample(
            &self.snapshot.pixels_bgra,
            self.snapshot.width,
            self.snapshot.height,
            view,
            self.last_mouse,
        ) else {
            return;
        };
        let text = match vk {
            0x31 => sample::pos_text(&sample),
            0x32 => sample::rgb_text(&sample),
            0x33 => sample::hex_text(&sample),
            _ => return,
        };
        let _ = clipboard::write_text(&text);
    }

    fn nudge(&mut self, vk: i32, shift: bool) {
        let Some(mut selection) = self.selection else {
            return;
        };
        let step = if shift { 10.0 } else { 1.0 };
        if vk == VK_LEFT.0 as i32 {
            selection.x -= step;
        } else if vk == VK_RIGHT.0 as i32 {
            selection.x += step;
        } else if vk == VK_UP.0 as i32 {
            selection.y -= step;
        } else if vk == VK_DOWN.0 as i32 {
            selection.y += step;
        }
        self.selection = Some(geometry::clamp(selection, view_bounds(self)));
    }
}

fn point_from_lparam(lparam: LPARAM) -> Point {
    let packed = lparam.0 as u32;
    Point {
        x: (packed & 0xFFFF) as u16 as i16 as f64,
        y: ((packed >> 16) & 0xFFFF) as u16 as i16 as f64,
    }
}

fn invalidate(hwnd: HWND) {
    unsafe {
        let _ = InvalidateRect(Some(hwnd), None, false);
    }
}

fn update_cursor(overlay: &Overlay) {
    unsafe {
        let mut screen = POINT::default();
        if GetCursorPos(&mut screen).is_err() {
            let _ = SetCursor(LoadCursorW(None, IDC_CROSS).ok());
            return;
        }
        let point = Point {
            x: (screen.x - overlay.snapshot.x) as f64,
            y: (screen.y - overlay.snapshot.y) as f64,
        };
        let cursor = if overlay.toolbar_contains(point) {
            IDC_ARROW
        } else if let Some(selection) = overlay.selection {
            if overlay.tool == Tool::None {
                if let Some(handle) = Handle::ALL
                    .iter()
                    .copied()
                    .find(|handle| handle.hit(selection, point))
                {
                    handle_cursor(handle)
                } else if selection.contains(point) {
                    IDC_SIZEALL
                } else {
                    IDC_CROSS
                }
            } else {
                IDC_CROSS
            }
        } else {
            IDC_CROSS
        };
        let _ = SetCursor(LoadCursorW(None, cursor).ok());
    }
}

fn handle_cursor(handle: Handle) -> PCWSTR {
    match handle {
        Handle::Left | Handle::Right => IDC_SIZEWE,
        Handle::Top | Handle::Bottom => IDC_SIZENS,
        Handle::TopLeft | Handle::BottomRight => IDC_SIZENWSE,
        Handle::TopRight | Handle::BottomLeft => IDC_SIZENESW,
    }
}

fn paint(overlay: &mut Overlay) {
    unsafe {
        let mut ps = PAINTSTRUCT::default();
        let hdc = BeginPaint(overlay.hwnd, &mut ps);
        if hdc.is_invalid() {
            return;
        }
        let view_w = overlay.snapshot.screen_width as i32;
        let view_h = overlay.snapshot.screen_height as i32;
        let mem = CreateCompatibleDC(Some(hdc));
        let need = overlay
            .backbuffer
            .as_ref()
            .is_none_or(|buffer| buffer.width != view_w || buffer.height != view_h);
        if need {
            overlay.backbuffer = GdiBitmap::blank(view_w as u32, view_h as u32).ok();
        }
        let scratch;
        let buffer = if let Some(ref dib) = overlay.backbuffer {
            dib.handle
        } else {
            scratch = CreateCompatibleBitmap(hdc, view_w, view_h);
            scratch
        };
        let owned = overlay.backbuffer.is_some();
        let old_buf = SelectObject(mem, buffer.into());

        blit_bitmap(
            mem,
            &overlay.dimmed,
            0,
            0,
            view_w,
            view_h,
            0,
            0,
            overlay.dimmed.width,
            overlay.dimmed.height,
        );

        if overlay.selection.is_some() {
            blit_marked_selection(mem, overlay);
        } else if let Some(hover) = overlay.hover {
            blit_view_rect(mem, overlay, hover);
        }

        let chrome = crate::chrome::Scene {
            view: view_bounds(overlay),
            selection: overlay.selection,
            hover: overlay.hover,
            dragging: matches!(overlay.mode, Mode::Dragging),
            tool: overlay.tool,
            undo_enabled: !overlay.annotations.is_empty(),
            pointer: overlay.last_mouse,
            pressed: if overlay.toolbar_pressed {
                overlay.pending_action
            } else {
                None
            },
        };
        if !crate::chrome::paint(mem, view_w, view_h, &chrome) {
            if let Some(selection) = overlay.selection {
                if !matches!(overlay.mode, Mode::Dragging) {
                    draw_selection_chrome(mem, selection);
                    draw_size_badge(mem, selection, view_w, view_h);
                    draw_toolbar(mem, overlay, selection);
                } else {
                    draw_ring(mem, selection);
                    draw_size_badge(mem, selection, view_w, view_h);
                }
            } else if overlay.hover.is_some() {
                if let Some(hover) = overlay.hover {
                    draw_ring(mem, hover);
                }
            }
        }

        if overlay.loupe_visible() {
            draw_loupe(mem, overlay);
        }

        let _ = BitBlt(hdc, 0, 0, view_w, view_h, Some(mem), 0, 0, SRCCOPY);
        SelectObject(mem, old_buf);
        if !owned {
            let _ = DeleteObject(buffer.into());
        }
        let _ = DeleteDC(mem);
        let _ = EndPaint(overlay.hwnd, &ps);
    }
}

unsafe fn blit_marked_selection(mem: HDC, overlay: &mut Overlay) {
    let Some(selection) = overlay.selection else {
        return;
    };
    let extra = overlay.current.as_ref();
    if overlay.annotations.is_empty() && extra.is_none() {
        overlay.marked = None;
        blit_view_rect(mem, overlay, selection);
        return;
    }
    if extra.is_none() {
        if let Some(cache) = overlay.marked.as_ref() {
            if cache.selection == selection && cache.marks == overlay.annotations.len() {
                let (x, y, w, h) = selection.to_i32();
                blit_bitmap(
                    mem,
                    &cache.bitmap,
                    x,
                    y,
                    w,
                    h,
                    0,
                    0,
                    cache.bitmap.width,
                    cache.bitmap.height,
                );
                return;
            }
        }
    }
    if let Ok((width, height, pixels)) = annotate::composite_with(
        &overlay.snapshot.pixels_bgra,
        overlay.snapshot.width,
        overlay.snapshot.height,
        view_bounds(overlay),
        selection,
        &overlay.annotations,
        extra,
    ) {
        if extra.is_none() {
            if let Some(cache) = overlay.marked.as_mut() {
                if cache.bitmap.width == width as i32
                    && cache.bitmap.height == height as i32
                    && cache.bitmap.write_bgra(&pixels)
                {
                    cache.selection = selection;
                    cache.marks = overlay.annotations.len();
                    let (x, y, w, h) = selection.to_i32();
                    blit_bitmap(
                        mem,
                        &cache.bitmap,
                        x,
                        y,
                        w,
                        h,
                        0,
                        0,
                        cache.bitmap.width,
                        cache.bitmap.height,
                    );
                    return;
                }
            }
            if let Ok(bitmap) = GdiBitmap::from_bgra(width, height, &pixels) {
                let (x, y, w, h) = selection.to_i32();
                blit_bitmap(mem, &bitmap, x, y, w, h, 0, 0, bitmap.width, bitmap.height);
                overlay.marked = Some(MarkedCache {
                    selection,
                    marks: overlay.annotations.len(),
                    bitmap,
                });
                return;
            }
        } else if let Ok(bitmap) = GdiBitmap::from_bgra(width, height, &pixels) {
            let (x, y, w, h) = selection.to_i32();
            blit_bitmap(mem, &bitmap, x, y, w, h, 0, 0, bitmap.width, bitmap.height);
            return;
        }
    }
    blit_view_rect(mem, overlay, selection);
}

unsafe fn blit_view_rect(mem: HDC, overlay: &Overlay, rect: Rect) {
    let view = view_bounds(overlay);
    let (x, y, w, h) = rect.to_i32();
    if w <= 0 || h <= 0 {
        return;
    }
    let Some((sx, sy, sw, sh)) = geometry::map_view_to_image(
        view,
        rect,
        overlay.original.width as u32,
        overlay.original.height as u32,
    ) else {
        return;
    };
    blit_bitmap(mem, &overlay.original, x, y, w, h, sx, sy, sw, sh);
}

// A StretchBlt by another name: the ten scalars ARE the Win32 call's shape.
#[allow(clippy::too_many_arguments)]
unsafe fn blit_bitmap(
    dest: HDC,
    bitmap: &GdiBitmap,
    dx: i32,
    dy: i32,
    dw: i32,
    dh: i32,
    sx: i32,
    sy: i32,
    sw: i32,
    sh: i32,
) {
    let src_dc = CreateCompatibleDC(Some(dest));
    let old = SelectObject(src_dc, bitmap.handle.into());
    let _ = StretchBlt(dest, dx, dy, dw, dh, Some(src_dc), sx, sy, sw, sh, SRCCOPY);
    SelectObject(src_dc, old);
    let _ = DeleteDC(src_dc);
}

unsafe fn draw_ring(hdc: HDC, rect: Rect) {
    let (x, y, w, h) = rect.to_i32();
    let pen = CreatePen(PS_SOLID, 2, SELECT_COLOR);
    let null_brush = GetStockObject(NULL_BRUSH);
    let old_pen = SelectObject(hdc, HGDIOBJ(pen.0));
    let old_brush = SelectObject(hdc, null_brush);
    let _ = windows::Win32::Graphics::Gdi::Rectangle(hdc, x, y, x + w, y + h);
    SelectObject(hdc, old_brush);
    SelectObject(hdc, old_pen);
    let _ = DeleteObject(pen.into());
}

unsafe fn draw_selection_chrome(hdc: HDC, selection: Rect) {
    draw_ring(hdc, selection);

    let fill = CreateSolidBrush(HANDLE_FILL);
    for handle in Handle::ALL {
        let box_rect = handle.rect(selection, HANDLE_SIZE);
        let (hx, hy, hw, hh) = box_rect.to_i32();
        let old_pen = SelectObject(hdc, HGDIOBJ(CreatePen(PS_SOLID, 1, SELECT_COLOR).0));
        let old_brush = SelectObject(hdc, fill.into());
        let _ = windows::Win32::Graphics::Gdi::RoundRect(hdc, hx, hy, hx + hw, hy + hh, 3, 3);
        let pen = old_pen;
        SelectObject(hdc, old_brush);
        let created_pen = SelectObject(hdc, pen);
        let _ = DeleteObject(created_pen);
    }
    let _ = DeleteObject(fill.into());
}

unsafe fn draw_size_badge(hdc: HDC, selection: Rect, view_w: i32, view_h: i32) {
    let label = format!(
        "{} × {}",
        selection.width.round() as i32,
        selection.height.round() as i32
    );
    let mut wide: Vec<u16> = label.encode_utf16().collect();
    wide.push(0);
    let width = (label.len() as i32) * 8 + 20;
    let height = 24;
    let mut x = selection.min_x().round() as i32;
    let mut y = selection.min_y().round() as i32 - height - 8;
    if y < 8 {
        y = selection.max_y().round() as i32 + 8;
    }
    if x + width > view_w - 8 {
        x = view_w - width - 8;
    }
    if x < 8 {
        x = 8;
    }
    if y + height > view_h - 8 {
        y = view_h - height - 8;
    }
    let brush = CreateSolidBrush(BADGE_BG);
    let old_brush = SelectObject(hdc, brush.into());
    let old_pen = SelectObject(hdc, GetStockObject(NULL_PEN));
    let _ = windows::Win32::Graphics::Gdi::RoundRect(hdc, x, y, x + width, y + height, 12, 12);
    SelectObject(hdc, old_brush);
    SelectObject(hdc, old_pen);
    let _ = DeleteObject(brush.into());

    let mut text_rect = WinRect {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
    };
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, BADGE_FG);
    let _ = SelectObject(hdc, GetStockObject(SYSTEM_FONT));
    let _ = DrawTextW(
        hdc,
        &mut wide,
        &mut text_rect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );
}

unsafe fn draw_toolbar(hdc: HDC, overlay: &Overlay, selection: Rect) {
    let origin = toolbar::layout_origin(selection, view_bounds(overlay));
    let frame = toolbar::frame(origin);
    let (x, y, w, h) = frame.to_i32();
    let brush = CreateSolidBrush(BADGE_BG);
    let old_brush = SelectObject(hdc, brush.into());
    let old_pen = SelectObject(hdc, GetStockObject(NULL_PEN));
    let _ = windows::Win32::Graphics::Gdi::RoundRect(hdc, x, y, x + w, y + h, h / 2, h / 2);
    SelectObject(hdc, old_brush);
    SelectObject(hdc, old_pen);
    let _ = DeleteObject(brush.into());

    for (index, action) in toolbar::items().iter().enumerate() {
        let bx = (origin.x + toolbar::button_offset(index)).round() as i32;
        let by = (origin.y + (toolbar::HEIGHT - toolbar::BUTTON) / 2.0).round() as i32;
        let size = toolbar::BUTTON.round() as i32;
        let selected = matches!(action, Action::Tool(tool) if *tool == overlay.tool);
        let undo_off = matches!(action, Action::Undo) && overlay.annotations.is_empty();
        draw_toolbar_button(hdc, bx, by, size, *action, selected, undo_off);
    }
}

unsafe fn draw_toolbar_button(
    hdc: HDC,
    x: i32,
    y: i32,
    size: i32,
    action: Action,
    selected: bool,
    disabled: bool,
) {
    if selected || matches!(action, Action::Confirm) {
        let fill = CreateSolidBrush(HANDLE_FILL);
        let old = SelectObject(hdc, fill.into());
        let old_pen = SelectObject(hdc, GetStockObject(NULL_PEN));
        let _ = windows::Win32::Graphics::Gdi::RoundRect(
            hdc,
            x,
            y,
            x + size,
            y + size,
            size / 2,
            size / 2,
        );
        SelectObject(hdc, old);
        SelectObject(hdc, old_pen);
        let _ = DeleteObject(fill.into());
    }
    let ink = if disabled {
        COLORREF(0x00666666)
    } else if selected || matches!(action, Action::Confirm) {
        COLORREF(0x001C1C1E)
    } else if matches!(action, Action::Cancel) {
        COLORREF(0x003A45FF)
    } else {
        BADGE_FG
    };
    let pad = 8;
    let left = x + pad;
    let top = y + pad;
    let right = x + size - pad;
    let bottom = y + size - pad;
    let pen = CreatePen(PS_SOLID, 2, ink);
    let old_pen = SelectObject(hdc, HGDIOBJ(pen.0));
    let old_brush = SelectObject(hdc, GetStockObject(NULL_BRUSH));
    match action {
        Action::Tool(Tool::Rectangle) | Action::Tool(Tool::None) => {
            let _ = windows::Win32::Graphics::Gdi::Rectangle(hdc, left, top, right, bottom);
        }
        Action::Tool(Tool::Ellipse) => {
            let _ = Ellipse(hdc, left, top, right, bottom);
        }
        Action::Tool(Tool::Arrow) => {
            let _ = MoveToEx(hdc, left, bottom, None);
            let _ = LineTo(hdc, right, top);
        }
        Action::Tool(Tool::Pen) => {
            let _ = MoveToEx(hdc, left, bottom - 2, None);
            let _ = LineTo(hdc, left + 6, top + 4);
            let _ = LineTo(hdc, right, bottom);
        }
        Action::Tool(Tool::Mosaic) => {
            let step = (right - left) / 3;
            for i in 0..3 {
                for j in 0..3 {
                    let _ = windows::Win32::Graphics::Gdi::Rectangle(
                        hdc,
                        left + i * step,
                        top + j * step,
                        left + (i + 1) * step - 1,
                        top + (j + 1) * step - 1,
                    );
                }
            }
        }
        Action::Undo => draw_glyph(hdc, x, y, size, "U", ink),
        Action::Save => draw_glyph(hdc, x, y, size, "S", ink),
        Action::Cancel => draw_glyph(hdc, x, y, size, "X", ink),
        Action::Confirm => draw_glyph(hdc, x, y, size, "OK", ink),
    }
    SelectObject(hdc, old_brush);
    SelectObject(hdc, old_pen);
    let _ = DeleteObject(pen.into());
}

unsafe fn draw_glyph(hdc: HDC, x: i32, y: i32, size: i32, text: &str, ink: COLORREF) {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let mut rect = WinRect {
        left: x,
        top: y,
        right: x + size,
        bottom: y + size,
    };
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, ink);
    let _ = SelectObject(hdc, GetStockObject(SYSTEM_FONT));
    let _ = DrawTextW(
        hdc,
        &mut wide,
        &mut rect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
    );
}

unsafe fn draw_loupe(hdc: HDC, overlay: &mut Overlay) {
    let view = view_bounds(overlay);
    let focus = overlay.last_mouse;
    let card_w = crate::chrome::LOUPE_CARD_W;
    let card_h = crate::chrome::LOUPE_CARD_H;
    let mut ox = focus.x + 20.0;
    let mut oy = focus.y + 20.0;
    if ox + card_w > view.max_x() {
        ox = focus.x - card_w - 20.0;
    }
    if oy + card_h > view.max_y() {
        oy = focus.y - card_h - 20.0;
    }
    ox = ox.max(8.0);
    oy = oy.max(8.0);
    let origin = Point { x: ox, y: oy };
    let view_w = overlay.snapshot.screen_width as i32;
    let view_h = overlay.snapshot.screen_height as i32;
    let _ = crate::chrome::paint_loupe_card(hdc, view_w, view_h, origin);

    let (px, py) =
        sample::image_pixel(focus, view, overlay.snapshot.width, overlay.snapshot.height);
    let patch = sample::centered_bgra(
        &overlay.snapshot.pixels_bgra,
        overlay.snapshot.width,
        overlay.snapshot.height,
        px,
        py,
        crate::chrome::LOUPE_SAMPLE,
    );
    let sample_px = crate::chrome::LOUPE_SAMPLE;
    let reuse = overlay
        .loupe_bitmap
        .as_mut()
        .is_some_and(|bitmap| bitmap.write_bgra(&patch));
    if !reuse {
        overlay.loupe_bitmap = GdiBitmap::from_bgra(sample_px, sample_px, &patch).ok();
    }
    if let Some(bitmap) = overlay.loupe_bitmap.as_ref() {
        let zoom = crate::chrome::loupe_zoom_rect(origin);
        let (zx, zy, zw, zh) = zoom.to_i32();
        SetStretchBltMode(hdc, COLORONCOLOR);
        let radius = (crate::chrome::LOUPE_RADIUS * 2.0).round() as i32;
        let region = CreateRoundRectRgn(zx, zy, zx + zw + 1, zy + zh + 1, radius, radius);
        let _ = SelectClipRgn(hdc, Some(region));
        blit_bitmap(
            hdc,
            bitmap,
            zx,
            zy,
            zw,
            zh,
            0,
            0,
            sample_px as i32,
            sample_px as i32,
        );
        let _ = SelectClipRgn(hdc, None);
        let _ = DeleteObject(region.into());
    }

    let sampled = sample::sample(
        &overlay.snapshot.pixels_bgra,
        overlay.snapshot.width,
        overlay.snapshot.height,
        view,
        focus,
    );
    let _ = crate::chrome::paint_loupe_chrome(hdc, view_w, view_h, origin, sampled.as_ref());
}

fn save_dialog(owner: HWND) -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::UI::Controls::Dialogs::{
        GetSaveFileNameW, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    let mut file: Vec<u16> = "screenshot.png".encode_utf16().collect();
    file.resize(520, 0);
    let filter: Vec<u16> = "PNG image\0*.png\0\0".encode_utf16().collect();
    let mut ofn = OPENFILENAMEW {
        lStructSize: size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner,
        lpstrFilter: PCWSTR(filter.as_ptr()),
        lpstrFile: PWSTR(file.as_mut_ptr()),
        nMaxFile: file.len() as u32,
        Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        lpstrDefExt: w!("png"),
        ..unsafe { std::mem::zeroed() }
    };
    ofn.lStructSize = size_of::<OPENFILENAMEW>() as u32;
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = PCWSTR(filter.as_ptr());
    ofn.lpstrFile = PWSTR(file.as_mut_ptr());
    ofn.nMaxFile = file.len() as u32;
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    ofn.lpstrDefExt = w!("png");
    unsafe {
        if GetSaveFileNameW(&mut ofn).as_bool() {
            let len = file.iter().position(|&c| c == 0).unwrap_or(file.len());
            Some(std::path::PathBuf::from(std::ffi::OsString::from_wide(
                &file[..len],
            )))
        } else {
            None
        }
    }
}
