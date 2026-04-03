/**
 * parser.js - Measurement Input Parser
 * Converts text DSL (hand sketch notes) into Building data
 *
 * Scott's 6-Step Methodology DSL Format:
 *
 *   # Pre-step: Grid setup (1m squares at 1:100, 200mm subdivisions)
 *   GRID X A=0 B=1000 C=2000 D=3000
 *   GRID Y 1=0 2=1000 3=2000
 *   SCALE 1000          # mm per major grid square (default 1000 = 1m)
 *
 *   # Step 1: Purple dots — perimeter corners
 *   PERIMETER D/2, G.6/2, G.6/2.8, K.2/2.8
 *
 *   # Step 2: Blue dots — internal walls
 *   INTERNAL G.6/4, H.8/4, H.8/8, G.6/8
 *
 *   # Step 3: Green dots — exterior elements
 *   EXTERNAL G.6/1.4, J.6/1.4, J.6/2.8
 *
 *   # Step 4: Join the dots (walls between dot pairs)
 *   WALL D/2-G.6/2 thickness=110
 *   WALL G.6/2-G.6/2.8 thickness=110
 *
 *   # Legacy format still supported:
 *   WALL A1-B1 thickness=110 height=2700
 *   DOOR A1-B1 offset=900 width=820 height=2040
 *   WINDOW A1-A2 offset=600 width=1200 height=1200 sill=900
 *   ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
 *   DIM A1-B1 offset=600
 *   LEVEL Ground=0 First=2700
 */

