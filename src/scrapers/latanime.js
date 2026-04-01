/**
 * Scraper para latanime.org
 * Obtiene todos los animes, sus episodios y servidores de video.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import slugify from "slugify";
import { extractVideos } from "../extractors/videoExtractor.js";

const BASE_URL = "https://latanime.org";
const DELAY_MS = 1500;       // pausa entre requests para no saturar el servidor
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
      console.log(`  [latanime] GET ${url} (intento ${attempt}/${retries})`);
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
      console.warn(`  [latanime] ⚠ error en ${url}: ${err.message}`);
      if (attempt < retries) await sleep(DELAY_MS * attempt);
    }
  }
  console.error(`  [latanime] ✗ no se pudo obtener: ${url}`);
  return null;
}

// ─── Listado de animes ──────────────────────────────────────────────────────────

/**
 * Obtiene una página del directorio de animes.
 * Retorna array de { nombre, slug, portada, url }.
 */
async function fetchAnimePage(page) {
  const url = `${BASE_URL}/animes?page=${page}`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const animes = [];

  // Selector principal del grid de animes en latanime.org
  $("article.anime-card, .anime-card, .col-anime, article").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a").first();
    const href = linkEl.attr("href") || "";
    const nombre = ($el.find(".anime-title, h3, h2, .title").first().text() || "").trim();
    const portada =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") ||
      "";

    if (!href || !nombre) return;

    // Extraer slug desde la URL: /anime/one-piece → one-piece
    const match = href.match(/\/anime\/([^/?#]+)/);
    const slug = match ? match[1] : toSlug(nombre);

    animes.push({
      nombre,
      slug,
      portada: portada.startsWith("http") ? portada : `${BASE_URL}${portada}`,
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });

  return animes;
}

/**
 * Recorre todas las páginas del directorio hasta que no haya más resultados.
 */
async function fetchAllAnimes() {
  console.log("[latanime] 📋 obteniendo lista completa de animes...");
  const all = [];
  let page = 1;

  while (true) {
    const batch = await fetchAnimePage(page);
    if (!batch.length) {
      console.log(`[latanime] ✓ paginación terminada en página ${page}`);
      break;
    }
    console.log(`[latanime]   página ${page}: ${batch.length} animes`);
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
    $(".anime-description, .sinopsis, .description, .synopsis, p.text-muted")
      .first()
      .text() || ""
  ).trim();

  const episodios = [];

  // Episodios listados como enlaces /ver/<slug>-<numero>
  $("a[href*='/ver/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/ver\/(.+?)-(\d+)(?:[/?#]|$)/);
    if (!match) return;
    const num = parseInt(match[2], 10);
    if (!isNaN(num) && !episodios.includes(num)) episodios.push(num);
  });

  episodios.sort((a, b) => a - b);
  return { descripcion, episodios };
}

// ─── Episodio ───────────────────────────────────────────────────────────────────

/**
 * Extrae los servidores de video de un episodio.
 * Retorna { episodio, titulo, servidores, actualizado }.
 */
async function scrapeEpisode(animeSlug, epNumber, browser) {
  const url = `${BASE_URL}/ver/${animeSlug}-${epNumber}`;
  console.log(`  [latanime] 🎬 episodio ${epNumber}: ${url}`);

  try {
    const servidores = await extractVideos(url, browser);
    return {
      episodio: epNumber,
      titulo: `Episodio ${epNumber}`,
      servidores,
      actualizado: Date.now(),
    };
  } catch (err) {
    console.warn(`  [latanime] ⚠ error en episodio ${epNumber}: ${err.message}`);
    return {
      episodio: epNumber,
      titulo: `Episodio ${epNumber}`,
      servidores: [],
      actualizado: Date.now(),
    };
  }
}

// ─── Exportación principal ──────────────────────────────────────────────────────

/**
 * Punto de entrada del scraper de latanime.
 * Retorna array de objetos { info, episodios[] }.
 *
 * @param {import('playwright').Browser} browser  Instancia de Playwright reutilizable.
 */
export async function scrapeLatanime(browser) {
  console.log("\n[latanime] ═══════════════════════════════════════");
  console.log("[latanime] 🚀 iniciando scraping de latanime.org");
  console.log("[latanime] ═══════════════════════════════════════");

  const animes = await fetchAllAnimes();
  console.log(`[latanime] 📦 total animes encontrados: ${animes.length}`);

  const results = [];

  for (let i = 0; i < animes.length; i++) {
    const anime = animes[i];
    console.log(
      `\n[latanime] [${i + 1}/${animes.length}] 📺 ${anime.nombre} (${anime.slug})`
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
        fuente: "latanime.org",
      };

      const episodiosData = [];

      for (const epNum of episodios) {
        const epData = await scrapeEpisode(anime.slug, epNum, browser);
        episodiosData.push(epData);
        await sleep(DELAY_MS);
      }

      results.push({ info, episodios: episodiosData });
      console.log(
        `[latanime] ✓ ${anime.nombre}: ${episodiosData.length} episodios procesados`
      );
    } catch (err) {
      console.error(`[latanime] ✗ error procesando ${anime.nombre}: ${err.message}`);
      // Continúa con el siguiente anime sin crashear
    }
  }

  console.log(`\n[latanime] ✅ scraping completado: ${results.length} animes`);
  return results;
}
