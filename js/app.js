/**
 * app.js - Application Controller
 * Wires the UI to coord, parser, and renderer modules
 */

const App = (() => {
  let currentView = "plan";
  let currentFacing = "N";
  let building = null;
  let debounceTimer = null;

  const DEFAULT_INPUT = `# Simple Room Example
# Grid defines the coordinate system
GRID X A=0 B=3600 C=7200
GRID Y 1=0 2=4200 3=8400

# Levels define floor heights
LEVEL Ground=0

# Walls connect grid intersections
WALL A1-B1 thickness=110 height=2700
WALL B1-C1 thickness=110 height=2700
WALL C1-C2 thickness=110 height=2700
WALL C2-B2 thickness=110 height=2700
WALL B2-A2 thickness=110 height=2700
WALL A2-A1 thickness=110 height=2700
WALL B1-B2 thickness=90 height=2700

# Openings in walls
DOOR A1-B1 offset=900 width=820 height=2040
WINDOW C1-C2 offset=600 width=1200 height=1200 sill=900
WINDOW A2-A1 offset=1200 width=1800 height=1200 sill=900

# Room labels
ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
ROOM "Kitchen" walls=B1-C1,C1-C2,C2-B2,B1-B2 level=Ground

# Dimensions
DIM A1-B1-C1 offset=800
DIM A1-A2 offset=800`;

  function init() {
    const input = document.getElementById("dsl-input");
    const svg = document.getElementById("drawing-svg");
    const errorBar = document.getElementById("error-bar");
    const viewSelect = document.getElementById("view-select");
    const exportBtn = document.getElementById("export-btn");
    const clearBtn = document.getElementById("clear-btn");
    const exampleSelect = document.getElementById("example-select");

    // Load default input
    input.value = DEFAULT_INPUT;

    // Parse and render on input change (debounced)
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => parseAndRender(input, svg, errorBar), 300);
    });

    // View selector
    viewSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "plan") {
        currentView = "plan";
      } else {
        currentView = "elevation";
        currentFacing = val.split("-")[1];
      }
      parseAndRender(input, svg, errorBar);
    });

    // Export SVG
    exportBtn.addEventListener("click", () => {
      Renderer.exportSVG(svg);
    });

    // Clear input
    clearBtn.addEventListener("click", () => {
      input.value = "";
      svg.innerHTML = "";
      errorBar.textContent = "";
      errorBar.className = "status-bar";
    });

    // Example loader
    exampleSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (!val) return;
      loadExample(val, input, svg, errorBar);
      exampleSelect.value = "";
    });

    // Resize handler
    window.addEventListener("resize", () => {
      if (building) {
        parseAndRender(input, svg, errorBar);
      }
    });

    // Initial render
    parseAndRender(input, svg, errorBar);
  }

  function parseAndRender(input, svg, errorBar) {
    const text = input.value;
    if (!text.trim()) {
      svg.innerHTML = "";
      errorBar.textContent = "Enter DSL commands to generate a drawing";
      errorBar.className = "status-bar";
      return;
    }

    const result = Parser.parseInput(text);
    building = result.building;

    // Display errors
    if (result.errors.length > 0) {
      const msgs = result.errors.map((e) => `Line ${e.line}: ${e.message}`);
      errorBar.textContent = msgs.join(" | ");
      errorBar.className = "status-bar has-errors";
    } else {
      errorBar.textContent = `Parsed: ${building.walls.size} walls, ${building.rooms.size} rooms, ${building.dimensions.length} dimensions`;
      errorBar.className = "status-bar";
    }

    // Render
    const svgRect = svg.parentElement.getBoundingClientRect();
    const options = {
      width: svgRect.width || 800,
      height: svgRect.height || 600,
    };

    if (currentView === "plan") {
      options.title = "Floor Plan";
      Renderer.renderPlan(building, svg, options);
    } else {
      options.facing = currentFacing;
      options.title = `Elevation - ${currentFacing}`;
      Renderer.renderElevation(building, svg, options);
    }
  }

  async function loadExample(name, input, svg, errorBar) {
    try {
      const resp = await fetch(`examples/${name}.json`);
      if (!resp.ok) throw new Error(`Failed to load example: ${resp.status}`);
      const data = await resp.json();
      if (data.sourceText) {
        input.value = data.sourceText;
      } else {
        building = Coord.fromJSON(data);
        input.value = `# Loaded from ${name}.json (JSON format)`;
      }
      parseAndRender(input, svg, errorBar);
    } catch (err) {
      errorBar.textContent = `Error loading example: ${err.message}`;
      errorBar.className = "status-bar has-errors";
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
