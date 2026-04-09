/**
 * coord.js - Core Coordinate System & Data Structures
 * Grid Coordinate System (X, Y, Z) for Architectural Drafting
 *
 * Scott's 6-Step Methodology (Absolute Drafting):
 *   Pre-step: Establish shared grid (graph paper squares = 1m x 1m)
 *   Step 1: Purple dots — perimeter corners
 *   Step 2: Blue dots — internal wall intersections
 *   Step 3: Green dots — exterior elements (verandas/decks)
 *   Step 4: Join the dots (H/V lines only — no diagonals!)
 *   Step 5: Wall thickness 110mm (offset ±55mm from centreline)
 *   Step 6: Dimension confirmation (human-in-the-loop)
 *
 * Conventions:
 *   X = horizontal (East-West)
 *   Y = vertical on plan (North-South)
 *   Z = height/elevation
 *   Origin (0,0,0) = bottom-left corner at ground level
 *   Units: millimetres (Australian construction standard)
 *
 * Grid refs use decimal notation for 200mm subdivisions:
 *   G.4 = column G + 400mm, K.2 = column K + 200mm
 *   Coordinate format: Column/Row e.g. D/2, G.6/16.4, K.2/8.4
 */

const Coord = (() => {
  let _idCounter = 0;
  function nextId(prefix) {
    return `${prefix}_${++_idCounter}`;
  }

  // --- Dot Categories (Scott's colour code) ---
  const DOT_TYPES = {
    PERIMETER: "perimeter",   // Purple — external wall corners (Step 1)
    INTERNAL: "internal",     // Blue/Teal — internal wall intersections (Step 2)
    EXTERNAL: "external",     // Green — verandas, decks, porches (Step 3)
    DOOR: "door",             // Dark Red — door positions (Step 7)
    WINDOW: "window",         // Teal rectangle — window positions (Step 7)
  };

  const DOT_COLOURS = {
    perimeter: "#6B2D8B",   // Dark purple
    internal: "#2196F3",    // Blue
    external: "#4CAF50",    // Green
    door: "#B71C1C",        // Dark red
    window: "#00897B",      // Teal
  };

  // --- Data Constructors ---

  function point(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function line(start, end) {
    return { start: { ...start }, end: { ...end } };
  }

  function createBuilding() {
    return {
      grid: { xLines: [], yLines: [], scale: 1000 },
      levels: [],
      dots: [],
      walls: new Map(),
      rooms: new Map(),
      dimensions: [],
      annotations: [],
      warnings: [],
    };
  }

  // --- Grid ---

  function setGrid(building, { xLines, yLines }) {
    // xLines: [{label, x}], yLines: [{label, y}]
    building.grid.xLines = (xLines || []).map((l) => ({
      id: nextId("gx"),
      label: l.label,
      x: l.x,
    }));
    building.grid.yLines = (yLines || []).map((l) => ({
      id: nextId("gy"),
      label: l.label,
      y: l.y,
    }));
  }

  // --- Dots (Scott's colour-coded markers) ---

  function addDot(building, { position, type, label }) {
    const dot = {
      id: nextId("dot"),
      position: { ...position },
      type: type || DOT_TYPES.PERIMETER,
      label: label || "",
      gridRef: "",
    };
    building.dots.push(dot);
    return dot.id;
  }

  function getDotsOfType(building, type) {
    return building.dots.filter((d) => d.type === type);
  }

  // --- Grid Reference Resolution ---
  // Supports Scott's decimal notation:
  //   "B2" = column B, row 2 (standard)
  //   "G.4/16.4" = column G + 400mm / row 16 + 400mm (Scott's format)
  //   "K.2/8.4" = column K + 200mm / row 8 + 400mm

  function resolveGridRef(ref, grid, z) {
    const scale = grid.scale || 1000; // mm per major grid square (default 1m)

    // Try Scott's slash format first: "G.6/2" or "K.2/8.4"
    if (ref.includes("/")) {
      return resolveSlashRef(ref, grid, z, scale);
    }

    // Legacy format: "A1", "B10", "C2" — letters=X column, digits=Y row
    // The regex splits at the letter/digit boundary: letters first, then all digits
    const match = ref.match(/^([A-Z]+)(\d+\.?\d*)$/);
    if (!match) {
      // Try decimal column only: "G.4" with separate row context
      const decMatch = ref.match(/^([A-Z]+\.\d+)$/);
      if (decMatch) {
        const xVal = resolveAxisRef(decMatch[1], grid.xLines, "x", scale);
        if (xVal !== null) return point(xVal, 0, z || 0);
      }
      return null;
    }

    const xRef = match[1];
    const yRef = match[2];

    const xVal = resolveAxisRef(xRef, grid.xLines, "x", scale);
    const yVal = resolveAxisRef(yRef, grid.yLines, "y", scale);

    if (xVal === null || yVal === null) return null;
    return point(xVal, yVal, z || 0);
  }

  function resolveSlashRef(ref, grid, z, scale) {
    const parts = ref.split("/");
    if (parts.length !== 2) return null;

    const xVal = resolveAxisRef(parts[0].trim(), grid.xLines, "x", scale);
    const yVal = resolveAxisRef(parts[1].trim(), grid.yLines, "y", scale);

    if (xVal === null || yVal === null) return null;
    return point(xVal, yVal, z || 0);
  }

  function resolveAxisRef(ref, axisLines, axis, scale) {
    // Handle decimal refs: "G.4" = column G + 0.4 * scale (400mm at 1:100)
    // Handle whole refs: "G" or "2"
    const decMatch = ref.match(/^([A-Za-z0-9]+)\.(\d+)$/);
    if (decMatch) {
      const baseLabel = decMatch[1];
      const decimal = parseFloat("0." + decMatch[2]);
      const baseLine = axisLines.find((l) => l.label === baseLabel);
      if (!baseLine) return null;
      const baseVal = axis === "x" ? baseLine.x : baseLine.y;
      return baseVal + decimal * scale;
    }

    // Whole number/letter ref
    const line = axisLines.find((l) => l.label === ref);
    if (!line) return null;
    return axis === "x" ? line.x : line.y;
  }

  // --- Levels ---

  function addLevel(building, { z, label }) {
    building.levels.push({ z, label });
    building.levels.sort((a, b) => a.z - b.z);
  }

  // --- Walls ---

  function addWall(building, { from, to, thickness, height }) {
    const id = nextId("wall");
    const wall = {
      id,
      centreline: line(from, to),
      thickness: thickness || 110,
      height: height || 2700,
      openings: [],
    };
    building.walls.set(id, wall);
    return id;
  }

  function addOpening(building, wallId, { type, offset, width, height, sillHeight }) {
    const wall = building.walls.get(wallId);
    if (!wall) return null;
    const opening = {
      id: nextId("opening"),
      type: type || "door", // 'door' | 'window'
      offset: offset || 0,
      width: width || 820,
      height: height || 2040,
      sillHeight: sillHeight || 0,
    };
    wall.openings.push(opening);
    return opening.id;
  }

  // --- Rooms ---

  function defineRoom(building, { label, wallIds, floorLevel }) {
    const id = nextId("room");
    building.rooms.set(id, {
      id,
      label: label || "",
      wallIds: wallIds || [],
      floorLevel: floorLevel || 0,
    });
    return id;
  }

  // --- Dimensions ---

  function addDimension(building, { points, offset, direction }) {
    const dim = {
      id: nextId("dim"),
      points: points.map((p) => ({ ...p })),
      offset: offset || 600,
      direction: direction || "auto",
    };
    building.dimensions.push(dim);
    return dim.id;
  }

  // --- Geometry Helpers ---

  function wallLength(wall) {
    const dx = wall.centreline.end.x - wall.centreline.start.x;
    const dy = wall.centreline.end.y - wall.centreline.start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function wallAngle(wall) {
    const dx = wall.centreline.end.x - wall.centreline.start.x;
    const dy = wall.centreline.end.y - wall.centreline.start.y;
    return Math.atan2(dy, dx);
  }

  function wallVertices(wall) {
    const angle = wallAngle(wall);
    const perpAngle = angle + Math.PI / 2;
    const halfT = wall.thickness / 2;
    const offsetX = Math.cos(perpAngle) * halfT;
    const offsetY = Math.sin(perpAngle) * halfT;
    const s = wall.centreline.start;
    const e = wall.centreline.end;
    return [
      point(s.x + offsetX, s.y + offsetY, s.z),
      point(e.x + offsetX, e.y + offsetY, e.z),
      point(e.x - offsetX, e.y - offsetY, e.z),
      point(s.x - offsetX, s.y - offsetY, s.z),
    ];
  }

  function getBoundingBox(building) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const wall of building.walls.values()) {
      const verts = wallVertices(wall);
      for (const v of verts) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
      minZ = Math.min(minZ, wall.centreline.start.z);
      maxZ = Math.max(maxZ, wall.centreline.start.z + wall.height);
    }

    if (minX === Infinity) {
      return { min: point(0, 0, 0), max: point(0, 0, 0) };
    }
    return { min: point(minX, minY, minZ), max: point(maxX, maxY, maxZ) };
  }

  function distanceBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // --- Wall Validation (Scott's Rule: No Diagonals Ever) ---

  function isWallHorizontal(wall) {
    return Math.abs(wall.centreline.end.y - wall.centreline.start.y) < 1;
  }

  function isWallVertical(wall) {
    return Math.abs(wall.centreline.end.x - wall.centreline.start.x) < 1;
  }

  function validateWalls(building) {
    // Scott's rule: ALL walls must be horizontal or vertical.
    // If a wall is diagonal, a coordinate is wrong — flag it.
    const warnings = [];
    for (const wall of building.walls.values()) {
      if (!isWallHorizontal(wall) && !isWallVertical(wall)) {
        const s = wall.centreline.start;
        const e = wall.centreline.end;
        warnings.push({
          type: "diagonal",
          wallId: wall.id,
          message: `Diagonal wall detected (${s.x},${s.y})→(${e.x},${e.y}). All walls must be H or V. Check coordinates.`,
        });
      }
    }
    building.warnings = warnings;
    return warnings;
  }

  // --- Dimension Adjustment (Step 6) ---
  // Nudge walls to match confirmed dimensions.
  // The drawing is already roughly to scale — walls only move a little.

  function adjustWallDimension(building, wallId, confirmedLength) {
    const wall = building.walls.get(wallId);
    if (!wall) return false;

    const currentLen = wallLength(wall);
    const diff = confirmedLength - currentLen;
    if (Math.abs(diff) < 1) return true; // Already correct

    // Extend/contract from the end point, keeping start fixed
    const angle = wallAngle(wall);
    wall.centreline.end.x = wall.centreline.start.x + Math.cos(angle) * confirmedLength;
    wall.centreline.end.y = wall.centreline.start.y + Math.sin(angle) * confirmedLength;

    return true;
  }

  // --- Serialisation ---

  function toJSON(building) {
    return JSON.stringify({
      grid: building.grid,
      levels: building.levels,
      dots: building.dots,
      walls: Array.from(building.walls.values()),
      rooms: Array.from(building.rooms.values()),
      dimensions: building.dimensions,
      annotations: building.annotations,
    }, null, 2);
  }

  function fromJSON(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const building = createBuilding();
    building.grid = data.grid || { xLines: [], yLines: [] };
    building.grid.scale = building.grid.scale || 1000;
    building.levels = data.levels || [];
    building.dots = data.dots || [];
    if (data.walls) {
      for (const w of data.walls) {
        building.walls.set(w.id, w);
      }
    }
    if (data.rooms) {
      for (const r of data.rooms) {
        building.rooms.set(r.id, r);
      }
    }
    building.dimensions = data.dimensions || [];
    building.annotations = data.annotations || [];
    return building;
  }

  return {
    DOT_TYPES,
    DOT_COLOURS,
    point,
    line,
    createBuilding,
    setGrid,
    resolveGridRef,
    resolveAxisRef,
    addLevel,
    addDot,
    getDotsOfType,
    addWall,
    addOpening,
    defineRoom,
    addDimension,
    wallLength,
    wallAngle,
    wallVertices,
    getBoundingBox,
    distanceBetween,
    isWallHorizontal,
    isWallVertical,
    validateWalls,
    adjustWallDimension,
    toJSON,
    fromJSON,
  };
})();
