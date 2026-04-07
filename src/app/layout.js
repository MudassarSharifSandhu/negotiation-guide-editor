import "./globals.css";

export const metadata = {
  title: "Blueprint Editor + Preview",
  description: "Edit HTML text and export PDF with Puppeteer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
