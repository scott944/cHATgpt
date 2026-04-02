# cHATgpt
Greater Transfer

## Grid Coordinate System (X, Y, Z)

A browser-based architectural drafting tool that converts hand sketch measurements into SVG drawings using a grid coordinate system.

### Coordinate System

- **X** = horizontal (East-West) — grid columns labelled A, B, C...
- **Y** = vertical on plan (North-South) — grid rows labelled 1, 2, 3...
- **Z** = height/elevation — defined by levels (Ground=0, First=2700, etc.)
- **Units**: millimetres (Australian construction standard)
- **Origin (0,0,0)**: bottom-left corner at ground level

### How It Works

1. Define a **grid** with labelled X and Y coordinates
2. Place **walls** between grid intersections (e.g. `A1-B1`)
3. Add **doors** and **windows** to walls
4. Label **rooms** and add **dimensions**
5. The system renders an SVG architectural drawing in real time

### DSL (Domain Specific Language)

```
GRID X A=0 B=3600 C=7200        # X-axis grid lines (mm)
GRID Y 1=0 2=4200 3=8400        # Y-axis grid lines (mm)
LEVEL Ground=0 First=2700       # Floor levels (Z height)
WALL A1-B1 thickness=110        # Wall between grid points
DOOR A1-B1 offset=900 width=820 height=2040
WINDOW A1-A2 offset=600 width=1200 height=1200 sill=900
ROOM "Living" walls=A1-B1,B1-B2,B2-A2,A2-A1 level=Ground
DIM A1-B1 offset=600            # Dimension line
```

### Usage

Open `index.html` in a browser. No build tools or dependencies required.

### Project Structure

```
index.html          Main UI (split panel: DSL input + SVG output)
css/style.css       Layout and styling
js/coord.js         Core data model and geometry
js/parser.js        DSL text parser
js/renderer.js      SVG drawing engine
js/app.js           Application controller
examples/           Example building data
```

### Claude Learning to Draw

This project teaches Claude to interpret architectural measurements and produce technical drawings. The grid coordinate system provides a structured way to describe spatial relationships that Claude can understand and generate.
