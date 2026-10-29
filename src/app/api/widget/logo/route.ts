import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectLogoType, LOGO_BUCKET, LOGO_CONTENT_TYPES, MAX_LOGO_BYTES } from "@/lib/widget";
import { logoUrl } from "@/lib/widget-server";

/**
 * Uploads or removes the signed-in client's widget logo. The file is checked
 * by its content, stored under a random name in the public logo bucket, and
 * the previous logo is deleted.
 */

export async function POST(request: Request) {
  const business = await currentBusiness();
  if (!business) return jsonError("Please sign in again.", 401);

  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File) || file.size === 0) return jsonError("Please choose an image.", 400);
  if (file.size > MAX_LOGO_BYTES) return jsonError("The logo must be 512 KB or smaller.", 400);

  const data = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(data);
  if (!type) return jsonError("Use a PNG, JPG or WebP image.", 400);

  const admin = createAdminClient();
  const path = `${crypto.randomUUID()}.${type}`;
  const stored = await admin.storage
    .from(LOGO_BUCKET)
    .upload(path, data, { contentType: LOGO_CONTENT_TYPES[type], cacheControl: "31536000", upsert: false });
  if (stored.error) {
    console.error("Logo upload failed:", stored.error);
    return jsonError("We couldn't store this image. Please try again.", 500);
  }

  const previous = await replaceLogo(admin, business.id, path);
  if (previous === false) {
    await admin.storage.from(LOGO_BUCKET).remove([path]);
    return jsonError("We couldn't save your logo. Please try again.", 500);
  }

  return Response.json({ logoUrl: logoUrl(path) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const business = await currentBusiness();
  if (!business) return jsonError("Please sign in again.", 401);

  const previous = await replaceLogo(createAdminClient(), business.id, null);
  if (previous === false) return jsonError("We couldn't remove your logo. Please try again.", 500);
  return Response.json({ logoUrl: null }, { headers: { "Cache-Control": "no-store" } });
}

/** Points the client's widget at a new logo and deletes the old file. Returns false on failure. */
async function replaceLogo(admin: ReturnType<typeof createAdminClient>, clientId: string, path: string | null) {
  const { data: current, error: readError } = await admin
    .from("widget_settings")
    .select("logo_path")
    .eq("client_id", clientId)
    .single();
  if (readError) {
    console.error("Reading widget settings failed:", readError);
    return false;
  }

  const { error } = await admin.from("widget_settings").update({ logo_path: path }).eq("client_id", clientId);
  if (error) {
    console.error("Saving the logo failed:", error);
    return false;
  }

  if (current.logo_path && current.logo_path !== path) {
    const removed = await admin.storage.from(LOGO_BUCKET).remove([current.logo_path]);
    if (removed.error) console.error("Removing the old logo failed:", removed.error);
  }
  return true;
}

async function currentBusiness() {
  if (!(await getCurrentUser())) return null;
  return getCurrentBusiness();
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
