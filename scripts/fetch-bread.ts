#!/usr/bin/env bun
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SPARQL = `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>

SELECT ?osm_id ?wkt ?name ?shop ?amenity ?cuisine ?bread WHERE {
  {
    ?osm_id osmkey:shop "bakery" .
  } UNION {
    ?osm_id osmkey:shop "pastry" .
  } UNION {
    ?osm_id osmkey:shop "deli" .
  } UNION {
    ?osm_id osmkey:shop "sandwich" .
  } UNION {
    ?osm_id osmkey:shop "bagel" .
  } UNION {
    ?osm_id osmkey:shop "donut" .
  } UNION {
    ?osm_id osmkey:shop "doughnut" .
  } UNION {
    ?osm_id osmkey:shop "supermarket" .
  } UNION {
    ?osm_id osmkey:shop "convenience" .
  } UNION {
    ?osm_id osmkey:shop "grocery" .
  } UNION {
    ?osm_id osmkey:amenity "cafe" .
  } UNION {
    ?osm_id osmkey:cuisine "bagel" .
  } UNION {
    ?osm_id osmkey:cuisine "donut" .
  } UNION {
    ?osm_id osmkey:cuisine "doughnut" .
  } UNION {
    ?osm_id osmkey:bread "yes" .
  }
  ?osm_id geo:hasGeometry/geo:asWKT ?wkt .
  OPTIONAL { ?osm_id osmkey:name ?name }
  OPTIONAL { ?osm_id osmkey:shop ?shop }
  OPTIONAL { ?osm_id osmkey:amenity ?amenity }
  OPTIONAL { ?osm_id osmkey:cuisine ?cuisine }
  OPTIONAL { ?osm_id osmkey:bread ?bread }
}
`;

const ENDPOINT =
  process.env.QLEVER_URL ??
  "https://qlever.cs.uni-freiburg.de/api/osm-planet";
const OUT = "public/bread.geojson";
const USER_AGENT =
  "BreadNear.me-harvester/0.1 (+https://breadnear.me; global bakery harvester; contact via https://breadnear.me)";

type Binding = Record<
  string,
  { type: string; value: string; datatype?: string }
>;
type SparqlResults = {
  head: { vars: string[] };
  results: { bindings: Binding[] };
};

console.log(`POSTing global bread query to ${ENDPOINT}...`);
const started = Date.now();

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/sparql-results+json",
    "User-Agent": USER_AGENT,
  },
  body: "query=" + encodeURIComponent(SPARQL),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`QLever returned ${res.status} ${res.statusText}`);
  console.error(body.slice(0, 1500));
  process.exit(1);
}

const text = await res.text();
let data: SparqlResults;
try {
  data = JSON.parse(text);
} catch {
  console.error("Response was not JSON. First 500 chars:");
  console.error(text.slice(0, 500));
  process.exit(1);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `Got ${data.results.bindings.length} bindings in ${elapsed}s. Converting to GeoJSON...`,
);

function wktToPoint(wkt: string): [number, number] | null {
  const pt = wkt.match(/^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i);
  if (pt) return [parseFloat(pt[1]), parseFloat(pt[2])];
  // Polygon/linestring fallback: average all coord pairs as a rough centroid.
  // Bakery footprints are tiny — this is plenty accurate for pin placement.
  const pairs = [...wkt.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g)];
  if (!pairs.length) return null;
  let sx = 0,
    sy = 0;
  for (const p of pairs) {
    sx += parseFloat(p[1]);
    sy += parseFloat(p[2]);
  }
  return [sx / pairs.length, sy / pairs.length];
}

const features = [];
let skipped = 0;
for (const b of data.results.bindings) {
  const wkt = b.wkt?.value;
  if (!wkt) {
    skipped++;
    continue;
  }
  const pt = wktToPoint(wkt);
  if (!pt) {
    skipped++;
    continue;
  }
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === "wkt") continue;
    props[k] = v.value;
  }
  features.push({
    type: "Feature",
    id: b.osm_id?.value,
    geometry: { type: "Point", coordinates: pt },
    properties: props,
  });
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ type: "FeatureCollection", features }));

const sizeMb = ((await Bun.file(OUT).size) / 1024 / 1024).toFixed(2);
console.log(`Wrote ${features.length} features (${sizeMb} MB) to ${OUT}`);
if (skipped)
  console.log(`Skipped ${skipped} bindings without parseable geometry`);
