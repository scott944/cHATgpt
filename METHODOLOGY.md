# Scott's 6-Step Sketch-to-Drawing Methodology
## "Teaching Claude to Draw" — Absolute Drafting

Developed by Scott (Absolute Drafting) over 27 years of drafting experience.
This method breaks down the complex problem of reading hand sketches into
small, sequential, verifiable steps that any AI can follow.

---

## The Key Insight

> "You stopped trying to make me read the sketch like a computer, and taught
> me to read it like a draftsperson. Dots first. Grid reference first.
> Lines second. Dimensions last."

---

## Pre-Step: Establish Shared Grid Reference

Before touching ANYTHING else, set up the coordinate system.

- The graph paper's big darker squares = **1m x 1m at scale** (1:100)
- Smaller squares inside = **200mm increments**
- Label columns across the top: **A, B, C, D...**
- Label rows down the side: **1, 2, 3, 4...**
- Both parties (human and AI) must use the SAME labels

### Decimal Notation for In-Between Positions

If a dot isn't on a major grid line, use decimals:
- `G.4` = 400mm past column G (2 small squares past G)
- `K.2` = 200mm past column K (1 small square past K)
- Only values: `.2, .4, .6, .8` (200mm increments)

### Coordinate Format

`Column/Row` — e.g. `D/2`, `G.6/16.4`, `K.2/8.4`

---

## Step 1: Purple Dots — Perimeter Corners

**What**: Place a dark purple dot at every external corner of the building.

**Rule**: These dots MUST line up to form parallel horizontal and vertical lines.
That parallel framework IS the building outline. Hand-drawn imprecision
doesn't matter — the dots tell you the true intent.

**Example** (Griffiths Street):
```
PERIMETER D/2, G.6/2, G.65/2.8, K.2/2.8, K.2/6.8, J.6/6.8,
          J.6/8.4, K.2/8.4, K.2/16.4, G.6/16.4, G.6/18.4, D/18.4
```

---

## Step 2: Blue Dots — Internal Wall Intersections

**What**: Place a blue dot at every internal wall corner, T-junction, or
intersection.

**Rule**: Same as perimeter — dots should form straight horizontal or
vertical lines. Every wall segment needs a dot at each end.

**Logical check**: Two bedrooms side by side MUST have a dividing wall.
That wall needs 2 dots — one at each end. If dots are missing,
something is wrong.

**Example**:
```
INTERNAL columns=G.6,H.8,I.6  rows=4,6.8,8,8.2,11,14.2
```

---

## Step 3: Green Dots — Exterior Elements

**What**: Place a green dot at every veranda, deck, porch, or external
structure corner.

**Rule**: Typically fewer dots (e.g. 3 front + 3 back for verandas).
Same H/V alignment rules apply.

**Example**:
```
EXTERNAL G.6/1.4, J.6/1.4, J.6/2.8, J/17.6, J/21.8, D.8/21.8
```

---

## Step 4: Join the Dots

**What**: Connect dots with straight lines to form walls.

### CRITICAL RULE: No Diagonals — Ever

> "All walls are going to be straight — horizontal or vertical.
> When you draw something with an angle on it, you've gotta start
> checking where we went wrong."

If a line appears diagonal:
1. STOP drawing
2. Check the column values — one coordinate is wrong
3. Fix the coordinate THEN draw the line

Use the hand sketch as a "lacsi-daisy" (rough) reference for which
dots connect to which.

---

## Step 5: Wall Thickness — 110mm

**What**: Apply 110mm wall thickness to all centrelines.

**Method**: Pure computer logic — offset each centreline ±55mm
perpendicular to the wall direction.

- Horizontal walls → expand up and down
- Vertical walls → expand left and right
- Corner overlaps are normal — clean mitre joins come later in CAD

**Internal walls**: May be 90mm (stud only, no wet area lining).

---

## Step 6: Dimension Confirmation (Human-in-the-Loop)

**What**: Read handwritten dimensions from the sketch, confirm with the
human, then nudge walls to exact positions.

### The Workflow

1. Claude reads the dimension from the sketch
2. Claude tells the human: "I think this reads 3645mm — confirm?"
3. Human says yes or corrects it
4. ONLY after confirmation, Claude adjusts the wall position

### Why This Works

The drawing is already roughly to scale from Steps 1-5. The dimensions
just fine-tune it. Walls only need to move a little bit.

### Context Rules for Reading Dimensions

- Dimensions on sketches are ALWAYS in mm
- Room dimensions: typically 500-9000mm
- Chain dimensions must add up (e.g. 90+2380+2400+2330+90 = 7290)
- Wall thicknesses cluster at 90mm or 110mm
- If a reading doesn't make physical sense, it's wrong — query it

---

## Step 7: Doors and Windows

**What**: Place doors and windows using colour-coded markers on the sketch.

- **Blue highlight** on a wall = window
- **Orange/pink shading** = door
- Door openings: 800-900mm wide
- Window sizes: read from handwritten dimensions or estimate from scale

---

## Step 8: DXF Output

**What**: Export the completed drawing as DXF for import into ArchiCAD.

**The DXF doesn't need to be perfect.** ArchiCAD is built for:
- Import rough geometry
- Snap walls to correct positions
- Stretch to dimension
- Check and adjust

Time saving: ~1-2 hours per job of mechanical redrawing eliminated.

---

## Key Rules Summary

1. **Grid first** — before anything else, establish the coordinate system
2. **Dots before lines** — find all corners before connecting anything
3. **Colour code** — purple=perimeter, blue=internal, green=external
4. **No diagonals** — all walls H or V. Diagonal = wrong coordinate
5. **Close enough is good enough** — read intent, not pixel-perfect
6. **Human confirms** — never adjust dimensions without confirmation
7. **Break it down** — small, easy, verifiable steps. KISS.

---

## Colour-Coded Dot System

| Colour | Meaning | Step |
|--------|---------|------|
| Dark Purple | External wall corner (perimeter) | 1 |
| Blue/Teal | Internal wall intersection | 2 |
| Green | Exterior element (veranda/deck) | 3 |
| Dark Red | Door position | 7 |
| Teal Rectangle | Window position | 7 |

---

## Site Measure Template

Custom A4 portrait graph paper with:
- Pre-printed column labels (A-R) and row numbers (1-26)
- 10mm major squares = 1m at 1:100 scale
- 2mm minor grid = 200mm subdivisions
- Corner calibration marks for camera angle correction
- Company name, job/date/address fields
- Scale bar

This eliminates the handwriting-on-grid-labels problem entirely.
