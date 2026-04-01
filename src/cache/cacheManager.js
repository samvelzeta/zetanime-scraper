/**
 * Cache Manager — guarda y actualiza datos en el repositorio GitHub
 * samvelzeta/zetanime-cache usando la API REST de GitHub.
 *
 * Estructura en el repo:
 *   data/<slug>/info.json        → metadatos del anime
 *   data/<slug>/<episodio>.json  → datos del episodio
 */

import axios from "axios";

const REPO = "samvelzeta/zetanime-cache";
const BRANCH = "main";
const COMMIT_MSG = "chore: update anime cache";
const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT = 20000;
const DELAY_MS = 300; // pausa entre escrituras para no saturar la API

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN no está definido en el entorno");
  return token;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Obtiene el SHA actual de un archivo (null si no existe).
 */
async function getFileSha(path) {
  const url = `${API_BASE}/repos/${REPO}/contents/${path}?ref=${BRANCH}`;
  try {
    const { data } = await axios.get(url, {
      headers: githubHeaders(),
      timeout: REQUEST_TIMEOUT,
    });
    return data.sha || null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Crea o actualiza un archivo en el repositorio de cache.
 *
 * @param {string} path     Ruta relativa dentro del repo (ej: "data/one-piece/1.json")
 * @param {object} content  Objeto JS que se serializará como JSON.
 */
export async function saveToCache(path, content) {
  const token = getToken(); // lanza si no hay token
  const url = `${API_BASE}/repos/${REPO}/contents/${path}`;
  const base64 = Buffer.from(JSON.stringify(content, null, 2)).toString("base64");

  let sha = null;
  try {
    sha = await getFileSha(path);
  } catch (err) {
    console.warn(`[cache] ⚠ no se pudo obtener SHA de ${path}: ${err.message}`);
  }

  const body = {
    message: COMMIT_MSG,
    content: base64,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  try {
    await axios.put(url, body, {
      headers: githubHeaders(),
      timeout: REQUEST_TIMEOUT,
    });
    console.log(`[cache] ✓ guardado: ${path}`);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.error(`[cache] ✗ error guardando ${path} (HTTP ${status}): ${msg}`);
    throw err;
  }
}

// ─── API pública ────────────────────────────────────────────────────────────────

/**
 * Guarda la información de un anime y todos sus episodios en el cache.
 *
 * @param {{ info: object, episodios: object[] }} animeData
 */
export async function cacheAnime({ info, episodios }) {
  const { slug } = info;
  if (!slug) {
    console.warn("[cache] ⚠ anime sin slug, omitiendo");
    return;
  }

  console.log(`[cache] 💾 guardando ${slug} (${episodios.length} episodios)...`);

  // Guardar info.json
  try {
    await saveToCache(`data/${slug}/info.json`, info);
    await sleep(DELAY_MS);
  } catch (err) {
    console.error(`[cache] ✗ error guardando info de ${slug}: ${err.message}`);
  }

  // Guardar cada episodio
  for (const ep of episodios) {
    const epNum = ep.episodio;
    if (epNum === undefined || epNum === null) continue;

    try {
      await saveToCache(`data/${slug}/${epNum}.json`, ep);
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(
        `[cache] ✗ error guardando episodio ${epNum} de ${slug}: ${err.message}`
      );
      // Continúa con el siguiente episodio
    }
  }

  console.log(`[cache] ✅ ${slug} guardado completamente`);
}

/**
 * Guarda los resultados completos de un scraper (array de animes).
 *
 * @param {Array<{ info: object, episodios: object[] }>} results
 */
export async function cacheAll(results) {
  console.log(`\n[cache] 📦 guardando ${results.length} animes en cache...`);
  let saved = 0;
  let failed = 0;

  for (const animeData of results) {
    try {
      await cacheAnime(animeData);
      saved++;
    } catch (err) {
      console.error(
        `[cache] ✗ fallo al guardar ${animeData?.info?.slug}: ${err.message}`
      );
      failed++;
    }
  }

  console.log(`[cache] ✅ cache completado: ${saved} guardados, ${failed} fallidos`);
}
