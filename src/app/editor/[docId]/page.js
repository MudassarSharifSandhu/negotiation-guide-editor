"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function parseDocument(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function collectStyles(doc) {
  const styleTags = Array.from(doc.querySelectorAll("style"));
  const merged = styleTags.map((tag) => tag.textContent || "").join("\n\n");
  return merged.replaceAll(":root", ":host, :root");
}

function createShadowDoc(host, styleText, bodyNode) {
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styleText;
  root.appendChild(style);
  root.appendChild(bodyNode);
  return root;
}

function getRenderableTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const value = node.nodeValue || "";
    if (
      parent &&
      !["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"].includes(parent.tagName) &&
      value.trim().length > 0
    ) {
      nodes.push(node);
    }
    node = walker.nextNode();
  }
  return nodes;
}

function getTextNodeBounds(textNode) {
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  range.detach?.();
  return {
    width: rect.width,
    height: rect.height,
  };
}

function createEditorField(text, bounds = null) {
  const useTextarea = text.length > 60 || text.includes("\n");
  const field = document.createElement(useTextarea ? "textarea" : "input");
  if (!useTextarea) {
    field.type = "text";
  }

  field.value = text;
  field.className = "text-edit-field";
  field.setAttribute("spellcheck", "false");
  field.setAttribute("aria-label", "Editable text");

  if (bounds && bounds.width > 0) {
    const baseWidth = Math.ceil(bounds.width * 1.02);
    field.style.width = `${baseWidth}px`;
    field.dataset.baseWidth = String(baseWidth);
  } else if (!useTextarea) {
    const sizeCh = Math.max(10, Math.min(80, text.length + 2));
    field.style.width = `${sizeCh}ch`;
  }

  if (bounds && bounds.height > 0) {
    const baseHeight = Math.ceil(bounds.height * 1.05);
    field.style.height = `${baseHeight}px`;
    field.dataset.baseHeight = String(baseHeight);
  }

  return field;
}

function autoResizeField(field) {
  const baseWidth = Number(field.dataset.baseWidth || 0);
  const baseHeight = Number(field.dataset.baseHeight || 0);

  if (field.tagName === "TEXTAREA") {
    field.style.height = "auto";
    const nextHeight = Math.max(baseHeight || 0, Math.ceil(field.scrollHeight));
    if (nextHeight > 0) {
      field.style.height = `${nextHeight}px`;
    }
    return;
  }

  const tmp = document.createElement("span");
  const computed = getComputedStyle(field);
  tmp.textContent = field.value || "";
  tmp.style.position = "absolute";
  tmp.style.visibility = "hidden";
  tmp.style.whiteSpace = "pre";
  tmp.style.font = computed.font;
  tmp.style.letterSpacing = computed.letterSpacing;
  document.body.appendChild(tmp);
  const contentWidth = tmp.getBoundingClientRect().width;
  tmp.remove();

  const nextWidth = Math.max(baseWidth || 0, Math.ceil(contentWidth + 20));
  if (nextWidth > 0) {
    field.style.width = `${nextWidth}px`;
  }
}

function enhanceEditorStyles(shadowRoot) {
  const style = document.createElement("style");
  style.textContent = `
    .text-edit-field {
      border: 2px solid #2563eb !important;
      border-radius: 6px !important;
      background: transparent !important;
      color: inherit !important;
      font: inherit !important;
      line-height: inherit !important;
      padding: 2px 6px !important;
      margin: 1px 2px !important;
      vertical-align: baseline !important;
      outline: none !important;
    }
    textarea.text-edit-field {
      display: inline-block !important;
      min-height: 72px !important;
      resize: vertical !important;
      white-space: pre-wrap !important;
    }
    .text-edit-field:focus {
      border-color: #1d4ed8 !important;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25) !important;
    }
  `;
  shadowRoot.appendChild(style);
}

function fitHostToCanvas(host, shadowRoot, canvasEl) {
  const body = shadowRoot.querySelector("body");
  if (!body) return;
  const contentWidth = Math.ceil(body.scrollWidth);
  if (!contentWidth) return;

  const availableWidth = Math.max(1, canvasEl.clientWidth - 20);
  const scale = Math.min(1, availableWidth / contentWidth);
  host.style.zoom = String(scale);
}

