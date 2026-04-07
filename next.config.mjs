import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Dynamic import + large .br binaries are not traced by default; Vercel would miss `bin/` and Chromium fails to start.
  outputFileTracingIncludes: {
    "/api/export-pdf": ["./node_modules/@sparticuz/chromium/**/*"],
  },
  // Puppeteer + Firebase Admin must not be bundled; otherwise the route module can load without HTTP handlers.
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "@sparticuz/chromium",
    "firebase-admin",
    "@google-cloud/storage",
    "customerio-node",
  ],
};

export default nextConfig;
