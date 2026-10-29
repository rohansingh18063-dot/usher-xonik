// Loads the industry packs in supabase/packs into the industry_packs table.
//
// Each folder holds pack.json ({ "industry", "version" }), knowledge.md and
// behavior-rules.md. Running this again updates the same version in place;
// bump "version" in pack.json to publish a new version instead.
//
// Run with: npm run packs:sync

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File not present.
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env or .env.local first.");
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const packsDir = join(import.meta.dirname, "..", "supabase", "packs");

for (const folder of readdirSync(packsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const dir = join(packsDir, folder.name);
  const meta = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  const row = {
    industry: meta.industry,
    version: meta.version,
    knowledge: readFileSync(join(dir, "knowledge.md"), "utf8").trim(),
    behavior_rules: readFileSync(join(dir, "behavior-rules.md"), "utf8").trim(),
    is_published: true,
  };

  const { error } = await admin.from("industry_packs").upsert(row, { onConflict: "industry,version" });
  if (error) {
    console.error(`Failed to sync the ${row.industry} pack: ${error.message}`);
    if (error.code === "PGRST205") {
      console.error("The industry_packs table does not exist yet. Run the migrations in supabase/migrations first.");
    }
    process.exit(1);
  }
  console.log(`Synced ${row.industry} pack, version ${row.version} (${row.knowledge.length} characters of knowledge).`);
}
