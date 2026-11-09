import csv
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "ThriveFullScrape_2026.csv"
OUTPUT_PATH = ROOT / "geocodes.json"
CACHE_PATH = ROOT / ".geocode-cache.json"
GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
REQUEST_INTERVAL = 1.6


def address_key(address):
    return "_".join(address.strip().lower().split())


def load_coordinates(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") == 1 and isinstance(data.get("coordinates"), dict):
            return data["coordinates"]
    except (OSError, ValueError, AttributeError):
        pass
    return {}


def valid_coordinates(value):
    if not isinstance(value, dict):
        return False
    try:
        lat = float(value["lat"])
        lng = float(value["lng"])
    except (KeyError, TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


def geocode(address, api_key):
    query = urlencode({"api_key": api_key, "text": address, "size": 1})
    request = Request(
        GEOCODE_URL + "?" + query,
        headers={"User-Agent": "ThriveMuralMap/1.0"},
    )
    with urlopen(request, timeout=30) as response:
        features = json.load(response).get("features", [])
    if not features:
        return None
    coordinates = features[0].get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        return None
    result = {"lat": float(coordinates[1]), "lng": float(coordinates[0])}
    return result if valid_coordinates(result) else None


def main():
    if not CSV_PATH.is_file():
        raise SystemExit("Mural CSV not found: " + str(CSV_PATH))

    with CSV_PATH.open(encoding="utf-8-sig", newline="") as csv_file:
        rows = csv.DictReader(csv_file)
        addresses = list(dict.fromkeys(
            (row.get("street_address") or "").strip()
            for row in rows
            if (row.get("street_address") or "").strip()
        ))

    coordinates = load_coordinates(CACHE_PATH)
    coordinates.update(load_coordinates(OUTPUT_PATH))
    coordinates = {
        key: value for key, value in coordinates.items()
        if valid_coordinates(value)
    }
    missing = [address for address in addresses if address_key(address) not in coordinates]

    api_key = os.environ.get("ORS_API_KEY", "").strip()
    if missing and not api_key:
        raise SystemExit("ORS_API_KEY is required to geocode new mural addresses")

    unresolved = []
    for index, address in enumerate(missing):
        try:
            result = geocode(address, api_key)
        except HTTPError as error:
            if error.code == 429 or error.code >= 500:
                raise SystemExit("OpenRouteService returned HTTP " + str(error.code))
            result = None
        except (URLError, TimeoutError, ValueError) as error:
            raise SystemExit("Geocoding failed for " + address + ": " + str(error))

        if result:
            coordinates[address_key(address)] = result
        else:
            unresolved.append(address)
            print("No geocode result: " + address, file=sys.stderr)

        if index + 1 < len(missing):
            time.sleep(REQUEST_INTERVAL)
        if (index + 1) % 25 == 0:
            print("Geocoded " + str(index + 1) + " / " + str(len(missing)))

    OUTPUT_PATH.write_text(json.dumps({
        "version": 1,
        "coordinates": coordinates,
        "unresolved": unresolved,
    }, separators=(",", ":")), encoding="utf-8")
    CACHE_PATH.unlink(missing_ok=True)
    print(
        "Coordinate cache: " + str(len(coordinates)) + " addresses, "
        + str(len(unresolved)) + " unresolved"
    )


if __name__ == "__main__":
    main()