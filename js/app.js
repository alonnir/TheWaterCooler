const CACHE_DOC = "latestWaterCooler";
const CACHE_TTL_MS = 60 * 60 * 1000;

const stopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of",
  "on", "or", "that", "the", "to", "was", "were", "with", "you", "your", "will", "this",
]);

const feeds = [
  { category: "news", label: "World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { category: "news", label: "US", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },
  { category: "politics", label: "Politics", url: "https://news.google.com/rss/search?q=US+politics&hl=en-US&gl=US&ceid=US:en" },
  { category: "tv", label: "TV", url: "https://news.google.com/rss/search?q=television+streaming+series&hl=en-US&gl=US&ceid=US:en" },
  { category: "sports", label: "Sports", url: "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en" },
  { category: "popular culture", label: "Pop Culture", url: "https://news.google.com/rss/search?q=celebrity+music+movies+viral&hl=en-US&gl=US&ceid=US:en" },
  { category: "weather", label: "Weather", url: "https://news.google.com/rss/search?q=weather+storm+forecast+climate&hl=en-US&gl=US&ceid=US:en" },
];

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const approved = await isApprovedUser(user);
  if (!approved) {
    await auth.signOut();
    window.location.href = "index.html?reason=not-approved";
    return;
  }

  renderUser(user);
  attachHandlers();
  loadBriefing(false);
});

async function isApprovedUser(user) {
  const email = (user.email || "").trim();
  if (!email) {
    return false;
  }
  try {
    const doc = await db.collection("allowedEmails").doc(email).get();
    return doc.exists;
  } catch (error) {
    return false;
  }
}

function attachHandlers() {
  const signOutBtn = document.getElementById("signout-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      await auth.signOut();
      window.location.href = "index.html";
    };
  }
  if (refreshBtn) {
    refreshBtn.onclick = () => loadBriefing(true);
  }
}

function renderUser(user) {
  const userInfo = document.getElementById("user-info");
  if (!userInfo) return;
  const name = user.displayName || user.email || "Signed in";
  const photo = user.photoURL
    ? `<img src="${escapeHtml(user.photoURL)}" alt="${escapeHtml(name)}" class="user-avatar">`
    : "";
  userInfo.innerHTML = `${photo}<span>${escapeHtml(name)}</span>`;
}

async function loadBriefing(forceRefresh) {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error-container");
  const container = document.getElementById("news-container");
  const lastUpdate = document.getElementById("last-update");
  const topInput = document.getElementById("top-count");
  const lookbackInput = document.getElementById("lookback-hours");

  const topCount = clamp(parseInt(topInput?.value || "12", 10), 1, 25);
  const lookbackHours = clamp(parseInt(lookbackInput?.value || "36", 10), 1, 120);

  loading.style.display = "block";
  error.textContent = "";
  container.innerHTML = "";

  try {
    let payload = null;

    if (!forceRefresh) {
      payload = await getCachedNews(lookbackHours);
    }

    if (!payload) {
      payload = await fetchFreshNews(topCount, lookbackHours);
      await cacheNews(payload);
    }

    renderTopics(payload.topics.slice(0, topCount));
    lastUpdate.textContent = `Last updated: ${timeAgo(payload.timestamp)}`;

    if (payload.warnings && payload.warnings.length > 0) {
      error.textContent = `Some feeds failed: ${payload.warnings.join(" | ")}`;
    }
  } catch (err) {
    error.textContent = `Failed to load stories: ${err.message}`;
  } finally {
    loading.style.display = "none";
  }
}

async function getCachedNews(lookbackHours) {
  try {
    const doc = await db.collection("newsCache").doc(CACHE_DOC).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data || !data.timestamp || !Array.isArray(data.topics)) return null;
    const isExpired = Date.now() - data.timestamp > CACHE_TTL_MS;
    const sameWindow = data.lookbackHours === lookbackHours;
    if (isExpired || !sameWindow) return null;
    return data;
  } catch (err) {
    return null;
  }
}

async function cacheNews(payload) {
  await db.collection("newsCache").doc(CACHE_DOC).set(payload, { merge: true });
}

