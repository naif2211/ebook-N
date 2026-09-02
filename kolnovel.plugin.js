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

function toPath(href) {
  var v = clean(href);
  if (!v) return null;
  v = v.replace(/^https?:\/\/[^/]+/i, "");
  if (v.indexOf("//") === 0) v = v.replace(/^\/\/[^/]+/i, "");
  if (v.charAt(0) !== "/") v = "/" + v;
  return v;
}

function seriesPath(id) {
  var v = clean(id);
  if (/^https?:\/\//i.test(v)) return toPath(v);
  if (v.indexOf("/series/") === 0) return v;
  return "/series/" + v.replace(/^\/+|\/+$/g, "") + "/";
}

function getSeriesId(href) {
  var p = toPath(href);
  if (!p) return null;
  var m = p.match(/^\/series\/([^/?#]+)\/?$/i);
  return m ? m[1] : null;
}

function getChapterId(href) {
  var p = toPath(href);
  if (!p) return null;
  if (p.indexOf("/shaag24") !== 0) return null;
  return p.substring(1).replace(/\/+$/, "");
}

function getChapterNumber(text) {
  var s = clean(text);
  var m = s.match(/(?:الفصل|chapter|ch)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m ? m[1] : undefined;
}

function getImage(img) {
  if (!img) return undefined;
  return abs(
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("src")
  );
}

function summaryFromCard(card) {
  var link = card.querySelector(".post-title a");
  if (!link) {
    var links = card.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      if (getSeriesId(links[i].attr("href") || "")) {
        link = links[i];
        break;
      }
    }
  }
  if (!link) return null;

  var id = getSeriesId(link.attr("href") || "");
  if (!id) return null;

  var title = clean(link.text()) || clean(link.attr("title"));
  var img = card.querySelector(".summary_image img") || card.querySelector("img");
  if (!title && img) title = clean(img.attr("alt"));
  if (!title) return null;

  return { id: id, title: title, cover: getImage(img) };
}

function listSeries(doc) {
  var cards = doc.querySelectorAll(".page-item-detail");
  var out = [];
  var seen = {};

  for (var i = 0; i < cards.length; i++) {
    var item = summaryFromCard(cards[i]);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    out.push(item);
  }

  if (out.length) return out;

  var links = doc.querySelectorAll("a[href*='/series/']");
  for (var j = 0; j < links.length; j++) {
    var id = getSeriesId(links[j].attr("href") || "");
    if (!id || seen[id]) continue;
    var title = clean(links[j].text()) || clean(links[j].attr("title"));
    if (!title) continue;
    seen[id] = true;
    out.push({ id: id, title: title });
  }
  return out;
}

function readChapterRows(doc) {
  var rows = doc.querySelectorAll(".wp-manga-chapter");
  var result = [];
  var seen = {};

  for (var i = 0; i < rows.length; i++) {
    var a = rows[i].querySelector("a");
    if (!a) continue;

    var id = getChapterId(a.attr("href") || "");
    if (!id || seen[id]) continue;
    seen[id] = true;

    var title = clean(a.text());
    var number = getChapterNumber(title);
    var date = rows[i].querySelector(".chapter-release-date");

    result.push({
      id: id,
      chapter: number || undefined,
      title: title || (number ? "الفصل " + number : id),
      position: result.length,
      pages: 0,
      language: "ar",
      publishAt: date ? clean(date.text()) : undefined
    });
  }

  return result;
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = page === 1 ? "/series/?m_orderby=views" : "/series/?page=" + page + "&m_orderby=views";
    return listSeries(await getDoc(path));
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = "/?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
    if (page > 1) path += "&paged=" + page;
    return listSeries(await getDoc(path));
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var title = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    var cover = doc.querySelector(".summary_image img") || doc.querySelector("img[alt]");
    var description = doc.querySelector(".description-summary .summary__content");
    var author = doc.querySelector(".author-content a");
    var status = doc.querySelector(".post-status .summary-content");
    var genreNodes = doc.querySelectorAll(".genres-content a");
    var genres = [];

    for (var i = 0; i < genreNodes.length; i++) {
      var g = clean(genreNodes[i].text());
      if (g) genres.push(g);
    }

    var chapterRows = readChapterRows(doc);

    return {
      id: id,
      title: clean(title ? title.text() : id),
      cover: getImage(cover),
      description: description ? clean(description.text()) : undefined,
      author: author ? clean(author.text()) : undefined,
      status: status ? clean(status.text()) : undefined,
      originalLanguage: "zh",
      genres: genres,
      chapters: chapterRows.length || undefined
    };
  },

  async chapters(id) {
    var doc = await getDoc(seriesPath(id));
    var result = readChapterRows(doc);

    if (!result.length) {
      var links = doc.querySelectorAll("a");
      var seen = {};
      for (var i = 0; i < links.length; i++) {
        var cid = getChapterId(links[i].attr("href") || "");
        if (!cid || seen[cid]) continue;
        seen[cid] = true;
        var text = clean(links[i].text());
        var number = getChapterNumber(text);
        result.push({
          id: cid,
          chapter: number || undefined,
          title: text || (number ? "الفصل " + number : cid),
          position: result.length,
          pages: 0,
          language: "ar"
        });
      }
    }

    // KolNovel returns newest chapters first. Harbor expects ascending positions.
    result.reverse();
    for (var p = 0; p < result.length; p++) result[p].position = p;
    return result;
  },

  async content(chapterId) {
    var path = toPath(chapterId);
    if (!path) throw new Error("Invalid chapter id");

    var doc = await getDoc(path);
    var selectors = [
      ".text-left p",
      ".text-left br",
      ".reading-content p",
      ".entry-content p",
      ".post-content p"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var nodes = doc.querySelectorAll(selectors[i]);
      var parts = [];
      for (var j = 0; j < nodes.length; j++) {
        var text = clean(nodes[j].text());
        if (!text) continue;
        parts.push(text);
      }
      if (parts.length >= 2) return parts.join("\n\n");
    }

    var containers = [".text-left", ".reading-content", ".entry-content", ".post-content"];
    for (var c = 0; c < containers.length; c++) {
      var container = doc.querySelector(containers[c]);
      if (!container) continue;
      var value = clean(container.text());
      if (value) return value;
    }

    return "";
  },

  async tags() {
    return [
      { id: "views", name: "الأكثر مشاهدة", group: "الترتيب" }
    ];
  }
};
