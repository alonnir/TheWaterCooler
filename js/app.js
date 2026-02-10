const CACHE_DOC = "latestWaterCooler";
const CACHE_TTL_MS = 60 * 60 * 1000;
const PREFS_SAVE_DEBOUNCE_MS = 600;

const stopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of",
  "on", "or", "that", "the", "to", "was", "were", "with", "you", "your", "will", "this",
]);

const feeds = [
  { id: "news-top", category: "news", label: "Google Top News", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" },
  { id: "news-us", category: "news", label: "Google US News", url: "https://news.google.com/rss/headlines/section/geo/US?hl=en-US&gl=US&ceid=US:en" },
  { id: "politics", category: "politics", label: "Google Politics", url: "https://news.google.com/rss/search?q=US+politics&hl=en-US&gl=US&ceid=US:en" },
  { id: "tv", category: "tv", label: "Google TV", url: "https://news.google.com/rss/search?q=television+streaming+series&hl=en-US&gl=US&ceid=US:en" },
  { id: "sports", category: "sports", label: "Google Sports", url: "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en" },
  { id: "culture", category: "popular culture", label: "Google Pop Culture", url: "https://news.google.com/rss/search?q=celebrity+music+movies+viral&hl=en-US&gl=US&ceid=US:en" },
  { id: "weather", category: "weather", label: "Google Weather", url: "https://news.google.com/rss/search?q=weather+storm+forecast+climate&hl=en-US&gl=US&ceid=US:en" },
];

const categoryOrder = ["news", "politics", "tv", "sports", "popular culture", "weather"];

const state = {
  user: null,
  lastPayload: null,
  savingPrefsTimer: null,
  prefs: {
    topCount: 12,
    lookbackHours: 36,
    tone: "neutral",
    enabledCategories: [],
    enabledFeedIds: feeds.map((feed) => feed.id),
    mutedTopicIds: [],
  },
};

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

  state.user = user;
  renderUser(user);
  await loadUserPreferences(user.uid);
  renderPreferenceControls();
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

async function loadUserPreferences(userId) {
  try {
    const doc = await db.collection("users").doc(userId).get();
    const prefs = doc.data()?.preferences;
    if (!prefs) return;

    const enabledFeedIds = Array.isArray(prefs.enabledFeedIds)
      ? prefs.enabledFeedIds.filter((id) => feeds.some((feed) => feed.id === id))
      : state.prefs.enabledFeedIds;
    const mutedTopicIds = Array.isArray(prefs.mutedTopicIds)
      ? prefs.mutedTopicIds.map((id) => String(id)).filter(Boolean)
      : [];

    state.prefs = {
      ...state.prefs,
      topCount: clamp(parseInt(prefs.topCount, 10), 1, 25),
      lookbackHours: clamp(parseInt(prefs.lookbackHours, 10), 1, 120),
      tone: ["neutral", "optimistic", "serious"].includes(prefs.tone) ? prefs.tone : "neutral",
      // Categories default to "all off" on each load; toggles are session-level.
      enabledCategories: [],
      enabledFeedIds: enabledFeedIds.length > 0 ? enabledFeedIds : feeds.map((feed) => feed.id),
      mutedTopicIds,
    };
  } catch (error) {
    // Continue with defaults if prefs cannot load.
  }
}

function scheduleSavePreferences() {
  if (!state.user) return;
  if (state.savingPrefsTimer) {
    clearTimeout(state.savingPrefsTimer);
  }
  state.savingPrefsTimer = setTimeout(async () => {
    try {
      await db.collection("users").doc(state.user.uid).set(
        {
          preferences: {
            topCount: state.prefs.topCount,
            lookbackHours: state.prefs.lookbackHours,
            tone: state.prefs.tone,
            enabledFeedIds: state.prefs.enabledFeedIds,
            mutedTopicIds: state.prefs.mutedTopicIds,
          },
          preferencesUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      // Non-fatal: UI can keep functioning without prefs persistence.
    }
  }, PREFS_SAVE_DEBOUNCE_MS);
}

function renderPreferenceControls() {
  const topInput = document.getElementById("top-count");
  const lookbackInput = document.getElementById("lookback-hours");
  const toneSelect = document.getElementById("tone-select");
  const categoryFilters = document.getElementById("category-filters");
  const sourceFilters = document.getElementById("source-filters");

  topInput.value = String(state.prefs.topCount);
  lookbackInput.value = String(state.prefs.lookbackHours);
  toneSelect.value = state.prefs.tone;

  categoryFilters.innerHTML = categoryOrder.map((category) => {
    const active = state.prefs.enabledCategories.includes(category) ? "active" : "";
    return `<button type="button" class="category-btn ${active}" data-role="category" data-value="${escapeHtml(category)}">${escapeHtml(category)}</button>`;
  }).join("");

  sourceFilters.innerHTML = feeds.map((feed) => {
    const checked = state.prefs.enabledFeedIds.includes(feed.id) ? "checked" : "";
    return `<label class="option"><input type="checkbox" data-role="source" data-value="${escapeHtml(feed.id)}" ${checked}>${escapeHtml(feed.label)}</label>`;
  }).join("");
}

function attachHandlers() {
  const signOutBtn = document.getElementById("signout-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const topInput = document.getElementById("top-count");
  const lookbackInput = document.getElementById("lookback-hours");
  const toneSelect = document.getElementById("tone-select");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const categoryFilters = document.getElementById("category-filters");
  const sourceFilters = document.getElementById("source-filters");
  const newsContainer = document.getElementById("news-container");

  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      await auth.signOut();
      window.location.href = "index.html";
    };
  }

  refreshBtn.onclick = () => loadBriefing(true);

  topInput.onchange = () => {
    state.prefs.topCount = clamp(parseInt(topInput.value, 10), 1, 25);
    scheduleSavePreferences();
    applyCurrentView();
  };

  lookbackInput.onchange = () => {
    state.prefs.lookbackHours = clamp(parseInt(lookbackInput.value, 10), 1, 120);
    scheduleSavePreferences();
    loadBriefing(true);
  };

  toneSelect.onchange = () => {
    state.prefs.tone = toneSelect.value;
    scheduleSavePreferences();
    applyCurrentView();
  };

  settingsToggle.onclick = () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsToggle.textContent = settingsPanel.hidden ? "Settings" : "Close Settings";
  };

  categoryFilters.onclick = (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }
    const target = rawTarget.closest("[data-role='category']");
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const category = target.dataset.value || "";
    const next = new Set(state.prefs.enabledCategories);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }

    state.prefs.enabledCategories = [...next];
    renderPreferenceControls();
    applyCurrentView();
  };

  sourceFilters.onchange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.role !== "source") {
      return;
    }

    const feedId = target.dataset.value || "";
    const next = new Set(state.prefs.enabledFeedIds);
    if (target.checked) {
      next.add(feedId);
    } else {
      next.delete(feedId);
    }

    if (next.size === 0) {
      target.checked = true;
      return;
    }

    state.prefs.enabledFeedIds = [...next];
    scheduleSavePreferences();
    loadBriefing(true);
  };

  newsContainer.onclick = (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }
    const digButton = rawTarget.closest("[data-role='dig-topic']");
    if (digButton instanceof HTMLElement) {
      const topicId = digButton.dataset.topicId || "";
      const panel = document.querySelector(`[data-role='related-panel'][data-topic-id='${cssEscape(topicId)}']`);
      if (panel instanceof HTMLElement) {
        const isHidden = panel.hasAttribute("hidden");
        if (isHidden) {
          panel.removeAttribute("hidden");
          digButton.textContent = "Hide details";
        } else {
          panel.setAttribute("hidden", "");
          digButton.textContent = "Dig deeper";
        }
      }
      return;
    }

    const muteButton = rawTarget.closest("[data-role='mute-topic']");
    if (!(muteButton instanceof HTMLElement)) {
      return;
    }
    const topicId = muteButton.dataset.topicId || "";
    if (!topicId) {
      return;
    }
    if (!state.prefs.mutedTopicIds.includes(topicId)) {
      state.prefs.mutedTopicIds = [...state.prefs.mutedTopicIds, topicId];
      scheduleSavePreferences();
      applyCurrentView();
    }
  };
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
  const sourceSignature = buildSourceSignature(state.prefs.enabledFeedIds);

  loading.style.display = "block";
  error.textContent = "";

  try {
    let payload = null;

    if (!forceRefresh) {
      payload = await getCachedNews(state.prefs.lookbackHours, sourceSignature);
    }

    if (!payload) {
      payload = await fetchFreshNews(state.prefs.lookbackHours, sourceSignature);
      await cacheNews(payload);
    }

    state.lastPayload = payload;
    applyCurrentView();

    if (payload.warnings && payload.warnings.length > 0) {
      error.textContent = `Some feeds failed: ${payload.warnings.join(" | ")}`;
    }
  } catch (err) {
    error.textContent = `Failed to load stories: ${err.message}`;
  } finally {
    loading.style.display = "none";
  }
}

