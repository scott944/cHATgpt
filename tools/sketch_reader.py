#!/usr/bin/env python3
"""
sketch_reader.py - Architectural Hand Sketch Reader
====================================================
For Scott Dellar, Absolute Drafting, NSW Australia.

Reads scanned graph-paper sketches with coloured dot annotations,
detects dot positions, maps to grid coordinates, and generates DXF
files for ArchiCAD import.

Scott's 6-Step Method:
  PRE:  Grid from graph paper (A-L cols, 1-23 rows, 1m/square)
  1. Purple/maroon dots = perimeter wall corners
  2. Blue/teal dots    = internal wall intersections
  3. Green dots        = exterior elements (verandas/decks)
  4. Connect with H/V lines ONLY (diagonal = error)
  5. Apply 110mm wall thickness (+/-55mm from centreline)
  6. Confirm dimensions with Scott before nudging

Usage (via Desktop Commander in Claude Desktop App):
  python sketch_reader.py --input scan.pdf --job "25056_Griffiths" --output ./DXF_Output

Required: pymupdf, pillow, numpy, opencv-python, ezdxf, scipy
"""

import argparse
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

try:
    import fitz  # pymupdf
except ImportError:
    fitz = None

try:
    import ezdxf
    from ezdxf.enums import TextEntityAlignment
except ImportError:
    ezdxf = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COLUMN_LABELS = list("ABCDEFGHIJKL")  # A-L
ROW_MIN, ROW_MAX = 1, 23
VALID_DECIMALS = {0.0, 0.2, 0.4, 0.6, 0.8}

# HSV colour ranges (OpenCV uses H: 0-179, S: 0-255, V: 0-255)
COLOUR_RANGES = {
    "purple": {"lower": np.array([120, 40, 40]), "upper": np.array([170, 255, 255])},
    "blue":   {"lower": np.array([80, 40, 40]),  "upper": np.array([120, 255, 255])},
    "green":  {"lower": np.array([35, 40, 40]),  "upper": np.array([80, 255, 255])},
}

LAYER_CONFIG = {
    "purple": {"layer": "WALLS-PERIMETER", "color": 7},
    "blue":   {"layer": "WALLS-INTERNAL",  "color": 8},
    "green":  {"layer": "WALLS-EXTERIOR",  "color": 3},
}

