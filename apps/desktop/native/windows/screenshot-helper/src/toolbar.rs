use crate::annotate::Tool;
use crate::geometry::{Point, Rect};

pub const HEIGHT: f64 = 52.0;
pub const BUTTON: f64 = 36.0;
const PAD: f64 = 8.0;
const GAP: f64 = 2.0;
const DIVIDER: f64 = 17.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Tool(Tool),
    Undo,
    Save,
    Cancel,
    Confirm,
}

pub fn items() -> [Action; 9] {
    [
        Action::Tool(Tool::Rectangle),
        Action::Tool(Tool::Ellipse),
        Action::Tool(Tool::Arrow),
        Action::Tool(Tool::Pen),
        Action::Tool(Tool::Mosaic),
        Action::Undo,
        Action::Save,
        Action::Cancel,
        Action::Confirm,
    ]
}

pub fn width() -> f64 {
    PAD + 9.0 * (BUTTON + GAP) + 2.0 * DIVIDER + PAD - GAP
}

pub fn divider_xs() -> [f64; 2] {
    [
        PAD + 5.0 * (BUTTON + GAP) + 8.0,
        PAD + 7.0 * (BUTTON + GAP) + DIVIDER + 8.0,
    ]
}

pub fn button_offset(index: usize) -> f64 {
    let mut x = PAD;
    for i in 0..index {
        if i == 5 || i == 7 {
            x += DIVIDER;
        }
        x += BUTTON + GAP;
    }
    if index == 5 || index == 7 {
        x += DIVIDER;
    }
    x
}

pub fn layout_origin(selection: Rect, view: Rect) -> Point {
    let w = width();
    let mut origin = Point {
        x: selection.min_x(),
        y: selection.max_y() + 8.0,
    };
    if origin.y + HEIGHT > view.max_y() - 8.0 {
        origin.y = selection.min_y() - HEIGHT - 8.0;
    }
    if origin.x + w > view.max_x() - 8.0 {
        origin.x = view.max_x() - w - 8.0;
    }
    if origin.x < 8.0 {
        origin.x = 8.0;
    }
    if origin.y < 8.0 {
        origin.y = 8.0;
    }
    origin
}

pub fn frame(origin: Point) -> Rect {
    Rect::from_xywh(origin.x, origin.y, width(), HEIGHT)
}

pub fn hit(origin: Point, point: Point) -> Option<Action> {
    if !frame(origin).contains(point) {
        return None;
    }
    let local_y = point.y - origin.y;
    if !((HEIGHT - BUTTON) / 2.0..=(HEIGHT + BUTTON) / 2.0).contains(&local_y) {
        return None;
    }
    for (index, action) in items().iter().enumerate() {
        let x = origin.x + button_offset(index);
        if point.x >= x && point.x < x + BUTTON {
            return Some(*action);
        }
    }
    None
}

/// Fire a toolbar control only when press and release hit the same button.
pub fn commit(origin: Point, pressed: Option<Action>, release: Point) -> Option<Action> {
    match (pressed, hit(origin, release)) {
        (Some(down), Some(up)) if down == up => Some(down),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_matches_mac_layout() {
        assert_eq!(width(), 8.0 + 9.0 * 38.0 + 2.0 * 17.0 + 8.0 - 2.0);
    }

    #[test]
    fn hits_each_control() {
        let origin = Point { x: 10.0, y: 20.0 };
        let mid_y = origin.y + HEIGHT / 2.0;
        for (index, action) in items().iter().enumerate() {
            let x = origin.x + button_offset(index) + BUTTON / 2.0;
            assert_eq!(hit(origin, Point { x, y: mid_y }), Some(*action));
        }
        assert_eq!(hit(origin, Point { x: 0.0, y: 0.0 }), None);
        let padding = Point {
            x: origin.x + 2.0,
            y: origin.y + HEIGHT / 2.0,
        };
        assert!(frame(origin).contains(padding));
        assert_eq!(hit(origin, padding), None);
        assert_eq!(commit(origin, None, padding), None);
    }

    #[test]
    fn commit_requires_same_button() {
        let origin = Point { x: 10.0, y: 20.0 };
        let mid_y = origin.y + HEIGHT / 2.0;
        let confirm_x = origin.x + button_offset(8) + BUTTON / 2.0;
        let confirm = Point {
            x: confirm_x,
            y: mid_y,
        };
        let cancel = Point {
            x: origin.x + button_offset(7) + BUTTON / 2.0,
            y: mid_y,
        };
        assert_eq!(hit(origin, confirm), Some(Action::Confirm));
        assert_eq!(
            commit(origin, Some(Action::Confirm), confirm),
            Some(Action::Confirm)
        );
        assert_eq!(commit(origin, Some(Action::Confirm), cancel), None);
        assert_eq!(
            commit(origin, Some(Action::Confirm), padding_of(origin)),
            None
        );
        assert_eq!(commit(origin, None, confirm), None);
    }

    fn padding_of(origin: Point) -> Point {
        Point {
            x: origin.x + 2.0,
            y: origin.y + HEIGHT / 2.0,
        }
    }
}
