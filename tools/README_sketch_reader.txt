SKETCH READER - README
======================
For Scott Dellar, Absolute Drafting (NSW Australia)
Tool: sketch_reader.py
Last updated: April 2026


1. WHAT THIS TOOL DOES
----------------------
Reads scanned architectural hand sketches with coloured dot markers and
generates DXF files you can import straight into ArchiCAD.

  - Reads scanned PDFs or images of your marked-up sketches
  - Detects three dot colours:
      Purple/maroon = perimeter walls
      Blue/teal     = internal walls
      Green         = exterior elements (verandas, decks)
  - Maps each dot to grid coordinates (columns A-L, rows 1-23)
  - Generates a clean DXF with horizontal and vertical walls only
  - All walls are H/V -- no diagonals


2. INSTALLATION
---------------
Requires Python 3.8 or later.

Install dependencies (one command):

    pip install pymupdf pillow numpy opencv-python ezdxf scipy

Copy sketch_reader.py to your tools folder:

    D:\Knowledge Vault 2026\Tools\


3. USAGE FROM CLAUDE DESKTOP (via Desktop Commander)
----------------------------------------------------
Paste this into Claude Desktop:

    python "D:\Knowledge Vault 2026\Tools\sketch_reader.py" --input "C:\path\to\scan.pdf" --job "25056_Griffiths" --output "D:\Knowledge Vault 2026\DXF_Output"

Replace the paths with your actual scan location and job name.


4. USAGE FROM COMMAND LINE
--------------------------
Same command. Run from CMD or PowerShell:

    python "D:\Knowledge Vault 2026\Tools\sketch_reader.py" --input "C:\path\to\scan.pdf" --job "25056_Griffiths" --output "D:\Knowledge Vault 2026\DXF_Output"


5. ARGUMENTS
------------
--input          Path to scanned PDF or image.              REQUIRED
--job            Job name used for output file names.       REQUIRED
--output         Output directory.                          Default: current dir
--scale          Millimetres per grid square.               Default: 1000
--wall-thickness Default wall thickness in mm.              Default: 110
--min-dot-area   Minimum dot size in pixels to detect.      Default: 20
--debug          Save debug images showing detected dots.   No value needed


6. HOW TO MARK UP YOUR SKETCH
------------------------------
Pens:
  - Dark purple or maroon pen  -- perimeter wall corners
  - Blue or teal pen           -- internal wall intersections
  - Green pen                  -- verandas, decks, exterior elements

Rules:
  - Place a dot at every corner and every wall intersection
  - Write grid labels A-L across the top of the page
  - Write grid labels 1-23 down the left side
  - Use blue pen for grid labels
  - Scan at 300 DPI minimum, in COLOUR mode (not greyscale)
  - Bigger dots are better -- don't be shy with the pen


7. EXPECTED OUTPUT
------------------
Three things come out:

  {job}.dxf          DXF file ready for ArchiCAD import
  {job}_coords.txt   Text file listing all detected coordinates
  Console summary    Dot counts per colour and output file paths


8. TROUBLESHOOTING
------------------
Dots not detected?
  - Make bigger dots, use more distinct colours, scan at higher DPI.

Wrong coordinates?
  - Check grid labels are clearly visible in the scan.
  - Run with --debug to see what the tool actually detected.

Diagonal wall warnings?
  - A dot coordinate is off. Check the flagged dot positions.
  - Dots must line up horizontally or vertically with their neighbours.

General:
  - Always try --debug first. It saves images showing exactly what
    was detected, so you can see what went wrong.


9. SCOTT'S 6-STEP METHOD (quick reference)
-------------------------------------------
Pre:  Grid setup -- graph paper, each square = 1 metre

  1.  Purple dots   -- mark every perimeter corner
  2.  Blue dots     -- mark every internal wall intersection
  3.  Green dots    -- mark verandas, decks, exterior elements
  4.  Join the dots -- horizontal and vertical lines only
  5.  Wall thickness -- 110mm default
  6.  Confirm dimensions with Scott before proceeding


10. TEST DATA (Griffiths Street -- perimeter)
----------------------------------------------
Purple dot coordinates for testing:

  D/2, G.6/2, G.6/2.8, K.2/2.8, K.2/6.8, J.6/6.8,
  J.6/8.4, K.2/8.4, K.2/16.4, G.6/16.4, G.6/18.4, D/18.4

Use these to verify the tool is reading and plotting correctly.
