import fetch from "node-fetch";
import * as cheerio from "cheerio"; // ✅ FIX
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "samvelzeta/zetanime-cache";

// ======================
// 🔥 FETCH
// ======================
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "es-ES,es;q=0.9"
      }
    });

    return await res.text();
  } catch {
    return null;
  }
}

// ======================
// 🔥 EXTRAER VIDEO
// ======================
function extractVideoUrls(html) {
  const urls = [];

  const m3u8 = html.match(/https?:\/\/[^"' ]+\.m3u8/g);
  if (m3u8) urls.push(...m3u8);

  const mp4 = html.match(/https?:\/\/[^"' ]+\.mp4/g);
  if (mp4) urls.push(...mp4);

  return [...new Set(urls)];
}

// ======================
// 🔥 LATANIME
// ======================
async function scrapeLatanime(slug, number) {

  const url = `https://latanime.org/ver/${slug}-${number}`;
  const html = await fetchHtml(url);

  if (!html) return [];

  return extractVideoUrls(html);
}

// ======================
// 🔥 ANIMELATINOHD
// ======================
async function scrapeAnimeLatinoHD(slug, number) {

  const search = `https://www.animelatinohd.com/?s=${slug}`;
  const html = await fetchHtml(search);

  if (!html) return [];

  const $ = cheerio.load(html);

  let link = null;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.includes(slug)) link = href;
  });

  if (!link) return [];

  const epUrl = `${link}/episodio-${number}`;
  const epHtml = await fetchHtml(epUrl);

  if (!epHtml) return [];

  return extractVideoUrls(epHtml);
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

  if (!videos.length) return;

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

  console.log("🚀 BOT LATINO");

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
