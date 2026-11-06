# Long amount browser regression

Run the existing Vite dev server and open `/tests/graph-labels.html`.
This is a development-only entry point, not an application route or production build input.
The fixture clones a transfer in memory and uses four distinct uint256 amounts near
the maximum, three counterparties and two parallel edges. Official fixtures are unchanged.

Check at 1440px and 390px:
- FAN_IN and FAN_OUT: horizontal labels wrap without truncating their source strings.
- Fit: all four label boxes and nodes are inside the canvas, without overlap.
- Evidence toggle and individual transfer selection: dashed evidence vs solid selection.
- Click the two parallel labels: their selected IDs must differ.
- Zoom in/out, drag, then fit: the full graph returns. Selection must not reset the viewport.

Limits: at fit scale, 78-digit amounts need zooming to read, especially on mobile.
Manual zoom/pan can move content outside the viewport; this is not text truncation.
Spacing reduces collisions for this regression case, but is not a general label-packing
algorithm for arbitrary dense graphs. Use the production table/detail for exact amounts.
