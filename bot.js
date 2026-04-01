import { chromium } from "playwright";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "samvelzeta/zetanime-cache";

// ======================
// 🔥 EXTRAER VIDEOS
// ======================
async function extractVideos(url) {

  console.log("➡ intentando:", url);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  const videos = new Set();

  page.on("response", async (res) => {
    try {
      const u = res.url();

      if (u.includes(".m3u8") || u.includes(".mp4")) {
        console.log("🎥 video detectado en red:", u);
        videos.add(u);
      }

    } catch {}
  });

  try {
    console.log("🌐 navegando a:", url);
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    console.log("⏳ esperando player...");
    await page.waitForTimeout(12000);

    console.log("📄 título de página:", await page.title());

  } catch (e) {
    console.log("❌ error cargando página:", url, "—", e.message);
  }

  await browser.close();

  console.log("📦 videos encontrados:", videos.size, [...videos]);

  return [...videos];
}

// ======================
// 🔥 LATANIME
// ======================
async function scrapeLatanime(slug, number) {

  const url = `https://latanime.org/ver/${slug}-${number}`;
  return await extractVideos(url);
}

// ======================
// 🔥 ANIMELATINOHD
// ======================
async function scrapeAnimeLatinoHD(slug, number) {

  const searchUrl = `https://www.animelatinohd.com/?s=${encodeURIComponent(slug)}`;

  console.log("🔎 buscando en AnimeLatinoHD:", searchUrl);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  try {
    console.log("🌐 navegando a búsqueda...");
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });

    console.log("📄 título de búsqueda:", await page.title());

    // Esperar a que aparezcan resultados de búsqueda
    console.log("⏳ esperando resultados de búsqueda...");
    try {
      await page.waitForSelector(
        "a.post-title, .search-result a, article a, .post a[href*='/anime/']",
        { timeout: 15000 }
      );
      console.log("✅ resultados de búsqueda cargados");
    } catch (e) {
      console.log("⚠ timeout esperando resultados, intentando con lo que hay:", e.message);
    }

    // Volcar todos los enlaces visibles para debuggear
    const allLinks = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map(a => a.href)
        .filter(h => h.includes("animelatinohd.com"))
        .slice(0, 20)
    );
    console.log("🔍 enlaces encontrados en página:", allLinks);

    // Intentar selectores específicos primero, luego fallback genérico
    const link = await page.evaluate(() => {
      const selectors = [
        "a.post-title",
        ".search-result a",
        "article h2 a",
        "article h3 a",
        ".post-title a",
        "a[href*='/anime/']"
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.href) {
          console.log("selector usado:", sel, "->", el.href);
          return el.href;
        }
      }
      return null;
    });

    console.log("🔗 primer resultado seleccionado:", link);

    if (!link) {
      console.log("❌ no se encontró ningún resultado para:", slug);
      await browser.close();
      return [];
    }

    const epUrl = `${link.replace(/\/$/, "")}/episodio-${number}`;
    console.log("🎬 URL del episodio:", epUrl);

    await browser.close();

    return await extractVideos(epUrl);

  } catch (e) {
    console.log("❌ error en scrapeAnimeLatinoHD:", e.message);
    await browser.close();
    return [];
  }
}

// ======================
// 🔥 GITHUB PUSH
// ======================
async function push(path, content) {

  console.log("⬆ subiendo:", path);

  const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const base64 = Buffer.from(content).toString("base64");

  let sha = null;

  try {
    const existing = await fetch(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
    }).then(r => r.json());

    if (existing?.sha) sha = existing.sha;

  } catch {}

  await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "update latino",
      content: base64,
      sha
    })
  });
}

// ======================
// 🔥 GUARDAR
// ======================
async function save(slug, number, videos) {

  if (!videos.length) {
    console.log("⚠ sin videos:", slug, number);
    return;
  }

  const data = {
    slug,
    episode: number,
    sources: {
      hls: videos.filter(v => v.includes(".m3u8")),
      mp4: videos.filter(v => v.includes(".mp4")),
      embed: videos
    },
    updated: Date.now()
  };

  const path = `data/${slug}/${number}-latino.json`;

  await push(path, JSON.stringify(data, null, 2));

  console.log("✔ guardado:", slug, number);
}

// ======================
// 🔥 MAIN
// ======================
async function run() {

  console.log("🚀 BOT LATINO DEBUG");

  const animes = [
    { slug: "one-piece", episodes: [1100] }
  ];

  for (const anime of animes) {
    for (const ep of anime.episodes) {

      console.log("🎬 procesando:", anime.slug, ep);

      let videos = [];

      const a = await scrapeLatanime(anime.slug, ep);
      const b = await scrapeAnimeLatinoHD(anime.slug, ep);

      videos = [...a, ...b];

      await save(anime.slug, ep, videos);
    }
  }

  console.log("✅ FIN TOTAL");
}

run();
