import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Every path except static assets, image files, document uploads and the
    // public widget API. The proxy buffers request bodies (up to 10 MB), which
    // would cut off large uploads; the document routes check the session
    // themselves. Widget requests come from visitors, who never have a session.
    "/((?!_next/static|_next/image|api/documents|api/public|widget\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
