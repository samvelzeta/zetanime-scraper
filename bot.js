import { chromium } from "playwright";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "samvelzeta/zetanime-cache";

// ======================
// 🔥 CAPTURAR VIDEO REAL
// ======================
async function extractVideos(url) {

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  const videos = new Set();

  // 👇 interceptar TODO lo que carga
  page.on("response", async (res) => {
    try {
      const u = res.url();

      if (
        u.includes(".m3u8") ||
        u.includes(".mp4")
      ) {
        videos.add(u);
      }

    } catch {}
  });

  try {
    console.log("➡ entrando:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // ⏳ dejar que cargue el player
    await page.waitForTimeout(8000);

  } catch (e) {
    console.log("❌ error cargando:", url);
  }

  await browser.close();

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

  const searchUrl = `https://www.animelatinohd.com/?s=${slug}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    // sacar primer resultado
    const link = await page.evaluate(() => {
      const a = document.querySelector("a[href*='anime']");
      return a ? a.href : null;
    });

    if (!link) {
      await browser.close();
      return [];
    }

    const epUrl = `${link}/episodio-${number}`;

    await browser.close();

    return await extractVideos(epUrl);

  } catch {
    await browser.close();
    return [];
  }
}

// ======================
// 🔥 GITHUB PUSH
// ======================
async function push(path, content) {

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

  console.log("🚀 BOT LATINO REAL");

  const animes = [
    { slug: "one-piece", episodes: [1100] }
  ];

  for (const anime of animes) {
    for (const ep of anime.episodes) {

      let videos = [];

      const a = await scrapeLatanime(anime.slug, ep);
      const b = await scrapeAnimeLatinoHD(anime.slug, ep);

      videos = [...a, ...b];

      await save(anime.slug, ep, videos);
    }
  }

  console.log("✅ FIN");
}

run();
