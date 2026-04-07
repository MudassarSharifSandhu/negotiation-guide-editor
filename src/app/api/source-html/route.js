import fs from "fs/promises";
import path from "path";

function extractInlineTemplate(htmlFile) {
  const match = htmlFile.match(/<template id="inline-source-html">([\s\S]*?)<\/template>/i);
  if (!match) return "";
  return match[1].trim();
}

export async function GET() {
  try {
    const previewFilePath = path.resolve(process.cwd(), "..", "design5-blueprint-editor-preview.html");
    const fallbackPath = path.resolve(process.cwd(), "..", "design5-blueprint.html");

    const previewContent = await fs.readFile(previewFilePath, "utf8");
    const inlineTemplate = extractInlineTemplate(previewContent);
    if (inlineTemplate) {
      return Response.json({ html: inlineTemplate });
    }

    const fallbackHtml = await fs.readFile(fallbackPath, "utf8");
    return Response.json({ html: fallbackHtml });
  } catch (error) {
    return Response.json(
      {
        error: `Unable to load source HTML: ${error.message}`,
      },
      { status: 500 },
    );
  }
}
