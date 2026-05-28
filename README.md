# POTEBS Website

Static project website for **POTEBS - Investigating the Potential of E-Bike-Sharing Systems for Sustainable Mobility in Different Spatial Types**.

The project is funded by the Swiss Federal Office of Energy (SFOE), grant `SI/502720-01`, and runs from December 2023 to January 2027.

## Structure

- `index.html` - main project overview and interactive data page
- `methods.html` - methods and survey instrument page
- `styles.css` - shared visual styling
- `nav.js` - mobile navigation and navigation helpers
- `route-animation.js` - lazy-loaded route animation logic
- `ASSETS/` - logos, Open Graph images, and lightweight hero route-loop media
- `data/` - static GeoJSON/JSON datasets used by the website

## Route Animation Data

The route section uses two files:

- `data/trips_animation_w35.json` - desktop sample, 3,000 routed trips
- `data/trips_animation_w35_mobile.json` - mobile sample, 600 simplified routed trips

The hero animation is pre-rendered:

- `ASSETS/hero-route-loop.webp` - animated WebP loaded after first paint
- `ASSETS/hero-route-loop-poster.png` - lightweight poster and reduced-motion fallback

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
