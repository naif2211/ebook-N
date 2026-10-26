// Harbor eBook source plugin: رواياتعرب (riwayatarab.com)
// Site is Next.js. /latest, /novel/<slug>, /novel/<slug>/chapters?page=N and
// /novel/<slug>/chapter/<n> are server-rendered; /search is client-rendered, so
// search() filters a cached crawl of /latest instead of calling a search endpoint.

const BASE = "https://riwayatarab.com";
const PAGE_SIZE = 24;       // novels per /latest page
const CHAPTERS_PER_PAGE = 50;
const BATCH = 6;            // Harbor's in-flight request limit

// ---------- helpers ----------
const abs = (u) => {
  if (!u) return undefined;
  u = String(u).trim();
  if (u.startsWith("//")) u = "https:" + u;
  if (u.startsWith("/")) u = BASE + u;
  // Next.js image proxy: /_next/image?url=<encoded>&w=..
  const m = u.match(/[?&]url=([^&]+)/);
  if (u.includes("/_next/image") && m) {
    try { u = decodeURIComponent(m[1]); } catch (_) {}
    if (u.startsWith("/")) u = BASE + u;
  }
  return /^https?:\/\//i.test(u) ? u : undefined;
};

async function getHtml(url) {
  const res = await harbor.http(url, { responseType: "text", timeoutMs: 20000 });
  const html = typeof res === "string" ? res : (res.text ?? res.body ?? res.data ?? "");
  return harbor.parseHtml(html);
}

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Spam/watermarks the site (or its upstream scrapes) injects into text.
const SPAM_INLINE = [
  /\*?\s*إقرأ\*?\s*رواياتنا\*?\s*فقط\*?\s*على\*?\s*مو\*?قع\s*م\*?لوك\s*الرو\*?ايات\s*ko\*?lno\*?vel\s*ko\*?lno\*?vel\.?\s*com/gi,
  /ko\*?lno\*?vel(\.?\s*com)?/gi,
  /\b2{6,}\b/g,
];
const SPAM_LINE = [
  /حقوق\s*\$\$.*\$\$/,                  // "حقوق $$عالم الروايات$$ ..."
  /عالم\s*الروايات/,
  /افخم\s*واسرع\s*واكبر/,
  /^الفصل\s*\d+\s*:\s*\d+$/,             // "الفصل 1: 0001" duplicate heading
  /^الفصل\s*\d+(\s*من\s*\d+)?$/,
  /^(الفصل\s*)?(التالي|السابق)$/,
];
const stripInline = (s) => SPAM_INLINE.reduce((t, re) => t.replace(re, " "), s || "");
const isSpamLine = (l) => SPAM_LINE.some((re) => re.test(l));

const normAr = (s) =>
  (s || "").toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function statusOf(t) {
  if (/مكتملة/.test(t)) return "completed";
  if (/متوقفة/.test(t)) return "hiatus";
  if (/مستمرة/.test(t)) return "ongoing";
  return undefined;
}

function parseCount(s) {
  if (!s) return undefined;
  const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([كKkMm])?/);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  if (/[كKk]/.test(m[2] || "")) n *= 1000;
  if (/[Mm]/.test(m[2] || "")) n *= 1e6;
  return Math.round(n);
}

