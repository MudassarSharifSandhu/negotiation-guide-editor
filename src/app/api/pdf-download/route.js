import { getStorageBucket } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const ALLOWED_PREFIX = "blueprint-exports/";

function isAllowedStoragePath(p) {
  if (typeof p !== "string" || !p.startsWith(ALLOWED_PREFIX)) return false;
  if (p.includes("..") || p.includes("\\")) return false;
  return true;
}

function safeDownloadFileName(name) {
  const base = String(name || "export.pdf").trim() || "export.pdf";
  const ascii = base.replace(/[^\w.\-]/g, "_");
  return ascii.endsWith(".pdf") ? ascii : `${ascii}.pdf`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const storagePath = String(body?.storagePath || "");
    const fileName = safeDownloadFileName(body?.fileName);

    if (!isAllowedStoragePath(storagePath)) {
      return Response.json({ ok: false, error: "Invalid storage path" }, { status: 400 });
    }

    const bucket = getStorageBucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return Response.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const [buffer] = await file.download();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
