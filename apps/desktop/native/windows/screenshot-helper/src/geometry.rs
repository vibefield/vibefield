//! Overlay geometry in Win32 client space (origin top-left, y down).

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn from_xywh(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn min_x(self) -> f64 {
        self.x
    }

    pub fn min_y(self) -> f64 {
        self.y
    }

    pub fn max_x(self) -> f64 {
        self.x + self.width
    }

    pub fn max_y(self) -> f64 {
        self.y + self.height
    }

    pub fn mid_x(self) -> f64 {
        self.x + self.width / 2.0
    }

    pub fn mid_y(self) -> f64 {
        self.y + self.height / 2.0
    }

    pub fn contains(self, point: Point) -> bool {
        point.x >= self.min_x()
            && point.x <= self.max_x()
            && point.y >= self.min_y()
            && point.y <= self.max_y()
    }

    pub fn intersection(self, other: Self) -> Self {
        let x = self.min_x().max(other.min_x());
        let y = self.min_y().max(other.min_y());
        let w = (self.max_x().min(other.max_x()) - x).max(0.0);
        let h = (self.max_y().min(other.max_y()) - y).max(0.0);
        Self {
            x,
            y,
            width: w,
            height: h,
        }
    }

    pub fn inset(self, dx: f64, dy: f64) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            width: (self.width - dx * 2.0).max(0.0),
            height: (self.height - dy * 2.0).max(0.0),
        }
    }

    #[allow(dead_code)]
    pub fn is_empty(self) -> bool {
        self.width < 1.0 || self.height < 1.0
    }

    pub fn to_i32(self) -> (i32, i32, i32, i32) {
        (
            self.x.round() as i32,
            self.y.round() as i32,
            self.width.round().max(0.0) as i32,
            self.height.round().max(0.0) as i32,
        )
    }
}

pub fn normalized_rect(a: Point, b: Point) -> Rect {
    Rect {
        x: a.x.min(b.x),
        y: a.y.min(b.y),
        width: (a.x - b.x).abs(),
        height: (a.y - b.y).abs(),
    }
}