function applyCurrentView() {
  const container = document.getElementById("news-container");
  const lastUpdate = document.getElementById("last-update");

  if (!state.lastPayload) {
    container.innerHTML = '<p class="no-news">No stories loaded yet.</p>';
    return;
  }

  const normalizedTopics = (state.lastPayload.topics || []).map((topic) => normalizeTopic(topic));
  const hasCategoryFilters = state.prefs.enabledCategories.length > 0;
  const filtered = normalizedTopics
    .filter((topic) => {
      if (!hasCategoryFilters) {
        return !state.prefs.mutedTopicIds.includes(topic.id);
      }
      return (
        topic.categories.some((category) => state.prefs.enabledCategories.includes(category))
        && !state.prefs.mutedTopicIds.includes(topic.id)
      );
    })
    .slice(0, state.prefs.topCount)
    .map((topic) => ({
      ...topic,
      prompt: makePrompt(topic.title, state.prefs.tone),
    }));

  renderTopics(filtered);
  lastUpdate.textContent = `Last updated: ${timeAgo(state.lastPayload.timestamp)}`;
}

function buildSourceSignature(enabledFeedIds) {
  return [...enabledFeedIds].sort().join(",");
}

async function getCachedNews(lookbackHours, sourceSignature) {
  try {
    const doc = await db.collection("newsCache").doc(CACHE_DOC).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data || !data.timestamp || !Array.isArray(data.topics)) return null;
    const isExpired = Date.now() - data.timestamp > CACHE_TTL_MS;
    const sameWindow = data.lookbackHours === lookbackHours;
    const sameSources = data.sourceSignature === sourceSignature;
    if (isExpired || !sameWindow || !sameSources) return null;
    return data;
  } catch (err) {
    return null;
  }
}