const Parser = (() => {
  function parseInput(text) {
    const building = Coord.createBuilding();
    const errors = [];
    const lines = text.split("\n");
    let currentZ = 0;

    // First pass: parse GRID, SCALE, and LEVEL lines (needed by other commands)
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
      } else if (upper.startsWith("SCALE ")) {
        const parts = line.trim().split(/\s+/);
        if (parts[1]) building.grid.scale = parseFloat(parts[1]);
      }
    }

    // Default level if none specified
    if (building.levels.length === 0) {
      Coord.addLevel(building, { z: 0, label: "Ground" });
    }
    currentZ = building.levels[0].z;

    // Track wall endpoints for matching
    const wallByEndpoints = new Map();

    // Second pass: parse DOT, WALL, DOOR, WINDOW, ROOM, DIM
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;

      const upper = line.toUpperCase();

      if (upper.startsWith("PERIMETER ")) {
        const err = parseDotLine(line, building, currentZ, Coord.DOT_TYPES.PERIMETER);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("INTERNAL ")) {
        const err = parseDotLine(line, building, currentZ, Coord.DOT_TYPES.INTERNAL);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("EXTERNAL ")) {
        const err = parseDotLine(line, building, currentZ, Coord.DOT_TYPES.EXTERNAL);
        if (err) errors.push({ line: i + 1, message: err });
      } else if (upper.startsWith("WALL ")) {
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
      } else if (upper.startsWith("GRID ") || upper.startsWith("LEVEL ") || upper.startsWith("SCALE ")) {
        // Already handled in first pass
      } else {
        errors.push({ line: i + 1, message: `Unknown command: ${line.split(" ")[0]}` });
      }
    }

    // Validate: no diagonal walls (Scott's rule)
    const warnings = Coord.validateWalls(building);
    for (const w of warnings) {
      errors.push({ line: 0, message: `WARNING: ${w.message}` });
    }

    return { building, errors };
  }

  // --- Dot parsing (Steps 1-3) ---

  function parseDotLine(line, building, currentZ, dotType) {
    // PERIMETER D/2, G.6/2, G.6/2.8, K.2/2.8
    // INTERNAL G.6/4, H.8/4
    // EXTERNAL G.6/1.4, J.6/1.4
    const content = line.replace(/^[A-Z]+\s+/i, "").trim();
    if (!content) return "Dot line requires at least one coordinate";

    // Split by comma or whitespace
    const refs = content.split(/[,\s]+/).filter((r) => r.length > 0);

    for (const ref of refs) {
      const pt = Coord.resolveGridRef(ref, building.grid, currentZ);
      if (!pt) return `Cannot resolve coordinate: "${ref}"`;
      Coord.addDot(building, { position: pt, type: dotType, label: ref });
    }
    return null;
  }

  // --- Grid parsing ---

  function parseGridLine(line, building) {
    // GRID X A=0 B=1000 C=2000
    // GRID Y 1=0 2=1000 3=2000
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

  // --- Wall parsing (Step 4) ---

  function parseWallLine(line, building, currentZ) {
    // Supports both formats:
    //   WALL A1-B1 thickness=110              (legacy: grid intersection refs)
    //   WALL D/2-G.6/2 thickness=110          (Scott's: slash coordinate refs)
    //   WALL G.6/2-G.6/2.8 thickness=110
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return { error: "WALL requires endpoint pair" };

    const wallRef = parts[1];
    const endpoints = splitWallRef(wallRef);
    if (!endpoints) return { error: `Invalid wall endpoints: "${wallRef}"` };

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

  function splitWallRef(ref) {
    // Handle "D/2-G.6/2" (Scott's format with slashes)
    // Handle "A1-B1" (legacy format)
    // The tricky part: dashes appear in both formats. Use pattern matching.

    // Try Scott's format: look for "xxx/yyy-xxx/yyy"
    const slashMatch = ref.match(/^([A-Za-z0-9.]+\/[0-9.]+)-([A-Za-z0-9.]+\/[0-9.]+)$/);
    if (slashMatch) return [slashMatch[1], slashMatch[2]];

    // Try legacy format: "A1-B1" or "A1-B1-C1" (chain, return first pair)
    const parts = ref.split("-");
    if (parts.length >= 2) return [parts[0], parts[1]];

    return null;
  }

  // --- Opening parsing ---

  function parseOpeningLine(line, building, wallByEndpoints, currentZ) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return "Opening requires wall reference";

    const type = parts[0].toUpperCase() === "DOOR" ? "door" : "window";
    const wallRef = parts[1];
    const endpoints = splitWallRef(wallRef);
    if (!endpoints) return `Invalid wall reference: "${wallRef}"`;

    const key = makeWallKey(endpoints[0], endpoints[1]);
    const wallId = wallByEndpoints.get(key);
    if (!wallId) return `No wall found for "${wallRef}" - define the wall first`;

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

  // --- Room parsing ---

  function parseRoomLine(line, building, wallByEndpoints, currentZ) {
    const labelMatch = line.match(/"([^"]+)"/);
    const label = labelMatch ? labelMatch[1] : "Room";

    const props = parseProps(line.trim().split(/\s+/).slice(1));
    const wallRefs = props.walls ? props.walls.split(",") : [];
    const wallIds = [];
    for (const ref of wallRefs) {
      const ep = splitWallRef(ref);
      if (!ep) continue;
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

  // --- Dimension parsing ---

  function parseDimLine(line, building, currentZ) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return "DIM requires point references";

    // Support both "DIM A1-B1-C1" and "DIM D/2-G.6/2"
    const refStr = parts[1];
    const refs = refStr.includes("/")
      ? refStr.split(/(?<=[0-9.])-(?=[A-Za-z])/) // Split on "-" between coords with slashes
      : refStr.split("-");

    if (refs.length < 2) return "DIM requires at least 2 points";

    const points = [];
    for (const ref of refs) {
      const p = Coord.resolveGridRef(ref.trim(), building.grid, currentZ);
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
      if (part.startsWith('"')) continue;
      const eq = part.indexOf("=");
      if (eq > 0) {
        props[part.substring(0, eq).toLowerCase()] = part.substring(eq + 1);
      }
    }
    return props;
  }

  function makeWallKey(refA, refB) {
    return [refA, refB].sort().join("~");
  }

  return { parseInput };
})();
