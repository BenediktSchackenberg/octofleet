// Runtime settings for the browser, read from the container environment on
// every request (NEXT_PUBLIC_* values are fixed when the image is built).
// Loaded by the root layout before the app starts; see lib/api-config.ts.
export const dynamic = "force-dynamic";

export function GET() {
  const config = { apiUrl: process.env.BROWSER_API_URL || "" };
  return new Response(`window.__OCTOFLEET_CONFIG__ = ${JSON.stringify(config)};\n`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
