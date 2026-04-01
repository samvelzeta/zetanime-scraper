/**
 * Scraper para animelatinohd.com
 * Obtiene todos los animes, sus episodios y servidores de video.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import slugify from "slugify";
import { extractVideos } from "../extractors/videoExtractor.js";

const BASE_URL = "https://www.animelatinohd.com";
const DELAY_MS = 1500;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000;

// ─── Utilidades ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toSlug(name) {
  return slugify(name, { lower: true, strict: true, locale: "es" });
}

/**
 * GET con reintentos automáticos y timeout.
 */
async function fetchHtml(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`  [animelatinohd] GET ${url} (intento ${attempt}/${retries})`);
      const { data } = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9",
        },
      });
      return data;
    } catch (err) {
      console.warn(`  [animelatinohd] ⚠ error en ${url}: ${err.message}`);
      if (attempt < retries) await sleep(DELAY_MS * attempt);
    }
  }
  console.error(`  [animelatinohd] ✗ no se pudo obtener: ${url}`);
  return null;
}

// ─── Listado de animes ──────────────────────────────────────────────────────────

/**
 * Obtiene una página del directorio de animes.
 * animelatinohd.com usa /animes?page=N o /animes/page/N
 */
async function fetchAnimePage(page) {
  // Probar ambos formatos de paginación
  const urls = [
    `${BASE_URL}/animes?page=${page}`,
    `${BASE_URL}/animes/page/${page}`,
  ];

  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const animes = [];

    $("article, .anime-card, .col-anime, .item-anime, .post").each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find("a[href*='/anime/']").first();
      const href = linkEl.attr("href") || "";
      const nombre = (
        $el.find(".anime-title, h3, h2, .title, .post-title").first().text() || ""
      ).trim();
      const portada =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        "";

      if (!href || !nombre) return;

      const match = href.match(/\/anime\/([^/?#]+)/);
      const slug = match ? match[1] : toSlug(nombre);

      animes.push({
        nombre,
        slug,
        portada: portada.startsWith("http") ? portada : `${BASE_URL}${portada}`,
        url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      });
    });

    if (animes.length) return animes;
  }

  return [];
}

/**
 * Recorre todas las páginas del directorio.
 */
async function fetchAllAnimes() {
  console.log("[animelatinohd] 📋 obteniendo lista completa de animes...");
  const all = [];
  let page = 1;

  while (true) {
    const batch = await fetchAnimePage(page);
    if (!batch.length) {
      console.log(`[animelatinohd] ✓ paginación terminada en página ${page}`);
      break;
    }
    console.log(`[animelatinohd]   página ${page}: ${batch.length} animes`);
    all.push(...batch);
    page++;
    await sleep(DELAY_MS);
  }

  // Deduplicar por slug
  const seen = new Set();
  return all.filter((a) => {
    if (seen.has(a.slug)) return false;
    seen.add(a.slug);
    return true;
  });
}

// ─── Detalle de anime ───────────────────────────────────────────────────────────

/**
 * Obtiene descripción y lista de episodios de la página de un anime.
 */
async function fetchAnimeDetail(animeUrl) {
  const html = await fetchHtml(animeUrl);
  if (!html) return { descripcion: "", episodios: [] };

  const $ = cheerio.load(html);

  const descripcion = (
    $(".anime-description, .sinopsis, .description, .synopsis, p.text-muted, .entry-content p")
      .first()
      .text() || ""
  ).trim();

  const episodios = [];

  // Episodios listados como /ver/<slug>/episodio-<numero> o /episodio/<slug>-<numero>
  $("a[href*='episodio']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match =
      href.match(/episodio[/-](\d+)/i) ||
      href.match(/\/(\d+)\/?$/);
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && !episodios.includes(num)) episodios.push(num);
  });

  episodios.sort((a, b) => a - b);
  return { descripcion, episodios };
}

// ─── Episodio ───────────────────────────────────────────────────────────────────

/**
 * Construye la URL del episodio y extrae servidores.
 */
async function scrapeEpisode(animeSlug, animeUrl, epNumber, browser) {
  // Intentar varios formatos de URL de episodio
  const candidates = [
    `${animeUrl.replace(/\/$/, "")}/episodio-${epNumber}`,
    `${BASE_URL}/ver/${animeSlug}/episodio-${epNumber}`,
    `${BASE_URL}/episodio/${animeSlug}-${epNumber}`,
  ];

  console.log(`  [animelatinohd] 🎬 episodio ${epNumber}`);

  for (const url of candidates) {
    try {
      const servidores = await extractVideos(url, browser);
      if (servidores.length) {
        return {
          episodio: epNumber,
          titulo: `Episodio ${epNumber}`,
          servidores,
          actualizado: Date.now(),
        };
      }
    } catch (err) {
      console.warn(`  [animelatinohd] ⚠ ${url}: ${err.message}`);
    }
  }

  return {
    episodio: epNumber,
    titulo: `Episodio ${epNumber}`,
    servidores: [],
    actualizado: Date.now(),
  };
}

// ─── Exportación principal ──────────────────────────────────────────────────────

/**
 * Punto de entrada del scraper de animelatinohd.
 *
 * @param {import('playwright').Browser} browser  Instancia de Playwright reutilizable.
 */
export async function scrapeAnimeLatinoHD(browser) {
  console.log("\n[animelatinohd] ═══════════════════════════════════════");
  console.log("[animelatinohd] 🚀 iniciando scraping de animelatinohd.com");
  console.log("[animelatinohd] ═══════════════════════════════════════");

  const animes = await fetchAllAnimes();
  console.log(`[animelatinohd] 📦 total animes encontrados: ${animes.length}`);

  const results = [];

  for (let i = 0; i < animes.length; i++) {
    const anime = animes[i];
    console.log(
      `\n[animelatinohd] [${i + 1}/${animes.length}] 📺 ${anime.nombre} (${anime.slug})`
    );

    try {
      const { descripcion, episodios } = await fetchAnimeDetail(anime.url);
      await sleep(DELAY_MS);

      const info = {
        slug: anime.slug,
        nombre: anime.nombre,
        portada: anime.portada,
        descripcion,
        totalEpisodios: episodios.length,
        fuente: "animelatinohd.com",
      };

      const episodiosData = [];

      for (const epNum of episodios) {
        const epData = await scrapeEpisode(anime.slug, anime.url, epNum, browser);
        episodiosData.push(epData);
        await sleep(DELAY_MS);
      }

      results.push({ info, episodios: episodiosData });
      console.log(
        `[animelatinohd] ✓ ${anime.nombre}: ${episodiosData.length} episodios procesados`
      );
    } catch (err) {
      console.error(
        `[animelatinohd] ✗ error procesando ${anime.nombre}: ${err.message}`
      );
    }
  }

  console.log(`\n[animelatinohd] ✅ scraping completado: ${results.length} animes`);
  return results;
}
