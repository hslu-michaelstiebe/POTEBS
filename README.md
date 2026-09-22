# POTEBS Website

Static project website for **POTEBS - Investigating the Potential of E-Bike-Sharing Systems for Sustainable Mobility in Different Spatial Types**.

The project is funded by the Swiss Federal Office of Energy (SFOE), grant `SI/502720-01`, and runs from December 2023 to January 2027.

Figures on the site follow the published articles: Stiebe, M., Krysiak, F. C., von Arx, W., & Weggelaar, B. (2026). Pragmatism, not ideology: drivers of e-bike sharing usage intensity. *Transportation Research Part D* 161, 105621. <https://doi.org/10.1016/j.trd.2026.105621> (CC BY 4.0); and Stiebe, M., von Arx, W., & Sager-Müller, S. (2026). *Journal of Urban Mobility* 10, 100288. <https://doi.org/10.1016/j.urbmob.2026.100288>. Any change to a reported number belongs in those sources first.

## Structure

- `index.html` - main project overview and interactive data page
- `methods.html` - methods and survey instrument page
- `styles.css` - shared visual styling
- `nav.js` - mobile navigation and navigation helpers
- `site.js` - lazy-loaded charts, maps, explore tabs, scroll-spy, and citations
- `route-animation.js` - lazy-loaded route animation logic
- `ASSETS/` - logos, team portraits, `photos/` (own photos, EXIF removed), `figures/` (figures reproduced from the two articles) and the Open Graph image `og-image.jpg`
- `data/` - static GeoJSON/JSON datasets used by the website
- `vendor/` - self-hosted libraries (Leaflet, leaflet.heat, MapLibre GL, maplibre-gl-leaflet, deck.gl, ECharts) and fonts (Source Serif 4, Source Sans 3, SIL OFL); the only external requests are basemap tiles from OpenFreeMap (no API key)

## Route Animation Data

The route section uses two files:

- `data/trips_animation_w35.json` - desktop sample, 1,800 simplified routed trips
- `data/trips_animation_w35_mobile.json` - mobile sample, 600 simplified routed trips

Route samples can be rebuilt from a larger source file:

```powershell
python tools/build_mobile_route_sample.py --input path\to\full_routes.json --output data\trips_animation_w35.json --per-provider 900 --max-points 60 --precision 5
python tools/build_mobile_route_sample.py --input path\to\full_routes.json --output data\trips_animation_w35_mobile.json --per-provider 300 --max-points 35 --precision 6
```

For performance, heavyweight map and chart libraries are loaded on demand.

## Local Preview

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000/
```

## Contact

Michael Stiebe  
Lucerne University of Applied Sciences and Arts  
`michael.stiebe@hslu.ch`
