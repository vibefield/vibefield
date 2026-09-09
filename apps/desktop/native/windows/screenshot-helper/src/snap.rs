use crate::geometry::{Point, Rect};
use std::mem::size_of;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT as WinRect};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

#[derive(Clone, Debug, PartialEq)]
pub struct DetectedWindow {
    pub name: String,
    pub frame: Rect,
}

#[derive(Clone, Debug, Default)]
pub struct WindowSnap {
    pub windows: Vec<DetectedWindow>,
}

impl WindowSnap {
    pub fn capture(exclude_pid: u32, displays: &[Rect]) -> Self {
        let mut state = EnumState {
            exclude_pid,
            displays: displays.to_vec(),
            windows: Vec::new(),
        };
        let _ = unsafe {
            EnumWindows(
                Some(enum_proc),
                LPARAM(&mut state as *mut EnumState as isize),
            )
        };
        Self {
            windows: state.windows,
        }
    }

    pub fn capture_excluding_self(displays: &[Rect]) -> Self {
        Self::capture(unsafe { GetCurrentProcessId() }, displays)
    }

    pub fn frontmost_at(&self, screen: Point) -> Option<&DetectedWindow> {
        frontmost(screen, &self.windows)
    }

    pub fn view_rect_at(&self, screen: Point, monitor_origin: Point, view: Rect) -> Option<Rect> {
        let window = self.frontmost_at(screen)?;
        view_rect(window.frame, monitor_origin, view)
    }
}

pub fn frontmost(screen: Point, windows: &[DetectedWindow]) -> Option<&DetectedWindow> {
    windows.iter().find(|window| window.frame.contains(screen))
}

pub fn view_rect(frame: Rect, monitor_origin: Point, view: Rect) -> Option<Rect> {
    let local = Rect::from_xywh(
        frame.x - monitor_origin.x,
        frame.y - monitor_origin.y,
        frame.width,
        frame.height,
    );
    let hit = local.intersection(view);
    if hit.width > 2.0 && hit.height > 2.0 {
        Some(hit)
    } else {
        None
    }
}

pub fn covers_most_of_a_display(rect: Rect, displays: &[Rect]) -> bool {
    let window_area = rect.width * rect.height;
    for display in displays {
        let area = display.width * display.height;
        if area <= 0.0 {
            continue;
        }
        let overlap = rect.intersection(*display);
        if overlap.width * overlap.height <= area * 0.5 {
            continue;
        }
        if window_area > area * 0.98 {
            return true;
        }
    }
    false
}

struct EnumState {
    exclude_pid: u32,
    displays: Vec<Rect>,
    windows: Vec<DetectedWindow>,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam.0 as *mut EnumState) };
    if let Some(window) = inspect(hwnd, state.exclude_pid, &state.displays) {
        state.windows.push(window);
    }
    BOOL(1)
}

fn inspect(hwnd: HWND, exclude_pid: u32, displays: &[Rect]) -> Option<DetectedWindow> {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == exclude_pid {
            return None;
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        if is_cloaked(hwnd) {
            return None;
        }
        let frame = window_frame(hwnd)?;
        if frame.width <= 8.0 || frame.height <= 8.0 {
            return None;
        }
        if covers_most_of_a_display(frame, displays) {
            return None;
        }
        Some(DetectedWindow {
            name: window_title(hwnd),
            frame,
        })
    }
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

fn window_frame(hwnd: HWND) -> Option<Rect> {
    let mut win = WinRect::default();
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut win as *mut WinRect as *mut _,
            size_of::<WinRect>() as u32,
        )
    };
    if dwm.is_err() {
        unsafe { GetWindowRect(hwnd, &mut win).ok()? };
    }
    let width = (win.right - win.left) as f64;
    let height = (win.bottom - win.top) as f64;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(Rect::from_xywh(
        win.left as f64,
        win.top as f64,
        width,
        height,
    ))
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmost_window_wins_overlap() {
        let front = DetectedWindow {
            name: "front".into(),
            frame: Rect::from_xywh(10.0, 10.0, 40.0, 40.0),
        };
        let back = DetectedWindow {
            name: "back".into(),
            frame: Rect::from_xywh(0.0, 0.0, 100.0, 100.0),
        };
        let list = [front.clone(), back.clone()];
        assert_eq!(
            frontmost(Point { x: 20.0, y: 20.0 }, &list).map(|w| w.name.as_str()),
            Some("front")
        );
        assert_eq!(
            frontmost(Point { x: 80.0, y: 80.0 }, &list).map(|w| w.name.as_str()),
            Some("back")
        );
        assert!(frontmost(Point { x: 400.0, y: 400.0 }, &list).is_none());
    }

    #[test]
    fn mid_size_window_on_large_display_is_kept() {
        let laptop = Rect::from_xywh(0.0, 0.0, 1440.0, 900.0);
        let studio = Rect::from_xywh(1440.0, 0.0, 5120.0, 2880.0);
        let mid = Rect::from_xywh(1600.0, 100.0, 1600.0, 1000.0);
        assert!(!covers_most_of_a_display(mid, &[laptop, studio]));
        let full_laptop = Rect::from_xywh(0.0, 0.0, 1440.0, 900.0);
        assert!(covers_most_of_a_display(full_laptop, &[laptop, studio]));
    }

    #[test]
    fn view_rect_maps_screen_frame_onto_monitor() {
        let frame = Rect::from_xywh(2000.0, 80.0, 400.0, 300.0);
        let origin = Point {
            x: 1920.0,
            y: -120.0,
        };
        let view = Rect::from_xywh(0.0, 0.0, 1440.0, 900.0);
        let mapped = view_rect(frame, origin, view).unwrap();
        assert_eq!(mapped, Rect::from_xywh(80.0, 200.0, 400.0, 300.0));
        let miss = Rect::from_xywh(-2000.0, 0.0, 10.0, 10.0);
        assert!(view_rect(miss, origin, view).is_none());
    }

    #[test]
    fn live_snapshot_does_not_panic() {
        let displays = [Rect::from_xywh(0.0, 0.0, 1920.0, 1080.0)];
        let snap = WindowSnap::capture(u32::MAX, &displays);
        for window in &snap.windows {
            assert!(window.frame.width > 8.0);
            assert!(window.frame.height > 8.0);
        }
    }
}
