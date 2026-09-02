const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return BASE + url;
  return BASE + "/" + url;
}

function pathFromHref(href) {
  var value = clean(href);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) value = value.replace(/^https?:\/\/[^/]+/i, "");
  if (value.indexOf("//") === 0) value = value.replace(/^\/\/[^/]+/i, "");
  if (value.charAt(0) !== "/") value = "/" + value;
  return value;
}

function seriesPath(id) {
  var value = clean(id);
  if (value.indexOf("http://") === 0 || value.indexOf("https://") === 0) return pathFromHref(value);
  if (value.indexOf("/series/") === 0) return value;
  return "/series/" + value.replace(/^\/+|\/+$/g, "") + "/";
}

function seriesId(href) {
  var path = pathFromHref(href);
  if (!path) return null;
  var match = path.match(/^\/series\/([^/?#]+)\/?$/i);
  return match ? match[1] : null;
}

function chapterFromHref(href) {
  var path = pathFromHref(href);
  if (!path || path.indexOf("/shaag24") !== 0) return null;
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function chapterNumber(text) {
  var match = clean(text).match(/(?:الفصل|chapter|ch\.?)\s*(\d+(?:\.\d+)?)/iu);
  return match ? match[1] : undefined;
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function makeSummary(card) {
  var link = card.querySelector(".post-title a");
  if (!link) {
    var links = card.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      if (seriesId(links[i].attr("href") || "")) { link = links[i]; break; }
    }
  }
  if (!link) return null;
  var id = seriesId(link.attr("href") || "");
  if (!id) return null;
  var title = clean(link.text()) || clean(link.attr("title"));
  var img = card.querySelector(".summary_image img") || card.querySelector("img.img-responsive") || card.querySelector("img");
  if (!title && img) title = clean(img.attr("alt"));
  if (!title) return null;
  return { id: id, title: title, cover: imageUrl(img) };
}

function listCards(doc) {
  var selectors = [".page-item-detail", ".c-tabs-item__content"];
  for (var s = 0; s < selectors.length; s++) {
    var cards = doc.querySelectorAll(selectors[s]);
    if (!cards.length) continue;
    var out = [], seen = {};
    for (var i = 0; i < cards.length; i++) {
      var item = makeSummary(cards[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
    }
    if (out.length) return out;
  }
  return [];
}

function fallbackSeriesLinks(doc) {
  var links = doc.querySelectorAll("a");
  var out = [], seen = {};
  for (var i = 0; i < links.length; i++) {
    var id = seriesId(links[i].attr("href") || "");
    if (!id || seen[id]) continue;
    var title = clean(links[i].text()) || clean(links[i].attr("title"));
    if (!title) continue;
    seen[id] = true;
    out.push({ id: id, title: title });
  }
  return out;
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var doc = await getDoc("/series/?page=" + page + "&m_orderby=views");
    var result = listCards(doc);
    return result.length ? result : fallbackSeriesLinks(doc);
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = "/?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
    if (page > 1) path += "&paged=" + page;
    var doc = await getDoc(path);
    var result = listCards(doc);
    return result.length ? result : fallbackSeriesLinks(doc);
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var titleNode = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    var summaryNode = doc.querySelector(".description-summary .summary__content");
    var authorNode = doc.querySelector(".author-content a");
    var statusNode = doc.querySelector(".post-status .summary-content");
    var cover = doc.querySelector(".summary_image img") || doc.querySelector("img[alt]") || doc.querySelector("img");
    var genreNodes = doc.querySelectorAll(".genres-content a");
    var genres = [];
    for (var i = 0; i < genreNodes.length; i++) {
      var g = clean(genreNodes[i].text());
      if (g) genres.push(g);
    }
    var chapterNodes = doc.querySelectorAll(".wp-manga-chapter");
    return {
      id: id,
      title: clean(titleNode ? titleNode.text() : "") || clean(id),
      cover: imageUrl(cover),
      description: summaryNode ? clean(summaryNode.text()) : undefined,
      author: authorNode ? clean(authorNode.text()) : undefined,
      status: statusNode ? clean(statusNode.text()) : undefined,
      originalLanguage: "zh",
      genres: genres,
      chapters: chapterNodes.length || undefined
    };
  },

  async chapters(id) {
    var doc = await getDoc(seriesPath(id));
    var rows = doc.querySelectorAll(".wp-manga-chapter");
    var result = [], seen = {};

    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].querySelector("a");
      if (!a) continue;
      var cid = chapterFromHref(a.attr("href") || "");
      if (!cid || seen[cid]) continue;
      seen[cid] = true;
      var text = clean(a.text());
      var number = chapterNumber(text);
      var dateNode = rows[i].querySelector(".chapter-release-date");
      result.push({
        id: cid,
        chapter: number || undefined,
        title: text || (number ? "الفصل " + number : cid),
        position: result.length,
        pages: 0,
        language: "ar",
        publishAt: dateNode ? clean(dateNode.text()) : undefined
      });
    }

    if (!result.length) {
      var links = doc.querySelectorAll("a");
      for (var j = 0; j < links.length; j++) {
        var fallbackId = chapterFromHref(links[j].attr("href") || "");
        if (!fallbackId || seen[fallbackId]) continue;
        seen[fallbackId] = true;
        var fallbackText = clean(links[j].text());
        var fallbackNumber = chapterNumber(fallbackText);
        result.push({
          id: fallbackId,
          chapter: fallbackNumber || undefined,
          title: fallbackText || (fallbackNumber ? "الفصل " + fallbackNumber : fallbackId),
          position: result.length,
          pages: 0,
          language: "ar"
        });
      }
    }

    result.reverse();
    for (var k = 0; k < result.length; k++) result[k].position = k;
    return result;
  },

  async content(chapterIdValue) {
    var path = pathFromHref(chapterIdValue);
    if (!path) throw new Error("Invalid chapter id");
    var doc = await getDoc(path);

    var selectors = [
      ".text-left p",
      ".reading-content p",
      ".chapter-content p",
      ".entry-content p",
      ".post-content p"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var nodes = doc.querySelectorAll(selectors[i]);
      var parts = [];
      for (var j = 0; j < nodes.length; j++) {
        var value = clean(nodes[j].text());
        if (!value) continue;
        if (/^(Facebook|Twitter|WhatsApp|Pinterest|Telegram)$/iu.test(value)) continue;
        parts.push(value);
      }
      if (parts.length >= 2) return parts.join("\n\n");
    }

    var containers = [".text-left", ".reading-content", ".chapter-content", ".entry-content", ".post-content"];
    for (var c = 0; c < containers.length; c++) {
      var container = doc.querySelector(containers[c]);
      if (!container) continue;
      var containerText = clean(container.text());
      if (containerText) return containerText;
    }
    return "";
  },

  async tags() {
    return [
      { id: "ongoing", name: "مستمرة", group: "الحالة" },
      { id: "completed", name: "مكتملة", group: "الحالة" },
      { id: "views", name: "الأكثر مشاهدة", group: "الترتيب" }
    ];
  }
};
