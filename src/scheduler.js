/**
 * Scheduler — ejecuta el scraping completo cada 6 horas usando node-cron.
 *
 * Cron: "0 *\/6 * * *"  →  a las 00:00, 06:00, 12:00, 18:00
 */

import cron from "node-cron";
import { chromium } from "playwright";
import { scrapeLatanime } from "./scrapers/latanime.js";
import { scrapeAnimeLatinoHD } from "./scrapers/animelatinohd.js";
import { cacheAll } from "./cache/cacheManager.js";

// ─── Tarea principal ────────────────────────────────────────────────────────────

/**
 * Ejecuta el scraping completo de ambos sitios y guarda en cache.
 * No lanza excepciones — registra errores y continúa.
 */
export async function runScraping() {
  const startTime = Date.now();
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  🚀 INICIO DE SCRAPING                           ║");
  console.log(`║  ${new Date().toISOString()}                ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Lanzar un único browser compartido para toda la sesión
  let browser = null;
  try {
    console.log("[scheduler] 🌐 lanzando browser Playwright...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    console.log("[scheduler] ✓ browser listo");
  } catch (err) {
    console.error("[scheduler] ✗ no se pudo lanzar el browser:", err.message);
    return;
  }

  // ── Latanime ──────────────────────────────────────────────────────────────
  let latanimeResults = [];
  try {
    console.log("\n[scheduler] ▶ scraping latanime.org...");
    latanimeResults = await scrapeLatanime(browser);
    console.log(
      `[scheduler] ✓ latanime: ${latanimeResults.length} animes obtenidos`
    );
  } catch (err) {
    console.error("[scheduler] ✗ error en scrapeLatanime:", err.message);
  }

  // ── AnimeLatinoHD ─────────────────────────────────────────────────────────
  let alhResults = [];
  try {
    console.log("\n[scheduler] ▶ scraping animelatinohd.com...");
    alhResults = await scrapeAnimeLatinoHD(browser);
    console.log(
      `[scheduler] ✓ animelatinohd: ${alhResults.length} animes obtenidos`
    );
  } catch (err) {
    console.error("[scheduler] ✗ error en scrapeAnimeLatinoHD:", err.message);
  }

  // ── Cerrar browser ────────────────────────────────────────────────────────
  try {
    await browser.close();
    console.log("\n[scheduler] 🔒 browser cerrado");
  } catch {}

  // ── Guardar en cache ──────────────────────────────────────────────────────
  const allResults = [...latanimeResults, ...alhResults];
  console.log(
    `\n[scheduler] 💾 guardando ${allResults.length} animes en cache...`
  );

  try {
    await cacheAll(allResults);
  } catch (err) {
    console.error("[scheduler] ✗ error guardando cache:", err.message);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ✅ SCRAPING COMPLETADO                           ║");
  console.log(`║  Duración: ${elapsed} min                              ║`);
  console.log(`║  Animes procesados: ${allResults.length}                        ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
}

// ─── Cron ───────────────────────────────────────────────────────────────────────

/**
 * Registra la tarea cron que se ejecuta cada 6 horas.
 * Retorna la instancia de la tarea para poder detenerla si es necesario.
 */
export function startScheduler() {
  const CRON_EXPR = "0 */6 * * *"; // cada 6 horas en punto

  console.log(`[scheduler] ⏰ cron registrado: "${CRON_EXPR}" (cada 6 horas)`);

  const task = cron.schedule(CRON_EXPR, async () => {
    console.log("[scheduler] ⏰ cron disparado — iniciando scraping programado");
    await runScraping();
  });

  return task;
}
