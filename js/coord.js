/**
 * coord.js - Core Coordinate System & Data Structures
 * Grid Coordinate System (X, Y, Z) for Architectural Drafting
 *
 * Conventions:
 *   X = horizontal (East-West)
 *   Y = vertical on plan (North-South)
 *   Z = height/elevation
 *   Origin (0,0,0) = bottom-left corner at ground level
 *   Units: millimetres (Australian construction standard)
 */

const Coord = (() => {
  let _idCounter = 0;
  function nextId(prefix) {
    return `${prefix}_${++_idCounter}`;
  }

  // --- Data Constructors ---

  function point(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function line(start, end) {
    return { start: { ...start }, end: { ...end } };
  }

  function createBuilding() {
    return {
      grid: { xLines: [], yLines: [] },
      levels: [],
      walls: new Map(),
      rooms: new Map(),
      dimensions: [],
      annotations: [],
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

  function resolveGridRef(ref, grid, z) {
    // ref e.g. "B2" -> letters = X grid label, digits = Y grid label
    const match = ref.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    const xLabel = match[1];
    const yLabel = match[2];
    const xLine = grid.xLines.find((l) => l.label === xLabel);
    const yLine = grid.yLines.find((l) => l.label === yLabel);
    if (!xLine || !yLine) return null;
    return point(xLine.x, yLine.y, z || 0);
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

  // --- Serialisation ---

  function toJSON(building) {
    return JSON.stringify({
      grid: building.grid,
      levels: building.levels,
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
    building.levels = data.levels || [];
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
    point,
    line,
    createBuilding,
    setGrid,
    resolveGridRef,
    addLevel,
    addWall,
    addOpening,
    defineRoom,
    addDimension,
    wallLength,
    wallAngle,
    wallVertices,
    getBoundingBox,
    distanceBetween,
    toJSON,
    fromJSON,
  };
})();
