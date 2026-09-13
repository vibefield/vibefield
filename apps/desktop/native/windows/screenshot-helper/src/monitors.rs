use crate::protocol::HelperError;
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

#[derive(Debug, Clone)]
pub struct Monitor {
    pub handle: HMONITOR,
    pub display_id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub device: String,
}

/// The monitor list, or the typed reason there is none. An empty enumeration
/// is NoDisplays (a headless or locked session); a failed enumeration is a
/// capture failure — the knowledge of which is which lives here, not in a
/// regex over the message (SNAP-D2).
pub fn enumerate() -> Result<Vec<Monitor>, HelperError> {
    let mut monitors: Vec<Monitor> = Vec::new();
    let ok = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(enum_proc),
            LPARAM(&mut monitors as *mut Vec<Monitor> as isize),
        )
    };
    if !ok.as_bool() {
        return Err(HelperError::capture_failed("EnumDisplayMonitors failed"));
    }
    if monitors.is_empty() {
        return Err(HelperError::no_displays("no displays available"));
    }
    for (index, monitor) in monitors.iter_mut().enumerate() {
        if monitor.display_id == 0 {
            monitor.display_id = (index as u32) + 1;
        }
    }
    Ok(monitors)
}

unsafe extern "system" fn enum_proc(
    handle: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let monitors = unsafe { &mut *(lparam.0 as *mut Vec<Monitor>) };
    // A monitor that will not describe itself is skipped, not fatal.
    if let Ok(monitor) = read_monitor(handle) {
        monitors.push(monitor);
    }
    BOOL(1)
}

fn read_monitor(handle: HMONITOR) -> Result<Monitor, String> {
    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    let ok =
        unsafe { GetMonitorInfoW(handle, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) };
    if !ok.as_bool() {
        return Err("GetMonitorInfoW failed".into());
    }
    let rect = info.monitorInfo.rcMonitor;
    let width = (rect.right - rect.left).max(0) as u32;
    let height = (rect.bottom - rect.top).max(0) as u32;
    if width == 0 || height == 0 {
        return Err("monitor has empty rect".into());
    }
    let device = wide_to_string(&info.szDevice);
    let display_id = display_id_from_device(&device);
    let scale = dpi_scale(handle);
    Ok(Monitor {
        handle,
        display_id,
        x: rect.left,
        y: rect.top,
        width,
        height,
        scale,
        device,
    })
}

fn dpi_scale(handle: HMONITOR) -> f64 {
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    let result = unsafe { GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    if result.is_err() || dpi_x == 0 {
        1.0
    } else {
        dpi_x as f64 / 96.0
    }
}

fn display_id_from_device(device: &str) -> u32 {
    let upper = device.to_ascii_uppercase();
    if let Some(pos) = upper.rfind("DISPLAY") {
        let digits: String = device[pos + 7..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(id) = digits.parse::<u32>() {
            return id;
        }
    }
    0
}

fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(test)]
mod tests {
    use super::display_id_from_device;

    #[test]
    fn parses_display_device_name() {
        assert_eq!(display_id_from_device(r"\\.\DISPLAY1"), 1);
        assert_eq!(display_id_from_device(r"\\.\DISPLAY12"), 12);
        assert_eq!(display_id_from_device(r"\\.\DISPLAY33"), 33);
        assert_eq!(display_id_from_device("MONITOR"), 0);
    }
}
