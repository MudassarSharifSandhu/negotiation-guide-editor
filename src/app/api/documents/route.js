import { FieldValue } from "firebase-admin/firestore";
import { BLUEPRINT_HTML_COLLECTION, getFirestore } from "../../../../lib/firebaseAdmin";

function serializeDoc(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    originalFileName: data.originalFileName,
    html: data.html,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    lastExportedPdfStoragePath: data.lastExportedPdfStoragePath ?? null,
    lastExportedAt: data.lastExportedAt?.toDate?.()?.toISOString() ?? null,
  };
}

export async function GET() {
  try {
    const db = getFirestore();
    const snap = await db
      .collection(BLUEPRINT_HTML_COLLECTION)
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();
    const items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        originalFileName: data.originalFileName,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });
    return Response.json({ ok: true, items });
  } catch (error) {
    return Response.json(
      { ok: false, error: error.message || "Failed to list documents" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const html = String(body?.html || "");
    if (!html.trim()) {
      return Response.json({ ok: false, error: "Missing html" }, { status: 400 });
    }
    const originalFileName = String(body?.originalFileName || "document.html").trim() || "document.html";

    const db = getFirestore();
    const ref = await db.collection(BLUEPRINT_HTML_COLLECTION).add({
      originalFileName,
      html,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const created = await ref.get();
    return Response.json({ ok: true, document: serializeDoc(created) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error.message || "Failed to create document" },
      { status: 500 },
    );
  }
}
