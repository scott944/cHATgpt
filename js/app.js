/**
 * app.js - Application Controller
 * Wires the UI to coord, parser, and renderer modules
 *
 * Implements Scott's 6-Step guided workflow:
 *   Pre: Grid setup
 *   1: Purple dots (perimeter)
 *   2: Blue dots (internal)
 *   3: Green dots (external)
 *   4: Join the dots (centrelines)
 *   5: Wall thickness (110mm)
 *   6: Dimension confirmation
 *   7: Doors & windows
 */

const App = (() => {
  let currentView = "plan";
  let currentFacing = "N";
  let currentStep = 7; // Show all steps by default
  let building = null;
  let debounceTimer = null;

  const STEP_LABELS = [
    "Pre: Grid Setup",
    "Step 1: Perimeter Dots",
    "Step 2: Internal Dots",
    "Step 3: External Dots",
    "Step 4: Join the Dots",
    "Step 5: Wall Thickness",
    "Step 6: Dimensions",
    "Step 7: Doors & Windows",
  ];

  // Griffiths Street example — Scott's actual teaching sketch
  const GRIFFITHS_EXAMPLE = `# Griffiths Street — Scott's 6-Step Teaching Example
# Based on 25056 Griffiths St site measure sketch

# Pre-step: Grid based on graph paper (1m = 1 major square)
GRID X A=0 B=1000 C=2000 D=3000 E=4000 F=5000 G=6000 H=7000 I=8000 J=9000 K=10000 L=11000
GRID Y 1=0 2=1000 3=2000 4=3000 5=4000 6=5000 7=6000 8=7000 9=8000 10=9000 11=10000 12=11000 13=12000 14=13000 15=14000 16=15000 17=16000 18=17000 19=18000 20=19000 21=20000 22=21000 23=22000
SCALE 1000

# Step 1: Purple dots — perimeter corners
PERIMETER D/2, G.6/2, G.6/2.8, K.2/2.8, K.2/6.8, J.6/6.8, J.6/8.4, K.2/8.4, K.2/16.4, G.6/16.4, G.6/18.4, D/18.4

# Step 2: Blue dots — internal walls
INTERNAL G.6/4, K/4, K/6.8, G.6/6.8, H.8/6.8, H.8/8.4, I.6/8, G.6/8, G.6/11, K/11, K/14.2, G.6/14.2

# Step 3: Green dots — exterior elements (verandas/decks)
EXTERNAL G.6/1.4, J.6/1.4, J.6/2.8, J/17.6, J/21.8, D.8/21.8

# Step 4: Join the dots — perimeter walls
WALL D/2-G.6/2 thickness=110
WALL G.6/2-G.6/2.8 thickness=110
WALL G.6/2.8-K.2/2.8 thickness=110
WALL K.2/2.8-K.2/6.8 thickness=110
WALL K.2/6.8-J.6/6.8 thickness=110
WALL J.6/6.8-J.6/8.4 thickness=110
WALL J.6/8.4-K.2/8.4 thickness=110
WALL K.2/8.4-K.2/16.4 thickness=110
WALL K.2/16.4-G.6/16.4 thickness=110
WALL G.6/16.4-G.6/18.4 thickness=110
WALL G.6/18.4-D/18.4 thickness=110
WALL D/18.4-D/2 thickness=110

# Step 4: Join the dots — internal walls
WALL G.6/4-K/4 thickness=90
WALL G.6/4-G.6/8 thickness=90
WALL K/4-K/6.8 thickness=90
WALL H.8/6.8-H.8/8.4 thickness=90
WALL G.6/8-I.6/8 thickness=90
WALL G.6/11-K/11 thickness=90
WALL G.6/11-G.6/14.2 thickness=90
WALL K/11-K/14.2 thickness=90

# Step 4: Join the dots — exterior (veranda/deck)
WALL G.6/1.4-J.6/1.4 thickness=90
WALL J.6/1.4-J.6/2.8 thickness=90
WALL J/17.6-J/21.8 thickness=90
WALL J/21.8-D.8/21.8 thickness=90

# Step 7: Rooms
ROOM "BED 1" walls=D/2-G.6/2,G.6/2-G.6/4,G.6/4-D/4 level=Ground
ROOM "BED 2" walls=G.6/4-G.6/8,G.6/8-D/8,D/8-D/4 level=Ground
ROOM "LIVING" walls=D/8-G.6/8,G.6/11-D/11 level=Ground
ROOM "DINING" walls=G.6/11-G.6/14.2,G.6/14.2-D/14.2,D/14.2-D/11 level=Ground
ROOM "KITCH" walls=K/11-K/14.2 level=Ground
ROOM "BATH" walls=H.8/6.8-H.8/8.4 level=Ground
ROOM "DECK" walls=J/17.6-J/21.8,J/21.8-D.8/21.8 level=Ground

# Step 6: Dimensions (confirm with Scott before adjusting)
DIM D/2-G.6/2 offset=800
DIM D/2-D/18.4 offset=800`;

  const DEFAULT_INPUT = `# Simple Room Example — Scott's 6-Step Method
# Open the DSL Reference below for command syntax

# Pre-step: Grid setup (A-C columns, 1-3 rows, 1m squares)
GRID X A=0 B=3600 C=7200
GRID Y 1=0 2=4200 3=8400

LEVEL Ground=0

# Step 1: Perimeter dots (purple)
PERIMETER A/1, B/1, C/1, C/2, C/3, B/3, A/3, A/2

# Step 2: Internal dots (blue)
INTERNAL B/1, B/2, B/3

# Steps 4-5: Walls (centrelines + 110mm thickness)
WALL A1-B1 thickness=110 height=2700
WALL B1-C1 thickness=110 height=2700
WALL C1-C2 thickness=110 height=2700
WALL C2-B2 thickness=110 height=2700
WALL B2-A2 thickness=110 height=2700
WALL A2-A1 thickness=110 height=2700
WALL B1-B2 thickness=90 height=2700

# Step 7: Openings
DOOR A1-B1 offset=900 width=820 height=2040
WINDOW C1-C2 offset=600 width=1200 height=1200 sill=900
WINDOW A2-A1 offset=1200 width=1800 height=1200 sill=900

# Rooms
ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
ROOM "Kitchen" walls=B1-C1,C1-C2,C2-B2,B1-B2 level=Ground

# Step 6: Dimensions
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
    const stepSlider = document.getElementById("step-slider");
    const stepLabel = document.getElementById("step-label");

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

    // Step slider — reveals drawing layer by layer
    if (stepSlider) {
      stepSlider.addEventListener("input", (e) => {
        currentStep = parseInt(e.target.value);
        if (stepLabel) stepLabel.textContent = STEP_LABELS[currentStep] || "All";
        parseAndRender(input, svg, errorBar);
      });
    }

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
      if (val === "griffiths") {
        input.value = GRIFFITHS_EXAMPLE;
        parseAndRender(input, svg, errorBar);
      } else {
        loadExample(val, input, svg, errorBar);
      }
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

  function getVisibleSteps() {
    // Build array of which steps are visible based on slider position
    const steps = [0]; // Grid always visible
    for (let i = 1; i <= currentStep; i++) {
      steps.push(i);
    }
    return steps;
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

    // Separate warnings from errors
    const realErrors = result.errors.filter((e) => !e.message.startsWith("WARNING:"));
    const warnings = result.errors.filter((e) => e.message.startsWith("WARNING:"));

    // Display status
    if (realErrors.length > 0) {
      const msgs = realErrors.map((e) => `Line ${e.line}: ${e.message}`);
      errorBar.textContent = msgs.join(" | ");
      errorBar.className = "status-bar has-errors";
    } else if (warnings.length > 0) {
      errorBar.textContent = `${building.walls.size} walls, ${building.dots.length} dots | ${warnings.map((w) => w.message).join(" | ")}`;
      errorBar.className = "status-bar has-warnings";
    } else {
      errorBar.textContent = `Parsed: ${building.walls.size} walls, ${building.dots.length} dots, ${building.rooms.size} rooms, ${building.dimensions.length} dims`;
      errorBar.className = "status-bar";
    }

    // Render
    const svgRect = svg.parentElement.getBoundingClientRect();
    const options = {
      width: svgRect.width || 800,
      height: svgRect.height || 600,
      visibleSteps: getVisibleSteps(),
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
