const BASE = "https://kolnovel.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function absolute(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return BASE + url;
  return BASE + "/" + url;
}

function pathFromHref(href) {
  if (!href) return null;
  var value = href.trim();
  if (/^https?:\/\//i.test(value)) value = value.replace(/^https?:\/\/[^/]+/i, "");
  if (value.indexOf("//") === 0) value = value.replace(/^\/\/[^/]+/i, "");
  if (value.charAt(0) !== "/") value = "/" + value;
  return value;
}

function seriesPath(id) {
  var value = id || "";
  if (value.indexOf("/series/") === 0) return value;
  return "/series/" + value.replace(/^\/+|\/+$/g, "") + "/";
}

function seriesId(href) {
  var path = pathFromHref(href);
  if (!path) return null;
  var match = path.match(/^\/series\/([^/?#]+)\/?$/i);
  return match ? match[1] : null;
}

function chapterNumber(text) {
  var match = clean(text).match(/(?:الفصل|chapter)\s*(\d+(?:\.\d+)?)/iu);
  return match ? match[1] : undefined;
}

function chapterFromHref(href) {
  var path = pathFromHref(href);
  if (!path || path.indexOf("/shaag24") !== 0) return null;
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function imageUrl(img) {
  if (!img) return undefined;
  return absolute(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function cardToSummary(card) {
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
  var img = card.querySelector(".summary_image img, img.img-responsive, img");
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
      var item = cardToSummary(cards[i]);
      if (!item || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
    }
    if (out.length) return out;
  }
  return [];
}

const plugin = {
  id: "kolnovel",
  name: "KolNovel",

  async popular(offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    return listCards(await getDoc(page === 1 ? "/" : "/page/" + page + "/"));
  },

  async search(query, offset) {
    var page = Math.floor((offset || 0) / 24) + 1;
    var path = "/?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
    if (page > 1) path += "&paged=" + page;
    return listCards(await getDoc(path));
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var titleNode = doc.querySelector(".post-title h1");
    var summaryNode = doc.querySelector(".description-summary .summary__content");
    var authorNode = doc.querySelector(".author-content a");
    var statusNode = doc.querySelector(".post-status .summary-content");
    var cover = doc.querySelector(".summary_image img") || doc.querySelector("img");
    var genreNodes = doc.querySelectorAll(".genres-content a");
    var chapterNodes = doc.querySelectorAll(".wp-manga-chapter a");
    var genres = [];
    for (var i = 0; i < genreNodes.length; i++) {
      var g = clean(genreNodes[i].text());
      if (g) genres.push(g);
    }
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
    var nodes = doc.querySelectorAll(".wp-manga-chapter");
    var result = [], seen = {};

    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i].querySelector("a");
      if (!a) continue;
      var chapterId = chapterFromHref(a.attr("href") || "");
      if (!chapterId || seen[chapterId]) continue;
      seen[chapterId] = true;
      var text = clean(a.text());
      var number = chapterNumber(text);
      var dateNode = nodes[i].querySelector(".chapter-release-date");
      result.push({
        id: chapterId,
        chapter: number || undefined,
        title: text || (number ? "الفصل " + number : chapterId),
        position: result.length,
        pages: 0,
        language: "ar",
        publishAt: dateNode ? clean(dateNode.text()) : undefined
      });
    }

    return result.reverse();
  },

  async content(chapterIdValue) {
    var path = pathFromHref(chapterIdValue);
    if (!path) throw new Error("Invalid chapter id");
    var doc = await getDoc(path);

    var blocks = doc.querySelectorAll(".text-left p");
    var text = [];
    for (var i = 0; i < blocks.length; i++) {
      var value = clean(blocks[i].text());
      if (value) text.push(value);
    }
    if (text.length) return text.join("\n\n");

    var container = doc.querySelector(".text-left");
    if (container) {
      var containerText = clean(container.text());
      if (containerText) return containerText;
    }

    return "";
  },

  async tags() {
    return [
      { id: "ongoing", name: "مستمرة", group: "الحالة" },
      { id: "completed", name: "مكتملة", group: "الحالة" }
    ];
  }
};
