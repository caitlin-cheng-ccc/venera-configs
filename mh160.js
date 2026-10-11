/** @type {import('./_venera_.js')} */

class Mh160 extends ComicSource {
    // name of the source
    name = "漫画160"

    // unique id of the source
    key = "mh160"

    version = "1.0.1"

    minAppVersion = "1.4.0"

    // update url
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/mh160.js"

    settings = {
        domain: {
            title: "域名",
            type: "input",
            default: "www.mh160mh.com"
        }
    }

    get baseUrl() {
        return `https://${this.loadSetting("domain")}`;
    }

    // Only search is behind Cloudflare. "Logging in" opens a search page in
    // the in-app browser, which solves the challenge; the resulting
    // cf_clearance cookie is then used by Network requests (same approach as
    // mycomic.js).
    account = {
        loginWithWebview: {
            url: "https://www.mh160mh.com/statics/searchelxt1e1.aspx?key=%E6%96%97%E7%BD%97",
            checkStatus: (url, title) => {
                if (!url || !title) {
                    return false;
                }
                if (/moment|Cloudflare|challenge|请稍候/i.test(title)) {
                    return false;
                }
                return url.indexOf("mh160mh.com") !== -1;
            },
        },

        logout: () => {
            Network.deleteCookies(this.baseUrl);
        },

        registerWebsite: null,
    }

    // Pages, covers (p.miyeye.cn) and chapter images all reject requests
    // without a Referer from the site. No custom User-Agent is sent so that
    // the cf_clearance cookie obtained through the app's Cloudflare
    // verification (needed for search) stays valid.
    get headers() {
        return {
            "Referer": this.baseUrl + "/",
        };
    }

    // Image hosts used by the reader for chapters with p_id > 542724; older
    // chapters live on mhpic6. Mirrors f_qTcms_Pic_curUrl_realpic/gethost
    // in /template/skin1/css/d7s/js/show.20170501.js.
    imageHosts = ["mhpic5er.tgmhfc.uk", "mhpic789-5.tgmhfc.uk", "mhpic7fr.tgmhfc.uk", "mhpicwt.tgmhfc.uk", "mhpicwx.tgmhfc.uk"]
    legacyImageHost = "mhpic6.tgmhfc.uk"
    legacyImageMaxId = 542724

    // listings that only exist on the desktop site
    desktopOnlyLists = ["all", "allhit"]
    desktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

    // first path segments under /kanmanhua/ that are listings, not comics
    listingSlugs = ["all", "allhit", "html", "rexue", "gedou", "kehuan", "jingji", "gaoxiao", "tuili", "kongbu", "danmei", "shaonv", "lianai", "shenghuo", "zhanzheng", "gushi", "maoxian", "mohuan", "xuanhuan", "xiaoyuan", "xuanyi", "mengxi", "chuanyue", "hougong", "dushi", "wuxia", "lishi", "tongren"]

