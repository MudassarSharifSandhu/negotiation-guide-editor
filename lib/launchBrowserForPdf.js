/**
 * Vercel runs Linux serverless functions without Puppeteer's downloaded Chrome.
 * Use @sparticuz/chromium there; full `puppeteer` (devDependency) for local dev.
 */
export async function launchBrowserForPdf() {
  const useServerlessChromium = process.env.VERCEL === "1" && process.platform === "linux";

  if (useServerlessChromium) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}
