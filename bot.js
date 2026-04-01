/**
 * bot.js — Punto de entrada del anime scraper.
 *
 * Al arrancar:
 *   1. Ejecuta el scraping completo de inmediato.
 *   2. Registra el cron para repetirlo cada 6 horas.
 *   3. Mantiene el proceso vivo indefinidamente.
 */

import { runScraping, startScheduler } from "./src/scheduler.js";

// ─── Validaciones de entorno ────────────────────────────────────────────────────

if (!process.env.GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN no está definido. El cache no funcionará.");
  console.error("   Define la variable de entorno GITHUB_TOKEN antes de iniciar.");
  // No salimos — el scraping puede correr igual, solo fallará el guardado
}

// ─── Arranque ───────────────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════════╗");
console.log("║       🎌 ANIME SCRAPER — INICIANDO               ║");
console.log("║  Sitios: latanime.org + animelatinohd.com        ║");
console.log("║  Cache:  samvelzeta/zetanime-cache               ║");
console.log("║  Cron:   cada 6 horas                            ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log();

// 1. Ejecutar scraping inmediatamente al iniciar
console.log("▶ Ejecutando scraping inicial...\n");
runScraping().catch((err) => {
  console.error("✗ Error en scraping inicial:", err.message);
});

// 2. Registrar cron para ejecuciones futuras
startScheduler();

// 3. Mantener el proceso vivo (el cron ya lo hace, pero por si acaso)
process.on("SIGINT", () => {
  console.log("\n[bot] 🛑 señal SIGINT recibida — cerrando...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[bot] 🛑 señal SIGTERM recibida — cerrando...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[bot] ⚠ excepción no capturada:", err.message);
  // No salimos — el proceso debe seguir vivo para el cron
});

process.on("unhandledRejection", (reason) => {
  console.error("[bot] ⚠ promesa rechazada sin manejar:", reason);
});

console.log("[bot] ✅ proceso activo — esperando próxima ejecución cron\n");
