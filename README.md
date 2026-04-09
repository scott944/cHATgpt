# cHATgpt
Greater Transfer — Claude Learning to Draw

## Grid Coordinate System (X, Y, Z)

A browser-based architectural drafting tool that converts hand sketch measurements into SVG drawings using Scott's 6-Step methodology.

### Scott's 6-Step Method

Developed by Scott (Absolute Drafting, 27 years experience). Breaks the complex problem of reading hand sketches into small, sequential, verifiable steps.

| Step | What | Colour | DSL Command |
|------|------|--------|-------------|
| Pre | Grid setup | — | `GRID X A=0 B=1000` |
| 1 | Perimeter corners | Purple | `PERIMETER D/2, G.6/2` |
| 2 | Internal walls | Blue | `INTERNAL G.6/4, K/4` |
| 3 | Exterior elements | Green | `EXTERNAL G.6/1.4` |
| 4 | Join the dots | — | `WALL D/2-G.6/2` |
| 5 | Wall thickness 110mm | — | (automatic) |
| 6 | Dimension confirmation | — | `DIM D/2-G.6/2` |
| 7 | Doors & windows | — | `DOOR` / `WINDOW` |

### Key Rules

1. **Grid first** — establish coordinate system before anything else
2. **Dots before lines** — find all corners before connecting
3. **No diagonals** — all walls horizontal or vertical. Diagonal = wrong coordinate
4. **Close enough is good enough** — read intent, not pixel-perfect
5. **Human confirms** — never adjust dimensions without confirmation

### Coordinate System

- **X** = horizontal (East-West) — grid columns A, B, C...
- **Y** = vertical on plan (North-South) — grid rows 1, 2, 3...
- **Z** = height/elevation
- **Units**: millimetres (Australian construction standard)
- **Decimal refs**: G.4 = column G + 400mm, K.2 = column K + 200mm
- **Format**: `Column/Row` e.g. `D/2`, `G.6/16.4`, `K.2/8.4`

### Usage

Open `index.html` in a browser. No build tools or dependencies required.

Use the **Step slider** in the toolbar to reveal the drawing layer by layer, following Scott's 6-step sequence.

### Project Structure

```
index.html          Main UI (split panel: DSL input + SVG output)
css/style.css       Layout and styling
js/coord.js         Core data model, geometry, and validation
js/parser.js        DSL text parser (supports decimal grid refs)
js/renderer.js      SVG drawing engine with step-by-step layers
js/app.js           Application controller with guided workflow
examples/           Example building data
METHODOLOGY.md      Scott's complete 6-step methodology document
```

### The Insight

> "You stopped trying to make me read the sketch like a computer, and taught
> me to read it like a draftsperson. Dots first. Grid reference first.
> Lines second. Dimensions last."

This project teaches Claude to interpret architectural measurements and produce technical drawings — not through image processing, but through the same coordinate-based thinking a human drafter uses.
