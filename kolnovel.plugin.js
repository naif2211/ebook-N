const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function clean(value) { return (value || "").replace(/\s+/g, " ").trim(); }

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
  var p = toPath(href); if (!p) return null;
  var m = p.match(/^\/series\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function chapterId(href) {
  var p = toPath(href); if (!p) return null;
  var m = p.match(/^\/(shaag24[^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function chapterNumber(text, href) {
  var s = clean(text) + " " + clean(href);
  var m = s.match(/(?:الفصل|chapter|chap|ch\.?)[\s._-]*(\d+(?:\.\d+)?)/iu);
  if (m) return m[1];
  m = clean(href).match(/[-_](\d+(?:\.\d+)?)\/?$/);
  return m ? m[1] : undefined;
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function summary(card) {
  var links = card.querySelectorAll("a"), link = null;
  for (var i = 0; i < links.length; i++) {
    if (seriesId(links[i].attr("href") || "")) { link = links[i]; break; }
  }
  if (!link) return null;
  var id = seriesId(link.attr("href") || "");
  var img = card.querySelector(".summary_image img") || card.querySelector("img");
  var title = clean(link.text()) || clean(link.attr("title")) || (img ? clean(img.attr("alt")) : "");
  return id && title ? { id: id, title: title, cover: imageUrl(img) } : null;
}

function listSeries(doc) {
  var out = [], seen = {};
  var cards = doc.querySelectorAll(".page-item-detail");
  for (var i = 0; i < cards.length; i++) {
    var item = summary(cards[i]);
    if (item && !seen[item.id]) { seen[item.id] = true; out.push(item); }
  }
  if (out.length) return out;
  var links = doc.querySelectorAll("a");
  for (var j = 0; j < links.length; j++) {
    var id = seriesId(links[j].attr("href") || "");
    if (!id || seen[id]) continue;
    var title = clean(links[j].text()) || clean(links[j].attr("title"));
    if (!title) continue;
    seen[id] = true;
    out.push({ id: id, title: title });
  }
  return out;
}

function readChapters(doc) {
  var links = doc.querySelectorAll("a"), out = [], seen = {};
  for (var i = 0; i < links.length; i++) {
    var href = links[i].attr("href") || "";
    var id = chapterId(href);
    if (!id || seen[id]) continue;
    seen[id] = true;
    var text = clean(links[i].text());
    var number = chapterNumber(text, href);
    out.push({ id: id, chapter: number || undefined, title: text || (number ? "الفصل " + number : id), position: 0, pages: 0, language: "ar" });
  }
  out.sort(function(a, b) {
    var x = parseFloat(a.chapter), y = parseFloat(b.chapter);
    if (isNaN(x)) return 1;
    if (isNaN(y)) return -1;
    return x - y;
  });
  for (var p = 0; p < out.length; p++) out[p].position = p;
  return out;
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    return listSeries(await getDoc("/series/?page=" + page + "&m_orderby=views"));
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = "/?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
    if (page > 1) path += "&paged=" + page;
    return listSeries(await getDoc(path));
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var h = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    var img = doc.querySelector(".summary_image img") || doc.querySelector("img[alt]") || doc.querySelector("img");
    var desc = doc.querySelector(".description-summary .summary__content");
    var author = doc.querySelector(".author-content a");
    var status = doc.querySelector(".post-status .summary-content");
    var gs = doc.querySelectorAll(".genres-content a"), genres = [];
    for (var i = 0; i < gs.length; i++) { var g = clean(gs[i].text()); if (g) genres.push(g); }
    var ch = readChapters(doc);
    return {
      id: id,
      title: clean(h ? h.text() : id),
      cover: imageUrl(img),
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
    var nodes = doc.querySelectorAll(".text-left p");
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      var t = clean(nodes[i].text());
      if (t) parts.push(t);
    }
    if (parts.length) return parts.join("\n\n");
    var box = doc.querySelector(".text-left");
    if (box) return clean(box.text());
    return "";
  },

  async tags() {
    return [{ id: "views", name: "الأكثر مشاهدة", group: "الترتيب" }];
  }
};
