/** @type {import('./_venera_.js')} */

class Rumanhua extends ComicSource {
    // name of the source
    name = "如漫画"

    // unique id of the source
    key = "rumanhua"

    version = "1.0.3"

    minAppVersion = "1.4.0"

    // update url
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/rumanhua.js"

    settings = {
        domain: {
            title: "域名",
            type: "input",
            // Note: www.rumanhua.com resolves but is behind a WAF that returns
            // HTTP 444 for every page. www.rumanhua2.com is the domain the site
            // itself actually links to (og:url, mobile_url, etc.) and is not
            // blocked, but its TLS certificate does not cover this hostname, so
            // it must be requested over plain http, not https (see baseUrl).
            default: "www.rumanhua2.com"
        }
    }

    get baseUrl() {
        return `http://${this.loadSetting("domain")}`;
    }

    get headers() {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": this.baseUrl + "/",
        };
    }

    /**
     * strip the leading/trailing slashes from a path like "/GZJwwGS/" -> "GZJwwGS"
     * @param href {string}
     * @returns {string}
     */
    parseId(href) {
        return href.replace(/^\/+|\/+$/g, "");
    }

    /**
     * parse a grid of comics, used on the home page ("item-data > .col-auto")
     * @param element {HtmlElement}
     * @returns {Comic[]}
     */
    parseGridList(element) {
        const comics = [];
        for (let item of element.querySelectorAll(".col-auto")) {
            const a = item.querySelector("a");
            const img = item.querySelector("img");
            const titleEl = item.querySelector(".e-title");
            const tipEl = item.querySelector(".tip");
            comics.push(new Comic({
                id: this.parseId(a.attributes["href"]),
                title: titleEl ? titleEl.text.trim() : "",
                subtitle: tipEl ? tipEl.text.trim() : undefined,
                cover: img.attributes["data-src"] || img.attributes["src"],
            }));
        }
        return comics;
    }

    /**
     * parse a list of comics rendered as ".likedata" blocks.
     * Used on category/rank/search pages and the "recommend" sidebar of the detail page.
     * @param element {HtmlElement}
     * @returns {Comic[]}
     */
    parseLikeList(element) {
        const comics = [];
        for (let item of element.querySelectorAll(".likedata")) {
            const a = item.querySelector(".likeimg a");
            const img = item.querySelector(".likeimg img");
            const titleEl = item.querySelector(".le-t");
            let subtitle;
            for (let p of item.querySelector(".likeinfo").querySelectorAll("p")) {
                const text = p.text.trim();
                if (text.startsWith("作")) {
                    subtitle = text.replace(/^作\s*者[：:]\s*/, "");
                    break;
                }
            }
            comics.push(new Comic({
                id: this.parseId(a.attributes["href"]),
                title: titleEl ? titleEl.text.trim() : "",
                subtitle: subtitle,
                cover: img.attributes["data-src"] || img.attributes["src"],
            }));
        }
        return comics;
    }

    /**
     * Chapter pages hide the image list behind an eval(function(p,a,c,k,e,d){...}(...))
     * "packer" blob. This reimplements the standard unpacking algorithm so the
     * plain (still further encrypted) script text can be read out of it.
     * @param html {string}
     * @returns {string|null}
     */
    unpackEval(html) {
        const marker = "eval(function(p,a,c,k,e,d)";
        const start = html.indexOf(marker);
        if (start === -1) {
            return null;
        }
        const bodyEnd = html.indexOf("}(", start);
        if (bodyEnd === -1) {
            return null;
        }

        function parseQuoted(s, idx) {
            const quote = s[idx];
            let j = idx + 1;
            let out = "";
            while (j < s.length) {
                if (s[j] === "\\") {
                    out += s[j + 1];
                    j += 2;
                    continue;
                }
                if (s[j] === quote) {
                    return { value: out, next: j + 1 };
                }
                out += s[j];
                j++;
            }
            throw "Unterminated string while unpacking chapter script";
        }

        const r1 = parseQuoted(html, bodyEnd + 2);
        const pString = r1.value;
        const rest = html.slice(r1.next);
        const numMatch = rest.match(/^,(\d+),(\d+),/);
        if (!numMatch) {
            throw "Failed to parse packer arguments";
        }
        const radix = parseInt(numMatch[1]);
        const count = parseInt(numMatch[2]);
        const r2 = parseQuoted(rest, numMatch[0].length);
        const words = r2.value.split("|");

        return this.unpackPacked(pString, radix, count, words);
    }

    /**
     * Standard "Dean Edwards packer" decoder.
     * @param payload {string}
     * @param radix {number}
     * @param count {number}
     * @param words {string[]}
     * @returns {string}
     */
    unpackPacked(payload, radix, count, words) {
        function toBase(c) {
            const left = c < radix ? "" : toBase(Math.floor(c / radix));
            const r = c % radix;
            const right = r > 35 ? String.fromCharCode(r + 29) : r.toString(36);
            return left + right;
        }
        const dict = {};
        for (let c = count - 1; c >= 0; c--) {
            dict[toBase(c)] = words[c] || toBase(c);
        }
        return payload.replace(/\b\w+\b/g, (w) => (dict[w] !== undefined ? dict[w] : w));
    }

    /**
     * @param bytes {Uint8Array}
     * @returns {string}
     */
    bytesToBinaryString(bytes) {
        const chunkSize = 0x2000;
        let result = "";
        for (let i = 0; i < bytes.length; i += chunkSize) {
            result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return result;
    }

    // The chapter reader picks one of 10 fixed salts using the reader
    // container's `data-id` (0-9). Each entry below is the *decoded*
    // plaintext salt (the page embeds them base64-encoded).
    imageSalts = ["smkhy258", "smkd95fv", "md496952", "cdcsdwq", "vbfsa256", "cawf151c", "cd56cvda", "8kihnt9", "dso15tlo", "5ko6plhy"]

    /**
     * Decrypt the image list embedded in a chapter page.
     * @param html {string}
     * @returns {string[]}
     */
    decryptImages(html) {
        const idMatch = html.match(/readerContainer[^>]*data-id="(\d+)"/);
        if (!idMatch) {
            throw "Failed to find reader container";
        }
        const salt = this.imageSalts[parseInt(idMatch[1])];
        if (!salt) {
            throw "Unknown image salt index";
        }

        const unpacked = this.unpackEval(html);
        if (!unpacked) {
            throw "Failed to find chapter script";
        }
        const cipherMatch = unpacked.match(/__c0rst96\s*=\s*"([^"]+)"/) || unpacked.match(/__c0rst96\s*=\s*'([^']+)'/);
        if (!cipherMatch) {
            throw "Failed to find encrypted image data";
        }

        const cipherBytes = new Uint8Array(Convert.decodeBase64(cipherMatch[1]));
        const xored = new Uint8Array(cipherBytes.length);
        for (let i = 0; i < cipherBytes.length; i++) {
            xored[i] = cipherBytes[i] ^ salt.charCodeAt(i % salt.length);
        }
        const jsonBuf = Convert.decodeBase64(this.bytesToBinaryString(xored));
        const jsonStr = Convert.decodeUtf8(jsonBuf);
        return JSON.parse(jsonStr);
    }

    // explore page list
    explore = [
        {
            title: "如漫画",

            type: "multiPartPage",

            load: async () => {
                const res = await Network.get(this.baseUrl, this.headers);
                if (res.status !== 200) {
                    throw `Invalid status code: ${res.status}`;
                }
                const doc = new HtmlDocument(res.body);
                const titles = doc.querySelectorAll(".view-item .item-title");
                const dataBlocks = doc.querySelectorAll(".view-item .item-data");
                const result = [];
                for (let i = 0; i < titles.length && i < dataBlocks.length; i++) {
                    result.push({
                        title: titles[i].text.replace(/\s+/g, ""),
                        comics: this.parseGridList(dataBlocks[i]),
                    });
                }
                return result;
            },
        }
    ]

    // categories
    category = {
        title: "如漫画",
        parts: [
            {
                name: "分类",
                type: "fixed",
                categories: ["冒险", "热血", "都市", "玄幻", "悬疑", "耽美", "恋爱", "生活", "搞笑", "穿越", "修真", "后宫", "女主", "古风", "连载", "完结"],
                itemType: "category",
                categoryParams: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"],
            }
        ],
        // enable ranking page
        enableRankingPage: false,
    }

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            if (page > 1) {
                // pagination scheme for this listing is not known; only the first page is available
                return { comics: [], maxPage: 1 };
            }
            const res = await Network.get(`${this.baseUrl}/sort/${param}`, this.headers);
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            }
            const doc = new HtmlDocument(res.body);
            return {
                comics: this.parseLikeList(doc),
                maxPage: 1,
            };
        },
    }

    /// search related
    search = {
        load: async (keyword, options, page) => {
            if (page > 1) {
                return { comics: [], maxPage: 1 };
            }
            const res = await Network.post(`${this.baseUrl}/s`, {
                ...this.headers,
                "content-type": "application/x-www-form-urlencoded;charset=utf-8",
            }, `k=${encodeURIComponent(keyword)}`);
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            }
            const doc = new HtmlDocument(res.body);
            return {
                // search results are rendered with the same grid markup as the
                // home page's sections (".col-auto"), not the ".likedata" markup
                // used by category listings
                comics: this.parseGridList(doc),
                maxPage: 1,
            };
        },

        // enable tags suggestions
        enableTagsSuggestions: false,
    }

    /// single comic related
    comic = {
        loadInfo: async (id) => {
            const res = await Network.get(`${this.baseUrl}/${id}/`, this.headers);
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            }
            const doc = new HtmlDocument(res.body);

            const title = doc.querySelector(".name_mh").text.trim();
            const coverImg = doc.querySelector(".mhcover img");
            const cover = coverImg.attributes["data-src"] || coverImg.attributes["src"];
            const descriptionEl = doc.querySelector(".content");
            const description = descriptionEl ? descriptionEl.text.trim() : undefined;

            const tags = {};
            for (let p of doc.querySelectorAll(".detinfo p")) {
                for (let span of p.querySelectorAll("span")) {
                    const text = span.text;
                    const idx = text.indexOf("：");
                    if (idx === -1) {
                        continue;
                    }
                    const label = text.slice(0, idx).replace(/\s+/g, "");
                    const value = text.slice(idx + 1).trim().split(/\s+/).filter((s) => s.length > 0);
                    if (label && value.length > 0) {
                        tags[label] = value;
                    }
                }
            }

            const chapters = {};
            for (let a of doc.querySelectorAll(".chapterlistload a")) {
                const href = a.attributes["href"];
                const epId = href.slice(href.lastIndexOf("/") + 1);
                const li = a.querySelector("li");
                chapters[epId] = li ? li.text.trim() : epId;
            }

            // Long-running series only render their newest ~20-30 chapters;
            // a "chaplist-more" button appears when the list was truncated.
            // The rest is fetched from /morechapter, which continues right
            // after the visible list with no overlap.
            if (doc.querySelector(".chaplist-more")) {
                try {
                    const moreRes = await Network.post(`${this.baseUrl}/morechapter`, {
                        ...this.headers,
                        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
                    }, `id=${encodeURIComponent(id)}`);
                    if (moreRes.status === 200) {
                        const moreData = JSON.parse(moreRes.body);
                        if (moreData.code === "200" && Array.isArray(moreData.data)) {
                            for (let ch of moreData.data) {
                                chapters[`${ch.chapterid}.html`] = ch.chaptername;
                            }
                        }
                    }
                } catch (_) {
                    // fall back to just the chapters already visible on the page
                }
            }

            // chapters are listed newest-first on the page; reverse for normal reading order
            const orderedChapters = {};
            for (let key of Object.keys(chapters).reverse()) {
                orderedChapters[key] = chapters[key];
            }

            const sidebar = doc.querySelector(".bk-r");
            const recommend = sidebar ? this.parseLikeList(sidebar) : [];

            return new ComicDetails({
                title: title,
                cover: cover,
                description: description,
                tags: tags,
                chapters: orderedChapters,
                recommend: recommend,
            });
        },

        loadEp: async (comicId, epId) => {
            const res = await Network.get(`${this.baseUrl}/${comicId}/${epId}`, this.headers);
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            }
            const images = this.decryptImages(res.body);
            return { images };
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
            domains: ["rumanhua.com", "www.rumanhua.com", "rumanhua2.com", "www.rumanhua2.com"],
            linkToId: (url) => {
                const m = url.match(/rumanhua2?\.com\/([^\/?#]+)/);
                return m ? m[1] : null;
            },
        },

        // enable tags translate
        enableTagsTranslate: false,
    }
}
