use crate::geometry::{Point, Rect};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sample {
    pub x: i32,
    pub y: i32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub fn image_pixel(focus: Point, view: Rect, image_width: u32, image_height: u32) -> (i32, i32) {
    let scale_x = image_width as f64 / view.width.max(1.0);
    let scale_y = image_height as f64 / view.height.max(1.0);
    let px = (focus.x * scale_x).floor() as i32;
    let py = (focus.y * scale_y).floor() as i32;
    (px, py)
}

pub fn read_bgra(pixels: &[u8], width: u32, height: u32, x: i32, y: i32) -> Option<(u8, u8, u8)> {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return None;
    }
    let i = ((y as u32 * width + x as u32) as usize) * 4;
    if i + 3 >= pixels.len() {
        return None;
    }
    Some((pixels[i + 2], pixels[i + 1], pixels[i]))
}

pub fn sample(
    pixels: &[u8],
    image_width: u32,
    image_height: u32,
    view: Rect,
    focus: Point,
) -> Option<Sample> {
    let (x, y) = image_pixel(focus, view, image_width, image_height);
    let (r, g, b) = read_bgra(pixels, image_width, image_height, x, y)?;
    Some(Sample { x, y, r, g, b })
}

pub fn pos_text(sample: &Sample) -> String {
    format!("{}, {}", sample.x, sample.y)
}

pub fn rgb_text(sample: &Sample) -> String {
    format!("{}, {}, {}", sample.r, sample.g, sample.b)
}

pub fn hex_text(sample: &Sample) -> String {
    format!("#{:02X}{:02X}{:02X}", sample.r, sample.g, sample.b)
}

/// 21×21 BGRA patch centered on `(cx, cy)`. Out-of-bounds pixels are black so the
/// focus pixel stays in the middle of the loupe, matching Mac.
pub fn centered_bgra(
    pixels: &[u8],
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    sample: u32,
) -> Vec<u8> {
    let mut out = vec![0u8; (sample * sample * 4) as usize];
    let half = sample as i32 / 2;
    for y in 0..sample as i32 {
        for x in 0..sample as i32 {
            let i = ((y * sample as i32 + x) * 4) as usize;
            if let Some((r, g, b)) = read_bgra(pixels, width, height, cx - half + x, cy - half + y)
            {
                out[i] = b;
                out[i + 1] = g;
                out[i + 2] = r;
                out[i + 3] = 255;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buffer() -> (u32, u32, Vec<u8>) {
        // 4x2 unique BGRA pixels: B,G,R,A
        let pixels = vec![
            10, 20, 30, 255, // (0,0) RGB 30,20,10
            40, 50, 60, 255, // (1,0) RGB 60,50,40
            70, 80, 90, 255, // (2,0)
            1, 2, 3, 255, // (3,0)
            11, 22, 33, 255, // (0,1)
            44, 55, 66, 255, // (1,1)
            77, 88, 99, 255, // (2,1)
            4, 5, 6, 255, // (3,1)
        ];
        (4, 2, pixels)
    }

    #[test]
    fn samples_known_pixel_and_formats() {
        let (w, h, pixels) = buffer();
        let view = Rect::from_xywh(0.0, 0.0, 4.0, 2.0);
        let at = sample(&pixels, w, h, view, Point { x: 1.2, y: 0.1 }).unwrap();
        assert_eq!(
            at,
            Sample {
                x: 1,
                y: 0,
                r: 60,
                g: 50,
                b: 40
            }
        );
        assert_eq!(pos_text(&at), "1, 0");
        assert_eq!(rgb_text(&at), "60, 50, 40");
        assert_eq!(hex_text(&at), "#3C3228");
        let last = sample(&pixels, w, h, view, Point { x: 3.9, y: 1.9 }).unwrap();
        assert_eq!(
            last,
            Sample {
                x: 3,
                y: 1,
                r: 6,
                g: 5,
                b: 4
            }
        );
        assert_eq!(hex_text(&last), "#060504");
    }

    #[test]
    fn maps_view_space_when_scaled() {
        let (w, h, pixels) = buffer();
        let view = Rect::from_xywh(0.0, 0.0, 8.0, 4.0);
        let at = sample(&pixels, w, h, view, Point { x: 2.0, y: 2.0 }).unwrap();
        assert_eq!((at.x, at.y), (1, 1));
        assert_eq!((at.r, at.g, at.b), (66, 55, 44));
    }

    #[test]
    fn centered_patch_keeps_focus_in_the_middle() {
        let (w, h, pixels) = buffer();
        let patch = centered_bgra(&pixels, w, h, 1, 0, 21);
        assert_eq!(patch.len(), 21 * 21 * 4);
        let mid = ((10 * 21 + 10) * 4) as usize;
        assert_eq!(&patch[mid..mid + 4], &[40, 50, 60, 255]);
        assert_eq!(&patch[0..4], &[0, 0, 0, 0]);
    }
}
