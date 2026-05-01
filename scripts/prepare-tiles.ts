#!/usr/bin/env bun
const IN = "public/bread.geojson";
const OUT = "public/bread.ndjson";
const STATS_OUT = "src/data/bread-stats.json";

// Bakeries are visible at every zoom; everything else only appears once
// you've zoomed in enough that the map can handle the density.
const BAKERY_MIN_ZOOM = 0;
const OTHER_MIN_ZOOM = 11;

const KEEP_TAGS = [
  "shop",
  "amenity",
  "cuisine",
  "bread",
  "name",
] as const;

const CATEGORIES = [
  "bakery",
  "pastry",
  "bagel",
  "doughnut",
  "sandwich",
  "cafe",
  "convenience",
  "grocery",
  "supermarket",
  "other",
] as const;
type Category = (typeof CATEGORIES)[number];

function pick(props: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (props[k] != null) out[k] = props[k];
  return out;
}

// Priority-ordered: each feature counts once, even if it matches multiple
// (e.g. a bakery-cafe is counted as a bakery — that's the spirit).
function classify(props: Record<string, unknown>): Category {
  const shop = props.shop;
  const amenity = props.amenity;
  const cuisine = props.cuisine;
  if (shop === "bakery") return "bakery";
  if (shop === "pastry") return "pastry";
  if (shop === "bagel" || cuisine === "bagel") return "bagel";
  if (
    shop === "donut" ||
    shop === "doughnut" ||
    cuisine === "donut" ||
    cuisine === "doughnut"
  )
    return "doughnut";
  if (shop === "sandwich" || shop === "deli") return "sandwich";
  if (amenity === "cafe") return "cafe";
  if (shop === "convenience") return "convenience";
  if (shop === "grocery") return "grocery";
  if (shop === "supermarket") return "supermarket";
  return "other";
}

const fc = await Bun.file(IN).json();
const writer = Bun.file(OUT).writer();

const counts: Record<Category, number> = Object.fromEntries(
  CATEGORIES.map((c) => [c, 0]),
) as Record<Category, number>;

for (const f of fc.features) {
  const props = f.properties ?? {};
  const category = classify(props);
  counts[category]++;
  const baseMin = category === "bakery" ? BAKERY_MIN_ZOOM : OTHER_MIN_ZOOM;

  writer.write(
    JSON.stringify({
      ...f,
      properties: pick(props, KEEP_TAGS),
      tippecanoe: { layer: "bread", minzoom: baseMin },
    }) + "\n",
  );
}
await writer.end();

const total = Object.values(counts).reduce((a, b) => a + b, 0);
await Bun.write(
  STATS_OUT,
  JSON.stringify({ total, counts, generatedAt: new Date().toISOString() }, null, 2) + "\n",
);

console.log(`Processed ${total} features:`);
for (const c of CATEGORIES) console.log(`  ${c.padEnd(12)} ${counts[c]}`);
console.log(`Wrote stats to ${STATS_OUT}`);