DXF_LAYERS = {
    "WALLS-PERIMETER": {"color": 7, "linetype": "Continuous"},
    "WALLS-INTERNAL":  {"color": 8, "linetype": "Continuous"},
    "WALLS-EXTERIOR":  {"color": 3, "linetype": "Continuous"},
    "WALLS-CENTRE":    {"color": 8, "linetype": "DASHED"},
    "GRID":            {"color": 4, "linetype": "Continuous"},
    "DOTS":            {"color": 2, "linetype": "Continuous"},
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class GridCoord:
    """A grid coordinate in slash notation, e.g. G.6/16.4"""
    col_label: str       # e.g. "G"
    col_frac: float      # e.g. 0.6
    row_int: int         # e.g. 16
    row_frac: float      # e.g. 0.4

    @property
    def col_index(self) -> float:
        return COLUMN_LABELS.index(self.col_label) + self.col_frac

    @property
    def row_value(self) -> float:
        return self.row_int + self.row_frac

    @property
    def slash(self) -> str:
        col = self.col_label
        if self.col_frac > 0:
            col += f".{int(self.col_frac * 10)}"
        row = str(self.row_int)
        if self.row_frac > 0:
            row += f".{int(self.row_frac * 10)}"
        return f"{col}/{row}"

    def to_mm(self, scale: float = 1000.0) -> Tuple[float, float]:
        x = self.col_index * scale
        y = self.row_value * scale
        return (x, y)

    def __repr__(self):
        return f"GridCoord({self.slash})"


@dataclass
class DetectedDot:
    """A detected coloured dot with pixel and grid positions."""
    px_x: float
    px_y: float
    area: float
    colour: str
    coord: Optional[GridCoord] = None


@dataclass
class Wall:
    """A wall segment between two grid coordinates."""
    start: GridCoord
    end: GridCoord
    thickness: float
    category: str  # purple, blue, green

    @property
    def is_horizontal(self) -> bool:
        return abs(self.start.row_value - self.end.row_value) < 0.05

    @property
    def is_vertical(self) -> bool:
        return abs(self.start.col_index - self.end.col_index) < 0.05

    @property
    def is_valid(self) -> bool:
        return self.is_horizontal or self.is_vertical


# ---------------------------------------------------------------------------
# 1. Image Loading
# ---------------------------------------------------------------------------

def load_image(input_path: str, dpi: int = 300) -> np.ndarray:
    """Load PDF or image file, return as BGR numpy array."""
    path = Path(input_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    ext = path.suffix.lower()
    if ext == ".pdf":
        if fitz is None:
            raise ImportError("pymupdf (fitz) is required for PDF input. Install: pip install pymupdf")
        print(f"  Loading PDF: {path.name} at {dpi} DPI...")
        doc = fitz.open(str(path))
        page = doc[0]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        img_array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
        doc.close()
        if img_array.shape[2] == 4:  # RGBA
            img_array = cv2.cvtColor(img_array, cv2.COLOR_RGBA2BGR)
        elif img_array.shape[2] == 3:  # RGB
            img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
        print(f"  Image size: {img_array.shape[1]}x{img_array.shape[0]} px")
        return img_array
    elif ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"):
        print(f"  Loading image: {path.name}...")
        pil_img = Image.open(str(path)).convert("RGB")
        img_array = np.array(pil_img)
        img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
        print(f"  Image size: {img_array.shape[1]}x{img_array.shape[0]} px")
        return img_array
    else:
        raise ValueError(f"Unsupported file format: {ext}")


# ---------------------------------------------------------------------------
# 2. Grid Detection
# ---------------------------------------------------------------------------

def detect_grid(img: np.ndarray, num_cols: int = 12, num_rows: int = 23
                ) -> Tuple[Dict[str, float], Dict[int, float], float]:
    """
    Detect major grid lines on graph paper.

    Returns:
        col_positions: dict mapping column label -> pixel X position
        row_positions: dict mapping row number -> pixel Y position
        px_per_mm: pixels per millimetre
    """
    print("  Detecting grid lines...")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Try to detect grid lines via edge detection
    # Apply adaptive threshold to find dark lines
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(blurred, 180, 255, cv2.THRESH_BINARY_INV)

    # Project onto axes to find line positions
    h_proj = np.sum(binary, axis=1).astype(float)
    v_proj = np.sum(binary, axis=0).astype(float)

    # Find peaks in projections (grid lines)
    h_peaks = _find_grid_peaks(h_proj, expected_count=num_rows + 1)
    v_peaks = _find_grid_peaks(v_proj, expected_count=num_cols + 1)

    if len(h_peaks) >= 2 and len(v_peaks) >= 2:
        # Use detected lines
        print(f"  Found {len(v_peaks)} vertical, {len(h_peaks)} horizontal grid lines")
    else:
        # Fallback: divide image evenly
        print("  Grid detection weak, using uniform spacing fallback")
        margin_x = int(w * 0.05)
        margin_y = int(h * 0.05)
        v_peaks = np.linspace(margin_x, w - margin_x, num_cols + 1).astype(int)
        h_peaks = np.linspace(margin_y, h - margin_y, num_rows + 1).astype(int)

    # Map to labels
    col_positions = {}
    for i, label in enumerate(COLUMN_LABELS[:num_cols]):
        if i < len(v_peaks):
            col_positions[label] = float(v_peaks[i])

    row_positions = {}
    for i in range(num_rows):
        row_num = i + 1
        if i < len(h_peaks):
            row_positions[row_num] = float(h_peaks[i])

    # Compute scale
    if len(v_peaks) >= 2:
        avg_col_spacing = np.mean(np.diff(sorted(v_peaks)))
    else:
        avg_col_spacing = w / num_cols

    px_per_mm = avg_col_spacing / 1000.0  # 1 grid square = 1000mm
    print(f"  Scale: {px_per_mm:.4f} px/mm ({avg_col_spacing:.1f} px per grid square)")

    return col_positions, row_positions, px_per_mm


def _find_grid_peaks(projection: np.ndarray, expected_count: int,
                     min_distance: int = 20) -> np.ndarray:
    """Find peaks in a projection that likely correspond to grid lines."""
    try:
        from scipy.signal import find_peaks as scipy_find_peaks
        # Normalize
        proj = projection / (projection.max() + 1e-8)
        # Find peaks with minimum distance
        min_dist = max(min_distance, len(projection) // (expected_count * 3))
        peaks, properties = scipy_find_peaks(proj, distance=min_dist, height=0.15)

        if len(peaks) > expected_count + 2:
            # Too many - keep the strongest
            heights = properties["peak_heights"]
            top_idx = np.argsort(heights)[-expected_count:]
            peaks = np.sort(peaks[top_idx])

        return peaks
    except ImportError:
        # Fallback without scipy
        return np.array([])


# ---------------------------------------------------------------------------
# 3. Dot Detection (OpenCV)
# ---------------------------------------------------------------------------

def snap_to_grid(value: float) -> float:
    """Snap a float value to the nearest 0.2 increment."""
    snapped = round(value * 5) / 5  # nearest 0.2
    frac = snapped - int(snapped)
    # Ensure fraction is in valid set
    frac_rounded = round(frac, 1)
    if frac_rounded not in {0.0, 0.2, 0.4, 0.6, 0.8, 1.0}:
        # Find nearest valid
        valid = [0.0, 0.2, 0.4, 0.6, 0.8]
        frac_rounded = min(valid, key=lambda v: abs(v - frac))
    if frac_rounded >= 1.0:
        return float(int(snapped) + 1)
    return float(int(snapped)) + frac_rounded


def pixel_to_grid(px_x: float, px_y: float,
                  col_positions: Dict[str, float],
                  row_positions: Dict[int, float],
                  scale: float = 1000.0) -> Optional[GridCoord]:
    """Convert pixel coordinates to grid coordinates."""
    sorted_cols = sorted(col_positions.items(), key=lambda x: x[1])
    sorted_rows = sorted(row_positions.items(), key=lambda x: x[1])

    if len(sorted_cols) < 2 or len(sorted_rows) < 2:
        return None

    # Find column position
    col_idx = _interpolate_position(px_x, sorted_cols)
    if col_idx is None:
        return None

    # Find row position
    row_val = _interpolate_position_rows(px_y, sorted_rows)
    if row_val is None:
        return None

    # Snap to 200mm increments
    col_idx = snap_to_grid(col_idx)
    row_val = snap_to_grid(row_val)

    # Extract label and fraction
    col_int = int(col_idx)
    col_frac = round(col_idx - col_int, 1)
    if col_int < 0 or col_int >= len(COLUMN_LABELS):
        return None
    col_label = COLUMN_LABELS[col_int]

    row_int = int(row_val)
    row_frac = round(row_val - row_int, 1)

    if col_frac >= 1.0:
        col_frac = 0.0
        col_int += 1
        if col_int >= len(COLUMN_LABELS):
            return None
        col_label = COLUMN_LABELS[col_int]

    if row_frac >= 1.0:
        row_frac = 0.0
        row_int += 1

    return GridCoord(col_label=col_label, col_frac=col_frac,
                     row_int=row_int, row_frac=row_frac)


def _interpolate_position(px: float, sorted_items: list) -> Optional[float]:
    """Interpolate pixel position to grid index for columns."""
    labels, positions = zip(*sorted_items)
    positions = list(positions)

    if px <= positions[0]:
        return 0.0
    if px >= positions[-1]:
        return float(len(positions) - 1)

    for i in range(len(positions) - 1):
        if positions[i] <= px <= positions[i + 1]:
            frac = (px - positions[i]) / (positions[i + 1] - positions[i])
            idx_i = COLUMN_LABELS.index(labels[i])
            idx_next = COLUMN_LABELS.index(labels[i + 1])
            return idx_i + frac * (idx_next - idx_i)
    return None


def _interpolate_position_rows(px: float, sorted_items: list) -> Optional[float]:
    """Interpolate pixel position to grid value for rows."""
    row_nums, positions = zip(*sorted_items)
    row_nums = list(row_nums)
    positions = list(positions)

    if px <= positions[0]:
        return float(row_nums[0])
    if px >= positions[-1]:
        return float(row_nums[-1])

    for i in range(len(positions) - 1):
        if positions[i] <= px <= positions[i + 1]:
            frac = (px - positions[i]) / (positions[i + 1] - positions[i])
            return row_nums[i] + frac * (row_nums[i + 1] - row_nums[i])
    return None


def detect_dots(img: np.ndarray,
                col_positions: Dict[str, float],
                row_positions: Dict[int, float],
                min_area: int = 20,
                debug: bool = False,
                debug_dir: Optional[str] = None
                ) -> Dict[str, List[DetectedDot]]:
    """
    Detect coloured dots in the image using HSV colour masking.

    Returns dict with keys 'purple', 'blue', 'green',
    each containing a list of DetectedDot objects.
    """
    print("  Detecting coloured dots...")
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    results = {}

    for colour_name, ranges in COLOUR_RANGES.items():
        mask = cv2.inRange(hsv, ranges["lower"], ranges["upper"])

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        dots = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue
            M = cv2.moments(contour)
            if M["m00"] == 0:
                continue
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

            coord = pixel_to_grid(cx, cy, col_positions, row_positions)
            dots.append(DetectedDot(px_x=cx, px_y=cy, area=area,
                                    colour=colour_name, coord=coord))

        # Sort dots by coordinate for consistent output
        dots.sort(key=lambda d: (d.coord.col_index if d.coord else 999,
                                  d.coord.row_value if d.coord else 999))
        results[colour_name] = dots
        print(f"    {colour_name}: {len(dots)} dots detected")

        if debug and debug_dir:
            debug_path = os.path.join(debug_dir, f"debug_mask_{colour_name}.png")
            cv2.imwrite(debug_path, mask)
            print(f"    Debug mask saved: {debug_path}")

    return results


# ---------------------------------------------------------------------------
# 4. Wall Generation
# ---------------------------------------------------------------------------

def generate_walls(dots: Dict[str, List[DetectedDot]],
                   wall_thickness: float = 110.0) -> List[Wall]:
    """
    Connect dots that share a column or row to form walls.
    Only horizontal and vertical walls are allowed - diagonal = error.
    """
    print("  Generating walls...")
    walls = []
    warnings = []

    for colour_name, dot_list in dots.items():
        coords = [d.coord for d in dot_list if d.coord is not None]
        if len(coords) < 2:
            continue

        thickness = wall_thickness

        # Find pairs that share column or row
        connected = set()
        for i in range(len(coords)):
            for j in range(i + 1, len(coords)):
                c1, c2 = coords[i], coords[j]

                is_h = abs(c1.row_value - c2.row_value) < 0.05
                is_v = abs(c1.col_index - c2.col_index) < 0.05

                if is_h or is_v:
                    # Check no other dot lies between them on the same line
                    between = False
                    for k in range(len(coords)):
                        if k == i or k == j:
                            continue
                        ck = coords[k]
                        if is_h and abs(ck.row_value - c1.row_value) < 0.05:
                            if min(c1.col_index, c2.col_index) < ck.col_index < max(c1.col_index, c2.col_index):
                                between = True
                                break
                        if is_v and abs(ck.col_index - c1.col_index) < 0.05:
                            if min(c1.row_value, c2.row_value) < ck.row_value < max(c1.row_value, c2.row_value):
                                between = True
                                break

                    if not between:
                        wall = Wall(start=c1, end=c2, thickness=thickness,
                                    category=colour_name)
                        walls.append(wall)
                        connected.add(i)
                        connected.add(j)

        unconnected = [coords[i].slash for i in range(len(coords))
                       if i not in connected]
        if unconnected:
            warnings.append(f"    WARNING [{colour_name}]: unconnected dots: {', '.join(unconnected)}")

    # Validate all walls
    valid_walls = []
    for wall in walls:
        if wall.is_valid:
            valid_walls.append(wall)
        else:
            dx = abs(wall.start.col_index - wall.end.col_index)
            dy = abs(wall.start.row_value - wall.end.row_value)
            print(f"    ERROR: Diagonal wall rejected: {wall.start.slash} -> {wall.end.slash} "
                  f"(dx={dx:.1f}, dy={dy:.1f})")

    for w in warnings:
        print(w)

    h_count = sum(1 for w in valid_walls if w.is_horizontal)
    v_count = sum(1 for w in valid_walls if w.is_vertical)
    print(f"  Walls generated: {len(valid_walls)} ({h_count} horizontal, {v_count} vertical)")
    if len(walls) != len(valid_walls):
        print(f"  Diagonal walls rejected: {len(walls) - len(valid_walls)}")

    return valid_walls


# ---------------------------------------------------------------------------
# 5. DXF Output
# ---------------------------------------------------------------------------

def create_dxf(walls: List[Wall],
               dots: Dict[str, List[DetectedDot]],
               col_positions: Dict[str, float],
               row_positions: Dict[int, float],
               scale: float = 1000.0,
               output_path: str = "output.dxf") -> None:
    """Generate a DXF file with walls, grid, and dot markers."""
    if ezdxf is None:
        raise ImportError("ezdxf is required for DXF output. Install: pip install ezdxf")

    print(f"  Creating DXF: {output_path}")
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Set units to millimetres
    doc.header["$INSUNITS"] = 4  # mm
    doc.header["$MEASUREMENT"] = 1  # metric

    # Add DASHED linetype
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add("DASHED", pattern="A,5.0,-5.0",
                          description="Dashed line __ __ __")

    # Create layers
    for layer_name, config in DXF_LAYERS.items():
        doc.layers.add(layer_name,
                       color=config["color"],
                       linetype=config.get("linetype", "Continuous"))

    # --- Grid lines ---
    _draw_grid(msp, scale)

    # --- Dot markers ---
    _draw_dots(msp, dots, scale)

    # --- Walls ---
    _draw_walls(msp, walls, scale)

    doc.saveas(output_path)
    print(f"  DXF saved: {output_path}")


def _draw_grid(msp, scale: float) -> None:
    """Draw grid lines and labels on the GRID layer."""
    max_col = len(COLUMN_LABELS) - 1
    max_row = ROW_MAX

    for i, label in enumerate(COLUMN_LABELS):
        x = i * scale
        msp.add_line((x, ROW_MIN * scale), (x, max_row * scale),
                      dxfattribs={"layer": "GRID"})
        msp.add_text(label, height=scale * 0.3,
                     dxfattribs={"layer": "GRID"}).set_placement(
                         (x, (ROW_MIN - 0.8) * scale),
                         align=TextEntityAlignment.CENTER)

    for row in range(ROW_MIN, max_row + 1):
        y = row * scale
        msp.add_line((0, y), (max_col * scale, y),
                      dxfattribs={"layer": "GRID"})
        msp.add_text(str(row), height=scale * 0.3,
                     dxfattribs={"layer": "GRID"}).set_placement(
                         (-0.6 * scale, y),
                         align=TextEntityAlignment.CENTER)


def _draw_dots(msp, dots: Dict[str, List[DetectedDot]], scale: float) -> None:
    """Draw dot markers as circles with labels on the DOTS layer."""
    radius = scale * 0.15  # 150mm radius marker

    for colour_name, dot_list in dots.items():
        for dot in dot_list:
            if dot.coord is None:
                continue
            x, y = dot.coord.to_mm(scale)
            msp.add_circle((x, y), radius,
                           dxfattribs={"layer": "DOTS"})
            msp.add_text(dot.coord.slash, height=scale * 0.15,
                         dxfattribs={"layer": "DOTS"}).set_placement(
                             (x + radius * 1.2, y),
                             align=TextEntityAlignment.LEFT)


def _draw_walls(msp, walls: List[Wall], scale: float) -> None:
    """Draw wall centrelines and thickness rectangles."""
    for wall in walls:
        layer_name = LAYER_CONFIG[wall.category]["layer"]
        sx, sy = wall.start.to_mm(scale)
        ex, ey = wall.end.to_mm(scale)
        half_t = wall.thickness / 2.0

        # Centreline (dashed)
        msp.add_line((sx, sy), (ex, ey),
                     dxfattribs={"layer": "WALLS-CENTRE"})

        # Wall rectangle (4 lines offset by +/- half thickness)
        if wall.is_horizontal:
            # Offset in Y
            msp.add_line((sx, sy - half_t), (ex, ey - half_t),
                         dxfattribs={"layer": layer_name})
            msp.add_line((sx, sy + half_t), (ex, ey + half_t),
                         dxfattribs={"layer": layer_name})
            msp.add_line((sx, sy - half_t), (sx, sy + half_t),
                         dxfattribs={"layer": layer_name})
            msp.add_line((ex, ey - half_t), (ex, ey + half_t),
                         dxfattribs={"layer": layer_name})
        elif wall.is_vertical:
            # Offset in X
            msp.add_line((sx - half_t, sy), (ex - half_t, ey),
                         dxfattribs={"layer": layer_name})
            msp.add_line((sx + half_t, sy), (ex + half_t, ey),
                         dxfattribs={"layer": layer_name})
            msp.add_line((sx - half_t, sy), (sx + half_t, sy),
                         dxfattribs={"layer": layer_name})
            msp.add_line((ex - half_t, ey), (ex + half_t, ey),
                         dxfattribs={"layer": layer_name})


# ---------------------------------------------------------------------------
# 6. Coordinate Text Output
# ---------------------------------------------------------------------------

def save_coordinates(dots: Dict[str, List[DetectedDot]],
                     job: str, output_dir: str) -> str:
    """Save detected coordinates to a text file."""
    filename = f"{job}_coords.txt"
    filepath = os.path.join(output_dir, filename)

    lines = []
    colour_map = {"purple": "PURPLE", "blue": "BLUE", "green": "GREEN"}

    for colour_name in ["purple", "blue", "green"]:
        dot_list = dots.get(colour_name, [])
        coord_strs = [d.coord.slash for d in dot_list if d.coord is not None]
        label = colour_map[colour_name]
        lines.append(f"{label}: {', '.join(coord_strs)}")

    text = "\n".join(lines) + "\n"
    with open(filepath, "w") as f:
        f.write(text)

    print(f"  Coordinates saved: {filepath}")
    return filepath


# ---------------------------------------------------------------------------
# Coordinate Parsing (for manual/test data input)
# ---------------------------------------------------------------------------

def parse_coord_string(s: str) -> Optional[GridCoord]:
    """
    Parse a slash-notation coordinate string like 'G.6/16.4' or 'D/2'.

    Format: ColLabel[.digit]/RowInt[.digit]
    """
    s = s.strip()
    match = re.match(r"^([A-L])(?:\.(\d))?/(\d+)(?:\.(\d))?$", s)
    if not match:
        return None

    col_label = match.group(1)
    col_frac = int(match.group(2)) / 10.0 if match.group(2) else 0.0
    row_int = int(match.group(3))
    row_frac = int(match.group(4)) / 10.0 if match.group(4) else 0.0

    # Validate fractions
    if col_frac not in VALID_DECIMALS or row_frac not in VALID_DECIMALS:
        print(f"  WARNING: Invalid decimal in coordinate {s} "
              f"(col_frac={col_frac}, row_frac={row_frac})")
        col_frac = min(VALID_DECIMALS, key=lambda v: abs(v - col_frac))
        row_frac = min(VALID_DECIMALS, key=lambda v: abs(v - row_frac))

    return GridCoord(col_label=col_label, col_frac=col_frac,
                     row_int=row_int, row_frac=row_frac)


def parse_coord_list(text: str) -> List[GridCoord]:
    """Parse a comma-separated list of slash-notation coordinates."""
    coords = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        coord = parse_coord_string(part)
        if coord:
            coords.append(coord)
        else:
            print(f"  WARNING: Could not parse coordinate: '{part}'")
    return coords


# ---------------------------------------------------------------------------
# Test Data: Griffiths Street known-good coordinates
# ---------------------------------------------------------------------------

GRIFFITHS_TEST_DATA = {
    "purple": "D/2, G.6/2, G.6/2.8, K.2/2.8, K.2/6.8, J.6/6.8, J.6/8.4, K.2/8.4, K.2/16.4, G.6/16.4, G.6/18.4, D/18.4",
    "blue": "G.6/4, K/4, K/6.8, G.6/6.8, H.8/6.8, H.8/8.4, I.6/8, G.6/8, G.6/11, K/11, K/14.2, G.6/14.2",
    "green": "G.6/1.4, J.6/1.4, J.6/2.8, J/17.6, J/21.8, D.8/21.8",
}


def run_test_data(job: str, output_dir: str, scale: float = 1000.0,
                  wall_thickness: float = 110.0) -> None:
    """Run with Griffiths Street test data (no image needed)."""
    print("\n=== RUNNING WITH GRIFFITHS STREET TEST DATA ===\n")

    dots = {}
    for colour_name, coord_text in GRIFFITHS_TEST_DATA.items():
        coord_list = parse_coord_list(coord_text)
        dot_list = []
        for coord in coord_list:
            x, y = coord.to_mm(scale)
            dot = DetectedDot(px_x=0, px_y=0, area=100,
                              colour=colour_name, coord=coord)
            dot_list.append(dot)
        dots[colour_name] = dot_list
        print(f"  {colour_name}: {len(dot_list)} dots loaded")

    walls = generate_walls(dots, wall_thickness)

    # Build grid positions from test data (synthetic)
    col_positions = {label: float(i) for i, label in enumerate(COLUMN_LABELS)}
    row_positions = {i: float(i) for i in range(ROW_MIN, ROW_MAX + 1)}

    # DXF output
    dxf_path = os.path.join(output_dir, f"{job}.dxf")
    create_dxf(walls, dots, col_positions, row_positions, scale, dxf_path)

    # Coordinate text output
    save_coordinates(dots, job, output_dir)

    _print_summary(dots, walls)


# ---------------------------------------------------------------------------
# Summary & Main
# ---------------------------------------------------------------------------

def _print_summary(dots: Dict[str, List[DetectedDot]], walls: List[Wall]) -> None:
    """Print a summary of detected features."""
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    colour_labels = {"purple": "PURPLE (perimeter)", "blue": "BLUE (internal)",
                     "green": "GREEN (exterior)"}

    total_dots = 0
    for colour_name in ["purple", "blue", "green"]:
        dot_list = dots.get(colour_name, [])
        coord_strs = [d.coord.slash for d in dot_list if d.coord is not None]
        label = colour_labels[colour_name]
        print(f"  {label}: {len(coord_strs)} dots")
        if coord_strs:
            print(f"    {', '.join(coord_strs)}")
        total_dots += len(coord_strs)

    print(f"\n  Total dots: {total_dots}")
    print(f"  Total walls: {len(walls)}")

    h_walls = [w for w in walls if w.is_horizontal]
    v_walls = [w for w in walls if w.is_vertical]
    print(f"    Horizontal: {len(h_walls)}")
    print(f"    Vertical:   {len(v_walls)}")

    # Wall summary by category
    for cat in ["purple", "blue", "green"]:
        cat_walls = [w for w in walls if w.category == cat]
        if cat_walls:
            print(f"\n  {colour_labels[cat]} walls ({len(cat_walls)}):")
            for w in cat_walls:
                direction = "H" if w.is_horizontal else "V"
                sx, sy = w.start.to_mm()
                ex, ey = w.end.to_mm()
                length = abs(ex - sx) + abs(ey - sy)
                print(f"    [{direction}] {w.start.slash} -> {w.end.slash}  "
                      f"({length:.0f}mm, {w.thickness:.0f}mm thick)")

    print("\n" + "=" * 60)
    print("STEP 6 REMINDER: Confirm dimensions with Scott before nudging!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Sketch Reader - Detect coloured dots on architectural "
                    "hand sketches and generate DXF files.",
        epilog="For Scott Dellar, Absolute Drafting, NSW Australia."
    )
    parser.add_argument("--input", "-i",
                        help="Input PDF or image file path")
    parser.add_argument("--job", "-j", required=True,
                        help="Job name (e.g. 25056_Griffiths)")
    parser.add_argument("--output", "-o", default=".",
                        help="Output directory (default: current directory)")
    parser.add_argument("--scale", type=float, default=1000.0,
                        help="Millimetres per grid square (default: 1000)")
    parser.add_argument("--wall-thickness", type=float, default=110.0,
                        help="Wall thickness in mm (default: 110)")
    parser.add_argument("--min-dot-area", type=int, default=20,
                        help="Minimum contour area for dot detection (default: 20)")
    parser.add_argument("--debug", action="store_true",
                        help="Save debug images (colour masks)")
    parser.add_argument("--test", action="store_true",
                        help="Run with Griffiths Street test data (no input image needed)")

    args = parser.parse_args()

    print("=" * 60)
    print("SKETCH READER - Absolute Drafting")
    print(f"Job: {args.job}")
    print("=" * 60)

    # Ensure output directory exists
    os.makedirs(args.output, exist_ok=True)

    # Test mode
    if args.test:
        run_test_data(args.job, args.output, args.scale, args.wall_thickness)
        return

    # Normal mode - require input file
    if not args.input:
        parser.error("--input is required (or use --test for test data)")

    try:
        # Step 1: Load image
        print("\n[STEP 1] Loading image...")
        img = load_image(args.input)

        # Step 2: Detect grid
        print("\n[STEP PRE] Detecting grid...")
        col_positions, row_positions, px_per_mm = detect_grid(img)

        # Step 3: Detect dots
        print("\n[STEPS 1-3] Detecting coloured dots...")
        debug_dir = args.output if args.debug else None
        dots = detect_dots(img, col_positions, row_positions,
                           min_area=args.min_dot_area,
                           debug=args.debug, debug_dir=debug_dir)

        # Step 4: Generate walls
        print("\n[STEP 4] Generating walls (H/V only)...")
        walls = generate_walls(dots, args.wall_thickness)

        # Step 5: DXF output
        print("\n[STEP 5] Creating DXF output...")
        dxf_path = os.path.join(args.output, f"{args.job}.dxf")
        create_dxf(walls, dots, col_positions, row_positions,
                   args.scale, dxf_path)

        # Step 6: Coordinate text output
        print("\n[STEP 6] Saving coordinates...")
        save_coordinates(dots, args.job, args.output)

        # Summary
        _print_summary(dots, walls)

    except FileNotFoundError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except ImportError as e:
        print(f"\nERROR: Missing dependency - {e}", file=sys.stderr)
        print("Install required packages: pip install pymupdf pillow numpy opencv-python ezdxf scipy",
              file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
