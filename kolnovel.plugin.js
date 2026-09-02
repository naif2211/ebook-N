const BASE = "https://kolnovel.com";
const PAGE_SIZE = 20;

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function toPath(href) {
  var v = clean(href);
  if (!v) return null;
  v = v.replace(/^https?:\/\/[^/]+/i, "");
  if (v.indexOf("//") === 0) v = v.replace(/^\/\/[^/]+/i, "");
  if (v.charAt(0) !== "/") v = "/" + v;
  return v;
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  return url.charAt(0) === "/" ? BASE + url : BASE + "/" + url;
}

function seriesPath(id) {
  var v = clean(id);
  if (/^https?:\/\//i.test(v) || v.indexOf("/series/") === 0) return toPath(v);
  return "/series/" + v.replace(/^\/+|\/+$/g, "") + "/";
}

function seriesId(href) {
  var p = toPath(href);
  if (!p) return null;
  var m = p.match(/^\/series\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function chapterId(href) {
  var p = toPath(href);
  if (!p) return null;
  var m = p.match(/^\/(shaag24[^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function chapterNumber(text, href) {
  var s = clean(text) + " " + clean(href);
  var m = s.match(/(?:الفصل|chapter|chap|ch\.?)\s*[._-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = clean(href).match(/[-_](\d+(?:\.\d+)?)\/?$/);
  return m ? m[1] : undefined;
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function makeSummary(link, root) {
  var id = seriesId(link.attr("href") || "");
  if (!id) return null;
  var title = clean(link.text()) || clean(link.attr("title"));
  var img = root ? (root.querySelector(".summary_image img") || root.querySelector("img")) : link.querySelector("img");
  if (!title && img) title = clean(img.attr("alt"));
  if (!title) return null;
  return { id: id, title: title, cover: imageUrl(img) };
}

function listSeries(doc) {
  var out = [];
  var seen = {};
  var cards = doc.querySelectorAll(".page-item-detail");

  for (var i = 0; i < cards.length; i++) {
    var links = cards[i].querySelectorAll("a");
    for (var j = 0; j < links.length; j++) {
      var item = makeSummary(links[j], cards[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
      break;
    }
  }

  // Universal fallback for pages whose card class changes.
  var allLinks = doc.querySelectorAll("a[href]");
  for (var k = 0; k < allLinks.length; k++) {
    var id = seriesId(allLinks[k].attr("href") || "");
    if (!id || seen[id]) continue;
    var title = clean(allLinks[k].text()) || clean(allLinks[k].attr("title"));
    var img = allLinks[k].querySelector("img");
    if (!title && img) title = clean(img.attr("alt"));
    if (!title) continue;
    seen[id] = true;
    out.push({ id: id, title: title, cover: imageUrl(img) });
  }

  return out;
}

function readChapters(doc) {
  var links = doc.querySelectorAll("a[href]");
  var out = [];
  var seen = {};

  for (var i = 0; i < links.length; i++) {
    var href = links[i].attr("href") || "";
    var id = chapterId(href);
    if (!id || seen[id]) continue;

    var text = clean(links[i].text());
    var number = chapterNumber(text, href);
    if (!number) continue;

    seen[id] = true;
    out.push({
      id: id,
      chapter: number,
      title: text || "الفصل " + number,
      position: out.length,
      pages: 0,
      language: "ar"
    });
  }

  // Keep KolNovel's order exactly as returned by the site.
  for (var p = 0; p < out.length; p++) out[p].position = p;
  return out;
}

function browsePath(page, tagId) {
  var state = "";
  var order = "";
  var tag = clean(tagId);
  if (tag.indexOf("status:") === 0) state = tag.substring(7);
  if (tag.indexOf("sort:") === 0) order = tag.substring(5);

  var path = "/series/?page=" + page;
  if (order) path += "&order=" + encodeURIComponent(order);
  if (state) path += "&status=" + encodeURIComponent(state);
  return path;
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset, tagId) {
    var page = Math.floor((offset || 0) / PAGE_SIZE) + 1;
    return listSeries(await getDoc(browsePath(page, tagId)));
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / PAGE_SIZE) + 1;
    var q = clean(query || "");
    if (!q) return [];

    // Primary KolNovel/WordPress search.
    var doc = await getDoc("/?s=" + encodeURIComponent(q) + "&post_type=wp-manga" + (page > 1 ? "&paged=" + page : ""));
    var result = listSeries(doc);

    // Alternate Series search used by some KolNovel deployments.
    if (!result.length) {
      var alt = "/series/?s=" + encodeURIComponent(q);
      if (page > 1) alt += "&page=" + page;
      result = listSeries(await getDoc(alt));
    }

    return result;
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var title = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    var cover = doc.querySelector(".summary_image img") || doc.querySelector("img[alt]") || doc.querySelector("img");
    var desc = doc.querySelector(".description-summary .summary__content");
    var author = doc.querySelector(".author-content a");
    var status = doc.querySelector(".post-status .summary-content");
    var gs = doc.querySelectorAll(".genres-content a");
    var genres = [];
    for (var i = 0; i < gs.length; i++) {
      var g = clean(gs[i].text());
      if (g) genres.push(g);
    }
    var ch = readChapters(doc);

    return {
      id: id,
      title: clean(title ? title.text() : id),
      cover: imageUrl(cover),
      description: desc ? clean(desc.text()) : undefined,
      author: author ? clean(author.text()) : undefined,
      status: status ? clean(status.text()) : undefined,
      originalLanguage: "zh",
      genres: genres,
      chapters: ch.length || undefined
    };
  },

  async chapters(id) {
    return readChapters(await getDoc(seriesPath(id)));
  },

  async content(chapterIdValue) {
    var path = toPath(chapterIdValue);
    if (!path) throw new Error("Invalid chapter id");

    var doc = await getDoc(path);
    var selectors = [
      ".text-left p",
      ".text-left > div",
      ".reading-content p",
      ".entry-content p",
      ".post-content p",
      "article p"
    ];

    for (var s = 0; s < selectors.length; s++) {
      var nodes = doc.querySelectorAll(selectors[s]);
      var parts = [];
      for (var j = 0; j < nodes.length; j++) {
        var text = clean(nodes[j].text());
        if (text) parts.push(text);
      }
      if (parts.length >= 2) return parts.join("\n\n");
    }

    var boxes = [".text-left", ".reading-content", ".entry-content", ".post-content", "article"];
    for (var c = 0; c < boxes.length; c++) {
      var box = doc.querySelector(boxes[c]);
      if (!box) continue;
      var value = clean(box.text());
      if (value) return value;
    }

    return "";
  },

  async tags() {
    return [
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" },
      { id: "sort:popular", name: "Popular", group: "Sort" },
      { id: "sort:rating", name: "Rating", group: "Sort" },
      { id: "sort:chapters", name: "Chapters", group: "Sort" },
      { id: "sort:update", name: "Latest Updates", group: "Sort" }
    ];
  }
};
