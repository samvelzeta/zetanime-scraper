import { chromium } from "playwright";

const PAGE_TIMEOUT = 90000;
const WAIT_AFTER_LOAD = 8000;

// ─── Helpers ─────────────────────────────────────────

function detectQuality(url) {
  if (/2160|4k/i.test(url)) return "4K";
  if (/1080/i.test(url)) return "1080p";
  if (/720/i.test(url)) return "720p";
  if (/480/i.test(url)) return "480p";
  return "auto";
}

// ─── MAIN ────────────────────────────────────────────

export async function extractVideos(episodeUrl, sharedBrowser = null) {

  console.log(`    [extractor] 🔍 ${episodeUrl}`);

  const ownBrowser = !sharedBrowser;

  const browser =
    sharedBrowser ||
    (await chromium.launch({
      headless: false, // 🔥 IMPORTANTE
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled"
      ]
    }));

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "es-ES"
  });

  const page = await context.newPage();

  // 🔥 ocultar webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false
    });
  });

  const found = new Map();

  // ── CAPTURA DE REQUESTS ─────────────────────────────
  page.on("response", async (res) => {
    try {
      const url = res.url();

      if (url.includes(".m3u8") || url.includes(".mp4")) {

        const clean = url.split("?")[0];

        if (!found.has(clean)) {
          found.set(clean, {
            tipo: url.includes(".m3u8") ? "m3u8" : "mp4",
            url,
            calidad: detectQuality(url)
          });

          console.log(`    🎥 VIDEO DETECTADO: ${url}`);
        }
      }

    } catch {}
  });

  try {
    // ── ENTRAR A LA PÁGINA ───────────────────────────
    await page.goto(episodeUrl, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT
    });

    console.log("    ⏳ página cargada");

    await page.waitForTimeout(3000);

    // ── HACER SCROLL (simular humano) ────────────────
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1500);

    // ── CLICK EN POSIBLES PLAYERS ────────────────────
    const buttons = await page.$$("button, .play, .player, .vjs-big-play-button");

    for (const btn of buttons) {
      try {
        await btn.click({ timeout: 2000 });
        console.log("    ▶ click en botón");
        await page.waitForTimeout(2000);
      } catch {}
    }

    // ── CLICK DIRECTO AL VIDEO ───────────────────────
    try {
      await page.click("video", { timeout: 3000 });
      console.log("    ▶ click en video");
    } catch {}

    // ── ESPERAR REQUESTS DEL PLAYER ──────────────────
    console.log("    ⏳ esperando streams...");
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    // ── EXTRA: IFRAMES ───────────────────────────────
    const iframes = await page.$$("iframe");

    for (const frame of iframes) {
      try {
        const src = await frame.getAttribute("src");
        if (!src) continue;

        console.log("    🔗 iframe:", src);

        const iframePage = await context.newPage();

        iframePage.on("response", async (res) => {
          const u = res.url();

          if (u.includes(".m3u8") || u.includes(".mp4")) {
            const clean = u.split("?")[0];

            if (!found.has(clean)) {
              found.set(clean, {
                tipo: u.includes(".m3u8") ? "m3u8" : "mp4",
                url: u,
                calidad: detectQuality(u)
              });

              console.log(`    🎥 (iframe) ${u}`);
            }
          }
        });

        await iframePage.goto(src, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });

        await iframePage.waitForTimeout(5000);

        await iframePage.close();

      } catch {}
    }

  } catch (err) {
    console.log("    ❌ error:", err.message);
  }

  await page.close();
  await context.close();

  if (ownBrowser) await browser.close();

  const result = [...found.values()];

  console.log(`    ✅ encontrados: ${result.length}`);

  return result;
}