async function fetchFreshNews(topCount, lookbackHours) {
  const warnings = [];
  const allStories = [];

  const results = await Promise.all(feeds.map((feed) => fetchFeed(feed)));
  for (const result of results) {
    if (result.error) {
      warnings.push(`${result.feed.category}: ${result.error}`);
      continue;
    }
    allStories.push(...result.items);
  }

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const recentStories = allStories.filter((item) => item.publishedAtMs >= cutoff);
  const clusters = clusterStories(recentStories);
  const ranked = rankClusters(clusters).slice(0, topCount);

  const topics = ranked.map((cluster) => {
    const rep = cluster.stories[0];
    return {
      title: rep.title,
      link: rep.link,
      categories: Array.from(cluster.categories).sort(),
      mentions: cluster.stories.length,
      sources: cluster.sources.size,
      prompt: makePrompt(rep.title),
      published: rep.published,
    };
  });

  return {
    timestamp: Date.now(),
    lookbackHours,
    topics,
    warnings,
  };
}

async function fetchFeed(feed) {
  const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
  try {
    const response = await fetch(rss2jsonUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const items = (data.items || []).slice(0, 20).map((item) => {
      const publishedMs = Date.parse(item.pubDate || item.published || "");
      return {
        title: (item.title || "").trim(),
        link: item.link || "",
        source: (item.author || data.feed?.title || feed.label || "Unknown").trim(),
        category: feed.category,
        published: item.pubDate || item.published || new Date().toISOString(),
        publishedAtMs: Number.isFinite(publishedMs) ? publishedMs : Date.now(),
      };
    }).filter((item) => item.title);
    return { feed, items };
  } catch (err) {
    return { feed, error: err.message || "fetch failed" };
  }
}

function clusterStories(stories) {
  const sorted = stories.slice().sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  const clusters = [];

  for (const story of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      const score = similarity(story.title, cluster.stories[0].title);
      if (score >= 0.55) {
        cluster.stories.push(story);
        cluster.categories.add(story.category);
        cluster.sources.add(story.source || "Unknown");
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        stories: [story],
        categories: new Set([story.category]),
        sources: new Set([story.source || "Unknown"]),
      });
    }
  }

  for (const cluster of clusters) {
    cluster.stories.sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  }

  return clusters;
}

function rankClusters(clusters) {
  const now = Date.now();
  return clusters.sort((a, b) => scoreCluster(b, now) - scoreCluster(a, now));
}

function scoreCluster(cluster, nowMs) {
  const mentions = cluster.stories.length;
  const sources = cluster.sources.size;
  const categorySpread = cluster.categories.size;
  const newest = cluster.stories[0]?.publishedAtMs || nowMs;
  const recencyHours = Math.max(0, (nowMs - newest) / (1000 * 60 * 60));
  const recencyBonus = Math.max(0, 24 - recencyHours) / 6;
  return mentions * 3 + sources * 2 + categorySpread * 1.5 + recencyBonus;
}

function similarity(leftTitle, rightTitle) {
  const a = new Set(tokenize(leftTitle));
  const b = new Set(tokenize(rightTitle));
  if (a.size === 0 || b.size === 0) return 0;

  const intersectionCount = [...a].filter((token) => b.has(token)).length;
  const unionCount = new Set([...a, ...b]).size;
  const jaccard = intersectionCount / unionCount;

  const leftNorm = [...a].join(" ");
  const rightNorm = [...b].join(" ");
  const contains = leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm) ? 1 : 0;

  return Math.max(jaccard, contains);
}

function tokenize(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !stopwords.has(token));
}

function makePrompt(title) {
  const terms = tokenize(title).slice(0, 2);
  if (terms.length === 0) {
    return "What angle here do you think people will still debate next week?";
  }
  return `Do you think this changes what happens next around ${terms.join(" and ")}?`;
}

function renderTopics(topics) {
  const container = document.getElementById("news-container");
  if (!topics || topics.length === 0) {
    container.innerHTML = '<p class="no-news">No stories found in this time window.</p>';
    return;
  }

  container.innerHTML = topics.map((topic, i) => {
    const categories = topic.categories.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join(" ");
    return `
      <article class="news-card">
        <div class="news-number">${i + 1}</div>
        <div class="news-content">
          <div class="chip-row">${categories}</div>
          <h3 class="news-title"><a href="${escapeHtml(topic.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(topic.title)}</a></h3>
          <p class="news-description">Why it's hot: ${topic.mentions} related headlines across ${topic.sources} sources.</p>
          <p class="news-prompt">Prompt: ${escapeHtml(topic.prompt)}</p>
          <div class="news-meta">
            <span>${escapeHtml(new Date(topic.published).toLocaleString())}</span>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