async function cacheNews(payload) {
  await db.collection("newsCache").doc(CACHE_DOC).set(payload, { merge: true });
}

async function fetchFreshNews(lookbackHours, sourceSignature) {
  const warnings = [];
  const allStories = [];
  const selectedFeeds = feeds.filter((feed) => state.prefs.enabledFeedIds.includes(feed.id));

  if (selectedFeeds.length === 0) {
    throw new Error("No sources selected.");
  }

  const results = await Promise.all(selectedFeeds.map((feed) => fetchFeed(feed)));
  for (const result of results) {
    if (result.error) {
      warnings.push(`${result.feed.label}: ${result.error}`);
      continue;
    }
    allStories.push(...result.items);
  }

  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const recentStories = allStories.filter((item) => item.publishedAtMs >= cutoff);
  const clusters = clusterStories(recentStories);
  const ranked = rankClusters(clusters);

  const topics = ranked.map((cluster) => {
    const rep = cluster.stories[0];
    const sources = [...cluster.sourceNames].slice(0, 4);
    return {
      id: makeTopicId(rep.title, rep.link),
      title: rep.title,
      link: rep.link,
      categories: Array.from(cluster.categories).sort(),
      mentions: cluster.stories.length,
      sources: cluster.sources.size,
      prompt: makePrompt(rep.title, state.prefs.tone),
      published: rep.published,
      score: round2(cluster.score),
      scoreBreakdown: {
        mentionPoints: round2(cluster.mentionPoints),
        sourcePoints: round2(cluster.sourcePoints),
        categoryPoints: round2(cluster.categoryPoints),
        recencyPoints: round2(cluster.recencyPoints),
      },
      sourceNames: sources,
      relatedStories: cluster.stories.slice(0, 5).map((story) => ({
        title: story.title,
        link: story.link,
        source: story.source || "Unknown",
      })),
    };
  });

  return {
    timestamp: Date.now(),
    lookbackHours,
    sourceSignature,
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
    const items = (data.items || []).slice(0, 24).map((item) => {
      const publishedMs = Date.parse(item.pubDate || item.published || "");
      return {
        title: (item.title || "").trim(),
        link: item.link || "",
        source: (item.author || data.feed?.title || feed.label || "Unknown").trim(),
        category: feed.category,
        feedId: feed.id,
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
        cluster.sourceNames.add(story.source || "Unknown");
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        stories: [story],
        categories: new Set([story.category]),
        sources: new Set([story.source || "Unknown"]),
        sourceNames: new Set([story.source || "Unknown"]),
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
  return clusters
    .map((cluster) => {
      const mentionPoints = cluster.stories.length * 3;
      const sourcePoints = cluster.sources.size * 2;
      const categoryPoints = cluster.categories.size * 1.5;
      const newest = cluster.stories[0]?.publishedAtMs || now;
      const recencyHours = Math.max(0, (now - newest) / (1000 * 60 * 60));
      const recencyPoints = Math.max(0, 24 - recencyHours) / 6;
      const score = mentionPoints + sourcePoints + categoryPoints + recencyPoints;
      return {
        ...cluster,
        mentionPoints,
        sourcePoints,
        categoryPoints,
        recencyPoints,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
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

function makePrompt(title, tone) {
  const terms = tokenize(title).slice(0, 2);
  const subject = terms.length > 0 ? terms.join(" and ") : "this story";

  if (tone === "optimistic") {
    return `What positive shift could come next around ${subject}?`;
  }
  if (tone === "serious") {
    return `What is the highest-impact risk here around ${subject}?`;
  }
  return `Do you think this changes what happens next around ${subject}?`;
}

function renderTopics(topics) {
  const container = document.getElementById("news-container");
  if (!topics || topics.length === 0) {
    container.innerHTML = '<p class="no-news">No stories match your current filters. Try clearing category filters or muted stories.</p>';
    return;
  }

  container.innerHTML = topics.map((topic, i) => {
    const categories = topic.categories.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join(" ");
    const sourceNames = (topic.sourceNames || []).map((source) => escapeHtml(source)).join(", ");
    return `
      <article class="news-card">
        <div class="news-number">${i + 1}</div>
        <div class="news-content">
          <div class="chip-row">${categories}</div>
          <h3 class="news-title"><a href="${escapeHtml(topic.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(topic.title)}</a></h3>
          <p class="news-description">Why it's hot: ${topic.mentions} related headlines across ${topic.sources} sources.</p>
          <p class="news-prompt">Prompt: ${escapeHtml(topic.prompt)}</p>
          <div class="story-actions">
            <button type="button" class="dig-btn" data-role="dig-topic" data-topic-id="${escapeHtml(topic.id)}">Dig deeper</button>
            <button type="button" class="mute-btn" data-role="mute-topic" data-topic-id="${escapeHtml(topic.id)}">Mute</button>
          </div>
          <div class="related-panel" data-role="related-panel" data-topic-id="${escapeHtml(topic.id)}" hidden>
            <ul class="related-list">
              ${(topic.relatedStories || []).map((story) => `<li>${story.link ? `<a href="${escapeHtml(story.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.title)}</a>` : `${escapeHtml(story.title)}`} <span class="related-source">(${escapeHtml(story.source)})</span></li>`).join("")}
            </ul>
          </div>
          <details class="score-toggle">
            <summary>Why trending (score ${topic.score})</summary>
            <div class="score-panel">
              <div>Mentions: ${topic.scoreBreakdown.mentionPoints}</div>
              <div>Source spread: ${topic.scoreBreakdown.sourcePoints}</div>
              <div>Category spread: ${topic.scoreBreakdown.categoryPoints}</div>
              <div>Recency: ${topic.scoreBreakdown.recencyPoints}</div>
              <div>Top sources: ${sourceNames || "n/a"}</div>
            </div>
          </details>
          <div class="news-meta">
            <span>${escapeHtml(new Date(topic.published).toLocaleString())}</span>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function makeTopicId(title, link) {
  const raw = `${String(title || "")} ${String(link || "")}`.toLowerCase();
  return raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeTopic(topic) {
  const normalized = { ...topic };
  normalized.id = normalized.id || makeTopicId(normalized.title, normalized.link);
  if (!Array.isArray(normalized.categories)) {
    normalized.categories = [];
  }
  if (!Array.isArray(normalized.relatedStories) || normalized.relatedStories.length === 0) {
    normalized.relatedStories = [{
      title: normalized.title || "Primary story",
      link: normalized.link || "",
      source: Array.isArray(normalized.sourceNames) && normalized.sourceNames[0] ? normalized.sourceNames[0] : "Unknown",
    }];
  }
  return normalized;
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

function cssEscape(input) {
  return String(input || "").replace(/["\\]/g, "\\$&");
}
