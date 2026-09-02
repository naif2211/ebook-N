const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function clean(v) { return (v || "").replace(/\s+/g, " ").trim(); }
function seriesPath(id) { return id.startsWith("/series/") ? id : "/series/" + id.replace(/^\/+|\/+$/g, "") + "/"; }
function chapterId(href) {
  if (!href) return null;
  const m = href.match(/\/(shaag24[^/?#]+-\d+)\/?$/i);
  if (m) return m[1];
  return href.replace(/^https?:\/\/kolnovel\.com/i, "").replace(/^\/+/, "").replace(/\/+$/, "");
}
function chapterNumber(text) {
  const m = clean(text).match(/(?:الفصل|chapter)\s*(\d+(?:\.\d+)?)/iu);
  return m ? m[1] : undefined;
}
function summary(a) {
  const href = a.attr("href") || "";
  if (!href.includes("/series/")) return null;
  const title = clean(a.attr("title") || a.querySelector("h2")?.text() || a.querySelector("h3")?.text() || a.text());
  if (!title) return null;
  const img = a.querySelector("img") || a.parent()?.querySelector("img");
  return { id: href.replace(/^https?:\/\/kolnovel\.com/i, "").replace(/^\/series\//, "").replace(/\/+$/, ""), title, cover: abs(img?.attr("data-src") || img?.attr("data-lazy-src") || img?.attr("src")) };
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    const doc = await getDoc("/page/" + (Math.floor(offset / 24) + 1) + "/");
    const seen = new Set();
    return doc.querySelectorAll("a[href*='/series/']").map(summary).filter(x => {
      if (!x || seen.has(x.id)) return false; seen.add(x.id); return true;
    });
  },

  async search(query, offset) {
    const doc = await getDoc("/?s=" + encodeURIComponent(query) + "&paged=" + (Math.floor(offset / 24) + 1));
    const seen = new Set();
    return doc.querySelectorAll("a[href*='/series/']").map(summary).filter(x => {
      if (!x || seen.has(x.id)) return false; seen.add(x.id); return true;
    });
  },

  async detail(id) {
    const doc = await getDoc(seriesPath(id));
    const cover = doc.querySelector("img");
    const title = clean(doc.querySelector("h1")?.text()) || id;
    const description = clean(doc.querySelector(".summary")?.text() || doc.querySelector(".desc")?.text() || doc.querySelector(".description")?.text());
    const author = clean(doc.querySelector(".author a")?.text() || doc.querySelector(".author")?.text());
    return {
      id, title,
      cover: abs(cover?.attr("data-src") || cover?.attr("data-lazy-src") || cover?.attr("src")),
      description: description || undefined,
      author: author || undefined,
      genres: doc.querySelectorAll(".genres a, .genre a, a[rel='tag']").map(n => clean(n.text())).filter(Boolean),
      status: clean(doc.querySelector(".status")?.text()) || undefined,
      originalLanguage: "zh",
      chapters: doc.querySelectorAll("a[href*='/shaag24']").length || undefined
    };
  },

  async chapters(id) {
    const doc = await getDoc(seriesPath(id));
    const result = [], seen = new Set();
    const links = doc.querySelectorAll("a[href*='/shaag24']");
    for (const a of links) {
      const cid = chapterId(a.attr("href") || "");
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const text = clean(a.text());
      const number = a.attr("data-number") || chapterNumber(text);
      result.push({ id: cid, chapter: number || undefined, title: text || ("الفصل " + (number || "")), position: result.length, volume: undefined, volumeTitle: undefined, pages: 0, language: "ar", publishAt: a.querySelector("time")?.attr("datetime") || undefined, views: undefined });
    }
    return result;
  },

  async content(chapterId) {
    const doc = await getDoc("/" + chapterId.replace(/^\/+/, "") + "/");
    const selectors = [".reading-content p", ".chapter-content p", ".entry-content p", ".post-content p", "article p"];
    let blocks = [];
    for (const selector of selectors) {
      const found = doc.querySelectorAll(selector).map(n => clean(n.text())).filter(Boolean);
      if (found.length > 3) { blocks = found; break; }
    }
    if (!blocks.length) blocks = doc.querySelectorAll("p").map(n => clean(n.text())).filter(t => t && !/^(facebook|twitter|whatsapp|telegram|pinterest)$/iu.test(t));
    return blocks.join("\n\n");
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" }
    ];
  }
};
