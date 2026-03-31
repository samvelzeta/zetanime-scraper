import fetch from "node-fetch";
import { getLatanimeServers } from "./scraper/sources.js";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "samvelzeta/zetanime-cache";

// ======================
// 🔥 PUSH GITHUB
// ======================
async function pushToGitHub(path, content) {

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
      message: "update cache",
      content: base64,
      sha
    })
  });
}

// ======================
// 🔥 GUARDAR
// ======================
async function saveEpisode(slug, number, servers) {

  if (!servers.length) return;

  const data = {
    slug,
    episode: number,
    sources: {
      hls: servers.filter(s => s.embed.includes(".m3u8")).map(s => s.embed),
      mp4: servers.filter(s => s.embed.includes(".mp4")).map(s => s.embed),
      embed: servers.map(s => s.embed)
    },
    updated: Date.now()
  };

  const path = `data/${slug}/${number}-latino.json`;

  await pushToGitHub(path, JSON.stringify(data, null, 2));

  console.log("✔ guardado:", slug, number);
}

// ======================
// 🔥 SCRAPER
// ======================
async function run() {

  console.log("🚀 iniciando scraper latino");

  const animes = [
    { slug: "one-piece", episodes: [1100] },
    { slug: "naruto", episodes: [1] }
  ];

  for (const anime of animes) {
    for (const ep of anime.episodes) {

      const servers = await getLatanimeServers(anime.slug, ep);

      await saveEpisode(anime.slug, ep, servers);
    }
  }

  console.log("✅ terminado");
}

run();
