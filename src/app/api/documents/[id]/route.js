import { FieldValue } from "firebase-admin/firestore";
import { BLUEPRINT_HTML_COLLECTION, getFirestore } from "../../../../../lib/firebaseAdmin";

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

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    }
    const db = getFirestore();
    const ref = db.collection(BLUEPRINT_HTML_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return Response.json({ ok: true, document: serializeDoc(snap) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error.message || "Failed to load document" },
      { status: 500 },
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    }
    const body = await request.json();
    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof body?.html === "string") {
      updates.html = body.html;
    }
    if (typeof body?.originalFileName === "string" && body.originalFileName.trim()) {
      updates.originalFileName = body.originalFileName.trim();
    }
    if (Object.keys(updates).length === 1) {
      return Response.json({ ok: false, error: "No valid fields to update" }, { status: 400 });
    }

    const db = getFirestore();
    const ref = db.collection(BLUEPRINT_HTML_COLLECTION).doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    await ref.update(updates);
    const updated = await ref.get();
    return Response.json({ ok: true, document: serializeDoc(updated) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error.message || "Failed to update document" },
      { status: 500 },
    );
  }
}
