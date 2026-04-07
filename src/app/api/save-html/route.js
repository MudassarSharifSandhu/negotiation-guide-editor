import fs from "fs/promises";
import path from "path";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

function sanitizeHtmlFileName(name) {
  const raw = String(name || "gradient.html").trim();
  const withExt = raw.toLowerCase().endsWith(".html") ? raw : `${raw}.html`;
  const base = path.basename(withExt);
  return base.replace(/[^\w.\- ]/g, "_");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const html = String(body?.html || "");
    if (!html.trim()) {
      return Response.json({ ok: false, error: "Missing html payload" }, { status: 400 });
    }

    const fileName = sanitizeHtmlFileName(body?.fileName);
    const outputPath = path.resolve(PUBLIC_DIR, fileName);
    await fs.writeFile(outputPath, html, "utf8");

    return Response.json({
      ok: true,
      fileName,
      outputPath,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message || "Failed to save HTML",
      },
      { status: 500 },
    );
  }
}
