/*
 * Build public/data/us-states.geojson — the offline state-boundary data used to
 * resolve a GPS position to a US state (for the beer sales-tax feature).
 *
 * Source: PublicaMundi / Leaflet US states GeoJSON (public domain-ish demo data).
 * We strip it down to { code } properties, drop non-tax features (Puerto Rico),
 * and round coordinates to 4 decimals (~11 m) to keep the file small.
 *
 *   node scripts/build-states.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const OUT = join(OUT_DIR, 'us-states.geojson');

const CODE = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'District of Columbia': 'DC',
};

const round = n => Math.round(n * 1e4) / 1e4;
const roundCoords = a => (Array.isArray(a[0]) ? a.map(roundCoords) : [round(a[0]), round(a[1])]);

const raw = await (await fetch(SRC)).json();
const features = raw.features
  .filter(f => CODE[f.properties.name])
  .map(f => ({
    type: 'Feature',
    properties: { code: CODE[f.properties.name] },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  }));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`wrote ${OUT} — ${features.length} states, ${(JSON.stringify({ type: 'FeatureCollection', features }).length / 1024).toFixed(0)} KB`);
