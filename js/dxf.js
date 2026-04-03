/**
 * dxf.js - DXF Export Module
 * Converts Building data to AutoCAD DXF format (R2010/AC1024)
 *
 * Output is a minimal but valid DXF that ArchiCAD, AutoCAD, and
 * most CAD programs can import. Geometry is drawn at 1:1 scale
 * in millimetres — ready to trace over in ArchiCAD.
 *
 * Layers follow Scott's colour-coded methodology:
 *   0-GRID         — grid lines (cyan)
 *   1-WALLS        — wall outlines (white/black)
 *   2-WALLS-CENTRE — wall centrelines (grey, dashed)
 *   3-OPENINGS     — doors and windows (green)
 *   4-DIMENSIONS   — dimension lines and text (red)
 *   5-ROOMS        — room labels (magenta)
 *   6-DOTS         — dot markers from sketch (yellow)
 */

const DXF = (() => {
  // DXF colour indices (ACI)
  const COLORS = {
    grid: 4,        // cyan
    wall: 7,        // white (prints black)
    centreline: 8,  // grey
    opening: 3,     // green
    dimension: 1,   // red
    room: 6,        // magenta
    dot: 2,         // yellow
  };

  function exportBuilding(building) {
    const sections = [];
    sections.push(header());
    sections.push(tables(building));
    sections.push(blocks());
    sections.push(entities(building));
    sections.push("  0\nEOF\n");
    return sections.join("");
  }

  // --- HEADER Section ---

  function header() {
    return `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1024
  9
$INSUNITS
 70
4
  9
$MEASUREMENT
 70
1
  0
ENDSEC
`;
  }

  // We need a reference to building for header bbox — set during export
  let building_ref = null;

  // --- TABLES Section ---

  function tables() {
    return `  0
SECTION
  2
TABLES
  0
TABLE
  2
LTYPE
 70
2
  0
LTYPE
  2
CONTINUOUS
 70
0
  3
Solid line
 72
65
 73
0
 40
0.0
  0
LTYPE
  2
DASHED
 70
0
  3
Dashed line
 72
65
 73
2
 40
6.0
 49
4.0
 74
0
 49
-2.0
 74
0
  0
ENDTAB
  0
TABLE
  2
LAYER
 70
7
${layer("0-GRID", COLORS.grid)}
${layer("1-WALLS", COLORS.wall)}
${layer("2-WALLS-CENTRE", COLORS.centreline, "DASHED")}
${layer("3-OPENINGS", COLORS.opening)}
${layer("4-DIMENSIONS", COLORS.dimension)}
${layer("5-ROOMS", COLORS.room)}
${layer("6-DOTS", COLORS.dot)}
  0
ENDTAB
  0
ENDSEC
`;
  }

  function layer(name, color, linetype) {
    return `  0
LAYER
  2
${name}
 70
0
 62
${color}
  6
${linetype || "CONTINUOUS"}`;
  }

  // --- BLOCKS Section (empty) ---

  function blocks() {
    return `  0
SECTION
  2
BLOCKS
  0
ENDSEC
`;
  }

  // --- ENTITIES Section ---

  function entities(building) {
    const lines = [];
    lines.push("  0\nSECTION\n  2\nENTITIES\n");

    // Grid lines
    const grid = building.grid;
    const bbox = Coord.getBoundingBox(building);
    const ext = 500; // extend grid 500mm past building

    for (const gl of grid.xLines) {
      let minY = bbox.min.y, maxY = bbox.max.y;
      for (const yl of grid.yLines) {
        minY = Math.min(minY, yl.y);
        maxY = Math.max(maxY, yl.y);
      }
      lines.push(dxfLine(gl.x, minY - ext, gl.x, maxY + ext, "0-GRID"));
      lines.push(dxfText(gl.label, gl.x, maxY + ext + 200, 300, "0-GRID"));
    }
    for (const gl of grid.yLines) {
      let minX = bbox.min.x, maxX = bbox.max.x;
      for (const xl of grid.xLines) {
        minX = Math.min(minX, xl.x);
        maxX = Math.max(maxX, xl.x);
      }
      lines.push(dxfLine(minX - ext, gl.y, maxX + ext, gl.y, "0-GRID"));
      lines.push(dxfText(gl.label, minX - ext - 400, gl.y, 300, "0-GRID"));
    }

    // Dots (Steps 1-3)
    for (const dot of building.dots) {
      const p = dot.position;
      lines.push(dxfCircle(p.x, p.y, 50, "6-DOTS"));
      if (dot.label) {
        lines.push(dxfText(dot.label, p.x + 80, p.y + 80, 150, "6-DOTS"));
      }
    }

    // Walls — centrelines + thickness outlines
    for (const wall of building.walls.values()) {
      const s = wall.centreline.start;
      const e = wall.centreline.end;

      // Centreline (dashed)
      lines.push(dxfLine(s.x, s.y, e.x, e.y, "2-WALLS-CENTRE"));

      // Wall thickness outline (4 lines forming rectangle)
      const verts = Coord.wallVertices(wall);
      for (let i = 0; i < verts.length; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];
        lines.push(dxfLine(v1.x, v1.y, v2.x, v2.y, "1-WALLS"));
      }

      // Openings
      for (const opening of wall.openings) {
        const angle = Coord.wallAngle(wall);
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const ox1 = s.x + dx * opening.offset;
        const oy1 = s.y + dy * opening.offset;
        const ox2 = s.x + dx * (opening.offset + opening.width);
        const oy2 = s.y + dy * (opening.offset + opening.width);

        // Opening line on centreline
        lines.push(dxfLine(ox1, oy1, ox2, oy2, "3-OPENINGS"));

        // For doors: add swing arc
        if (opening.type === "door") {
          lines.push(dxfArc(ox1, oy1, opening.width, angle, angle + Math.PI / 2, "3-OPENINGS"));
        }

        // For windows: add parallel lines
        if (opening.type === "window") {
          const perpAngle = angle + Math.PI / 2;
          const halfT = wall.thickness / 4;
          for (const sign of [-1, 1]) {
            const lx1 = ox1 + Math.cos(perpAngle) * halfT * sign;
            const ly1 = oy1 + Math.sin(perpAngle) * halfT * sign;
            const lx2 = ox2 + Math.cos(perpAngle) * halfT * sign;
            const ly2 = oy2 + Math.sin(perpAngle) * halfT * sign;
            lines.push(dxfLine(lx1, ly1, lx2, ly2, "3-OPENINGS"));
          }
        }
      }
    }

    // Dimensions
    for (const dim of building.dimensions) {
      for (let i = 0; i < dim.points.length - 1; i++) {
        const p1 = dim.points[i];
        const p2 = dim.points[i + 1];
        const len = Math.round(Coord.distanceBetween(p1, p2));

        // Perpendicular offset for dimension line
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / d * dim.offset;
        const perpY = dx / d * dim.offset;

        const dp1x = p1.x + perpX, dp1y = p1.y + perpY;
        const dp2x = p2.x + perpX, dp2y = p2.y + perpY;

        // Dimension line
        lines.push(dxfLine(dp1x, dp1y, dp2x, dp2y, "4-DIMENSIONS"));
        // Extension lines
        lines.push(dxfLine(p1.x + perpX * 0.2, p1.y + perpY * 0.2, dp1x, dp1y, "4-DIMENSIONS"));
        lines.push(dxfLine(p2.x + perpX * 0.2, p2.y + perpY * 0.2, dp2x, dp2y, "4-DIMENSIONS"));
        // Dimension text
        const midX = (dp1x + dp2x) / 2;
        const midY = (dp1y + dp2y) / 2;
        const textAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        lines.push(dxfText(String(len), midX, midY + 100, 200, "4-DIMENSIONS", textAngle));
      }
    }

    // Room labels
    for (const room of building.rooms.values()) {
      if (!room.label || room.wallIds.length === 0) continue;
      let sumX = 0, sumY = 0, count = 0;
      for (const wid of room.wallIds) {
        const wall = building.walls.get(wid);
        if (!wall) continue;
        sumX += wall.centreline.start.x + wall.centreline.end.x;
        sumY += wall.centreline.start.y + wall.centreline.end.y;
        count += 2;
      }
      if (count === 0) continue;
      lines.push(dxfText(room.label, sumX / count, sumY / count, 250, "5-ROOMS"));
    }

    lines.push("  0\nENDSEC\n");
    return lines.join("");
  }

  // --- DXF Primitives ---

  function dxfLine(x1, y1, x2, y2, layerName) {
    return `  0
LINE
  8
${layerName}
 10
${x1.toFixed(1)}
 20
${y1.toFixed(1)}
 30
0.0
 11
${x2.toFixed(1)}
 21
${y2.toFixed(1)}
 31
0.0
`;
  }

  function dxfCircle(cx, cy, radius, layerName) {
    return `  0
CIRCLE
  8
${layerName}
 10
${cx.toFixed(1)}
 20
${cy.toFixed(1)}
 30
0.0
 40
${radius.toFixed(1)}
`;
  }

  function dxfArc(cx, cy, radius, startAngle, endAngle, layerName) {
    // DXF arcs use degrees, counter-clockwise from X axis
    const startDeg = startAngle * (180 / Math.PI);
    const endDeg = endAngle * (180 / Math.PI);
    return `  0
ARC
  8
${layerName}
 10
${cx.toFixed(1)}
 20
${cy.toFixed(1)}
 30
0.0
 40
${radius.toFixed(1)}
 50
${startDeg.toFixed(1)}
 51
${endDeg.toFixed(1)}
`;
  }

  function dxfText(text, x, y, height, layerName, rotation) {
    return `  0
TEXT
  8
${layerName}
 10
${x.toFixed(1)}
 20
${y.toFixed(1)}
 30
0.0
 40
${height.toFixed(1)}
  1
${text}
 50
${(rotation || 0).toFixed(1)}
 72
1
 11
${x.toFixed(1)}
 21
${y.toFixed(1)}
 31
0.0
`;
  }

  // --- Public API ---

  function exportDXF(building) {
    building_ref = building;
    const content = exportBuilding(building);
    building_ref = null;
    return content;
  }

  function downloadDXF(building, filename) {
    const content = exportDXF(building);
    const blob = new Blob([content], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "drawing.dxf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return { exportDXF, downloadDXF };
})();
