"""
POTEBS — Lorenz Curve Data Exporter
------------------------------------
Reads raw trip and survey data locally, computes Lorenz curves for 4 panels,
and writes a small aggregated JSON file suitable for public upload to GitHub.

Output: ../data/lorenz.json   (~5–10 KB, no individual-level data)

Panels:
  all_trips        — Trip count,    all users
  all_duration     — Duration (min), all users
  survey_trips     — Trip count,    survey respondents only
  survey_duration  — Duration (min), survey respondents only

Each panel contains curves for: combined, peb (Pick-e-Bike), pb (PubliBike Velospot)
Each curve: { curve: [[pop_pct, cum_pct], ...], gini: float, n_users: int, total: float }

Usage:
  cd tools/
  python export_lorenz.py
"""

import pandas as pd
import numpy as np
import json
import os
from datetime import datetime

# =============================================================================
# CONFIGURATION — adjust paths if needed
# =============================================================================

FFEBSS_PATH = r"C:\Users\Micha\OneDrive - Hochschule Luzern\Forschungsprojekte\POTEBS BFE\HSLU x UniBas\AP2_Data_Analysis\Daten_Pick_e_Bike_PubliBike\Daten Pick-e-Bike\Lieferung Daten Pick-e-Bike Mai 2025\Merged_Rentals_PeB_05_2018_05_2025.csv"

DBEBSS_PATH = r"C:\Users\Micha\OneDrive - Hochschule Luzern\Forschungsprojekte\POTEBS BFE\HSLU x UniBas\AP2_Data_Analysis\Daten_Pick_e_Bike_PubliBike\Daten PubliBike\Rohdaten\Lieferung Daten velospot März 2025\2025.03.24\trips_enriched.csv"

SURVEY_PATH = r"C:\Users\Micha\OneDrive - Hochschule Luzern\Forschungsprojekte\POTEBS BFE\HSLU x UniBas\AP3_Survey\Survey Evaluation\Merged Datasets\merged_survey_data_PeB_VS_weather_enhanced.csv"

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'lorenz.json')

# Number of sampled points per curve (higher = smoother, but larger file)
N_POINTS = 201

# =============================================================================
# HELPERS
# =============================================================================

def lorenz_sample(values, n_points=N_POINTS):
    """
    Returns n_points [pop_pct, cum_pct] pairs sampled at evenly-spaced
    population percentiles. Safe to publish — contains no individual data.
    """
    v = np.sort(np.asarray(values, dtype=float))
    v = v[v > 0]  # drop zeros
    if len(v) == 0:
        return [[0.0, 0.0], [100.0, 100.0]]

    pop_pct = np.arange(1, len(v) + 1) / len(v) * 100
    cum_pct = np.cumsum(v) / v.sum() * 100
    # prepend origin
    pop_pct = np.concatenate([[0.0], pop_pct])
    cum_pct = np.concatenate([[0.0], cum_pct])

    # interpolate to evenly-spaced sample points
    xs = np.linspace(0, 100, n_points)
    ys = np.interp(xs, pop_pct, cum_pct)

    return [[round(float(x), 2), round(float(y), 4)] for x, y in zip(xs, ys)]


def gini(values):
    v = np.sort(np.asarray(values, dtype=float))
    v = v[v > 0]
    n = len(v)
    if n == 0:
        return 0.0
    return float(round(
        (2 * np.sum(np.arange(1, n + 1) * v)) / (n * v.sum()) - (n + 1) / n,
        4
    ))


def build_curve(df, metric):
    """
    metric: 'trips' or 'duration'
    Returns dict with curve, gini, n_users, total.
    """
    if metric == 'trips':
        vals = df.groupby('user_id').size().values
        total = int(vals.sum())
    else:
        vals = df.groupby('user_id')['duration_min'].sum().values
        total = round(float(vals.sum()), 1)

    return {
        'curve':   lorenz_sample(vals),
        'gini':    gini(vals),
        'n_users': int(len(vals)),
        'total':   total
    }


def build_panel(df, metric):
    return {
        'combined': build_curve(df,                                  metric),
        'peb':      build_curve(df[df['provider'] == 'FFEBSS'].copy(), metric),
        'pb':       build_curve(df[df['provider'] == 'DBEBSS'].copy(), metric),
    }

# =============================================================================
# 1. LOAD TRIP DATA
# =============================================================================

print("=" * 55)
print("POTEBS Lorenz Export")
print("=" * 55)

print("\n[1/3] Loading trip data...")

# --- Pick-e-Bike (FFEBSS) ---
print("    Loading Pick-e-Bike...")
chunks = []
for chunk in pd.read_csv(
        FFEBSS_PATH,
        usecols=['user_id', 'duration_in_seconds'],
        low_memory=False,
        chunksize=500_000):
    chunk['duration_in_seconds'] = pd.to_numeric(chunk['duration_in_seconds'], errors='coerce')
    chunk['user_id'] = pd.to_numeric(chunk['user_id'], errors='coerce').astype('Int64')
    chunk = chunk[chunk['duration_in_seconds'] >= 60].copy()   # drop sub-minute noise
    chunks.append(chunk)