pub fn clamp(rect: Rect, bounds: Rect) -> Rect {
    let mut r = rect;
    if r.width > bounds.width {
        r.width = bounds.width;
    }
    if r.height > bounds.height {
        r.height = bounds.height;
    }
    r.x = r.x.max(bounds.min_x()).min(bounds.max_x() - r.width);
    r.y = r.y.max(bounds.min_y()).min(bounds.max_y() - r.height);
    r
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

impl Handle {
    pub const ALL: [Handle; 8] = [
        Handle::TopLeft,
        Handle::Top,
        Handle::TopRight,
        Handle::Right,
        Handle::BottomRight,
        Handle::Bottom,
        Handle::BottomLeft,
        Handle::Left,
    ];

    pub fn rect(self, selection: Rect, size: f64) -> Rect {
        let point = match self {
            Handle::TopLeft => Point {
                x: selection.min_x(),
                y: selection.min_y(),
            },
            Handle::Top => Point {
                x: selection.mid_x(),
                y: selection.min_y(),
            },
            Handle::TopRight => Point {
                x: selection.max_x(),
                y: selection.min_y(),
            },
            Handle::Right => Point {
                x: selection.max_x(),
                y: selection.mid_y(),
            },
            Handle::BottomRight => Point {
                x: selection.max_x(),
                y: selection.max_y(),
            },
            Handle::Bottom => Point {
                x: selection.mid_x(),
                y: selection.max_y(),
            },
            Handle::BottomLeft => Point {
                x: selection.min_x(),
                y: selection.max_y(),
            },
            Handle::Left => Point {
                x: selection.min_x(),
                y: selection.mid_y(),
            },
        };
        Rect {
            x: point.x - size / 2.0,
            y: point.y - size / 2.0,
            width: size,
            height: size,
        }
    }

    pub fn hit(self, selection: Rect, point: Point) -> bool {
        self.rect(selection, 8.0).inset(-3.0, -3.0).contains(point)
    }

    pub fn apply(self, rect: Rect, delta: Point, bounds: Rect) -> Rect {
        let mut r = rect;
        match self {
            Handle::TopLeft => {
                r.x += delta.x;
                r.y += delta.y;
                r.width -= delta.x;
                r.height -= delta.y;
            }
            Handle::Top => {
                r.y += delta.y;
                r.height -= delta.y;
            }
            Handle::TopRight => {
                r.y += delta.y;
                r.width += delta.x;
                r.height -= delta.y;
            }
            Handle::Right => {
                r.width += delta.x;
            }
            Handle::BottomRight => {
                r.width += delta.x;
                r.height += delta.y;
            }
            Handle::Bottom => {
                r.height += delta.y;
            }
            Handle::BottomLeft => {
                r.x += delta.x;
                r.width -= delta.x;
                r.height += delta.y;
            }
            Handle::Left => {
                r.x += delta.x;
                r.width -= delta.x;
            }
        }
        if r.width < 4.0 {
            r.width = 4.0;
        }
        if r.height < 4.0 {
            r.height = 4.0;
        }
        clamp(r, bounds)
    }
}

/// Map a view-space rect onto snapshot pixels. Origin is floored so live blit
/// and confirm/save crops hit the same texels (scale may be non-integer).
pub fn map_view_to_image(
    view: Rect,
    rect: Rect,
    image_width: u32,
    image_height: u32,
) -> Option<(i32, i32, i32, i32)> {
    if view.width <= 0.0 || view.height <= 0.0 {
        return None;
    }
    let scale_x = image_width as f64 / view.width;
    let scale_y = image_height as f64 / view.height;
    let mut x = (rect.min_x() * scale_x).floor() as i32;
    let mut y = (rect.min_y() * scale_y).floor() as i32;
    let mut w = (rect.width * scale_x).round() as i32;
    let mut h = (rect.height * scale_y).round() as i32;
    x = x.max(0);
    y = y.max(0);
    if x >= image_width as i32 || y >= image_height as i32 {
        return None;
    }
    w = w.max(1).min(image_width as i32 - x);
    h = h.max(1).min(image_height as i32 - y);
    Some((x, y, w, h))
}

pub fn crop_bgra(
    pixels: &[u8],
    image_width: u32,
    image_height: u32,
    view: Rect,
    selection: Rect,
) -> Result<(u32, u32, Vec<u8>), String> {
    let (x, y, w, h) = map_view_to_image(view, selection, image_width, image_height)
        .ok_or_else(|| "selection is outside the snapshot".to_string())?;
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    let src_stride = image_width as usize * 4;
    let dst_stride = w as usize * 4;
    for row in 0..h as usize {
        let src = (y as usize + row) * src_stride + x as usize * 4;
        let dst = row * dst_stride;
        out[dst..dst + dst_stride].copy_from_slice(&pixels[src..src + dst_stride]);
    }
    Ok((w as u32, h as u32, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_rect_origin_and_size() {
        let rect = normalized_rect(Point { x: 30.0, y: 10.0 }, Point { x: 10.0, y: 40.0 });
        assert_eq!(rect, Rect::from_xywh(10.0, 10.0, 20.0, 30.0));
        let same = normalized_rect(Point { x: 5.0, y: 5.0 }, Point { x: 5.0, y: 5.0 });
        assert_eq!(same.width, 0.0);
        assert_eq!(same.height, 0.0);
    }

    #[test]
    fn clamp_keeps_or_shrinks() {
        let bounds = Rect::from_xywh(0.0, 0.0, 100.0, 80.0);
        let clamped = clamp(Rect::from_xywh(-20.0, -10.0, 40.0, 30.0), bounds);
        assert_eq!(clamped, Rect::from_xywh(0.0, 0.0, 40.0, 30.0));
        let too_wide = clamp(Rect::from_xywh(10.0, 10.0, 400.0, 10.0), bounds);
        assert_eq!(too_wide.width, 100.0);
        assert_eq!(too_wide.x, 0.0);
        let slid = clamp(Rect::from_xywh(0.0, 70.0, 10.0, 40.0), bounds);
        assert_eq!(slid.height, 40.0);
        assert_eq!(slid.y, 40.0);
    }

    #[test]
    fn handle_resize_y_down() {
        let bounds = Rect::from_xywh(0.0, 0.0, 200.0, 200.0);
        let rect = Rect::from_xywh(40.0, 50.0, 60.0, 40.0);
        let right = Handle::Right.apply(rect, Point { x: 15.0, y: 3.0 }, bounds);
        assert_eq!(right.width, 75.0);
        assert_eq!(right.x, 40.0);
        assert_eq!(right.height, 40.0);
        let left = Handle::Left.apply(rect, Point { x: 10.0, y: 0.0 }, bounds);
        assert_eq!(left.x, 50.0);
        assert_eq!(left.width, 50.0);
        let top = Handle::Top.apply(rect, Point { x: 0.0, y: 8.0 }, bounds);
        assert_eq!(top.y, 58.0);
        assert_eq!(top.height, 32.0);
        let bottom = Handle::Bottom.apply(rect, Point { x: 0.0, y: 8.0 }, bounds);
        assert_eq!(bottom.y, 50.0);
        assert_eq!(bottom.height, 48.0);
        let tiny = Handle::Right.apply(rect, Point { x: -1000.0, y: 0.0 }, bounds);
        assert!(tiny.width >= 4.0);
    }

    #[test]
    fn view_to_image_floors_origin_like_crop() {
        let view = Rect::from_xywh(0.0, 0.0, 100.0, 100.0);
        let rect = Rect::from_xywh(11.0, 0.0, 10.0, 10.0);
        // 11 * 1.5 = 16.5 → floor 16, not round 17
        assert_eq!(
            map_view_to_image(view, rect, 150, 150),
            Some((16, 0, 15, 15))
        );
    }

    #[test]
    fn crop_maps_view_to_image() {
        let mut pixels = vec![0u8; 8 * 8 * 4];
        for y in 0..8 {
            for x in 0..8 {
                let i = (y * 8 + x) * 4;
                pixels[i] = x as u8;
                pixels[i + 1] = y as u8;
                pixels[i + 2] = 9;
                pixels[i + 3] = 255;
            }
        }
        let view = Rect::from_xywh(0.0, 0.0, 8.0, 8.0);
        let (w, h, out) =
            crop_bgra(&pixels, 8, 8, view, Rect::from_xywh(2.0, 3.0, 2.0, 2.0)).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&out[0..4], &[2, 3, 9, 255]);
        assert_eq!(&out[4..8], &[3, 3, 9, 255]);
        assert_eq!(&out[8..12], &[2, 4, 9, 255]);
    }

    #[test]
    fn crop_scales_when_view_differs() {
        let mut pixels = vec![0u8; 4 * 4 * 4];
        for y in 0..4 {
            for x in 0..4 {
                let i = (y * 4 + x) * 4;
                pixels[i] = x as u8 * 10;
                pixels[i + 1] = y as u8 * 10;
                pixels[i + 2] = 1;
                pixels[i + 3] = 255;
            }
        }
        let view = Rect::from_xywh(0.0, 0.0, 8.0, 8.0);
        let (w, h, out) =
            crop_bgra(&pixels, 4, 4, view, Rect::from_xywh(2.0, 2.0, 4.0, 4.0)).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&out[0..4], &[10, 10, 1, 255]);
    }
}
