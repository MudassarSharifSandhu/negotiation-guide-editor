"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function LibraryPage() {
  const [items, setItems] = useState([]);
  const [listStatus, setListStatus] = useState({ text: "Loading…", error: false });
  const [uploadStatus, setUploadStatus] = useState({ text: "", error: false });
  const [displayName, setDisplayName] = useState("");
  const [file, setFile] = useState(null);

  const loadList = useCallback(async () => {
    setListStatus({ text: "Loading…", error: false });
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load list");
      }
      setItems(data.items || []);
      setListStatus({ text: `${(data.items || []).length} file(s)`, error: false });
    } catch (e) {
      setListStatus({ text: e.message || "Load failed", error: true });
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setUploadStatus({ text: "", error: false });
    if (f && !displayName.trim()) {
      setDisplayName(f.name);
    }
  };

  const onUpload = async () => {
    if (!file) {
      setUploadStatus({ text: "Choose an HTML file first", error: true });
      return;
    }
    setUploadStatus({ text: "Uploading…", error: false });
    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("File is empty");
      }
      const originalFileName = displayName.trim() || file.name || "document.html";
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: text, originalFileName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setUploadStatus({ text: `Saved: ${data.document?.id}`, error: false });
      setFile(null);
      setDisplayName("");
      const input = document.getElementById("html-file-input");
      if (input) input.value = "";
      await loadList();
    } catch (e) {
      setUploadStatus({ text: e.message || "Upload failed", error: true });
    }
  };

  return (
    <div className="library-page">
      <header className="library-header">
        <h1 className="library-title">Blueprint library</h1>
        <p className="library-sub">Upload HTML to Firebase, then open a file in the editor to preview, save, and export PDF.</p>
      </header>

      <section className="library-card">
        <h2 className="library-card-title">Upload HTML</h2>
        <div className="library-form">
          <label className="library-label" htmlFor="html-file-input">
            File
          </label>
          <input
            id="html-file-input"
            className="library-input-file"
            type="file"
            accept=".html,.htm,text/html"
            onChange={onPickFile}
          />
          <label className="library-label" htmlFor="display-name">
            Display name
          </label>
          <input
            id="display-name"
            className="library-input-text"
            type="text"
            placeholder="e.g. gradient.html"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <button className="action-btn library-upload-btn" type="button" onClick={onUpload}>
            Upload to Firebase
          </button>
        </div>
        <p className={`library-hint ${uploadStatus.error ? "error" : ""}`}>{uploadStatus.text}</p>
      </section>

      <section className="library-card">
        <div className="library-card-head">
          <h2 className="library-card-title">Uploaded files</h2>
          <button className="action-btn action-btn-ghost" type="button" onClick={loadList}>
            Refresh
          </button>
        </div>
        <p className={`library-hint ${listStatus.error ? "error" : ""}`}>{listStatus.text}</p>
        {items.length === 0 && !listStatus.error ? (
          <p className="library-empty">No documents yet. Upload an HTML file above.</p>
        ) : (
          <ul className="library-list">
            {items.map((item) => (
              <li key={item.id} className="library-list-item">
                <Link className="library-doc-link" href={`/editor/${item.id}`}>
                  {item.originalFileName || item.id}
                </Link>
                <span className="library-doc-meta">
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
