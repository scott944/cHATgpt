/**
 * renderer.js - SVG Drawing Engine
 * Renders Building data as architectural SVG drawings
 *
 * Supports Plan view (XY) and Elevation views (XZ from N/S/E/W)
 * Follows architectural drawing conventions for line weights,
 * grid lines, dimensions, and opening symbols.
 */

const Renderer = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Line weights in SVG units (px at 96dpi, ~0.26mm per px)
  const WEIGHTS = {
    wallCut: 2,      // ~0.5mm - walls cut in plan
    wallBeyond: 0.8, // ~0.2mm - walls beyond cut plane
    grid: 1,         // ~0.25mm - grid lines
    dimension: 0.5,  // ~0.13mm - dimension lines
    opening: 0.8,    // ~0.2mm - door/window symbols
    titleBlock: 1.2, // border
  };

  const COLORS = {
    wallFill: "#000000",
    wallStroke: "#000000",
    grid: "#0066cc",
    gridLabel: "#0066cc",
    dimension: "#333333",
    dimText: "#333333",
    opening: "#000000",
    roomLabel: "#666666",
    titleBlock: "#000000",
    background: "#ffffff",
  };

  // --- Coordinate Transform ---

  function createTransform(building, svgWidth, svgHeight, scale, viewType, margin, facing) {
    margin = margin || 80;
    const bbox = Coord.getBoundingBox(building);

    // Include grid extents in bounding box
    const grid = building.grid;
    let minX = bbox.min.x, maxX = bbox.max.x;
    let minY = bbox.min.y, maxY = bbox.max.y;
    let minZ = bbox.min.z, maxZ = bbox.max.z;

    for (const gl of grid.xLines) {
      minX = Math.min(minX, gl.x);
      maxX = Math.max(maxX, gl.x);
    }
    for (const gl of grid.yLines) {
      minY = Math.min(minY, gl.y);
      maxY = Math.max(maxY, gl.y);
    }

    const drawW = svgWidth - margin * 2;
    const drawH = svgHeight - margin * 2;

    let worldW, worldH, originX, originY;
    if (viewType === "plan") {
      worldW = maxX - minX || 1;
      worldH = maxY - minY || 1;
      originX = minX;
      originY = minY;
    } else {
      // Elevation: use correct axis based on facing direction
      // N/S elevations look along Y axis → horizontal extent is X
      // E/W elevations look along X axis → horizontal extent is Y
      if (facing === "E" || facing === "W") {
        worldW = maxY - minY || 1;
        originX = minY;
      } else {
        worldW = maxX - minX || 1;
        originX = minX;
      }
      worldH = maxZ - minZ || 1;
      originY = minZ;
    }

    // Auto-fit scale
    const fitScale = Math.min(drawW / worldW, drawH / worldH);
    const useScale = scale === "auto" ? fitScale : Math.min(fitScale, scale);

    return {
      viewType,
      facing: facing || null,
      originX,
      originY,
      worldW,
      worldH,
      scale: useScale,
      offsetX: margin + (drawW - worldW * useScale) / 2,
      offsetY: margin + (drawH - worldH * useScale) / 2,
      svgWidth,
      svgHeight,
      margin,
      bbox: { minX, maxX, minY, maxY, minZ, maxZ },
    };
  }

  function worldToSvg(wx, wy, transform) {
    if (transform.viewType === "plan") {
      // Plan: X maps to SVG X, Y is flipped (world Y up, SVG Y down)
      const sx = (wx - transform.originX) * transform.scale + transform.offsetX;
      const sy = transform.svgHeight - ((wy - transform.originY) * transform.scale + transform.offsetY);
      return { x: sx, y: sy };
    } else {
      // Elevation: X maps to SVG X, Z maps to SVG Y (flipped)
      const sx = (wx - transform.originX) * transform.scale + transform.offsetX;
      const sy = transform.svgHeight - ((wy - transform.originY) * transform.scale + transform.offsetY);
      return { x: sx, y: sy };
    }
  }

  function worldLenToSvg(len, transform) {
    return len * transform.scale;
  }

  // --- SVG Element Helpers ---

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      el.setAttribute(k, v);
    }
    return el;
  }

  function svgGroup(id) {
    return svgEl("g", { id });
  }

  // --- Render Plan View ---

  function renderPlan(building, svgElement, options) {
    options = options || {};
    const svgWidth = options.width || svgElement.clientWidth || 800;
    const svgHeight = options.height || svgElement.clientHeight || 600;

    svgElement.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    svgElement.innerHTML = "";

    // Background
    svgElement.appendChild(svgEl("rect", {
      x: 0, y: 0, width: svgWidth, height: svgHeight,
      fill: COLORS.background,
    }));

    const transform = createTransform(building, svgWidth, svgHeight, "auto", "plan");

    // Layer groups — following Scott's 6-step sequence
    const gridGroup = svgGroup("grid");         // Pre-step
    const dotGroup = svgGroup("dots");          // Steps 1-3
    const wallGroup = svgGroup("walls");        // Steps 4-5
    const openingGroup = svgGroup("openings");  // Step 7
    const dimGroup = svgGroup("dimensions");
    const labelGroup = svgGroup("labels");
    const warningGroup = svgGroup("warnings");
    const titleGroup = svgGroup("titleblock");

    // Visible steps (controlled by options.visibleSteps)
    const steps = options.visibleSteps || [0, 1, 2, 3, 4, 5, 6, 7];

    if (steps.includes(0)) drawGrid(gridGroup, building.grid, transform);
    if (steps.includes(1) || steps.includes(2) || steps.includes(3))
      drawDots(dotGroup, building, transform, steps);
    if (steps.includes(4) || steps.includes(5))
      drawWallsPlan(wallGroup, building, transform, steps.includes(5));
    if (steps.includes(7))
      drawOpeningsPlan(openingGroup, building, transform);
    if (steps.includes(6))
      drawDimensions(dimGroup, building, transform);
    drawRoomLabels(labelGroup, building, transform);
    drawDiagonalWarnings(warningGroup, building, transform);
    drawTitleBlock(titleGroup, transform, options.title || "Floor Plan");

    svgElement.appendChild(gridGroup);
    svgElement.appendChild(dotGroup);
    svgElement.appendChild(wallGroup);
    svgElement.appendChild(openingGroup);
    svgElement.appendChild(dimGroup);
    svgElement.appendChild(labelGroup);
    svgElement.appendChild(warningGroup);
    svgElement.appendChild(titleGroup);
  }

  // --- Render Elevation View ---

  function renderElevation(building, svgElement, options) {
    options = options || {};
    const facing = options.facing || "N"; // N, S, E, W
    const svgWidth = options.width || svgElement.clientWidth || 800;
    const svgHeight = options.height || svgElement.clientHeight || 600;

    svgElement.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    svgElement.innerHTML = "";

    svgElement.appendChild(svgEl("rect", {
      x: 0, y: 0, width: svgWidth, height: svgHeight,
      fill: COLORS.background,
    }));

    const transform = createTransform(building, svgWidth, svgHeight, "auto", "elevation", undefined, facing);

    const wallGroup = svgGroup("walls");
    const openingGroup = svgGroup("openings");
    const titleGroup = svgGroup("titleblock");

    drawWallsElevation(wallGroup, building, transform, facing);
    drawOpeningsElevation(openingGroup, building, transform, facing);
    drawTitleBlock(titleGroup, transform, `Elevation - ${facing}`);

    svgElement.appendChild(wallGroup);
    svgElement.appendChild(openingGroup);
    svgElement.appendChild(titleGroup);
  }

  // --- Grid Drawing ---

  function drawGrid(group, grid, transform) {
    const ext = 30; // extension past building in SVG px
    const { minY, maxY, minX, maxX } = transform.bbox;

    // X grid lines (vertical on plan)
    for (const gl of grid.xLines) {
      const top = worldToSvg(gl.x, maxY, transform);
      const bot = worldToSvg(gl.x, minY, transform);

      group.appendChild(svgEl("line", {
        x1: top.x, y1: top.y - ext,
        x2: bot.x, y2: bot.y + ext,
        stroke: COLORS.grid,
        "stroke-width": WEIGHTS.grid,
        "stroke-dasharray": "12,4,4,4",
      }));

      // Circle label at top
      drawGridBubble(group, top.x, top.y - ext - 18, gl.label);
      // Circle label at bottom
      drawGridBubble(group, bot.x, bot.y + ext + 18, gl.label);
    }

    // Y grid lines (horizontal on plan)
    for (const gl of grid.yLines) {
      const left = worldToSvg(minX, gl.y, transform);
      const right = worldToSvg(maxX, gl.y, transform);

      group.appendChild(svgEl("line", {
        x1: left.x - ext, y1: left.y,
        x2: right.x + ext, y2: right.y,
        stroke: COLORS.grid,
        "stroke-width": WEIGHTS.grid,
        "stroke-dasharray": "12,4,4,4",
      }));

      // Circle label at left
      drawGridBubble(group, left.x - ext - 18, left.y, gl.label);
      // Circle label at right
      drawGridBubble(group, right.x + ext + 18, right.y, gl.label);
    }
  }

  function drawGridBubble(group, cx, cy, label) {
    const r = 12;
    group.appendChild(svgEl("circle", {
      cx, cy, r,
      fill: "white",
      stroke: COLORS.gridLabel,
      "stroke-width": 1.2,
    }));
    const text = svgEl("text", {
      x: cx, y: cy + 4,
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "11",
      "font-weight": "bold",
      fill: COLORS.gridLabel,
    });
    text.textContent = label;
    group.appendChild(text);
  }

  // --- Dot Drawing (Steps 1-3: Scott's colour-coded markers) ---

  function drawDots(group, building, transform, visibleSteps) {
    const stepMap = {
      [Coord.DOT_TYPES.PERIMETER]: 1,
      [Coord.DOT_TYPES.INTERNAL]: 2,
      [Coord.DOT_TYPES.EXTERNAL]: 3,
    };

    for (const dot of building.dots) {
      const step = stepMap[dot.type];
      if (step && !visibleSteps.includes(step)) continue;

      const colour = Coord.DOT_COLOURS[dot.type] || "#999";
      const sv = worldToSvg(dot.position.x, dot.position.y, transform);

      // Filled circle
      group.appendChild(svgEl("circle", {
        cx: sv.x, cy: sv.y, r: 5,
        fill: colour,
        stroke: "white",
        "stroke-width": 1,
      }));

      // Label (grid ref)
      if (dot.label) {
        const text = svgEl("text", {
          x: sv.x + 8, y: sv.y - 6,
          "font-family": "Arial, sans-serif",
          "font-size": "8",
          fill: colour,
        });
        text.textContent = dot.label;
        group.appendChild(text);
      }
    }
  }

  // --- Diagonal Wall Warnings ---

  function drawDiagonalWarnings(group, building, transform) {
    if (!building.warnings) return;
    for (const w of building.warnings) {
      if (w.type !== "diagonal") continue;
      const wall = building.walls.get(w.wallId);
      if (!wall) continue;

      const sv1 = worldToSvg(wall.centreline.start.x, wall.centreline.start.y, transform);
      const sv2 = worldToSvg(wall.centreline.end.x, wall.centreline.end.y, transform);

      // Red dashed line over the diagonal wall
      group.appendChild(svgEl("line", {
        x1: sv1.x, y1: sv1.y,
        x2: sv2.x, y2: sv2.y,
        stroke: "#ff0000",
        "stroke-width": 2,
        "stroke-dasharray": "6,3",
      }));

      // Warning icon at midpoint
      const mx = (sv1.x + sv2.x) / 2;
      const my = (sv1.y + sv2.y) / 2;
      const warn = svgEl("text", {
        x: mx, y: my - 8,
        "text-anchor": "middle",
        "font-family": "Arial, sans-serif",
        "font-size": "12",
        "font-weight": "bold",
        fill: "#ff0000",
      });
      warn.textContent = "DIAGONAL!";
      group.appendChild(warn);
    }
  }

  // --- Wall Drawing (Plan) ---

  function drawWallsPlan(group, building, transform, showThickness) {
    if (showThickness === undefined) showThickness = true;

    for (const wall of building.walls.values()) {
      if (showThickness) {
        // Step 5: 110mm wall thickness (filled rectangles)
        const verts = Coord.wallVertices(wall);
        const svgVerts = verts.map((v) => worldToSvg(v.x, v.y, transform));
        const pts = svgVerts.map((v) => `${v.x},${v.y}`).join(" ");

        group.appendChild(svgEl("polygon", {
          points: pts,
          fill: COLORS.wallFill,
          stroke: COLORS.wallStroke,
          "stroke-width": 0.5,
        }));
      } else {
        // Step 4: Centrelines only (join the dots)
        const sv1 = worldToSvg(wall.centreline.start.x, wall.centreline.start.y, transform);
        const sv2 = worldToSvg(wall.centreline.end.x, wall.centreline.end.y, transform);

        group.appendChild(svgEl("line", {
          x1: sv1.x, y1: sv1.y,
          x2: sv2.x, y2: sv2.y,
          stroke: COLORS.wallStroke,
          "stroke-width": WEIGHTS.wallCut,
        }));
      }
    }
  }

  // --- Opening Drawing (Plan) ---

  function drawOpeningsPlan(group, building, transform) {
    for (const wall of building.walls.values()) {
      const angle = Coord.wallAngle(wall);
      const len = Coord.wallLength(wall);

      for (const opening of wall.openings) {
        const s = wall.centreline.start;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        // Opening centre along wall
        const cx = s.x + dx * (opening.offset + opening.width / 2);
        const cy = s.y + dy * (opening.offset + opening.width / 2);

        // Opening start and end on centreline
        const ox1 = s.x + dx * opening.offset;
        const oy1 = s.y + dy * opening.offset;
        const ox2 = s.x + dx * (opening.offset + opening.width);
        const oy2 = s.y + dy * (opening.offset + opening.width);

        // Clear the wall behind opening (white rectangle)
        const perpAngle = angle + Math.PI / 2;
        const halfT = wall.thickness / 2 + 1;
        const clearVerts = [
          { x: ox1 + Math.cos(perpAngle) * halfT, y: oy1 + Math.sin(perpAngle) * halfT },
          { x: ox2 + Math.cos(perpAngle) * halfT, y: oy2 + Math.sin(perpAngle) * halfT },
          { x: ox2 - Math.cos(perpAngle) * halfT, y: oy2 - Math.sin(perpAngle) * halfT },
          { x: ox1 - Math.cos(perpAngle) * halfT, y: oy1 - Math.sin(perpAngle) * halfT },
        ];
        const svgClear = clearVerts.map((v) => worldToSvg(v.x, v.y, transform));
        group.appendChild(svgEl("polygon", {
          points: svgClear.map((v) => `${v.x},${v.y}`).join(" "),
          fill: "white",
          stroke: "none",
        }));

        if (opening.type === "door") {
          drawDoorPlan(group, ox1, oy1, ox2, oy2, angle, wall.thickness, transform);
        } else {
          drawWindowPlan(group, ox1, oy1, ox2, oy2, angle, wall.thickness, transform);
        }
      }
    }
  }

  function drawDoorPlan(group, x1, y1, x2, y2, wallAngle, thickness, transform) {
    const sv1 = worldToSvg(x1, y1, transform);
    const sv2 = worldToSvg(x2, y2, transform);
    const width = Math.sqrt((sv2.x - sv1.x) ** 2 + (sv2.y - sv1.y) ** 2);

    // Door leaf line (from hinge to open position)
    group.appendChild(svgEl("line", {
      x1: sv1.x, y1: sv1.y,
      x2: sv2.x, y2: sv2.y,
      stroke: COLORS.opening,
      "stroke-width": WEIGHTS.opening,
    }));

    // Door arc (90 degree swing)
    const perpAngle = wallAngle + Math.PI / 2;
    const arcEnd = {
      x: x1 + Math.cos(perpAngle) * (x2 - x1 > 0 || y2 - y1 > 0 ? 1 : -1) * Coord.distanceBetween({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 }),
      y: y1 + Math.sin(perpAngle) * (x2 - x1 > 0 || y2 - y1 > 0 ? 1 : -1) * Coord.distanceBetween({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 }),
    };
    const svArc = worldToSvg(arcEnd.x, arcEnd.y, transform);

    const path = `M ${sv2.x},${sv2.y} A ${width},${width} 0 0 1 ${svArc.x},${svArc.y}`;
    group.appendChild(svgEl("path", {
      d: path,
      fill: "none",
      stroke: COLORS.opening,
      "stroke-width": WEIGHTS.opening * 0.6,
      "stroke-dasharray": "4,2",
    }));

    // Line from hinge to arc end
    group.appendChild(svgEl("line", {
      x1: sv1.x, y1: sv1.y,
      x2: svArc.x, y2: svArc.y,
      stroke: COLORS.opening,
      "stroke-width": WEIGHTS.opening * 0.6,
    }));
  }

  function drawWindowPlan(group, x1, y1, x2, y2, wallAngle, thickness, transform) {
    const perpAngle = wallAngle + Math.PI / 2;
    const halfT = thickness / 4; // window lines inside wall

    // Two parallel lines representing glass
    for (const sign of [-1, 1]) {
      const lx1 = x1 + Math.cos(perpAngle) * halfT * sign;
      const ly1 = y1 + Math.sin(perpAngle) * halfT * sign;
      const lx2 = x2 + Math.cos(perpAngle) * halfT * sign;
      const ly2 = y2 + Math.sin(perpAngle) * halfT * sign;

      const sv1 = worldToSvg(lx1, ly1, transform);
      const sv2 = worldToSvg(lx2, ly2, transform);

      group.appendChild(svgEl("line", {
        x1: sv1.x, y1: sv1.y,
        x2: sv2.x, y2: sv2.y,
        stroke: COLORS.opening,
        "stroke-width": WEIGHTS.opening,
      }));
    }
  }

  // --- Wall Drawing (Elevation) ---

  function drawWallsElevation(group, building, transform, facing) {
    for (const wall of building.walls.values()) {
      const s = wall.centreline.start;
      const e = wall.centreline.end;

      let x1, x2;
      if (facing === "N" || facing === "S") {
        x1 = s.x; x2 = e.x;
      } else {
        x1 = s.y; x2 = e.y;
      }

      const z1 = s.z;
      const z2 = s.z + wall.height;

      const sv1 = worldToSvg(Math.min(x1, x2), z1, transform);
      const sv2 = worldToSvg(Math.max(x1, x2), z2, transform);

      group.appendChild(svgEl("rect", {
        x: sv1.x,
        y: sv2.y,
        width: Math.abs(sv2.x - sv1.x),
        height: Math.abs(sv2.y - sv1.y),
        fill: "none",
        stroke: COLORS.wallStroke,
        "stroke-width": WEIGHTS.wallCut,
      }));
    }
  }

  // --- Opening Drawing (Elevation) ---

  function drawOpeningsElevation(group, building, transform, facing) {
    for (const wall of building.walls.values()) {
      const s = wall.centreline.start;
      const angle = Coord.wallAngle(wall);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      for (const opening of wall.openings) {
        let ox1, ox2;
        if (facing === "N" || facing === "S") {
          ox1 = s.x + dx * opening.offset;
          ox2 = s.x + dx * (opening.offset + opening.width);
        } else {
          ox1 = s.y + dy * opening.offset;
          ox2 = s.y + dy * (opening.offset + opening.width);
        }

        const z1 = s.z + opening.sillHeight;
        const z2 = s.z + opening.sillHeight + opening.height;

        const sv1 = worldToSvg(Math.min(ox1, ox2), z1, transform);
        const sv2 = worldToSvg(Math.max(ox1, ox2), z2, transform);

        group.appendChild(svgEl("rect", {
          x: sv1.x,
          y: sv2.y,
          width: Math.abs(sv2.x - sv1.x),
          height: Math.abs(sv2.y - sv1.y),
          fill: "white",
          stroke: COLORS.opening,
          "stroke-width": WEIGHTS.opening,
        }));

        // Cross for window
        if (opening.type === "window") {
          group.appendChild(svgEl("line", {
            x1: sv1.x, y1: sv2.y,
            x2: sv2.x, y2: sv1.y,
            stroke: COLORS.opening,
            "stroke-width": WEIGHTS.opening * 0.5,
          }));
          group.appendChild(svgEl("line", {
            x1: sv1.x, y1: sv1.y,
            x2: sv2.x, y2: sv2.y,
            stroke: COLORS.opening,
            "stroke-width": WEIGHTS.opening * 0.5,
          }));
        }
      }
    }
  }

  // --- Dimension Drawing ---

  function drawDimensions(group, building, transform) {
    for (const dim of building.dimensions) {
      if (dim.points.length < 2) continue;

      for (let i = 0; i < dim.points.length - 1; i++) {
        const p1 = dim.points[i];
        const p2 = dim.points[i + 1];
        drawDimensionLine(group, p1, p2, dim.offset, transform);
      }

      // Overall dimension if chain has 3+ points
      if (dim.points.length > 2) {
        drawDimensionLine(
          group,
          dim.points[0],
          dim.points[dim.points.length - 1],
          dim.offset * 1.8,
          transform
        );
      }
    }
  }

  function drawDimensionLine(group, p1, p2, offset, transform) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    // Direction perpendicular to dimension line for offset
    const perpX = -dy / len;
    const perpY = dx / len;

    // Offset points
    const op1 = { x: p1.x + perpX * offset, y: p1.y + perpY * offset };
    const op2 = { x: p2.x + perpX * offset, y: p2.y + perpY * offset };

    const sv1 = worldToSvg(op1.x, op1.y, transform);
    const sv2 = worldToSvg(op2.x, op2.y, transform);

    // Dimension line
    group.appendChild(svgEl("line", {
      x1: sv1.x, y1: sv1.y,
      x2: sv2.x, y2: sv2.y,
      stroke: COLORS.dimension,
      "stroke-width": WEIGHTS.dimension,
    }));

    // Extension lines
    const svp1 = worldToSvg(p1.x + perpX * offset * 0.2, p1.y + perpY * offset * 0.2, transform);
    const svp2 = worldToSvg(p2.x + perpX * offset * 0.2, p2.y + perpY * offset * 0.2, transform);

    group.appendChild(svgEl("line", {
      x1: svp1.x, y1: svp1.y,
      x2: sv1.x, y2: sv1.y,
      stroke: COLORS.dimension,
      "stroke-width": WEIGHTS.dimension,
    }));
    group.appendChild(svgEl("line", {
      x1: svp2.x, y1: svp2.y,
      x2: sv2.x, y2: sv2.y,
      stroke: COLORS.dimension,
      "stroke-width": WEIGHTS.dimension,
    }));

    // Tick marks (45 degree slash at each end)
    const tickLen = 6;
    for (const sv of [sv1, sv2]) {
      group.appendChild(svgEl("line", {
        x1: sv.x - tickLen / 2, y1: sv.y - tickLen / 2,
        x2: sv.x + tickLen / 2, y2: sv.y + tickLen / 2,
        stroke: COLORS.dimension,
        "stroke-width": WEIGHTS.dimension * 1.5,
      }));
    }

    // Dimension text
    const midX = (sv1.x + sv2.x) / 2;
    const midY = (sv1.y + sv2.y) / 2;
    const dimValue = Math.round(len);
    const displayText = dimValue >= 1000 ? `${(dimValue / 1000).toFixed(dimValue % 1000 === 0 ? 0 : 1)}m` : `${dimValue}`;

    // Rotate text to align with dimension line
    const svgAngle = Math.atan2(sv2.y - sv1.y, sv2.x - sv1.x) * (180 / Math.PI);
    const textAngle = (svgAngle > 90 || svgAngle < -90) ? svgAngle + 180 : svgAngle;

    const text = svgEl("text", {
      x: midX, y: midY - 4,
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "10",
      fill: COLORS.dimText,
      transform: `rotate(${textAngle}, ${midX}, ${midY})`,
    });
    text.textContent = displayText;
    group.appendChild(text);
  }

  // --- Room Labels ---

  function drawRoomLabels(group, building, transform) {
    for (const room of building.rooms.values()) {
      if (!room.label || room.wallIds.length === 0) continue;

      // Find centroid of room walls
      let sumX = 0, sumY = 0, count = 0;
      for (const wid of room.wallIds) {
        const wall = building.walls.get(wid);
        if (!wall) continue;
        sumX += wall.centreline.start.x + wall.centreline.end.x;
        sumY += wall.centreline.start.y + wall.centreline.end.y;
        count += 2;
      }
      if (count === 0) continue;

      const centroid = worldToSvg(sumX / count, sumY / count, transform);
      const text = svgEl("text", {
        x: centroid.x, y: centroid.y,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-family": "Arial, sans-serif",
        "font-size": "13",
        "font-weight": "bold",
        fill: COLORS.roomLabel,
      });
      text.textContent = room.label;
      group.appendChild(text);
    }
  }

  // --- Title Block ---

  function drawTitleBlock(group, transform, title) {
    const w = 200;
    const h = 50;
    const x = transform.svgWidth - w - 10;
    const y = transform.svgHeight - h - 10;

    group.appendChild(svgEl("rect", {
      x, y, width: w, height: h,
      fill: "white",
      stroke: COLORS.titleBlock,
      "stroke-width": WEIGHTS.titleBlock,
    }));

    const titleText = svgEl("text", {
      x: x + w / 2, y: y + 18,
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "12",
      "font-weight": "bold",
      fill: COLORS.titleBlock,
    });
    titleText.textContent = title || "Drawing";
    group.appendChild(titleText);

    const projectText = svgEl("text", {
      x: x + w / 2, y: y + 34,
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "9",
      fill: "#666",
    });
    projectText.textContent = "cHATgpt - Greater Transfer";
    group.appendChild(projectText);

    const dateText = svgEl("text", {
      x: x + w / 2, y: y + 45,
      "text-anchor": "middle",
      "font-family": "Arial, sans-serif",
      "font-size": "8",
      fill: "#999",
    });
    dateText.textContent = new Date().toLocaleDateString();
    group.appendChild(dateText);
  }

  // --- Export ---

  function exportSVG(svgElement) {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgElement);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    renderPlan,
    renderElevation,
    exportSVG,
    createTransform,
    worldToSvg,
  };
})();
