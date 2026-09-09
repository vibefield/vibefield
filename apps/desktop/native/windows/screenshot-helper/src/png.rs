use std::io::Cursor;
use std::path::Path;

fn bgra_to_rgba(bgra: &[u8]) -> Vec<u8> {
    let mut rgba = vec![0u8; bgra.len()];
    for (src, dst) in bgra.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
        dst[0] = src[2];
        dst[1] = src[1];
        dst[2] = src[0];
        dst[3] = 255;
    }
    rgba
}

fn expected_len(width: u32, height: u32) -> Result<usize, String> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "png dimensions overflow".to_string())
}

pub fn encode_bgra(width: u32, height: u32, bgra: &[u8]) -> Result<Vec<u8>, String> {
    let expected = expected_len(width, height)?;
    if bgra.len() != expected {
        return Err(format!(
            "bgra length {} does not match {}x{}",
            bgra.len(),
            width,
            height
        ));
    }
    let rgba = bgra_to_rgba(bgra);
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(Cursor::new(&mut out), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("png header: {error}"))?;
        writer
            .write_image_data(&rgba)
            .map_err(|error| format!("png data: {error}"))?;
    }
    Ok(out)
}

pub fn write_bgra(path: &Path, width: u32, height: u32, bgra: &[u8]) -> Result<(), String> {
    let bytes = encode_bgra(width, height, bgra)?;
    std::fs::write(path, bytes).map_err(|error| format!("write {}: {error}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn writes_png_magic() {
        let path = env::temp_dir().join("screenshot-helper-png-test.png");
        let pixels = [
            0u8, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
        ];
        write_bgra(&path, 2, 2, &pixels).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..4], &[0x89, b'P', b'N', b'G']);
        let _ = std::fs::remove_file(path);
    }
}
