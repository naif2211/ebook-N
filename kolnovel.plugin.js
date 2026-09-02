const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return harbor.parseHtml(res.body);
}

function clean(v) {
  return (v || "").replace(/\s+/g, " ").trim();
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return BASE + url;
  return BASE + "/" + url;
}

function seriesPath(id) {
  id = id || "";
  if (id.indexOf("/series/") === 0) return id;
  return "/series/" + id.replace(/^\/+|\/+$/g, "") + "/";
}

function seriesId(href) {
  var m = (href || "").match(/\/series\/([^?#]+)\/?$/i);
  return m ? m[1] : null;
}

function chapterId(href) {
  var m = (href || "").match(/\/(shaag24[^/?#]+-\d+)\/?$/i);
  return m ? m[1] : null;
}

function chapterNumber(text) {
  var m = clean(text).match(/(?:الفصل|chapter)\s*(\d+(?:\.\d+)?)/iu);
  return m ? m[1] : undefined;
}

function imageUrl(node) {
  if (!node) return undefined;
  return abs(node.attr("data-src") || node.attr("data-lazy-src") || node.attr("src"));
}

function makeSummary(a) {
  var href = a.attr("href") || "";
  var id = seriesId(href);
  if (!id) return null;
  var title = clean(a.attr("title") || a.text());
  var img = a.querySelector("img");
  if (!img) return null;
  if (!title) title = clean(img.attr("alt"));
  if (!title) return null;
  return { id: id, title: title, cover: imageUrl(img) };
}

function uniqueSummaries(doc) {
  var out = [];
  var seen = {};
  var links = doc.querySelectorAll("a[href*='/series/']");
  for (var i = 0; i < links.length; i++) {
    var item = makeSummary(links[i]);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }
  return out;
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var doc = await getDoc(page === 1 ? "/" : "/page/" + page + "/");
    return uniqueSummaries(doc);
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = "/?s=" + encodeURIComponent(query || "");
    if (page > 1) path += "&paged=" + page;
    return uniqueSummaries(await getDoc(path));
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var h1 = doc.querySelector("h1");
    var title = clean(h1 ? h1.text() : id);
    var cover = doc.querySelector("img");
    var links = doc.querySelectorAll("a[href*='/shaag24']");
    var genres = doc.querySelectorAll("a[rel='tag']").map(function(n) { return clean(n.text()); }).filter(Boolean);
    return {
      id: id,
      title: title,
      cover: imageUrl(cover),
      description: clean(doc.querySelector(".summary") ? doc.querySelector(".summary").text() : "") || undefined,
      author: clean(doc.querySelector(".author") ? doc.querySelector(".author").text() : "") || undefined,
      genres: genres,
      status: clean(doc.querySelector(".status") ? doc.querySelector(".status").text() : "") || undefined,
      originalLanguage: "zh",
      chapters: links.length || undefined
    };
  },

  async chapters(id) {
    var doc = await getDoc(seriesPath(id));
    var links = doc.querySelectorAll("a[href*='/shaag24']");
    var result = [];
    var seen = {};

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var cid = chapterId(a.attr("href") || "");
      if (!cid || seen[cid]) continue;
      seen[cid] = true;

      var text = clean(a.text());
      var number = a.attr("data-number") || chapterNumber(text);
      result.push({
        id: cid,
        chapter: number || undefined,
        title: text || (number ? "الفصل " + number : cid),
        position: result.length,
        pages: 0,
        language: "ar"
      });
    }

    return result;
  },

  async content(chapterIdValue) {
    var doc = await getDoc("/" + (chapterIdValue || "").replace(/^\/+/, "") + "/");
    var selectors = [
      ".reading-content p",
      ".chapter-content p",
      ".entry-content p",
      ".post-content p",
      "article p"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var nodes = doc.querySelectorAll(selectors[i]);
      var text = nodes.map(function(n) { return clean(n.text()); }).filter(Boolean);
      if (text.length >= 3) return text.join("\n\n");
    }

    return doc.querySelectorAll("p").map(function(n) {
      return clean(n.text());
    }).filter(Boolean).join("\n\n");
  },

  async tags() {
    return [
      { id: "ongoing", name: "مستمرة", group: "الحالة" },
      { id: "completed", name: "مكتملة", group: "الحالة" }
    ];
  }
};
