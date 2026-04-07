import { existsSync, readFileSync } from "fs";
import path from "path";
import admin from "firebase-admin";

function stripOuterQuotes(s) {
  const t = String(s).trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
    (t.startsWith("'") && t.endsWith("'") && t.length > 1)
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function parseServiceAccountJson(raw) {
  const trimmed = stripOuterQuotes(raw);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

function parseServiceAccount() {
  const fromFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fromFile) {
    const abs = path.isAbsolute(fromFile.trim())
      ? fromFile.trim()
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), fromFile.trim());
    if (existsSync(abs)) {
      const parsed = parseServiceAccountJson(readFileSync(abs, "utf8"));
      if (parsed?.type === "service_account") return parsed;
    }
  }

  const pathOnly = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (pathOnly) {
    const abs = path.isAbsolute(pathOnly.trim())
      ? pathOnly.trim()
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), pathOnly.trim());
    if (existsSync(abs)) {
      const parsed = parseServiceAccountJson(readFileSync(abs, "utf8"));
      if (parsed?.type === "service_account") return parsed;
    }
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const fromEnv = raw ? parseServiceAccountJson(raw) : null;
  if (fromEnv?.type === "service_account") {
    return fromEnv;
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64?.trim()) {
    const parsed = parseServiceAccountJson(b64.trim());
    if (parsed?.type === "service_account") return parsed;
  }

  throw new Error(
    "Firebase Admin credentials missing. Set one of: FIREBASE_SERVICE_ACCOUNT (single-line JSON, no space after =), " +
      "FIREBASE_SERVICE_ACCOUNT_BASE64, GOOGLE_APPLICATION_CREDENTIALS (path to JSON file), or FIREBASE_SERVICE_ACCOUNT_PATH.",
  );
}

function bucketNameFromEnv() {
  return String(process.env.FIREBASE_BUCKET || "")
    .replace(/^gs:\/\//, "")
    .replace(/\/$/, "");
}

function ensureApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }
  const serviceAccount = parseServiceAccount();
  const storageBucket = bucketNameFromEnv();
  if (!storageBucket) {
    throw new Error("FIREBASE_BUCKET is not set");
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket,
  });
  return admin.app();
}

export function getFirestore() {
  ensureApp();
  return admin.firestore();
}

export function getStorageBucket() {
  ensureApp();
  const name = bucketNameFromEnv();
  return admin.storage().bucket(name);
}

export const BLUEPRINT_HTML_COLLECTION = "blueprint_html_documents";
