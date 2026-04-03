#!/usr/bin/env python3
"""
sketch_reader.py - Sketch Reader for Absolute Drafting
Reads coloured dots from scanned architectural hand sketches,
maps them to grid coordinates, and generates DXF files.

Scott's 6-Step Method:
  PRE:  Grid from graph paper (A-L columns, 1-23 rows, 1m squares)
  1:    Purple dots = perimeter wall corners
  2:    Blue/teal dots = internal wall intersections
  3:    Green dots = exterior elements (verandas/decks)
  4:    Connect dots H/V only — diagonal = error
  5:    Apply 110mm wall thickness (±55mm from centreline)
  6:    Confirm dimensions with Scott before adjusting

Usage:
  python sketch_reader.py --input scan.pdf --job "25056_Griffiths" --output ./DXF_Output
"""

import argparse
import math
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Lazy imports — fail gracefully with install instructions
# ---------------------------------------------------------------------------

def _check_imports():
    missing = []
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    try:
        import cv2  # noqa: F401
    except ImportError:
        missing.append("opencv-python")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        missing.append("pillow")
    try:
        import ezdxf  # noqa: F401
    except ImportError:
        missing.append("ezdxf")
    # pymupdf is optional — only needed for PDF input
    if missing:
        print(f"ERROR: Missing libraries: {', '.join(missing)}")
        print(f"Install with:  pip install {' '.join(missing)}")
        sys.exit(1)

_check_imports()

import numpy as np
import cv2
from PIL import Image
import ezdxf

# Optional PDF support
try:
    import fitz  # pymupdf
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False


# ============================================================================
# COLOUR DEFINITIONS (HSV ranges for dot detection)
# ============================================================================

# OpenCV uses H: 0-179, S: 0-255, V: 0-255
COLOUR_RANGES = {
    "purple": {
        "lower": np.array([120, 40, 40]),
        "upper": np.array([170, 255, 255]),
        "label": "PURPLE",
        "category": "perimeter",
    },
    "blue": {
        "lower": np.array([80, 40, 40]),
        "upper": np.array([120, 255, 255]),
        "label": "BLUE",
        "category": "internal",
    },
    "green": {
        "lower": np.array([35, 40, 40]),
        "upper": np.array([80, 255, 255]),
        "label": "GREEN",
        "category": "external",
    },
}


# ============================================================================
# 1. IMAGE LOADING
# ============================================================================