    /**
     * "/kanmanhua/28766/" -> "28766"
     * @param href {string}
     * @returns {string|null}
     */
    parseId(href) {
        const m = href.match(/\/kanmanhua\/([^\/?#]+)/);
        return m ? m[1] : null;
    }

    /**
     * @param res {{status: number, body: string}}
     */
    checkResponse(res) {
        if ((res.status === 403 || res.status === 503) && /Just a moment|challenge-platform|cf_chl/.test(res.body)) {
            throw "Cloudflare 验证拦截：请在漫画源设置中点击「登录」，在内置浏览器中完成一次 Cloudflare 验证后重试";
        }
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
    }

    /**
     * @param url {string}
     * @param extraHeaders {object?}
     * @returns {Promise<HtmlDocument>}
     */
    async getHtml(url, extraHeaders) {
        const res = await Network.get(url, { ...this.headers, ...extraHeaders });
        this.checkResponse(res);
        return new HtmlDocument(res.body);
    }

    /**
     * Parse cover tiles (".mh-works") used on the home page and the
     * "related comics" block of the detail page.
     * @param element {HtmlElement|HtmlDocument}
     * @returns {Comic[]}
     */
    parseWorks(element) {
        const comics = [];
        for (let item of element.querySelectorAll(".mh-works")) {
            const a = item.querySelector("a");
            const img = item.querySelector("img");
            if (!a || !img) {
                continue;
            }
            const id = this.parseId(a.attributes["href"] || "");
            if (!id) {
                continue;
            }
            const p = item.querySelector("p");
            comics.push(new Comic({
                id: id,
                title: a.attributes["title"] || img.attributes["alt"] || "",
                subtitle: p ? p.text.trim() : undefined,
                cover: img.attributes["src"],
            }));
        }
        return comics;
    }

    /**
     * Parse the list layout used by category, region and search result pages:
     * each comic is an <li> holding ".mh-worksbox" (cover) and ".mh-works-info".
     * @param element {HtmlElement|HtmlDocument}
     * @returns {Comic[]}
     */
    parseList(element) {
        const comics = [];
        for (let info of element.querySelectorAll(".mh-works-info")) {
            const li = info.parent;
            const a = info.querySelector(".mh-works-title h4 a");
            if (!li || !a) {
                continue;
            }
            const id = this.parseId(a.attributes["href"] || "");
            if (!id) {
                continue;
            }
            const img = li.querySelector(".mh-nlook-w img");
            const updateEl = li.querySelector(".cover-list-updata span");
            const authorEl = info.querySelector(".mh-works-tags em");
            const descEl = info.querySelector(".mh-works-decs");
            const desc = descEl ? descEl.text.trim() : "";
            comics.push(new Comic({
                id: id,
                title: a.text.trim(),
                subtitle: authorEl ? authorEl.text.trim() : undefined,
                cover: img ? img.attributes["src"] : undefined,
                tags: updateEl ? [updateEl.text.trim()] : undefined,
                // the site uses "..." for an empty description
                description: /^\.*$/.test(desc) ? undefined : desc,
            }));
        }
        return comics;
    }

    /**
     * Parse the mobile site's list layout ("#listbody li"). Cloudflare caches
     * the www -> m.mh160mh.com redirect it sends to mobile browsers and serves
     * it to everyone, so any listing may come back as the mobile page.
     * @param element {HtmlElement|HtmlDocument}
     * @returns {Comic[]}
     */
    parseMobileList(element) {
        const comics = [];
        for (let li of element.querySelectorAll("#listbody li")) {
            const a = li.querySelector("a.ImgA");
            const id = a ? this.parseId(a.attributes["href"] || "") : null;
            if (!id) {
                continue;
            }
            const img = a.querySelector("img");
            const titleEl = li.querySelector(".txtA");
            const infoEl = li.querySelector(".info");
            comics.push(new Comic({
                id: id,
                title: titleEl ? titleEl.text.trim() : "",
                subtitle: infoEl ? infoEl.text.trim() : undefined,
                cover: img ? img.attributes["src"] : undefined,
            }));
        }
        return comics;
    }

    /**
     * Parse a listing page in either the desktop or the mobile layout.
     * The mobile layout has no pager, so assume another page while results keep coming.
     * @param doc {HtmlDocument}
     * @param page {number}
     * @returns {{comics: Comic[], maxPage: number}}
     */
    parseListPage(doc, page) {
        const comics = this.parseList(doc);
        if (comics.length > 0) {
            return { comics, maxPage: this.parseMaxPage(doc, page) };
        }
        const mobile = this.parseMobileList(doc);
        return { comics: mobile, maxPage: mobile.length > 0 ? page + 1 : page };
    }

    /**
     * Read the last page number from the ".NewPages" pager.
     * On the last page there is no "尾页" link, so fall back to the largest
     * page number linked, or the current page.
     * @param doc {HtmlDocument}
     * @param page {number}
     * @returns {number}
     */
    parseMaxPage(doc, page) {
        let max = page;
        for (let a of doc.querySelectorAll(".NewPages a")) {
            const href = a.attributes["href"] || "";
            const m = href.match(/(\d+)\.html/) || href.match(/page=(\d+)/);
            if (m) {
                max = Math.max(max, parseInt(m[1]));
            }
        }
        return max;
    }

    /**
     * Extract `var name="value";` from a chapter page.
     * @param html {string}
     * @param name {string}
     * @returns {string}
     */
    getVar(html, name) {
        const m = html.match(new RegExp(`var ${name}\\s*=\\s*"([^"]*)"`));
        return m ? m[1] : "";
    }

    /**
     * Turn an image path from the chapter page into a full URL, following the
     * site's reader logic (f_qTcms_Pic_curUrl_realpic).
     * @param path {string}
     * @param ctx {{pId: number, host: string, mId: string, picIf: string, httpUrl: string}}
     * @returns {string}
     */
    buildImageUrl(path, ctx) {
        if (path.startsWith("/")) {
            const host = ctx.pId > this.legacyImageMaxId ? ctx.host : this.legacyImageHost;
            // paths contain raw Chinese characters
            return `https://${host}` + path.split("/").map((s) => encodeURIComponent(s)).join("/");
        }
        if (ctx.picIf !== "2") {
            // external image, proxied through the site
            let v = path.replace(/\?/g, "a1a1").replace(/&/g, "b1b1").replace(/%/g, "c1c1");
            return `${this.baseUrl}/statics/pic/?p=${escape(v)}&picid=${ctx.mId}&m_httpurl=${escape(ctx.httpUrl)}`;
        }
        return path.startsWith("//") ? "https:" + path : path;
    }

    /**
     * @param b64 {string}
     * @returns {string}
     */
    decodeBase64Utf8(b64) {
        return b64 ? Convert.decodeUtf8(Convert.decodeBase64(b64)) : "";
    }

    // explore page list
    explore = [
        {
            title: "漫画160",

            type: "multiPartPage",

            load: async () => {
                const doc = await this.getHtml(this.baseUrl + "/");
                const result = [];

                // "人气强档" tabs: 最新更新 / 热门漫画 / 推荐漫画
                const tabs = doc.querySelectorAll("#hotcomic li");
                const blocks = doc.querySelectorAll(".hotcomic-list");
                for (let i = 0; i < blocks.length; i++) {
                    const title = tabs[i] ? tabs[i].text.replace(/[\s\/]/g, "") : `人气强档${i + 1}`;
                    result.push({
                        title: title,
                        comics: this.parseWorks(blocks[i]),
                    });
                }

                // region sections, e.g. 日韩漫画 / 内地漫画
                for (let header of doc.querySelectorAll(".mh-comic-title")) {
                    const h4 = header.querySelector("h4");
                    const works = header.nextElementSibling;
                    if (!h4 || !works) {
                        continue;
                    }
                    const more = header.querySelector("a");
                    const moreId = more ? this.parseId(more.attributes["href"] || "") : null;
                    const comics = this.parseWorks(works);
                    if (comics.length === 0) {
                        continue;
                    }
                    const part = {
                        title: h4.text.trim(),
                        comics: comics,
                    };
                    if (moreId) {
                        part.viewMore = {
                            page: "category",
                            attributes: {
                                category: h4.text.trim(),
                                param: moreId,
                            },
                        };
                    }
                    result.push(part);
                }
                return result;
            },
        }
    ]

    // categories
    category = {
        title: "漫画160",
        parts: [
            {
                name: "列表",
                type: "fixed",
                categories: ["全部漫画", "热门人气"],
                itemType: "category",
                categoryParams: ["all", "allhit"],
            },
            {
                name: "地区",
                type: "fixed",
                categories: ["日韩", "内地", "港台", "欧美", "其他"],
                itemType: "category",
                categoryParams: ["zaixian_rhmh", "zaixian_dlmh", "zaixian_gtmh", "zaixian_ommh", "zaixian_qita"],
            },
            {
                name: "题材",
                type: "fixed",
                categories: ["热血", "格斗", "科幻", "竞技", "搞笑", "推理", "恐怖", "耽美", "少女", "恋爱", "生活", "战争", "故事", "冒险", "魔幻", "玄幻", "校园", "悬疑", "萌系", "穿越", "后宫", "都市", "武侠", "历史", "同人"],
                itemType: "category",
                categoryParams: ["rexue", "gedou", "kehuan", "jingji", "gaoxiao", "tuili", "kongbu", "danmei", "shaonv", "lianai", "shenghuo", "zhanzheng", "gushi", "maoxian", "mohuan", "xuanhuan", "xiaoyuan", "xuanyi", "mengxi", "chuanyue", "hougong", "dushi", "wuxia", "lishi", "tongren"],
            }
        ],
        // enable ranking page
        enableRankingPage: false,
    }

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            let url = `${this.baseUrl}/kanmanhua/${param}/`;
            if (page > 1) {
                url += `${page}.html`;
            }
            if (!this.desktopOnlyLists.includes(param)) {
                const doc = await this.getHtml(url);
                return this.parseListPage(doc, page);
            }
            // These lists don't exist on the mobile site, so a cached
            // www -> m. redirect would 404. The query string gives a cache key
            // no browser shares, and the desktop UA keeps the origin from
            // redirecting (these pages have no Cloudflare check).
            url = url.replace("://m.", "://www.");
            const doc = await this.getHtml(`${url}?desktop=1`, { "User-Agent": this.desktopUserAgent });
            return this.parseListPage(doc, page);
        },
    }

    /// search related
    search = {
        load: async (keyword, options, page) => {
            // search is behind Cloudflare: log in once (account below) to get
            // the cf_clearance cookie. The search form posts to this path;
            // the statics/search.aspx path in the mobile site's JS is a 404.
            let url = `${this.baseUrl}/statics/searchelxt1e1.aspx?key=${encodeURIComponent(keyword)}`;
            if (page > 1) {
                url += `&page=${page}`;
            }
            const doc = await this.getHtml(url);
            return this.parseListPage(doc, page);
        },

        // enable tags suggestions
        enableTagsSuggestions: false,
    }

    /// single comic related
    comic = {
        loadInfo: async (id) => {
            const doc = await this.getHtml(`${this.baseUrl}/kanmanhua/${id}/`);

            // Cloudflare may serve a cached redirect to the mobile site, so
            // the page can be in either layout
            let details;
            if (doc.querySelector(".mh-date-info-name h4")) {
                details = this.parseDesktopDetails(doc);
            } else if (doc.querySelector(".Introduct .sub_r")) {
                details = this.parseMobileDetails(doc);
            } else {
                throw "Failed to parse comic page";
            }
            details.recommend = details.recommend.filter((c) => c.id !== id);
            details.url = `${this.baseUrl}/kanmanhua/${id}/`;
            return new ComicDetails(details);
        },

        loadEp: async (comicId, epId) => {
            const res = await Network.get(`${this.baseUrl}/kanmanhua/${comicId}/${epId}.html`, this.headers);
            this.checkResponse(res);
            const html = res.body;

            const encoded = this.getVar(html, "qTcms_S_m_murl_e");
            if (!encoded) {
                throw "Failed to find image list";
            }
            const paths = this.decodeBase64Utf8(encoded).split("$qingtiandy$").filter((s) => s.length > 0);

            const ctx = {
                pId: parseInt(this.getVar(html, "qTcms_S_p_id")) || 0,
                // the reader picks one random host per page load
                host: this.imageHosts[Math.floor(Math.random() * this.imageHosts.length)],
                mId: this.getVar(html, "qTcms_S_m_id"),
                picIf: this.getVar(html, "qTcms_Pic_m_if"),
                httpUrl: this.decodeBase64Utf8(this.getVar(html, "qTcms_S_m_mhttpurl")),
            };

            return {
                images: paths.map((p) => this.buildImageUrl(p, ctx)),
            };
        },

        onImageLoad: (url) => {
            return {
                headers: this.headers,
            };
        },

        onThumbnailLoad: (url) => {
            return {
                headers: this.headers,
            };
        },

        link: {
            domains: ["www.mh160mh.com", "m.mh160mh.com", "mh160mh.com"],
            linkToId: (url) => {
                const m = url.match(/\/kanmanhua\/([^\/?#]+)/);
                if (!m || m[1].startsWith("zaixian_") || this.listingSlugs.includes(m[1])) {
                    return null;
                }
                return m[1];
            },
        },

        // enable tags translate
        enableTagsTranslate: false,
    }

    /**
     * Collect chapters from newest-first lists into reading order.
     * Chapter ids are numeric, so a plain object would reorder them by id;
     * a Map keeps the site's order.
     * @param doc {HtmlDocument}
     * @param listSelector {string}
     * @returns {Map<string, string>}
     */
    parseChapters(doc, listSelector) {
        const chapters = new Map();
        for (let ul of doc.querySelectorAll(listSelector)) {
            const links = ul.querySelectorAll("a").reverse();
            for (let a of links) {
                const m = (a.attributes["href"] || "").match(/\/(\d+)\.html/);
                if (!m) {
                    continue;
                }
                chapters.set(m[1], a.text.trim());
            }
        }
        return chapters;
    }

    /**
     * the site uses "..." for an empty description
     * @param el {HtmlElement|null}
     * @returns {string|undefined}
     */
    parseDescription(el) {
        const text = el ? el.text.trim() : "";
        return /^\.*$/.test(text) ? undefined : text;
    }

    /**
     * Detail page on www.mh160mh.com.
     * @param doc {HtmlDocument}
     */
    parseDesktopDetails(doc) {
        const coverImg = doc.querySelector(".mh-date-bgpic img");

        const tags = {};
        const authors = doc.querySelectorAll(".works-info-tc .one a").map((a) => a.text.trim()).filter((s) => s);
        if (authors.length > 0) {
            tags["作者"] = authors;
        }
        for (let span of doc.querySelectorAll(".works-info-tc span")) {
            const text = span.text.replace(/\s+/g, "");
            if (text.startsWith("状态：")) {
                tags["状态"] = [text.slice(3)];
            }
        }

        const updateEl = doc.querySelector(".cy_zhangjie_top font");
        const relatedBlock = doc.querySelector(".mh-nlook");

        return {
            title: doc.querySelector(".mh-date-info-name h4").text.trim(),
            cover: coverImg ? coverImg.attributes["src"] : undefined,
            description: this.parseDescription(doc.querySelector("#workint")),
            tags: tags,
            chapters: this.parseChapters(doc, ".cy_plist ul"),
            updateTime: updateEl ? updateEl.text.trim() : undefined,
            recommend: relatedBlock ? this.parseRelated(relatedBlock) : [],
        };
    }

    /**
     * Detail page on m.mh160mh.com. Info is a list of "标签：值" lines;
     * its "状态" line holds the latest chapter, not the status, so it is skipped.
     * @param doc {HtmlDocument}
     */
    parseMobileDetails(doc) {
        const coverImg = doc.querySelector("#Cover img");

        const tags = {};
        let updateTime;
        for (let p of doc.querySelectorAll(".sub_r .txtItme")) {
            const text = p.text.trim();
            const idx = text.indexOf("：");
            if (idx === -1) {
                continue;
            }
            const label = text.slice(0, idx).trim();
            const value = text.slice(idx + 1).trim();
            if (!value) {
                continue;
            }
            if (label === "作者" || label === "标签") {
                tags[label] = value.split(/\s+/);
            } else if (label === "时间") {
                updateTime = value;
            }
        }

        const recommend = [];
        for (let a of doc.querySelectorAll("#tjmanhua li a")) {
            const img = a.querySelector("img");
            const id = this.parseId(a.attributes["href"] || "");
            if (!img || !id) {
                continue;
            }
            recommend.push(new Comic({
                id: id,
                title: a.attributes["title"] || img.attributes["alt"] || "",
                cover: img.attributes["src"],
            }));
        }

        return {
            title: doc.querySelector(".sub_r .h1").text.trim(),
            cover: coverImg ? coverImg.attributes["src"] : undefined,
            description: this.parseDescription(doc.querySelector(".detailContent p")),
            tags: tags,
            chapters: this.parseChapters(doc, ".chapters ul"),
            updateTime: updateTime,
            recommend: recommend,
        };
    }

    /**
     * Parse the "相关的漫画" tiles on the detail page (".mh-nlook-w" + ".mh-works-txt").
     * @param element {HtmlElement}
     * @returns {Comic[]}
     */
    parseRelated(element) {
        const comics = [];
        for (let li of element.querySelectorAll("li")) {
            const a = li.querySelector(".mh-nlook-w a");
            const img = li.querySelector(".mh-nlook-w img");
            if (!a || !img) {
                continue;
            }
            const id = this.parseId(a.attributes["href"] || "");
            if (!id) {
                continue;
            }
            const p = li.querySelector(".mh-works-txt p");
            comics.push(new Comic({
                id: id,
                title: a.attributes["title"] || img.attributes["alt"] || "",
                subtitle: p ? p.text.trim() : undefined,
                cover: img.attributes["src"],
            }));
        }
        return comics;
    }
}
