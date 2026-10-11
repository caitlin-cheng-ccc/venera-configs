/** @type {import('./_venera_.js')} */

class Mh160 extends ComicSource {
    // name of the source
    name = "漫画160"

    // unique id of the source
    key = "mh160"

    version = "1.0.0"

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
        if (res.status === 403 && /Just a moment|challenge-platform|cf_chl/.test(res.body)) {
            throw "Cloudflare 验证拦截：请通过应用内的 Cloudflare 验证后重试";
        }
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
    }

    /**
     * @param url {string}
     * @returns {Promise<HtmlDocument>}
     */
    async getHtml(url) {
        const res = await Network.get(url, this.headers);
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
            const doc = await this.getHtml(url);
            return {
                comics: this.parseList(doc),
                maxPage: this.parseMaxPage(doc, page),
            };
        },
    }

    /// search related
    search = {
        load: async (keyword, options, page) => {
            // search is behind Cloudflare; the app's built-in verification
            // flow is needed the first time
            let url = `${this.baseUrl}/statics/search.aspx?key=${encodeURIComponent(keyword)}`;
            if (page > 1) {
                url += `&page=${page}`;
            }
            const doc = await this.getHtml(url);
            return {
                comics: this.parseList(doc),
                maxPage: this.parseMaxPage(doc, page),
            };
        },

        // enable tags suggestions
        enableTagsSuggestions: false,
    }

    /// single comic related
    comic = {
        loadInfo: async (id) => {
            const doc = await this.getHtml(`${this.baseUrl}/kanmanhua/${id}/`);

            const title = doc.querySelector(".mh-date-info-name h4").text.trim();
            const coverImg = doc.querySelector(".mh-date-bgpic img");
            const cover = coverImg ? coverImg.attributes["src"] : undefined;

            const descEl = doc.querySelector("#workint");
            let description = descEl ? descEl.text.trim() : "";
            if (/^\.*$/.test(description)) {
                description = undefined;
            }

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

            // each list is newest-first; reverse into reading order.
            // Chapter ids are numeric, so a plain object would reorder them
            // by id; a Map keeps the site's order.
            const chapters = new Map();
            for (let ul of doc.querySelectorAll(".cy_plist ul")) {
                const links = ul.querySelectorAll("a").reverse();
                for (let a of links) {
                    const m = (a.attributes["href"] || "").match(/\/(\d+)\.html/);
                    if (!m) {
                        continue;
                    }
                    chapters.set(m[1], a.text.trim());
                }
            }

            const updateEl = doc.querySelector(".cy_zhangjie_top font");

            const relatedBlock = doc.querySelector(".mh-nlook");
            const recommend = relatedBlock
                ? this.parseRelated(relatedBlock).filter((c) => c.id !== id)
                : [];

            return new ComicDetails({
                title: title,
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                updateTime: updateEl ? updateEl.text.trim() : undefined,
                recommend: recommend,
                url: `${this.baseUrl}/kanmanhua/${id}/`,
            });
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