ffebss = pd.concat(chunks, ignore_index=True)
ffebss['provider'] = 'FFEBSS'
ffebss.rename(columns={'duration_in_seconds': 'duration_sec'}, inplace=True)
print(f"    → {len(ffebss):,} trips, {ffebss['user_id'].nunique():,} users")

# --- PubliBike Velospot (DBEBSS) ---
print("    Loading PubliBike Velospot...")
dbebss = pd.read_csv(
    DBEBSS_PATH,
    usecols=['Benutzer Record ID', 'Beginn', 'Ende'],
    low_memory=False)
dbebss.rename(columns={'Benutzer Record ID': 'user_id'}, inplace=True)
dbebss['user_id'] = dbebss['user_id'].astype(str)
dbebss['Beginn'] = pd.to_datetime(dbebss['Beginn'], errors='coerce')
dbebss['Ende']   = pd.to_datetime(dbebss['Ende'],   errors='coerce')
dbebss = dbebss.dropna(subset=['Beginn', 'Ende'])
dbebss['duration_sec'] = (dbebss['Ende'] - dbebss['Beginn']).dt.total_seconds()
dbebss = dbebss[dbebss['duration_sec'] >= 60].copy()
dbebss['provider'] = 'DBEBSS'
print(f"    → {len(dbebss):,} trips, {dbebss['user_id'].nunique():,} users")

# --- Combine ---
trips = pd.concat([
    ffebss[['user_id', 'provider', 'duration_sec']],
    dbebss[['user_id', 'provider', 'duration_sec']]
], ignore_index=True)
trips['duration_min'] = trips['duration_sec'] / 60.0
print(f"    → Total: {len(trips):,} trips")

# =============================================================================
# 2. LOAD SURVEY & LINK RESPONDENTS
# =============================================================================

print("\n[2/3] Loading survey & linking respondents...")

survey = pd.read_csv(SURVEY_PATH, sep=';', low_memory=False, encoding='utf-8')

if 'exclude_case' in survey.columns:
    survey = survey[survey['exclude_case'] != True].copy()

survey['provider'] = survey['SURVEY_ORIGIN'].map({
    'Pick-e-Bike': 'FFEBSS',
    'PubliBike':   'DBEBSS'
})

# Link FFEBSS respondents (numeric user_id)
survey_users_peb = set(
    pd.to_numeric(
        survey.loc[survey['provider'] == 'FFEBSS', 'ExternalReference'],
        errors='coerce'
    ).dropna().astype('Int64')
)

# Link DBEBSS respondents (string user_id)
survey_users_pb = set(
    survey.loc[survey['provider'] == 'DBEBSS', 'ExternalReference']
    .dropna().astype(str)
)

in_survey_peb = (trips['provider'] == 'FFEBSS') & trips['user_id'].isin(survey_users_peb)
in_survey_pb  = (trips['provider'] == 'DBEBSS') & trips['user_id'].isin(survey_users_pb)
trips['in_survey'] = in_survey_peb | in_survey_pb

trips_survey = trips[trips['in_survey']].copy()
print(f"    → {len(trips_survey):,} trips linked ({trips_survey['user_id'].nunique():,} users)")

# =============================================================================
# 3. COMPUTE LORENZ DATA & EXPORT
# =============================================================================

print("\n[3/3] Computing Lorenz curves and exporting...")

output = {
    'meta': {
        'generated':        datetime.now().strftime('%Y-%m-%d'),
        'n_trips_total':    int(len(trips)),
        'n_trips_peb':      int((trips['provider'] == 'FFEBSS').sum()),
        'n_trips_pb':       int((trips['provider'] == 'DBEBSS').sum()),
        'n_users_total':    int(trips['user_id'].nunique()),
        'n_users_peb':      int(trips[trips['provider'] == 'FFEBSS']['user_id'].nunique()),
        'n_users_pb':       int(trips[trips['provider'] == 'DBEBSS']['user_id'].nunique()),
        'n_survey_linked':  int(trips_survey['user_id'].nunique()),
        'n_points_per_curve': N_POINTS
    },
    'panels': {
        'all_trips':       build_panel(trips,        'trips'),
        'all_duration':    build_panel(trips,        'duration'),
        'survey_trips':    build_panel(trips_survey, 'trips'),
        'survey_duration': build_panel(trips_survey, 'duration'),
    }
}

os.makedirs(os.path.dirname(os.path.abspath(OUTPUT_PATH)), exist_ok=True)
with open(OUTPUT_PATH, 'w') as f:
    json.dump(output, f, separators=(',', ':'))

size_kb = os.path.getsize(OUTPUT_PATH) / 1024
print(f"\n✓ Exported to: {os.path.abspath(OUTPUT_PATH)}")
print(f"  File size:   {size_kb:.1f} KB")
print(f"\n  Gini summary:")
for panel_key, panel_label in [
    ('all_trips',       'All users  / Trips   '),
    ('all_duration',    'All users  / Duration'),
    ('survey_trips',    'Survey     / Trips   '),
    ('survey_duration', 'Survey     / Duration'),
]:
    p = output['panels'][panel_key]
    print(f"    {panel_label}  — Combined: {p['combined']['gini']:.3f} "
          f"| PeB: {p['peb']['gini']:.3f} "
          f"| PB: {p['pb']['gini']:.3f}")

print("\nDone. Upload data/lorenz.json to GitHub.")
