use crate::png;
use std::env;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{GlobalFree, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
const CF_DIB: u32 = 8;
const CF_DIBV5: u32 = 17;
use windows::core::w;

const BI_BITFIELDS: u32 = 3;
const BI_RGB: u32 = 0;

pub struct ShotImage {
    pub width: u32,
    pub height: u32,
    pub pixels_bgra: Vec<u8>,
}

pub fn write_text(text: &str) -> Result<(), String> {
    let mut bytes: Vec<u16> = text.encode_utf16().collect();
    bytes.push(0);
    let raw = unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const u8, bytes.len() * 2) };
    unsafe {
        OpenClipboard(Some(HWND::default())).map_err(|error| format!("OpenClipboard: {error}"))?;
        let result = (|| {
            EmptyClipboard().map_err(|error| format!("EmptyClipboard: {error}"))?;
            set_handle(1, raw)?; // CF_UNICODETEXT
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn write(image: &ShotImage) -> Result<PathBuf, String> {
    let png = png::encode_bgra(image.width, image.height, &image.pixels_bgra)?;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = env::temp_dir().join(format!("vibefield-screenshot-{millis}.png"));
    std::fs::write(&path, &png).map_err(|error| format!("write {}: {error}", path.display()))?;
    let dib = pack_dib(image.width, image.height, &image.pixels_bgra);
    let dibv5 = pack_dibv5(image.width, image.height, &image.pixels_bgra);
    if let Err(error) = set_clipboard(&png, &dib, &dibv5) {
        eprintln!(
            "clipboard copy failed ({error}); file kept at {}",
            path.display()
        );
    }
    Ok(path)
}

pub fn pack_dib(width: u32, height: u32, bgra_topdown: &[u8]) -> Vec<u8> {
    let row = (width as usize) * 4;
    let mut out = vec![0u8; 40 + row * height as usize];
    write_u32(&mut out, 0, 40);
    write_i32(&mut out, 4, width as i32);
    write_i32(&mut out, 8, height as i32);
    write_u16(&mut out, 12, 1);
    write_u16(&mut out, 14, 32);
    write_u32(&mut out, 16, BI_RGB);
    write_u32(&mut out, 20, (row * height as usize) as u32);
    for y in 0..height as usize {
        let src = y * row;
        let dest = 40 + (height as usize - 1 - y) * row;
        out[dest..dest + row].copy_from_slice(&bgra_topdown[src..src + row]);
    }
    out
}

fn pack_dibv5(width: u32, height: u32, bgra_topdown: &[u8]) -> Vec<u8> {
    let row = (width as usize) * 4;
    let header = 124usize;
    let mut out = vec![0u8; header + row * height as usize];
    write_u32(&mut out, 0, header as u32);
    write_i32(&mut out, 4, width as i32);
    write_i32(&mut out, 8, height as i32);
    write_u16(&mut out, 12, 1);
    write_u16(&mut out, 14, 32);
    write_u32(&mut out, 16, BI_BITFIELDS);
    write_u32(&mut out, 20, (row * height as usize) as u32);
    write_u32(&mut out, 40, 0x00FF0000);
    write_u32(&mut out, 44, 0x0000FF00);
    write_u32(&mut out, 48, 0x000000FF);
    write_u32(&mut out, 52, 0xFF000000);
    write_u32(&mut out, 56, 0x73524742); // 'sRGB'
    for y in 0..height as usize {
        let src = y * row;
        let dest = header + (height as usize - 1 - y) * row;
        out[dest..dest + row].copy_from_slice(&bgra_topdown[src..src + row]);
    }
    out
}

fn set_clipboard(png: &[u8], dib: &[u8], dibv5: &[u8]) -> Result<(), String> {
    unsafe {
        OpenClipboard(Some(HWND::default())).map_err(|error| format!("OpenClipboard: {error}"))?;
        let result = (|| {
            EmptyClipboard().map_err(|error| format!("EmptyClipboard: {error}"))?;
            let png_format = RegisterClipboardFormatW(w!("PNG"));
            if png_format == 0 {
                return Err("RegisterClipboardFormat PNG failed".into());
            }
            set_handle(png_format, png)?;
            set_handle(CF_DIB, dib)?;
            set_handle(CF_DIBV5, dibv5)?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

unsafe fn set_handle(format: u32, bytes: &[u8]) -> Result<(), String> {
    let alloc =
        GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|error| format!("GlobalAlloc: {error}"))?;
    if alloc.is_invalid() {
        return Err("GlobalAlloc returned null".into());
    }
    let ptr = GlobalLock(alloc);
    if ptr.is_null() {
        let _ = GlobalFree(Some(alloc));
        return Err("GlobalLock failed".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
    let _ = GlobalUnlock(alloc);
    if SetClipboardData(format, Some(windows::Win32::Foundation::HANDLE(alloc.0))).is_err() {
        let _ = GlobalFree(Some(alloc));
        return Err("SetClipboardData failed".into());
    }
    Ok(())
}

fn write_u16(buf: &mut [u8], offset: usize, value: u16) {
    buf[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(buf: &mut [u8], offset: usize, value: u32) {
    buf[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_i32(buf: &mut [u8], offset: usize, value: i32) {
    buf[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dib_has_header_and_flipped_rows() {
        let pixels = [1u8, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
        let dib = pack_dib(2, 2, &pixels);
        assert_eq!(&dib[0..4], &40u32.to_le_bytes());
        assert_eq!(i32::from_le_bytes(dib[4..8].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(dib[8..12].try_into().unwrap()), 2);
        assert_eq!(&dib[40..44], &[7, 8, 9, 255]);
        assert_eq!(&dib[48..52], &[1, 2, 3, 255]);
    }
}