function pdfNameFromOriginal(originalFileName) {
  const base = String(originalFileName || "document").replace(/\.html?$/i, "");
  const safe = base.replace(/[^\w.\- ]/g, "_").trim() || "export";
  return safe.endsWith(".pdf") ? safe : `${safe}.pdf`;
}

const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function collectValidRecipients(rows) {
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    const e = String(raw || "").trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      return { error: `Invalid email: ${String(raw).trim() || "(empty)"}` };
    }
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  if (out.length > MAX_RECIPIENTS) {
    return { error: `Maximum ${MAX_RECIPIENTS} recipients.` };
  }
  return { emails: out };
}

export default function EditorPage() {
  const params = useParams();
  const docId = params?.docId;
  const editorCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const getCurrentHtmlRef = useRef(null);
  const hasUnsavedRef = useRef(false);
  const [status, setStatus] = useState({ text: "Loading...", error: false });
  const [originalFileName, setOriginalFileName] = useState("document.html");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [recipientRows, setRecipientRows] = useState([""]);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [exportModalError, setExportModalError] = useState("");
  const [exportToast, setExportToast] = useState(null);

  const setSaveStatus = (text, error = false) => setStatus({ text, error });

  useEffect(() => {
    let cleanupResize = null;

    const init = async () => {
      const editorCanvas = editorCanvasRef.current;
      const previewCanvas = previewCanvasRef.current;
      if (!editorCanvas || !previewCanvas || !docId) return;

      try {
        const sourceRes = await fetch(`/api/documents/${docId}`, { cache: "no-store" });
        const payload = await sourceRes.json();
        if (!sourceRes.ok || !payload.ok) {
          throw new Error(payload.error || `Failed to load document (${sourceRes.status})`);
        }
        const html = String(payload.document?.html || "");
        if (!html.trim()) {
          throw new Error("Document HTML is empty");
        }
        setOriginalFileName(payload.document.originalFileName || "document.html");

        const sourceDoc = parseDocument(html);
        const styleText = collectStyles(sourceDoc);

        const editorHost = document.createElement("div");
        editorHost.className = "doc-host";
        const previewHost = document.createElement("div");
        previewHost.className = "doc-host";

        editorCanvas.replaceChildren(editorHost);
        previewCanvas.replaceChildren(previewHost);

        const editorBody = sourceDoc.body.cloneNode(true);
        const previewBody = sourceDoc.body.cloneNode(true);

        const editorShadow = createShadowDoc(editorHost, styleText, editorBody);
        const previewShadow = createShadowDoc(previewHost, styleText, previewBody);
        enhanceEditorStyles(editorShadow);

        const editorTextNodes = getRenderableTextNodes(editorShadow);
        const previewTextNodes = getRenderableTextNodes(previewShadow);
        const sourceTextNodes = getRenderableTextNodes(sourceDoc.body);

        const nodeCount = Math.min(editorTextNodes.length, previewTextNodes.length, sourceTextNodes.length);
        for (let i = 0; i < nodeCount; i += 1) {
          const editorTextNode = editorTextNodes[i];
          const previewTextNode = previewTextNodes[i];
          const sourceTextNode = sourceTextNodes[i];
          const original = editorTextNode.nodeValue || "";
          const bounds = getTextNodeBounds(editorTextNode);

          const field = createEditorField(original, bounds);
          field.addEventListener("input", () => {
            previewTextNode.nodeValue = field.value;
            sourceTextNode.nodeValue = field.value;
            autoResizeField(field);
            hasUnsavedRef.current = true;
            setSaveStatus("Unsaved changes");
          });

          editorTextNode.parentNode.replaceChild(field, editorTextNode);
          autoResizeField(field);
        }

        const applyFit = () => {
          fitHostToCanvas(editorHost, editorShadow, editorCanvas);
          fitHostToCanvas(previewHost, previewShadow, previewCanvas);
        };
        requestAnimationFrame(applyFit);
        setTimeout(applyFit, 120);
        window.addEventListener("resize", applyFit);
        cleanupResize = () => window.removeEventListener("resize", applyFit);

        getCurrentHtmlRef.current = () => `<!DOCTYPE html>\n${sourceDoc.documentElement.outerHTML}`;
        hasUnsavedRef.current = false;
        setSaveStatus("Ready");
      } catch (error) {
        const message = `Failed to initialize: ${error.message}`;
        editorCanvas.innerHTML = `<div class="error">${message}</div>`;
        previewCanvas.innerHTML = `<div class="error">${message}</div>`;
        setSaveStatus("Load failed", true);
      }
    };

    init();
    return () => {
      if (cleanupResize) cleanupResize();
    };
  }, [docId]);

  const onSaveHtml = async () => {
    if (!getCurrentHtmlRef.current || !docId) {
      setSaveStatus("Nothing to save yet", true);
      return;
    }
    const html = getCurrentHtmlRef.current();

    try {
      setSaveStatus("Saving...");
      const response = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Save failed");
      }
      hasUnsavedRef.current = false;
      setSaveStatus("Saved to Firebase");
    } catch (error) {
      if (error?.name === "AbortError") {
        setSaveStatus(hasUnsavedRef.current ? "Save cancelled" : "No changes");
      } else {
        setSaveStatus(`Save failed: ${error.message}`, true);
      }
    }
  };

  const openExportModal = () => {
    if (!getCurrentHtmlRef.current || !docId) {
      setSaveStatus("Nothing to export yet", true);
      return;
    }
    setExportModalError("");
    setRecipientRows((r) => (r.length ? r : [""]));
    setExportModalOpen(true);
  };

  const closeExportModal = () => {
    if (exportSubmitting) return;
    setExportModalOpen(false);
    setExportModalError("");
  };

  const addRecipientRow = () => {
    setRecipientRows((rows) => (rows.length >= MAX_RECIPIENTS ? rows : [...rows, ""]));
  };

  const updateRecipientRow = (index, value) => {
    setRecipientRows((rows) => rows.map((v, i) => (i === index ? value : v)));
  };

  const removeRecipientRow = (index) => {
    setRecipientRows((rows) => {
      if (rows.length <= 1) return [""];
      return rows.filter((_, i) => i !== index);
    });
  };

  const downloadToastPdf = async () => {
    if (!exportToast) return;
    const { storagePath, fileName, pdfSignedUrl } = exportToast;
    if (!storagePath) {
      window.open(pdfSignedUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const res = await fetch("/api/pdf-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, fileName }),
      });
      if (!res.ok) {
        throw new Error("Download failed");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(pdfSignedUrl, "_blank", "noopener,noreferrer");
    }
  };

  const confirmExportPdf = async () => {
    if (!getCurrentHtmlRef.current || !docId) return;
    const parsed = collectValidRecipients(recipientRows);
    if (parsed.error) {
      setExportModalError(parsed.error);
      return;
    }
    setExportModalError("");
    setExportSubmitting(true);
    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: getCurrentHtmlRef.current(),
          outputFileName: pdfNameFromOriginal(originalFileName),
          documentId: docId,
          recipients: parsed.emails,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Export failed");
      }
      setExportModalOpen(false);
      const sent = result.emailsSent?.length ?? 0;
      const failed = result.emailsFailed?.length ?? 0;
      const failedNote =
        failed > 0 ? ` Some addresses failed: ${result.emailsFailed.map((f) => f.email).join(", ")}.` : "";
      let statusText;
      let statusErr = failed > 0;
      if (sent === 0 && failed === 0) {
        statusText = "PDF exported (no email sent).";
      } else {
        statusText = `PDF exported; sent to ${sent} recipient(s).${failedNote}${
          result.attachmentIncluded ? "" : " (link in email)"
        }`;
      }
      setSaveStatus(statusText, statusErr);
      setExportToast({
        storagePath: result.storagePath,
        pdfSignedUrl: result.pdfSignedUrl,
        fileName: result.outputFileName || "export.pdf",
        emailsSent: result.emailsSent || [],
        emailsFailed: result.emailsFailed || [],
      });
    } catch (error) {
      setExportModalError(error.message || "Export failed");
    } finally {
      setExportSubmitting(false);
    }
  };

  if (!docId) {
    return (
      <div className="library-wrap">
        <p className="library-error">Missing document id.</p>
        <Link className="library-link" href="/">
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="topbar topbar-wide">
        <Link className="action-btn action-btn-ghost" href="/">
          Library
        </Link>
        <button className="action-btn" type="button" onClick={openExportModal}>
          Export PDF
        </button>
        <button className="action-btn" type="button" onClick={onSaveHtml}>
          Save HTML
        </button>
        <span className={`save-status ${status.error ? "error" : ""}`}>{status.text}</span>
      </div>

      <div className="layout">
        <section className="panel">
          <div className="panel-header">Editable Version</div>
          <div ref={editorCanvasRef} className="canvas">
            <div className="loading">Loading editable document...</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">Live Preview</div>
          <div ref={previewCanvasRef} className="canvas">
            <div className="loading">Loading preview...</div>
          </div>
        </section>
      </div>

      {exportModalOpen ? (
        <div
          className="export-modal-backdrop"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && closeExportModal()}
        >
          <div className="export-modal" role="dialog" aria-labelledby="export-modal-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="export-modal-title" className="export-modal-title">
              Export PDF
            </h2>
            <p className="export-modal-hint">
              Leave addresses empty to export only, or add up to {MAX_RECIPIENTS} emails to send the PDF as well.
            </p>
            <label className="export-modal-label" htmlFor="export-email-0">
              Email to (optional)
            </label>
            {recipientRows.map((value, index) => (
              <div key={index} className="export-modal-row">
                <input
                  id={index === 0 ? "export-email-0" : undefined}
                  className="export-modal-input"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={value}
                  disabled={exportSubmitting}
                  onChange={(e) => updateRecipientRow(index, e.target.value)}
                />
                <button
                  type="button"
                  className="export-modal-remove"
                  disabled={exportSubmitting || recipientRows.length <= 1}
                  onClick={() => removeRecipientRow(index)}
                  aria-label="Remove email"
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="export-modal-add" disabled={exportSubmitting} onClick={addRecipientRow}>
              + Add another email
            </button>
            {exportModalError ? <p className="export-modal-error">{exportModalError}</p> : null}
            <div className="export-modal-actions">
              <button type="button" className="action-btn action-btn-ghost" disabled={exportSubmitting} onClick={closeExportModal}>
                Cancel
              </button>
              <button type="button" className="action-btn" disabled={exportSubmitting} onClick={confirmExportPdf}>
                {exportSubmitting
                  ? "Working…"
                  : recipientRows.some((r) => String(r || "").trim())
                    ? "Send PDF"
                    : "Export PDF"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {exportToast ? (
        <div className="export-toast" role="status">
          <div className="export-toast-title">
            {exportToast.emailsSent.length > 0
              ? "PDF sent"
              : exportToast.emailsFailed.length > 0
                ? "PDF ready (email failed)"
                : "PDF ready"}
          </div>
          <div className="export-toast-detail">
            {exportToast.emailsSent.length > 0 ? (
              <>
                Emailed {exportToast.emailsSent.length} address(es).
                {exportToast.emailsFailed.length > 0 ? (
                  <>
                    {" "}
                    Failed: {exportToast.emailsFailed.map((f) => f.email).join(", ")}.
                  </>
                ) : null}
              </>
            ) : exportToast.emailsFailed.length > 0 ? (
              "No emails were delivered. You can still download the file below."
            ) : (
              "No email was sent. Use Preview or Download below."
            )}
          </div>
          <div className="export-toast-actions">
            {exportToast.pdfSignedUrl ? (
              <a
                className="action-btn action-btn-ghost"
                href={exportToast.pdfSignedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview
              </a>
            ) : null}
            <button type="button" className="action-btn" onClick={downloadToastPdf}>
              Download PDF
            </button>
            <button type="button" className="action-btn action-btn-ghost" onClick={() => setExportToast(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
