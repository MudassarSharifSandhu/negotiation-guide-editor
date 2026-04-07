import { FieldValue } from "firebase-admin/firestore";
import { BLUEPRINT_HTML_COLLECTION, getFirestore, getStorageBucket } from "@/lib/firebaseAdmin";
import { launchBrowserForPdf } from "@/lib/launchBrowserForPdf";
import { sendTransactionalEmail } from "@/lib/sendEmail";

export const runtime = "nodejs";

/** Vercel Hobby max is 10s; Pro allows up to 300s — raise in dashboard if PDFs are slow. */
export const maxDuration = 60;

/** Customer.io counts attachment payload; base64 expands ~4/3 — keep encoded size under 2 MiB. */
const MAX_ATTACHMENT_B64_CHARS = 2 * 1024 * 1024 - 4096;
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_RENDER_TIMEOUT_MS = 45000;

/** Wait for images, optional fonts, and layout so PDFs aren’t generated mid-load or mid-paint. */
async function preparePageForPdfExport(page) {
  await page.evaluate(async () => {
    const scrollH = Math.max(
      document.body?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0,
    );
    window.scrollTo(0, scrollH);
    await new Promise((r) => setTimeout(r, 200));
    window.scrollTo(0, 0);

    const waitImg = (img) =>
      new Promise((resolve) => {
        if (img.complete && img.naturalWidth !== 0) return resolve();
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, 15000);
      });

    await Promise.all([...document.images].map(waitImg));

    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch {
      /* ignore */
    }

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

function parseRecipients(body) {
  const raw = body?.recipients ?? body?.emails ?? [];
  if (!Array.isArray(raw)) {
    return { error: "recipients must be an array of email strings" };
  }
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const e = String(item || "").trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      return { error: `Invalid email: ${String(item).trim() || "(empty)"}` };
    }
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) {
    return { error: `Maximum ${MAX_RECIPIENTS} recipients allowed` };
  }
  return { emails: out };
}

function displayNameFromEmail(email) {
  const local = email.split("@")[0] || "recipient";
  const cleaned = local.replace(/[._-]+/g, " ").trim() || "Recipient";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `&` in signed URLs must be escaped inside HTML attributes. */
function escapeHref(url) {
  return String(url).replace(/&/g, "&amp;");
}

/** Table-based “button” so it renders in common email clients. */
function buildPdfEmailBody(pdfUrl, fileLabel) {
  const safeUrl = escapeHref(pdfUrl);
  const safeLabel = escapeHtml(fileLabel);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1e293b;">
<p style="margin:0 0 16px;">Your blueprint PDF export is ready.</p>
<p style="margin:0 0 8px;font-size:14px;color:#64748b;">File: <strong>${safeLabel}</strong></p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
  <tr>
    <td style="border-radius:8px;background:#2563eb;">
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
        Open PDF
      </a>
    </td>
  </tr>
</table>
</body></html>`;
}

function pdfFitsCustomerIoAttachmentLimit(buffer) {
  const b64 = buffer.toString("base64");
  return b64.length <= MAX_ATTACHMENT_B64_CHARS;
}

/** Attachment filename is the JSON key Customer.io uses; keep it simple (no spaces). */
function sanitizeAttachmentFileName(name) {
  const base = sanitizePdfFileName(name).replace(/\s+/g, "_");
  const safe = base.replace(/[^\w.\-]/g, "_");
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe || "blueprint"}.pdf`;
}

function sanitizePdfFileName(name) {
  const trimmed = String(name || "export.pdf").trim();
  const withExt = trimmed.endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  const base = withExt.split(/[/\\]/).pop() || withExt;
  return base.replace(/[^\w.\- ]/g, "_");
}

function sanitizePathSegment(id) {
  return id.replace(/[^\w\-]/g, "_").slice(0, 120) || "doc";
}

export async function POST(request) {
  let browser;
  try {
    const body = await request.json();
    const html = String(body?.html || "");
    if (!html.trim()) {
      return Response.json({ ok: false, error: "Missing html payload" }, { status: 400 });
    }

    const outputFileName = sanitizePdfFileName(String(body?.outputFileName || "export.pdf"));
    const documentId = String(body?.documentId || "").trim();

    const parsedRecipients = parseRecipients(body);
    if (parsedRecipients.error) {
      return Response.json({ ok: false, error: parsedRecipients.error }, { status: 400 });
    }
    const recipientEmails = parsedRecipients.emails;

    if (documentId) {
      const db = getFirestore();
      const snap = await db.collection(BLUEPRINT_HTML_COLLECTION).doc(documentId).get();
      if (!snap.exists) {
        return Response.json({ ok: false, error: "Document not found" }, { status: 404 });
      }
    }

    browser = await launchBrowserForPdf();

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_RENDER_TIMEOUT_MS,
    });
    await preparePageForPdfExport(page);
    await page.addStyleTag({
      content: `
        img, picture, svg, video, canvas {
          page-break-inside: avoid;
          break-inside: avoid;
        }
      `,
    });
    await page.emulateMediaType("print");
    const pdfUint8 = await page.pdf({
      printBackground: true,
      scale: 1,
      preferCSSPageSize: true,
      format: "A4",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    const pdfBuffer = Buffer.from(pdfUint8);

    const bucket = getStorageBucket();
    const folder = documentId ? sanitizePathSegment(documentId) : "no-doc";
    const storagePath = `blueprint-exports/${folder}/${Date.now()}-${outputFileName}`;
    const file = bucket.file(storagePath);
    const storedAsName = sanitizeAttachmentFileName(outputFileName);
    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0",
        contentDisposition: `inline; filename="${storedAsName}"`,
      },
    });

    const [pdfSignedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    if (documentId) {
      const db = getFirestore();
      await db
        .collection(BLUEPRINT_HTML_COLLECTION)
        .doc(documentId)
        .update({
          lastExportedPdfStoragePath: storagePath,
          lastExportedAt: FieldValue.serverTimestamp(),
        });
    }

    const emailsSent = [];
    const emailsFailed = [];
    let attachmentIncluded = false;
    let attachmentSkippedReason = null;

    if (recipientEmails.length > 0) {
      let attachments;
      if (pdfFitsCustomerIoAttachmentLimit(pdfBuffer)) {
        attachments = [{ filename: sanitizeAttachmentFileName(outputFileName), data: pdfBuffer }];
      } else {
        attachmentSkippedReason = "pdf_exceeds_customer_io_attachment_limit";
      }
      attachmentIncluded = Boolean(attachments);
      const emailBody = buildPdfEmailBody(pdfSignedUrl, outputFileName);

      for (const email of recipientEmails) {
        try {
          await sendTransactionalEmail({
            transactionalMessageId: "41",
            messageData: {
              event: {
                recipient_name: displayNameFromEmail(email),
                sender_name: "Negotiation Editor",
                recipient_email: email,
                pdf_download_url: pdfSignedUrl,
              },
            },
            body: emailBody,
            from: "Reventure App<helpdesk@reventure.app>",
            subject: "Negotiation Guide PDF export is ready",
            to: email,
            identifiers: { email },
            attachments,
          });
          emailsSent.push(email);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emailsFailed.push({ email, error: msg });
        }
      }
    }

    return Response.json({
      ok: true,
      outputFileName,
      storagePath,
      pdfSignedUrl,
      emailsSent,
      emailsFailed,
      attachmentIncluded,
      attachmentSkippedReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export PDF";
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
