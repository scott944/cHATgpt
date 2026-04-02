/**
 * parser.js - Measurement Input Parser
 * Converts text DSL (hand sketch notes) into Building data
 *
 * DSL Format:
 *   GRID X A=0 B=3600 C=7200
 *   GRID Y 1=0 2=4200 3=8400
 *   LEVEL Ground=0 First=2700
 *   WALL A1-B1 thickness=110 height=2700
 *   DOOR A1-B1 offset=900 width=820 height=2040
 *   WINDOW A1-A2 offset=600 width=1200 height=1200 sill=900
 *   ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
 *   DIM A1-B1 offset=600
 */

const Parser = (() => {
  function parseInput(text) {
    const building = Coord.createBuilding();
    const errors = [];
    const lines = text.split("\n");
    let currentZ = 0;

    // First pass: parse GRID and LEVEL lines (needed by other commands)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;

      const upper = line.toUpperCase();
      if (upper.startsWith("GRID ")) {
        const err = parseGridLine(line, building);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("LEVEL ")) {
        const err = parseLevelLine(line, building);
        if (err) errors.push({ line: i + 1, message: err });
      }
    }

    // Default level if none specified
    if (building.levels.length === 0) {
      Coord.addLevel(building, { z: 0, label: "Ground" });
    }
    currentZ = building.levels[0].z;

    // Track wall endpoints for matching
    const wallByEndpoints = new Map();

    // Second pass: parse WALL, DOOR, WINDOW, ROOM, DIM
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;

      const upper = line.toUpperCase();

      if (upper.startsWith("WALL ")) {
        const result = parseWallLine(line, building, currentZ);
        if (result.error) {
          errors.push({ line: i + 1, message: result.error });
        } else if (result.wallId && result.key) {
          wallByEndpoints.set(result.key, result.wallId);
        }
      } else if (upper.startsWith("DOOR ") || upper.startsWith("WINDOW ")) {
        const err = parseOpeningLine(line, building, wallByEndpoints, currentZ);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("ROOM ")) {
        const err = parseRoomLine(line, building, wallByEndpoints, currentZ);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("DIM ")) {
        const err = parseDimLine(line, building, currentZ);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("GRID ") || upper.startsWith("LEVEL ")) {
        // Already handled
      } else {
        errors.push({ line: i + 1, message: `Unknown command: ${line.split(" ")[0]}` });
      }
    }

    return { building, errors };
  }

  function parseGridLine(line, building) {
    // GRID X A=0 B=3600 C=7200
    // GRID Y 1=0 2=4200
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return "GRID requires axis and at least one value";

    const axis = parts[1].toUpperCase();
    if (axis !== "X" && axis !== "Y") return `GRID axis must be X or Y, got "${parts[1]}"`;

    const entries = [];
    for (let i = 2; i < parts.length; i++) {
      const match = parts[i].match(/^([A-Za-z0-9]+)=(-?\d+\.?\d*)$/);
      if (!match) return `Invalid grid entry: "${parts[i]}" (expected Label=Value)`;
      entries.push({ label: match[1], value: parseFloat(match[2]) });
    }

    if (axis === "X") {
      const existing = building.grid.yLines;
      Coord.setGrid(building, {
        xLines: entries.map((e) => ({ label: e.label, x: e.value })),
        yLines: existing,
      });
    } else {
      const existing = building.grid.xLines;
      Coord.setGrid(building, {
        xLines: existing,
        yLines: entries.map((e) => ({ label: e.label, y: e.value })),
      });
    }
    return null;
  }

  function parseLevelLine(line, building) {
    // LEVEL Ground=0 First=2700
    const parts = line.trim().split(/\s+/);
    for (let i = 1; i < parts.length; i++) {
      const match = parts[i].match(/^([A-Za-z0-9_]+)=(-?\d+\.?\d*)$/);
      if (!match) return `Invalid level entry: "${parts[i]}"`;
      Coord.addLevel(building, { z: parseFloat(match[2]), label: match[1] });
    }
    return null;
  }

  function parseWallLine(line, building, currentZ) {
    // WALL A1-B1 thickness=110 height=2700
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return { error: "WALL requires endpoint pair (e.g. A1-B1)" };

    const endpoints = parts[1].split("-");
    if (endpoints.length !== 2) return { error: `Invalid wall endpoints: "${parts[1]}"` };

    const from = Coord.resolveGridRef(endpoints[0], building.grid, currentZ);
    const to = Coord.resolveGridRef(endpoints[1], building.grid, currentZ);
    if (!from) return { error: `Cannot resolve grid reference: "${endpoints[0]}"` };
    if (!to) return { error: `Cannot resolve grid reference: "${endpoints[1]}"` };

    const props = parseProps(parts.slice(2));
    const wallId = Coord.addWall(building, {
      from,
      to,
      thickness: props.thickness ? parseFloat(props.thickness) : 110,
      height: props.height ? parseFloat(props.height) : 2700,
    });

    const key = makeWallKey(endpoints[0], endpoints[1]);
    return { wallId, key };
  }

  function parseOpeningLine(line, building, wallByEndpoints, currentZ) {
    // DOOR A1-B1 offset=900 width=820 height=2040
    // WINDOW A1-A2 offset=600 width=1200 height=1200 sill=900
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return "Opening requires wall reference";

    const type = parts[0].toUpperCase() === "DOOR" ? "door" : "window";
    const endpoints = parts[1].split("-");
    if (endpoints.length !== 2) return `Invalid wall reference: "${parts[1]}"`;

    const key = makeWallKey(endpoints[0], endpoints[1]);
    const wallId = wallByEndpoints.get(key);
    if (!wallId) return `No wall found for "${parts[1]}" - define the wall first`;

    const props = parseProps(parts.slice(2));
    Coord.addOpening(building, wallId, {
      type,
      offset: props.offset ? parseFloat(props.offset) : 0,
      width: props.width ? parseFloat(props.width) : type === "door" ? 820 : 1200,
      height: props.height ? parseFloat(props.height) : type === "door" ? 2040 : 1200,
      sillHeight: props.sill ? parseFloat(props.sill) : type === "window" ? 900 : 0,
    });
    return null;
  }

  function parseRoomLine(line, building, wallByEndpoints, currentZ) {
    // ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
    const labelMatch = line.match(/"([^"]+)"/);
    const label = labelMatch ? labelMatch[1] : "Room";

    const props = parseProps(line.trim().split(/\s+/).slice(1));
    const wallRefs = props.walls ? props.walls.split(",") : [];
    const wallIds = [];
    for (const ref of wallRefs) {
      const ep = ref.split("-");
      if (ep.length !== 2) continue;
      const key = makeWallKey(ep[0], ep[1]);
      const wid = wallByEndpoints.get(key);
      if (wid) wallIds.push(wid);
    }

    let floorZ = currentZ;
    if (props.level) {
      const lvl = building.levels.find(
        (l) => l.label.toLowerCase() === props.level.toLowerCase()
      );
      if (lvl) floorZ = lvl.z;
    }

    Coord.defineRoom(building, { label, wallIds, floorLevel: floorZ });
    return null;
  }

  function parseDimLine(line, building, currentZ) {
    // DIM A1-B1 offset=600
    // DIM A1-B1-C1 offset=600  (chain dimension)
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return "DIM requires point references";

    const refs = parts[1].split("-");
    if (refs.length < 2) return "DIM requires at least 2 points";

    const points = [];
    for (const ref of refs) {
      const p = Coord.resolveGridRef(ref, building.grid, currentZ);
      if (!p) return `Cannot resolve grid reference: "${ref}"`;
      points.push(p);
    }

    const props = parseProps(parts.slice(2));
    Coord.addDimension(building, {
      points,
      offset: props.offset ? parseFloat(props.offset) : 600,
      direction: props.dir || "auto",
    });
    return null;
  }

  // --- Helpers ---

  function parseProps(parts) {
    const props = {};
    for (const part of parts) {
      if (part.startsWith('"')) continue; // skip quoted labels
      const eq = part.indexOf("=");
      if (eq > 0) {
        props[part.substring(0, eq).toLowerCase()] = part.substring(eq + 1);
      }
    }
    return props;
  }

  function makeWallKey(refA, refB) {
    // Normalise order so A1-B1 and B1-A1 match the same wall
    return [refA, refB].sort().join("-");
  }

  return { parseInput };
})();
