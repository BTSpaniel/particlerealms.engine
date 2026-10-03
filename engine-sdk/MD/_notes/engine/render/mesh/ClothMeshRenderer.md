### Retained woven panels

`updateFromTriangleMeshes()` accepts the optional `materialAppearance` descriptor validated by `normalizeWovenAppearance()`. A woven panel must also provide `materialCoordinatesMm`, or a Factory adapter must derive those coordinates from the panel's physical `source2D` chart before upload. The shader rotates that chart by `grainDegrees`, draws warp/weft crossings, and fades unresolved detail at distant zoom levels. Solid and woven panels share one vertex buffer, pipeline, and indexed draw.

This path changes appearance only. Use the Engine cloth solvers when the application needs mechanics, contact, tearing, or individual yarn state.
