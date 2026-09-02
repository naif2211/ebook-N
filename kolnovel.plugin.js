const BASE = "https://kolnovel.com";
const PAGE_SIZE = 20;

async function getDoc(pathOrUrl) {
  var target = abs(pathOrUrl);
  if (!target) throw new Error("Invalid KolNovel URL");

  const res = await harbor.http(target, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + target);
  return harbor.parseHtml(res.body);
}

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function abs(url) {
  var value = clean(url);
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf("//") === 0) return "https:" + value;
  return value.charAt(0) === "/" ? BASE + value : BASE + "/" + value;
}

function toPath(href) {
  var value = clean(href);
  if (!value) return null;

  // Chapter ids are persisted as paths. Only accept links back to KolNovel.
  var absolute = value.match(/^https?:\/\/([^/]+)(\/[^?#]*)(\?[^#]*)?(?:#.*)?$/i);
  if (absolute) {
    if (!/(^|\.)kolnovel\.com$/i.test(absolute[1])) return null;
    return absolute[2] + (absolute[3] || "");
  }

  if (value.indexOf("//") === 0) {
    var protocolRelative = value.match(/^\/\/([^/]+)(\/[^?#]*)(\?[^#]*)?(?:#.*)?$/i);
    if (!protocolRelative || !/(^|\.)kolnovel\.com$/i.test(protocolRelative[1])) return null;
    return protocolRelative[2] + (protocolRelative[3] || "");
  }

  value = value.replace(/#.*$/, "");
  return value.charAt(0) === "/" ? value : "/" + value;
}

function seriesPath(id) {
  var value = clean(id);
  if (!value) throw new Error("Invalid series id");
  if (/^https?:\/\//i.test(value) || value.indexOf("/series/") === 0) return toPath(value);
  return "/series/" + value.replace(/^\/+|\/+$/g, "") + "/";
}

function seriesId(href) {
  var path = toPath(href);
  if (!path) return null;
  var match = path.match(/^\/series\/([^/?#]+)\/?(?:\?[^#]*)?$/i);
  return match ? match[1] : null;
}

function chapterNumber(title, href) {
  var text = clean(title) + " " + clean(href);
  var match = text.match(/(?:الفصل|chapter|chap\.?|ch\.?)\s*[._:-]*(\d+(?:\.\d+)?)/iu);
  if (match) return match[1];

  match = clean(href).match(/[-_](\d+(?:\.\d+)?)(?:\/?(?:\?.*)?)?$/);
  return match ? match[1] : undefined;
}

function imageUrl(img) {
  if (!img) return undefined;
  return abs(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("data-original") || img.attr("src"));
}

function firstSeriesLink(root) {
  var preferred = root.querySelector(".post-title a") || root.querySelector("h3 a") || root.querySelector("h4 a");
  if (preferred && seriesId(preferred.attr("href") || "")) return preferred;

  var links = root.querySelectorAll("a[href*='/series/']");
  for (var i = 0; i < links.length; i++) {
    if (seriesId(links[i].attr("href") || "")) return links[i];
  }
  return null;
}

function makeSummary(root) {
  var link = firstSeriesLink(root);
  if (!link) return null;

  var id = seriesId(link.attr("href") || "");
  var image = root.querySelector(".summary_image img") || root.querySelector("img");
  var title = clean(link.text()) || clean(link.attr("title"));
  if (!title && image) title = clean(image.attr("alt"));
  if (!id || !title) return null;

  return { id: id, title: title, cover: imageUrl(image) };
}

function listSeries(doc) {
  var result = [];
  var seen = {};
  var cards = doc.querySelectorAll(".page-item-detail, .c-tabs-item__content, .item-summary");

  for (var i = 0; i < cards.length; i++) {
    var item = makeSummary(cards[i]);
    if (!item || seen[item.id]) continue;
    seen[item.id] = true;
    result.push(item);
  }

  // Search layouts can omit card wrappers, but still use links to /series/.
  if (!result.length) {
    var links = doc.querySelectorAll("a[href*='/series/']");
    for (var j = 0; j < links.length; j++) {
      var id = seriesId(links[j].attr("href") || "");
      var title = clean(links[j].text()) || clean(links[j].attr("title"));
      if (!id || !title || seen[id]) continue;
      seen[id] = true;
      result.push({ id: id, title: title, cover: imageUrl(links[j].querySelector("img")) });
    }
  }

  return result;
}

function readChapters(doc) {
  var rows = doc.querySelectorAll(".wp-manga-chapter");
  var result = [];
  var seen = {};

  for (var i = 0; i < rows.length; i++) {
    var link = rows[i].querySelector("a[href]");
    if (!link) continue;

    // Retain KolNovel's exact chapter path. It is what content() must request.
    var path = toPath(link.attr("href") || "");
    if (!path || seen[path]) continue;

    var title = clean(link.text());
    var number = chapterNumber(title, path);
    var date = rows[i].querySelector(".chapter-release-date");
    seen[path] = true;
    result.push({
      id: path,
      chapter: number || undefined,
      title: title || (number ? "الفصل " + number : path),
      position: result.length,
      pages: 0,
      language: "ar",
      publishAt: date ? clean(date.text()) : undefined
    });
  }

  // Do not sort or reverse: Harbor receives the order shown by KolNovel.
  return result;
}

function textFrom(doc, selector) {
  var nodes = doc.querySelectorAll(selector);
  var parts = [];
  for (var i = 0; i < nodes.length; i++) {
    var value = clean(nodes[i].text());
    if (value) parts.push(value);
  }
  return parts.length ? parts.join("\n\n") : "";
}

function browsePath(page, tagId) {
  var status = "";
  var order = "";
  var tag = clean(tagId);
  if (tag.indexOf("status:") === 0) status = tag.substring(7);
  if (tag.indexOf("sort:") === 0) order = tag.substring(5);

  var path = "/series/?page=" + page;
  if (order) path += "&order=" + encodeURIComponent(order);
  if (status) path += "&status=" + encodeURIComponent(status);
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
    var value = clean(query || "");
    if (!value) return [];

    var doc = await getDoc("/?s=" + encodeURIComponent(value) + "&post_type=wp-manga" + (page > 1 ? "&paged=" + page : ""));
    var result = listSeries(doc);
    if (result.length) return result;

    var alternate = "/series/?s=" + encodeURIComponent(value) + (page > 1 ? "&page=" + page : "");
    return listSeries(await getDoc(alternate));
  },

  async detail(id) {
    var doc = await getDoc(seriesPath(id));
    var title = doc.querySelector(".post-title h1") || doc.querySelector("h1");
    var cover = doc.querySelector(".summary_image img") || doc.querySelector("img[alt]") || doc.querySelector("img");
    var description = doc.querySelector(".description-summary .summary__content");
    var author = doc.querySelector(".author-content a");
    var status = doc.querySelector(".post-status .summary-content");
    var genreNodes = doc.querySelectorAll(".genres-content a");
    var genres = [];
    for (var i = 0; i < genreNodes.length; i++) {
      var genre = clean(genreNodes[i].text());
      if (genre) genres.push(genre);
    }

    var chapters = readChapters(doc);
    return {
      id: id,
      title: clean(title ? title.text() : id),
      cover: imageUrl(cover),
      description: description ? clean(description.text()) : undefined,
      author: author ? clean(author.text()) : undefined,
      status: status ? clean(status.text()) : undefined,
      originalLanguage: "zh",
      genres: genres,
      chapters: chapters.length || undefined
    };
  },

  async chapters(id) {
    return readChapters(await getDoc(seriesPath(id)));
  },

  async content(chapterIdValue) {
    var path = toPath(chapterIdValue);
    if (!path) throw new Error("Invalid chapter id");

    var doc = await getDoc(path);
    var selectors = [".text-left p", ".reading-content p", ".entry-content p"];
    for (var i = 0; i < selectors.length; i++) {
      var content = textFrom(doc, selectors[i]);
      if (content) return content;
    }

    var textLeft = doc.querySelector(".text-left");
    return textLeft ? clean(textLeft.text()) : "";
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