def load_image(input_path: str) -> np.ndarray:
    """Load a PDF or image file, return as BGR numpy array."""
    path = Path(input_path)
    if not path.exists():
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)

    ext = path.suffix.lower()

    if ext == ".pdf":
        if not HAS_PYMUPDF:
            print("ERROR: PDF support requires pymupdf. Install: pip install pymupdf")
            sys.exit(1)
        doc = fitz.open(str(path))
        page = doc[0]
        # Render at 300 DPI
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        if pix.n == 4:  # RGBA
            img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        elif pix.n == 3:  # RGB
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        doc.close()
        print(f"Loaded PDF: {pix.width}x{pix.height} @ 300 DPI")
        return img

    elif ext in (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"):
        img = cv2.imread(str(path))
        if img is None:
            print(f"ERROR: Could not read image: {input_path}")
            sys.exit(1)
        h, w = img.shape[:2]
        print(f"Loaded image: {w}x{h}")
        return img

    else:
        print(f"ERROR: Unsupported file type: {ext}")
        sys.exit(1)


# ============================================================================
# 2. GRID DETECTION
# ============================================================================

def detect_grid(img: np.ndarray, scale: int = 1000):
    """
    Detect the major grid lines on graph paper.
    Returns (x_labels, y_labels, px_per_mm) where labels map
    grid label -> pixel position.

    Falls back to evenly-spaced grid if detection fails.
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Detect strong lines using adaptive threshold
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Find horizontal and vertical line profiles
    h_proj = np.sum(thresh, axis=1)  # horizontal projection
    v_proj = np.sum(thresh, axis=0)  # vertical projection

    # Find peaks in projections (major grid lines)
    h_threshold = np.percentile(h_proj, 85)
    v_threshold = np.percentile(v_proj, 85)

    h_lines = _find_grid_lines(h_proj, h_threshold, min_spacing=20)
    v_lines = _find_grid_lines(v_proj, v_threshold, min_spacing=20)

    if len(v_lines) < 3 or len(h_lines) < 3:
        print("WARNING: Grid detection weak — using fallback uniform grid")
        return _fallback_grid(w, h, scale)

    # Compute average grid spacing
    v_spacings = [v_lines[i+1] - v_lines[i] for i in range(len(v_lines)-1)]
    h_spacings = [h_lines[i+1] - h_lines[i] for i in range(len(h_lines)-1)]

    avg_v_spacing = np.median(v_spacings) if v_spacings else w / 12
    avg_h_spacing = np.median(h_spacings) if h_spacings else h / 23

    # px_per_mm: one grid square = scale mm
    px_per_mm = avg_v_spacing / scale

    # Assign labels: A, B, C... for columns, 1, 2, 3... for rows
    x_labels = {}
    for i, px in enumerate(v_lines):
        label = chr(65 + i) if i < 26 else f"X{i}"  # A-Z
        x_labels[label] = px

    y_labels = {}
    for i, px in enumerate(h_lines):
        label = str(i + 1)
        y_labels[label] = px

    print(f"Grid detected: {len(x_labels)} columns, {len(y_labels)} rows")
    print(f"  px/mm = {px_per_mm:.3f}, grid spacing = {avg_v_spacing:.0f}px")

    return x_labels, y_labels, px_per_mm


def _find_grid_lines(projection, threshold, min_spacing=20):
    """Find peaks in a projection profile above threshold."""
    above = projection > threshold
    lines = []
    in_peak = False
    peak_start = 0

    for i, val in enumerate(above):
        if val and not in_peak:
            peak_start = i
            in_peak = True
        elif not val and in_peak:
            peak_centre = (peak_start + i) // 2
            if not lines or (peak_centre - lines[-1]) > min_spacing:
                lines.append(peak_centre)
            in_peak = False

    return lines


def _fallback_grid(w, h, scale):
    """Create a uniform grid when detection fails."""
    margin_x = w * 0.08
    margin_y = h * 0.08
    usable_w = w - 2 * margin_x
    usable_h = h - 2 * margin_y

    # Assume A4 portrait with ~12 columns and ~23 rows
    n_cols = 12
    n_rows = 23
    col_spacing = usable_w / n_cols
    row_spacing = usable_h / n_rows

    x_labels = {}
    for i in range(n_cols):
        label = chr(65 + i)
        x_labels[label] = int(margin_x + i * col_spacing)

    y_labels = {}
    for i in range(n_rows):
        label = str(i + 1)
        y_labels[label] = int(margin_y + i * row_spacing)

    px_per_mm = col_spacing / scale
    print(f"Fallback grid: {n_cols} columns (A-L), {n_rows} rows (1-23)")
    return x_labels, y_labels, px_per_mm


# ============================================================================
# 3. DOT DETECTION
# ============================================================================

def detect_dots(img, x_labels, y_labels, px_per_mm, scale, min_area=20, debug=False, debug_dir=None):
    """
    Detect coloured dots and map to grid coordinates.
    Returns dict: {"purple": [...], "blue": [...], "green": [...]}
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    results = {}

    for colour_name, colour_def in COLOUR_RANGES.items():
        mask = cv2.inRange(hsv, colour_def["lower"], colour_def["upper"])

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        dots = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue

            # Compute centroid
            M = cv2.moments(cnt)
            if M["m00"] == 0:
                continue
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])

            # Map pixel to grid coordinate
            coord = pixel_to_grid_ref(cx, cy, x_labels, y_labels, scale)
            if coord:
                dots.append({"px": (cx, cy), "ref": coord, "area": area})

        # Sort by coordinate for consistent output
        dots.sort(key=lambda d: d["ref"])
        results[colour_name] = dots

        label = colour_def["label"]
        print(f"  {label}: Found {len(dots)} dots")

        # Debug output
        if debug and debug_dir:
            debug_img = img.copy()
            cv2.drawContours(debug_img, contours, -1, (0, 0, 255), 2)
            for dot in dots:
                cv2.circle(debug_img, dot["px"], 8, (0, 255, 0), 2)
                cv2.putText(debug_img, dot["ref"], (dot["px"][0]+10, dot["px"][1]-10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
            cv2.imwrite(str(Path(debug_dir) / f"debug_{colour_name}.png"), debug_img)

    return results


def pixel_to_grid_ref(px_x, px_y, x_labels, y_labels, scale):
    """
    Convert pixel coordinates to grid reference string.
    Uses Scott's decimal notation: G.4 = 400mm past column G.
    Snaps to nearest 200mm increment.
    """
    col_ref = _pixel_to_axis_ref(px_x, x_labels, scale, use_letters=True)
    row_ref = _pixel_to_axis_ref(px_y, y_labels, scale, use_letters=False)

    if col_ref is None or row_ref is None:
        return None

    return f"{col_ref}/{row_ref}"


def _pixel_to_axis_ref(px, labels, scale, use_letters=True):
    """
    Map a pixel position to the nearest grid reference with decimal.
    Snaps to 200mm (0.2 grid unit) increments.
    """
    sorted_labels = sorted(labels.items(), key=lambda x: x[1])
    if not sorted_labels:
        return None

    # Find which grid square the pixel falls in
    for i in range(len(sorted_labels) - 1):
        label, pos = sorted_labels[i]
        next_label, next_pos = sorted_labels[i + 1]

        if pos <= px <= next_pos:
            # Fraction within this grid square
            frac = (px - pos) / (next_pos - pos) if (next_pos - pos) > 0 else 0

            # Snap to nearest 0.2
            snapped = round(frac * 5) / 5  # 0, 0.2, 0.4, 0.6, 0.8, 1.0

            if snapped >= 1.0:
                return next_label
            elif snapped <= 0.0:
                return label
            else:
                # Format decimal: G.4 = column G + 0.4
                dec_str = str(int(snapped * 10))
                return f"{label}.{dec_str}"

    # Before first or after last grid line
    first_label, first_pos = sorted_labels[0]
    last_label, last_pos = sorted_labels[-1]

    if px < first_pos:
        return first_label
    if px > last_pos:
        return last_label

    return None


# ============================================================================
# 4. WALL GENERATION
# ============================================================================

def generate_walls(dot_results, x_labels, y_labels, scale, wall_thickness):
    """
    Connect dots that share a column or row to form walls.
    All walls must be horizontal or vertical — diagonals are errors.
    """
    walls = []
    warnings = []

    for colour_name, dots in dot_results.items():
        category = COLOUR_RANGES[colour_name]["category"]
        thickness = wall_thickness if category == "perimeter" else 90

        coords = []
        for dot in dots:
            mm = ref_to_mm(dot["ref"], x_labels, y_labels, scale)
            if mm:
                coords.append({"ref": dot["ref"], "mm": mm})

        # Connect dots that share approximately the same X or Y
        tolerance = scale * 0.15  # 15% of a grid square

        for i in range(len(coords)):
            for j in range(i + 1, len(coords)):
                p1 = coords[i]["mm"]
                p2 = coords[j]["mm"]
                dx = abs(p1[0] - p2[0])
                dy = abs(p1[1] - p2[1])

                is_horizontal = dy < tolerance and dx > tolerance
                is_vertical = dx < tolerance and dy > tolerance

                if is_horizontal or is_vertical:
                    # Check it's a direct neighbour (no other dot between them on same axis)
                    if _is_direct_neighbour(coords, i, j, is_horizontal):
                        walls.append({
                            "start": p1,
                            "end": p2,
                            "thickness": thickness,
                            "category": category,
                            "ref_start": coords[i]["ref"],
                            "ref_end": coords[j]["ref"],
                        })
                elif dx > tolerance and dy > tolerance:
                    # This would be a diagonal — skip silently (not all dots connect)
                    pass

    print(f"Generated {len(walls)} walls ({len(warnings)} warnings)")
    return walls, warnings


def _is_direct_neighbour(coords, i, j, is_horizontal):
    """Check that no other dot lies between i and j on the same axis."""
    p1 = coords[i]["mm"]
    p2 = coords[j]["mm"]

    if is_horizontal:
        # Same row — check no dot between them in X
        min_x = min(p1[0], p2[0])
        max_x = max(p1[0], p2[0])
        y_avg = (p1[1] + p2[1]) / 2
        tolerance = abs(p2[1] - p1[1]) + 200

        for k in range(len(coords)):
            if k == i or k == j:
                continue
            pk = coords[k]["mm"]
            if abs(pk[1] - y_avg) < tolerance and min_x < pk[0] < max_x:
                return False
    else:
        # Same column — check no dot between them in Y
        min_y = min(p1[1], p2[1])
        max_y = max(p1[1], p2[1])
        x_avg = (p1[0] + p2[0]) / 2
        tolerance = abs(p2[0] - p1[0]) + 200

        for k in range(len(coords)):
            if k == i or k == j:
                continue
            pk = coords[k]["mm"]
            if abs(pk[0] - x_avg) < tolerance and min_y < pk[1] < max_y:
                return False

    return True


def ref_to_mm(ref, x_labels, y_labels, scale):
    """Convert 'G.6/16.4' to (x_mm, y_mm)."""
    parts = ref.split("/")
    if len(parts) != 2:
        return None

    x_mm = _axis_ref_to_mm(parts[0].strip(), x_labels, scale)
    y_mm = _axis_ref_to_mm(parts[1].strip(), y_labels, scale)

    if x_mm is None or y_mm is None:
        return None
    return (x_mm, y_mm)


def _axis_ref_to_mm(ref, labels, scale):
    """Convert 'G.6' to mm: label position + decimal * scale."""
    match = re.match(r'^([A-Za-z0-9]+)\.(\d+)$', ref)
    if match:
        base_label = match.group(1)
        decimal = float(f"0.{match.group(2)}")
        sorted_labels = sorted(labels.items(), key=lambda x: x[1])
        # Find index of base label
        for idx, (lbl, _) in enumerate(sorted_labels):
            if lbl == base_label:
                return idx * scale + decimal * scale
        return None

    # Whole ref: "G" or "2"
    sorted_labels = sorted(labels.items(), key=lambda x: x[1])
    for idx, (lbl, _) in enumerate(sorted_labels):
        if lbl == ref:
            return idx * scale
    return None


# ============================================================================
# 5. DXF OUTPUT
# ============================================================================

def write_dxf(walls, dot_results, x_labels, y_labels, scale, output_path):
    """Generate DXF file with walls, grid, and dot markers."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Set units to millimetres
    doc.header["$INSUNITS"] = 4  # mm
    doc.header["$MEASUREMENT"] = 1  # metric

    # Create layers
    doc.layers.add("WALLS-PERIMETER", color=7, lineweight=50)
    doc.layers.add("WALLS-INTERNAL", color=8, lineweight=35)
    doc.layers.add("WALLS-EXTERIOR", color=3, lineweight=35)
    doc.layers.add("WALLS-CENTRE", color=8, lineweight=18)
    doc.layers.add("GRID", color=4)
    doc.layers.add("DOTS", color=2)

    # Add dashed linetype for centrelines
    doc.linetypes.add("DASHED", pattern=[0.5, 0.25, -0.25])

    # --- Draw grid ---
    sorted_x = sorted(x_labels.items(), key=lambda x: x[1])
    sorted_y = sorted(y_labels.items(), key=lambda x: x[1])

    n_cols = len(sorted_x)
    n_rows = len(sorted_y)
    max_x = (n_cols - 1) * scale
    max_y = (n_rows - 1) * scale
    ext = 500  # extend grid past building

    for i, (label, _) in enumerate(sorted_x):
        x = i * scale
        msp.add_line((x, -ext), (x, max_y + ext), dxfattribs={"layer": "GRID"})
        msp.add_text(label, height=300, dxfattribs={"layer": "GRID"}).set_placement(
            (x, max_y + ext + 200), align=ezdxf.enums.TextEntityAlignment.CENTER
        )

    for i, (label, _) in enumerate(sorted_y):
        y = i * scale
        msp.add_line((-ext, y), (max_x + ext, y), dxfattribs={"layer": "GRID"})
        msp.add_text(label, height=300, dxfattribs={"layer": "GRID"}).set_placement(
            (-ext - 400, y), align=ezdxf.enums.TextEntityAlignment.CENTER
        )

    # --- Draw dots ---
    for colour_name, dots in dot_results.items():
        for dot in dots:
            mm = ref_to_mm(dot["ref"], x_labels, y_labels, scale)
            if not mm:
                continue
            msp.add_circle(mm, radius=50, dxfattribs={"layer": "DOTS"})
            msp.add_text(dot["ref"], height=150, dxfattribs={"layer": "DOTS"}).set_placement(
                (mm[0] + 80, mm[1] + 80)
            )

    # --- Draw walls ---
    layer_map = {
        "perimeter": "WALLS-PERIMETER",
        "internal": "WALLS-INTERNAL",
        "external": "WALLS-EXTERIOR",
    }

    for wall in walls:
        s = wall["start"]
        e = wall["end"]
        layer = layer_map.get(wall["category"], "WALLS-PERIMETER")
        t = wall["thickness"]

        # Centreline (dashed)
        msp.add_line(s, e, dxfattribs={
            "layer": "WALLS-CENTRE",
            "linetype": "DASHED",
        })

        # Wall thickness rectangle
        verts = _wall_vertices(s, e, t)
        if verts:
            for k in range(4):
                v1 = verts[k]
                v2 = verts[(k + 1) % 4]
                msp.add_line(v1, v2, dxfattribs={"layer": layer})

    doc.saveas(str(output_path))
    print(f"DXF saved: {output_path}")


def _wall_vertices(start, end, thickness):
    """Compute 4 corner vertices of a wall with given thickness."""
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length == 0:
        return []

    # Perpendicular offset
    half_t = thickness / 2
    px = -dy / length * half_t
    py = dx / length * half_t

    return [
        (start[0] + px, start[1] + py),
        (end[0] + px, end[1] + py),
        (end[0] - px, end[1] - py),
        (start[0] - px, start[1] - py),
    ]


# ============================================================================
# 6. COORDINATE OUTPUT
# ============================================================================

def write_coords(dot_results, job, output_dir):
    """Save coordinate text file."""
    output_path = Path(output_dir) / f"{job}_coords.txt"

    with open(output_path, "w") as f:
        f.write(f"# Sketch Coordinates — {job}\n")
        f.write(f"# Generated by sketch_reader.py (Absolute Drafting)\n\n")

        for colour_name, colour_def in COLOUR_RANGES.items():
            label = colour_def["label"]
            dots = dot_results.get(colour_name, [])
            refs = [d["ref"] for d in dots]
            f.write(f"{label}: {', '.join(refs)}\n")

    print(f"Coordinates saved: {output_path}")
    return output_path


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Sketch Reader — Detect coloured dots on hand sketches, generate DXF",
        epilog="Scott's 6-Step Method (Absolute Drafting)"
    )
    parser.add_argument("--input", required=True, help="Path to scanned PDF or image")
    parser.add_argument("--job", required=True, help="Job name for output files")
    parser.add_argument("--output", default=".", help="Output directory (default: current)")
    parser.add_argument("--scale", type=int, default=1000, help="mm per grid square (default: 1000)")
    parser.add_argument("--wall-thickness", type=int, default=110, help="Default wall thickness mm (default: 110)")
    parser.add_argument("--min-dot-area", type=int, default=20, help="Min dot pixel area (default: 20)")
    parser.add_argument("--debug", action="store_true", help="Save debug images")

    args = parser.parse_args()

    # Ensure output directory exists
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("SKETCH READER — Absolute Drafting")
    print("=" * 60)
    print(f"Input:  {args.input}")
    print(f"Job:    {args.job}")
    print(f"Output: {output_dir}")
    print(f"Scale:  1:{args.scale}mm per grid square")
    print()

    # Step 1: Load image
    print("[1/5] Loading image...")
    img = load_image(args.input)

    # Step 2: Detect grid
    print("[2/5] Detecting grid...")
    x_labels, y_labels, px_per_mm = detect_grid(img, args.scale)

    # Step 3: Detect dots
    print("[3/5] Detecting coloured dots...")
    debug_dir = str(output_dir) if args.debug else None
    dot_results = detect_dots(
        img, x_labels, y_labels, px_per_mm, args.scale,
        min_area=args.min_dot_area, debug=args.debug, debug_dir=debug_dir
    )

    # Step 4: Generate walls
    print("[4/5] Generating walls (H/V only)...")
    walls, warnings = generate_walls(
        dot_results, x_labels, y_labels, args.scale, args.wall_thickness
    )

    for w in warnings:
        print(f"  WARNING: {w}")

    # Step 5: Write outputs
    print("[5/5] Writing outputs...")
    dxf_path = output_dir / f"{args.job}.dxf"
    write_dxf(walls, dot_results, x_labels, y_labels, args.scale, dxf_path)
    coords_path = write_coords(dot_results, args.job, output_dir)

    # Summary
    purple_count = len(dot_results.get("purple", []))
    blue_count = len(dot_results.get("blue", []))
    green_count = len(dot_results.get("green", []))

    print()
    print("=" * 60)
    print("DONE")
    print(f"Found {purple_count} purple, {blue_count} blue, {green_count} green dots")
    print(f"Generated {len(walls)} walls")
    print(f"DXF:    {dxf_path}")
    print(f"Coords: {coords_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
