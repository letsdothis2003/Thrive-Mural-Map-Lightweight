# Thrive-Mural-Map-Lightweight

## Mural data

`ThriveFullScrape_2026.csv` is the public mural source. GitHub Actions uses the `ORS_API_KEY` secret to generate `geocodes.json`; the browser loads both files without geocoding every mural for every visitor.