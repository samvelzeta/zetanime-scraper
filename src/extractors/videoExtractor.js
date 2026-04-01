/**
 * Extractor universal de servidores de video.
 *
 * Recibe la URL de un episodio, lanza Playwright, intercepta tráfico de red
 * y analiza el DOM para encontrar m3u8, mp4 y embeds.
 *
 * Retorna un array de objetos:
 *   { tipo: "m3u8"|"mp4"|"embed", url: string, calidad: string }
 */

import { chromium } from "playwright";

const PAGE_TIMEOUT = 90000;   // 90 s para cargar la página
const WAIT_AFTER_LOAD = 10000; // 10 s extra para que el player dispare requests

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Intenta detectar la calidad a partir de la URL o del texto del elemento.
 */
function detectQuality(url) {
  if (/2160|4k/i.test(url)) return "4K";
  if (/1080/i.test(url)) return "1080p";
  if (/720/i.test(url)) return "720p";
  if (/480/i.test(url)) return "480p";
  if (/360/i.test(url)) return "360p";
  return "auto";
}

/**
 * Normaliza una URL relativa a absoluta usando la URL base de la página.
 */
function toAbsolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return url.startsWith("http") ? url : null;
  }
}

/**
 * Decodifica URLs que puedan estar en base64 u otras codificaciones simples.
 */
function tryDecode(raw) {
  // base64 puro (sin espacios, longitud múltiplo de 4 aprox.)
  if (/^[A-Za-z0-9+/=]{20,}$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    } catch {}
  }
  // URL encoding
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw && decoded.startsWith("http")) return decoded;
  } catch {}
  return raw;
}

// ─── Extractor principal ────────────────────────────────────────────────────────

/**
 * @param {string} episodeUrl  URL completa del episodio.
 * @param {import('playwright').Browser|null} sharedBrowser  Browser reutilizable (opcional).
 * @returns {Promise<Array<{tipo:string, url:string, calidad:string}>>}
 */
export async function extractVideos(episodeUrl, sharedBrowser = null) {
  console.log(`    [extractor] 🔍 ${episodeUrl}`);

  const ownBrowser = !sharedBrowser;
  const browser =
    sharedBrowser ||
    (await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    }));

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Colección de servidores encontrados (usamos Map para deduplicar por URL)
  const found = new Map(); // url → { tipo, url, calidad }

  // ── Interceptar tráfico de red ──────────────────────────────────────────────
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (url.includes(".m3u8")) {
        const clean = url.split("?")[0]; // quitar query string para deduplicar
        if (!found.has(clean)) {
          found.set(clean, { tipo: "m3u8", url, calidad: detectQuality(url) });
          console.log(`    [extractor] 🎥 m3u8: ${url}`);
        }
      } else if (url.includes(".mp4")) {
        const clean = url.split("?")[0];
        if (!found.has(clean)) {
          found.set(clean, { tipo: "mp4", url, calidad: detectQuality(url) });
          console.log(`    [extractor] 🎥 mp4: ${url}`);
        }
      }
    } catch {}
  });

  try {
    await page.goto(episodeUrl, {
      waitUntil: "networkidle",
      timeout: PAGE_TIMEOUT,
    });

    // Esperar a que el player dispare sus requests
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    // ── Analizar DOM: iframes ─────────────────────────────────────────────────
    const iframes = await page.evaluate(() =>
      [...document.querySelectorAll("iframe[src]")].map((f) => f.src)
    );

    for (const src of iframes) {
      if (!src) continue;
      const abs = toAbsolute(src, episodeUrl);
      if (!abs) continue;

      // Registrar como embed
      if (!found.has(abs)) {
        found.set(abs, { tipo: "embed", url: abs, calidad: "auto" });
        console.log(`    [extractor] 🔗 embed: ${abs}`);
      }

      // Intentar navegar al iframe para capturar más streams
      try {
        const iframePage = await context.newPage();
        iframePage.on("response", async (res) => {
          try {
            const u = res.url();
            if (u.includes(".m3u8") || u.includes(".mp4")) {
              const clean = u.split("?")[0];
              const tipo = u.includes(".m3u8") ? "m3u8" : "mp4";
              if (!found.has(clean)) {
                found.set(clean, { tipo, url: u, calidad: detectQuality(u) });
                console.log(`    [extractor] 🎥 (iframe) ${tipo}: ${u}`);
              }
            }
          } catch {}
        });

        await iframePage.goto(abs, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        await iframePage.waitForTimeout(5000);
        await iframePage.close();
      } catch (err) {
        console.warn(`    [extractor] ⚠ iframe ${abs}: ${err.message}`);
      }
    }

    // ── Analizar DOM: atributos data-src, data-file, src en <video> ──────────
    const domSources = await page.evaluate(() => {
      const attrs = ["src", "data-src", "data-file", "data-url", "data-stream"];
      const results = [];
      document.querySelectorAll("video, source, [data-src], [data-file]").forEach((el) => {
        for (const attr of attrs) {
          const val = el.getAttribute(attr);
          if (val && (val.includes(".m3u8") || val.includes(".mp4"))) {
            results.push(val);
          }
        }
      });
      return results;
    });

    for (const raw of domSources) {
      const decoded = tryDecode(raw);
      const abs = toAbsolute(decoded, episodeUrl);
      if (!abs) continue;
      const clean = abs.split("?")[0];
      const tipo = abs.includes(".m3u8") ? "m3u8" : "mp4";
      if (!found.has(clean)) {
        found.set(clean, { tipo, url: abs, calidad: detectQuality(abs) });
        console.log(`    [extractor] 🎥 (dom) ${tipo}: ${abs}`);
      }
    }

    // ── Buscar en scripts inline ──────────────────────────────────────────────
    const scriptSources = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("script:not([src])").forEach((s) => {
        const text = s.textContent || "";
        // Buscar URLs de m3u8 y mp4 en el código JS
        const re = /["'`](https?:\/\/[^"'`\s]+\.(?:m3u8|mp4)[^"'`\s]*)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          results.push(m[1]);
        }
      });
      return results;
    });

    for (const raw of scriptSources) {
      const decoded = tryDecode(raw);
      const clean = decoded.split("?")[0];
      const tipo = decoded.includes(".m3u8") ? "m3u8" : "mp4";
      if (!found.has(clean)) {
        found.set(clean, { tipo, url: decoded, calidad: detectQuality(decoded) });
        console.log(`    [extractor] 🎥 (script) ${tipo}: ${decoded}`);
      }
    }
  } catch (err) {
    console.warn(`    [extractor] ⚠ error cargando ${episodeUrl}: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
    if (ownBrowser) await browser.close();
  }

  const servers = [...found.values()];
  console.log(`    [extractor] ✓ ${servers.length} servidor(es) encontrado(s)`);
  return servers;
}