function slugFromHref(href) {
  const m = String(href || "").match(/\/novel\/([^/?#]+)/);
  return m ? m[1] : null;
}

async function mapLimit(items, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += BATCH) {
    const part = await Promise.all(items.slice(i, i + BATCH).map((x, j) => fn(x, i + j)));
    part.forEach((v, j) => (out[i + j] = v));
  }
  return out;
}

// ---------- listing (/latest cards) ----------
function parseCards(doc) {
  const out = [];
  for (const a of doc.querySelectorAll("a")) {
    const href = a.attr("href") || "";
    if (!/\/novel\/[^/?#]+\/?$/.test(href.replace(BASE, ""))) continue;
    const slug = slugFromHref(href);
    if (!slug) continue;
    const text = clean(a.text());
    if (!text) continue;

    // Card text: "<title> <status> <title> بقلم: ... <desc> <genre> <views> <chapters> 0 آخر تحديث: ..."
    const st = text.match(/^(.*?)\s+(مستمرة|مكتملة|متوقفة)\s/);
    let title = st ? clean(st[1]) : "";
    const h = a.querySelector("h2") || a.querySelector("h3") || a.querySelector("h4");
    if (h && clean(h.text())) title = clean(h.text());
    if (!title) continue;

    let cover;
    const img = a.querySelector("img");
    if (img) cover = abs(img.attr("src") || img.attr("data-src"));

    const nums = text.match(/([\d.,]+[كK]?)\s+(\d+)\s+\d+\s+آخر تحديث/);
    const desc = text.match(/بقلم:\s*[^]*$/);
    out.push({
      id: slug,
      title,
      cover,
      status: statusOf(text),
      trendingScore: nums ? parseCount(nums[1]) : undefined,
      chapters: nums ? Number(nums[2]) || undefined : undefined,
      description: undefined,
      siteUrl: `${BASE}/novel/${slug}`,
      _desc: desc ? desc[0] : undefined,
    });
  }
  // keep first occurrence of each id (cards can wrap the same link twice)
  const seen = {};
  return out.filter((x) => (seen[x.id] ? false : (seen[x.id] = true)))
            .map(({ _desc, ...rest }) => rest);
}

async function latestPage(page) {
  const doc = await getHtml(`${BASE}/latest${page > 1 ? "?page=" + page : ""}`);
  return parseCards(doc);
}

let indexCache = null;
async function fullIndex() {
  if (indexCache) return indexCache;
  const first = await getHtml(`${BASE}/latest`);
  let last = 1;
  for (const a of first.querySelectorAll("a")) {
    const m = (a.attr("href") || "").match(/latest\?page=(\d+)/);
    if (m) last = Math.max(last, Number(m[1]));
  }
  const rest = [];
  for (let p = 2; p <= last; p++) rest.push(p);
  const pages = await mapLimit(rest, (p) => latestPage(p).catch(() => []));
  indexCache = [parseCards(first), ...pages].flat();
  return indexCache;
}

// ---------- provider ----------
const provider = {
  id: "riwayatarab",
  name: "رواياتعرب",

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return latestPage(page);
  },

  async search(query, offset) {
    const q = normAr(query);
    if (!q) return provider.popular(offset);
    const words = q.split(" ");
    const hits = (await fullIndex()).filter((n) => {
      const t = normAr(n.title);
      return words.every((w) => t.includes(w));
    });
    return hits.slice(offset, offset + PAGE_SIZE);
  },

  async detail(id) {
    const doc = await getHtml(`${BASE}/novel/${id}`);
    const root = doc.querySelector("main") || doc.querySelector("body") || doc;
    const text = clean(root.text());
    const h1 = doc.querySelector("h1");
    const title = h1 ? clean(h1.text()) : "";
    if (!title) return null;

    let cover;
    for (const img of doc.querySelectorAll("img")) {
      const src = abs(img.attr("src") || img.attr("data-src"));
      if (src && /\/covers\//.test(src)) { cover = src; break; }
    }

    const author = (text.match(/بقلم:\s*(.+?)\s+[\d.,]+[كK]?\s*مشاهدة/) || [])[1];
    const desc = (text.match(/نبذة عن الرواية\s*(.*?)\s*قائمة الفصول/) || [])[1];
    const genres = [];
    for (const a of doc.querySelectorAll("a")) {
      if (/[?&]category=/.test(a.attr("href") || "")) {
        const g = clean(a.text());
        if (g && !genres.includes(g)) genres.push(g);
      }
    }
    const chapters = Number((text.match(/(\d+)\s*فصل/) || [])[1]) || undefined;
    const views = parseCount((text.match(/([\d.,]+[كK]?)\s*مشاهدة/) || [])[1]);

    return {
      id,
      title,
      cover,
      author: author && !/غير محدد/.test(author) ? clean(author) : undefined,
      description: desc ? clean(stripInline(desc)) : undefined,
      status: statusOf(text.slice(0, 200)),
      genres: genres.length ? genres : undefined,
      chapters,
      trendingScore: views,
      originalLanguage: "ar",
      siteUrl: `${BASE}/novel/${id}`,
    };
  },

  async chapters(id) {
    const base = `${BASE}/novel/${id}/chapters`;
    const first = await getHtml(base);
    const firstText = clean((first.querySelector("main") || first.querySelector("body") || first).text());
    let pages = Number((firstText.match(/الصفحة\s*\d+\s*من\s*(\d+)/) || [])[1]) || 1;

    const parse = (doc) => {
      const rows = [];
      for (const a of doc.querySelectorAll("a")) {
        const href = a.attr("href") || "";
        const m = href.match(/\/novel\/[^/?#]+\/chapter\/([^/?#]+)/);
        if (!m) continue;
        const t = clean(a.text());
        // "الفصل 1الفصل 1 481" -> trailing number is the view count
        const v = t.match(/\s(\d+)$/);
        rows.push({ num: decodeURIComponent(m[1]), views: v ? Number(v[1]) : undefined });
      }
      return rows;
    };

    const nums = [];
    for (let p = 2; p <= pages; p++) nums.push(p);
    const others = await mapLimit(nums, async (p) => parse(await getHtml(`${base}?page=${p}`)));
    const all = [...parse(first), ...others.flat()]; // server order, ascending

    return all.map((r, i) => ({
      id: `${id}/${r.num}`,
      chapter: r.num,
      title: `الفصل ${r.num}`,
      position: i,
      views: r.views,
    }));
  },

  async content(chapterId) {
    const [slug, num] = chapterId.split("/");
    const doc = await getHtml(`${BASE}/novel/${slug}/chapter/${num}`);

    const toLines = (el) => {
      const ps = el.querySelectorAll("p");
      const raw = ps.length >= 2
        ? ps.map((p) => p.text())
        : String(el.text()).split(/\r?\n+/);
      return raw.map((l) => clean(stripInline(l))).filter((l) => l && !isSpamLine(l));
    };

    // Score every plausible container by how much real chapter text it yields,
    // then take the best one (the narrowest wins ties via smaller raw length).
    let best = [], bestScore = 0, bestRaw = Infinity;
    const sels = ["article", "main", "section", "div"];
    for (const sel of sels) {
      for (const el of doc.querySelectorAll(sel)) {
        const raw = clean(el.text()).length;
        if (raw < 200) continue;
        const lines = toLines(el);
        const score = lines.join("").length;
        if (score > bestScore * 1.02 || (score >= bestScore * 0.98 && score > 0 && raw < bestRaw)) {
          best = lines; bestScore = score; bestRaw = raw;
        }
      }
    }

    // Trim page chrome that can sit inside the container.
    const t = clean(doc.querySelector("h1") ? doc.querySelector("h1").text() : "");
    best = best.filter((l) => l !== t && !/^(رواياتعرب|الرئيسية|البحث|تسجيل الدخول|إنشاء حساب)$/.test(l)
      && !/عرض قائمة الفصول|جميع الحقوق محفوظة|موقعك المفضل لقراءة/.test(l));

    // Document order preserved: no sort/reverse/dedupe.
    return { text: best.join("\n\n") };
  },
};

harbor.register(provider);
