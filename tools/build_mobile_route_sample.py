#!/usr/bin/env python3
"""Build a lightweight mobile route-animation sample from the desktop JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def simplify_trip(trip: dict, max_points: int, precision: int) -> dict:
    path = trip.get("p", [])
    week_t = trip.get("t", [])
    day_t = trip.get("td", [])
    if len(path) <= max_points:
        keep = list(range(len(path)))
    else:
        step = (len(path) - 1) / (max_points - 1)
        keep = sorted({round(i * step) for i in range(max_points)})

    return {
        "provider": trip.get("provider"),
        "p": [[round(path[i][0], precision), round(path[i][1], precision)] for i in keep],
        "t": [week_t[i] for i in keep if i < len(week_t)],
        "td": [day_t[i] for i in keep if i < len(day_t)],
    }


def balanced_sample(trips: list[dict], per_provider: int) -> list[dict]:
    selected = []
    for provider in ("peb", "pb"):
        provider_trips = [trip for trip in trips if trip.get("provider") == provider]
        selected.extend(provider_trips[:per_provider])
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/trips_animation_w35.json")
    parser.add_argument("--output", default="data/trips_animation_w35_mobile.json")
    parser.add_argument("--per-provider", type=int, default=300)
    parser.add_argument("--max-points", type=int, default=35)
    parser.add_argument("--precision", type=int, default=6)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    input_path = root / args.input
    output_path = root / args.output

    trips = json.loads(input_path.read_text(encoding="utf-8"))
    mobile = [
        simplify_trip(trip, args.max_points, args.precision)
        for trip in balanced_sample(trips, args.per_provider)
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(mobile, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Wrote {len(mobile):,} trips to {output_path}")


if __name__ == "__main__":
    main()
