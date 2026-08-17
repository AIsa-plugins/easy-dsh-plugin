import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { isIP } from "node:net";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/config.ts
const DEFAULT_BASE_URL = "https://api.aisa.one";
const DEFAULT_API_KEY_ENV = "AISA_API_KEY";
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
const MAX_REQUEST_TIMEOUT_MS = 12e4;
const Config = z.object({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseUrl: z.string().default(DEFAULT_BASE_URL),
	requestTimeoutMs: z.number().step(1).min(1).max(MAX_REQUEST_TIMEOUT_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
	maxResponseBytes: z.number().step(1).min(1).max(20971520).default(5242880),
	defaultMaxResults: z.number().step(1).min(1).max(20).default(5),
	maxResults: z.number().step(1).min(1).max(20).default(10),
	maxSnippetChars: z.number().step(1).min(100).max(1e4).default(1200),
	maxExtractChars: z.number().step(1).min(1e3).max(1e6).default(1e5)
});
function integerBetween(name, value, minimum, maximum) {
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		const range = String(minimum) + " and " + String(maximum);
		throw new Error("easy-search: " + name + " must be an integer between " + range);
	}
	return value;
}
function origin(value) {
	if (!URL.canParse(value)) throw new Error("easy-search: baseUrl must be an HTTP(S) origin");
	const url = new URL(value);
	const hasRootOnly = url.pathname === "/" && url.search === "" && url.hash === "";
	if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || !hasRootOnly) throw new Error("easy-search: baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment");
	return url.origin;
}
function resolveConfig(config = {}) {
	const resolved = {
		apiKeyEnv: config.apiKeyEnv ?? "AISA_API_KEY",
		baseUrl: origin(config.baseUrl ?? "https://api.aisa.one"),
		requestTimeoutMs: integerBetween("requestTimeoutMs", config.requestTimeoutMs ?? 3e4, 1, MAX_REQUEST_TIMEOUT_MS),
		maxResponseBytes: integerBetween("maxResponseBytes", config.maxResponseBytes ?? 5242880, 1, 20971520),
		defaultMaxResults: integerBetween("defaultMaxResults", config.defaultMaxResults ?? 5, 1, 20),
		maxResults: integerBetween("maxResults", config.maxResults ?? 10, 1, 20),
		maxSnippetChars: integerBetween("maxSnippetChars", config.maxSnippetChars ?? 1200, 100, 1e4),
		maxExtractChars: integerBetween("maxExtractChars", config.maxExtractChars ?? 1e5, 1e3, 1e6)
	};
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(resolved.apiKeyEnv)) throw new Error("easy-search: apiKeyEnv must be a POSIX environment-variable name");
	if (resolved.defaultMaxResults > resolved.maxResults) throw new Error("easy-search: defaultMaxResults cannot exceed maxResults");
	return resolved;
}
//#endregion
//#region src/client.ts
const USER_AGENT = "deepseek-harness/easy-search/0.1.0";
var AisaHttpError = class extends Error {
	status;
	requestId;
	constructor(status, requestId) {
		super("AIsa request failed with HTTP status " + String(status));
		this.name = "AisaHttpError";
		this.status = status;
		if (requestId !== void 0) this.requestId = requestId;
	}
};
var AisaClient = class {
	options;
	fetchImpl;
	constructor(options) {
		this.options = options;
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
	}
	async start() {
		const config = this.options.config();
		const apiKey = (await this.options.resolveApiKey(config.apiKeyEnv))?.trim();
		if (!apiKey) throw new Error("AIsa credential " + config.apiKeyEnv + " is not configured");
		return new AisaOperation(config, apiKey, this.fetchImpl);
	}
};
var AisaOperation = class {
	config;
	apiKey;
	fetchImpl;
	constructor(config, apiKey, fetchImpl) {
		this.config = config;
		this.apiKey = apiKey;
		this.fetchImpl = fetchImpl;
	}
	searchWeb(request, signal) {
		return this.request("/apis/v1/tavily/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: request.query,
				search_depth: request.searchDepth,
				max_results: request.maxResults,
				include_answer: true,
				include_raw_content: false,
				include_images: false,
				...request.country === void 0 ? {} : { country: request.country }
			})
		}, signal);
	}
	searchX(request, signal) {
		const query = new URLSearchParams({
			query: request.query,
			queryType: request.order
		});
		return this.request("/apis/v1/twitter/tweet/advanced_search?" + query.toString(), { method: "GET" }, signal);
	}
	searchYouTube(request, signal) {
		const query = new URLSearchParams({
			engine: "youtube",
			q: request.query
		});
		if (request.region !== void 0) query.set("gl", request.region.toLowerCase());
		if (request.language !== void 0) query.set("hl", request.language);
		return this.request("/apis/v1/youtube/search?" + query.toString(), { method: "GET" }, signal);
	}
	searchScholar(request, signal) {
		const query = new URLSearchParams({
			query: request.query,
			max_num_results: String(request.maxResults)
		});
		if (request.yearFrom !== void 0) query.set("as_ylo", String(request.yearFrom));
		if (request.yearTo !== void 0) query.set("as_yhi", String(request.yearTo));
		return this.request("/apis/v1/scholar/search/web?" + query.toString(), { method: "POST" }, signal);
	}
	extract(urls, depth, signal) {
		return this.request("/apis/v1/tavily/extract", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				urls,
				extract_depth: depth,
				include_images: false,
				format: "markdown"
			})
		}, signal);
	}
	async request(path, init, parentSignal) {
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		headers.set("Authorization", "Bearer " + this.apiKey);
		headers.set("User-Agent", USER_AGENT);
		const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(this.config.requestTimeoutMs)]);
		const response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
			...init,
			headers,
			signal
		});
		const requestId = response.headers.get("x-request-id") ?? void 0;
		const text = await readText(response, this.config.maxResponseBytes);
		if (!response.ok) throw new AisaHttpError(response.status, requestId);
		if (text.length === 0) throw new Error("AIsa returned an empty response");
		return {
			data: JSON.parse(text),
			...requestId === void 0 ? {} : { requestId }
		};
	}
};
async function readText(response, maxBytes) {
	const declared = response.headers.get("content-length");
	if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) throw new Error("AIsa response exceeded " + String(maxBytes) + " bytes");
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		total += chunk.value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("AIsa response exceeded " + String(maxBytes) + " bytes");
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
//#endregion
//#region src/normalize.ts
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("AIsa returned an invalid " + label);
	return value;
}
function optionalObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function array(value, label) {
	if (!Array.isArray(value)) throw new Error("AIsa returned an invalid " + label);
	return value;
}
function optionalArray(value, label) {
	return value === void 0 ? [] : array(value, label);
}
function string(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function requiredString(value, label) {
	const parsed = string(value);
	if (parsed === void 0) throw new Error("AIsa returned an invalid " + label);
	return parsed;
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function integer(value) {
	return typeof value === "number" && Number.isInteger(value) ? value : void 0;
}
function requestId(body, response) {
	return body ?? response.requestId;
}
function snippet(value, maximum) {
	const parsed = string(value);
	if (parsed === void 0) return void 0;
	return parsed.length <= maximum ? parsed : parsed.slice(0, maximum) + "...";
}
function result(source, kind, title, url, fields) {
	return {
		source,
		kind,
		title,
		url,
		...fields
	};
}
function normalizeWeb(response, maxResults, config) {
	const root = object(response.data, "Tavily search response");
	const raw = array(root.results, "Tavily results");
	const results = raw.slice(0, maxResults).map((value, index) => {
		const item = object(value, "Tavily result #" + String(index + 1));
		const content = snippet(item.content, config.maxSnippetChars);
		const score = number(item.score);
		return result("web", "page", requiredString(item.title, "Tavily result title"), requiredString(item.url, "Tavily result URL"), {
			...content === void 0 ? {} : { snippet: content },
			...score === void 0 ? {} : { score }
		});
	});
	const answer = string(root.answer);
	const id = requestId(string(root.request_id), response);
	return {
		source: "web",
		results,
		truncated: raw.length > maxResults,
		...id === void 0 ? {} : { requestId: id },
		...answer === void 0 ? {} : { answer }
	};
}
function xMetrics(item) {
	const likes = integer(item.likeCount);
	const replies = integer(item.replyCount);
	const reposts = integer(item.retweetCount);
	const quotes = integer(item.quoteCount);
	const views = integer(item.viewCount);
	const metrics = {
		...likes === void 0 ? {} : { likes },
		...replies === void 0 ? {} : { replies },
		...reposts === void 0 ? {} : { reposts },
		...quotes === void 0 ? {} : { quotes },
		...views === void 0 ? {} : { views }
	};
	return Object.keys(metrics).length === 0 ? void 0 : metrics;
}
function xAuthor(value) {
	const author = optionalObject(value);
	if (author === void 0) return void 0;
	const name = string(author.name);
	const username = string(author.userName);
	if (name !== void 0 && username !== void 0) return name + " (@" + username + ")";
	return name ?? (username === void 0 ? void 0 : "@" + username);
}
function normalizeX(response, maxResults, config) {
	const root = object(response.data, "X search response");
	const raw = array(root.tweets, "X tweets");
	return {
		source: "x",
		results: raw.slice(0, maxResults).map((value, index) => {
			const item = object(value, "X post #" + String(index + 1));
			const author = xAuthor(item.author);
			const metrics = xMetrics(item);
			const text = snippet(item.text, config.maxSnippetChars);
			const publishedAt = string(item.createdAt);
			return result("x", "post", author ?? "X post", requiredString(item.url, "X post URL"), {
				...text === void 0 ? {} : { snippet: text },
				...publishedAt === void 0 ? {} : { publishedAt },
				...author === void 0 ? {} : { author },
				...metrics === void 0 ? {} : { metrics }
			});
		}),
		truncated: root.has_next_page === true || raw.length > maxResults,
		...response.requestId === void 0 ? {} : { requestId: response.requestId }
	};
}
function youtubeAuthor(value) {
	return string(optionalObject(value)?.name);
}
function youtubeVideo(value, index, config) {
	const item = object(value, "YouTube video #" + String(index + 1));
	const views = integer(item.views);
	const author = youtubeAuthor(item.channel);
	const description = snippet(item.description, config.maxSnippetChars);
	const publishedAt = string(item.published_time);
	return {
		position: integer(item.position) ?? Number.MAX_SAFE_INTEGER,
		result: result("youtube", "video", requiredString(item.title, "YouTube video title"), requiredString(item.link, "YouTube video URL"), {
			...description === void 0 ? {} : { snippet: description },
			...publishedAt === void 0 ? {} : { publishedAt },
			...author === void 0 ? {} : { author },
			...views === void 0 ? {} : { metrics: { views } }
		})
	};
}
function youtubeCollection(value, index, kind, config) {
	const item = object(value, "YouTube " + kind + " #" + String(index + 1));
	const description = snippet(item.description, config.maxSnippetChars);
	return {
		position: integer(item.position) ?? Number.MAX_SAFE_INTEGER,
		result: result("youtube", kind, requiredString(item.title, "YouTube " + kind + " title"), requiredString(item.link, "YouTube " + kind + " URL"), { ...description === void 0 ? {} : { snippet: description } })
	};
}
function normalizeYouTube(response, maxResults, config) {
	const root = object(response.data, "YouTube search response");
	const videos = optionalArray(root.videos, "YouTube videos").map((value, index) => youtubeVideo(value, index, config));
	const channels = optionalArray(root.channels, "YouTube channels").map((value, index) => youtubeCollection(value, index, "channel", config));
	const playlists = optionalArray(root.playlists, "YouTube playlists").map((value, index) => youtubeCollection(value, index, "playlist", config));
	const ranked = [
		...videos,
		...channels,
		...playlists
	].sort((left, right) => left.position - right.position);
	const metadata = optionalObject(root.search_metadata);
	const pagination = optionalObject(root.pagination);
	const id = requestId(string(metadata?.id), response);
	return {
		source: "youtube",
		results: ranked.slice(0, maxResults).map((entry) => entry.result),
		truncated: ranked.length > maxResults || string(pagination?.next_page_token) !== void 0,
		...id === void 0 ? {} : { requestId: id }
	};
}
function normalizeScholar(response, maxResults, config) {
	const root = object(response.data, "Scholar search response");
	const raw = array(root.results, "Scholar results");
	const results = raw.slice(0, maxResults).map((value, index) => {
		const item = object(value, "Scholar result #" + String(index + 1));
		const summary = snippet(item.snippet, config.maxSnippetChars);
		const publishedAt = string(item.published_date);
		return result("scholar", "page", requiredString(item.title, "Scholar result title"), requiredString(item.link, "Scholar result URL"), {
			...summary === void 0 ? {} : { snippet: summary },
			...publishedAt === void 0 ? {} : { publishedAt }
		});
	});
	const id = requestId(string(root.id), response);
	return {
		source: "scholar",
		results,
		truncated: raw.length > maxResults,
		...id === void 0 ? {} : { requestId: id }
	};
}
function extractedDocument(value, index, config) {
	const item = object(value, "Tavily extract result #" + String(index + 1));
	const content = requiredString(item.raw_content, "Tavily extracted content");
	const truncated = content.length > config.maxExtractChars;
	const title = string(item.title);
	return {
		url: requiredString(item.url, "Tavily extracted URL"),
		content: truncated ? content.slice(0, config.maxExtractChars) : content,
		truncated,
		...title === void 0 ? {} : { title }
	};
}
function normalizeExtract(response, config) {
	const root = object(response.data, "Tavily extract response");
	const documents = array(root.results, "Tavily extract results").map((value, index) => extractedDocument(value, index, config));
	const failures = array(root.failed_results, "Tavily failed results").map((value, index) => ({
		url: requiredString(value, "Tavily failed URL #" + String(index + 1)),
		error: "AIsa could not extract this URL"
	}));
	const id = requestId(string(root.request_id), response);
	return {
		documents,
		failures,
		...id === void 0 ? {} : { requestId: id }
	};
}
//#endregion
//#region src/types.ts
const SEARCH_SOURCES = [
	"web",
	"x",
	"youtube",
	"scholar"
];
const WEB_DEPTHS = [
	"basic",
	"advanced",
	"fast",
	"ultra-fast"
];
const X_ORDERS = ["Latest", "Top"];
//#endregion
//#region src/search.ts
function optionalText(value) {
	const trimmed = value?.trim();
	return trimmed === void 0 || trimmed.length === 0 ? void 0 : trimmed;
}
function year(name, value) {
	if (value === void 0) return void 0;
	if (!Number.isInteger(value) || value < 1900 || value > 2030) throw new Error(name + " must be an integer between 1900 and 2030");
	return value;
}
function parseSearchOptions(options, config) {
	const query = options.query.trim();
	if (query.length === 0) throw new Error("query must not be blank");
	const sources = [...new Set(options.sources)];
	if (sources.length === 0) throw new Error("select at least one search source");
	if (!sources.every((source) => SEARCH_SOURCES.includes(source))) throw new Error("sources contains an unsupported search source");
	const maxResults = options.maxResults ?? config.defaultMaxResults;
	if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > config.maxResults) throw new Error("max_results must be an integer between 1 and " + String(config.maxResults));
	const webDepth = options.webDepth ?? "basic";
	if (!WEB_DEPTHS.includes(webDepth)) throw new Error("web_depth is unsupported");
	const xOrder = options.xOrder ?? "Latest";
	if (!X_ORDERS.includes(xOrder)) throw new Error("x_order is unsupported");
	const yearFrom = year("year_from", options.yearFrom);
	const yearTo = year("year_to", options.yearTo);
	if (yearFrom !== void 0 && yearTo !== void 0 && yearFrom > yearTo) throw new Error("year_from cannot be later than year_to");
	const webCountry = optionalText(options.webCountry);
	const youtubeRegion = optionalText(options.youtubeRegion);
	const youtubeLanguage = optionalText(options.youtubeLanguage);
	return {
		query,
		sources,
		maxResults,
		webDepth,
		xOrder,
		...webCountry === void 0 ? {} : { webCountry },
		...youtubeRegion === void 0 ? {} : { youtubeRegion },
		...youtubeLanguage === void 0 ? {} : { youtubeLanguage },
		...yearFrom === void 0 ? {} : { yearFrom },
		...yearTo === void 0 ? {} : { yearTo }
	};
}
function ipv4Private(hostname) {
	const parts = hostname.split(".").map(Number);
	const first = parts[0] ?? 0;
	const second = parts[1] ?? 0;
	return first === 0 || first === 10 || first === 127 || first === 100 && second >= 64 && second <= 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first === 198 && (second === 18 || second === 19) || first >= 224;
}
function mappedIpv4(address) {
	if (!address.startsWith("::ffff:")) return void 0;
	const suffix = address.slice(7);
	if (isIP(suffix) === 4) return suffix;
	const words = suffix.split(":");
	if (words.length !== 2 || !words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) return;
	const high = Number.parseInt(words[0] ?? "", 16);
	const low = Number.parseInt(words[1] ?? "", 16);
	return [
		high >>> 8,
		high & 255,
		low >>> 8,
		low & 255
	].join(".");
}
function ipPrivate(hostname) {
	const version = isIP(hostname);
	if (version === 4) return ipv4Private(hostname);
	if (version !== 6) return false;
	const address = hostname.toLowerCase();
	if (address === "::" || address === "::1") return true;
	if (address.startsWith("fc") || address.startsWith("fd")) return true;
	if (/^fe[89ab]/.test(address) || address.startsWith("ff")) return true;
	const mapped = mappedIpv4(address);
	return mapped !== void 0 && ipv4Private(mapped);
}
function publicUrl(raw) {
	if (!URL.canParse(raw)) throw new Error("extract URLs must be valid HTTP(S) URLs");
	const url = new URL(raw);
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("extract URLs must use HTTP or HTTPS");
	if (url.username !== "" || url.password !== "") throw new Error("credential-bearing extract URLs are not allowed");
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
	if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || ipPrivate(hostname)) throw new Error("local or private-network extract URLs are not allowed");
	return url.href;
}
function parseExtractOptions(options) {
	const urls = [...new Set(options.urls.map(publicUrl))];
	if (urls.length < 1 || urls.length > 3) throw new Error("provide between one and three public URLs");
	return {
		urls,
		depth: options.depth ?? "basic"
	};
}
function errorMessage(reason) {
	return reason instanceof Error ? reason.message : String(reason);
}
function successfulCoverage(result) {
	return {
		source: result.source,
		status: "ok",
		resultCount: result.results.length,
		...result.requestId === void 0 ? {} : { requestId: result.requestId }
	};
}
function failedCoverage(source, reason) {
	return {
		source,
		status: "error",
		resultCount: 0,
		error: errorMessage(reason)
	};
}
var EasySearchService = class {
	client;
	config;
	constructor(client, config) {
		this.client = client;
		this.config = config;
	}
	async search(options, signal) {
		const config = this.config();
		const input = parseSearchOptions(options, config);
		const operation = await this.client.start();
		const settled = await Promise.allSettled(input.sources.map((source) => this.searchSource(operation, source, input, signal, config)));
		const coverage = [];
		const results = [];
		let truncated = false;
		let answer;
		settled.forEach((outcome, index) => {
			const source = input.sources[index];
			if (source === void 0) return;
			if (outcome.status === "rejected") {
				coverage.push(failedCoverage(source, outcome.reason));
				return;
			}
			coverage.push(successfulCoverage(outcome.value));
			results.push(...outcome.value.results);
			truncated ||= outcome.value.truncated;
			answer ??= outcome.value.answer;
		});
		return {
			query: input.query,
			coverage,
			results,
			truncated,
			...answer === void 0 ? {} : { answer }
		};
	}
	async extract(options, signal) {
		const input = parseExtractOptions(options);
		return normalizeExtract(await (await this.client.start()).extract(input.urls, input.depth, signal), this.config());
	}
	async searchSource(operation, source, input, signal, config) {
		switch (source) {
			case "web": return normalizeWeb(await operation.searchWeb({
				query: input.query,
				searchDepth: input.webDepth,
				maxResults: input.maxResults,
				...input.webCountry === void 0 ? {} : { country: input.webCountry }
			}, signal), input.maxResults, config);
			case "x": return normalizeX(await operation.searchX({
				query: input.query,
				order: input.xOrder
			}, signal), input.maxResults, config);
			case "youtube": return normalizeYouTube(await operation.searchYouTube({
				query: input.query,
				...input.youtubeRegion === void 0 ? {} : { region: input.youtubeRegion },
				...input.youtubeLanguage === void 0 ? {} : { language: input.youtubeLanguage }
			}, signal), input.maxResults, config);
			case "scholar": return normalizeScholar(await operation.searchScholar({
				query: input.query,
				maxResults: input.maxResults,
				...input.yearFrom === void 0 ? {} : { yearFrom: input.yearFrom },
				...input.yearTo === void 0 ? {} : { yearTo: input.yearTo }
			}, signal), input.maxResults, config);
		}
	}
};
//#endregion
//#region src/tools.ts
const SEARCH_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		query: {
			type: "string",
			required: true
		},
		coverage: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					source: {
						type: "string",
						required: true,
						enum: [
							"web",
							"x",
							"youtube",
							"scholar"
						]
					},
					status: {
						type: "string",
						required: true,
						enum: ["ok", "error"]
					},
					resultCount: {
						type: "integer",
						required: true
					},
					requestId: { type: "string" },
					error: { type: "string" }
				}
			}
		},
		results: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					source: {
						type: "string",
						required: true,
						enum: [
							"web",
							"x",
							"youtube",
							"scholar"
						]
					},
					kind: {
						type: "string",
						required: true,
						enum: [
							"page",
							"post",
							"video",
							"channel",
							"playlist"
						]
					},
					title: {
						type: "string",
						required: true
					},
					url: {
						type: "string",
						required: true
					},
					snippet: { type: "string" },
					publishedAt: { type: "string" },
					author: { type: "string" },
					score: { type: "number" },
					metrics: {
						type: "object",
						additionalProperties: false,
						properties: {
							likes: { type: "integer" },
							replies: { type: "integer" },
							reposts: { type: "integer" },
							quotes: { type: "integer" },
							views: { type: "integer" }
						}
					}
				}
			}
		},
		truncated: {
			type: "boolean",
			required: true
		},
		answer: { type: "string" }
	}
};
const EXTRACT_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		documents: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					url: {
						type: "string",
						required: true
					},
					content: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					},
					title: { type: "string" }
				}
			}
		},
		failures: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					url: {
						type: "string",
						required: true
					},
					error: {
						type: "string",
						required: true
					}
				}
			}
		},
		requestId: { type: "string" }
	}
};
function inline(value) {
	return value.replace(/\s+/g, " ").trim();
}
function label(value) {
	return inline(value).replaceAll("[", "\\[").replaceAll("]", "\\]");
}
function resultLine(item, index) {
	const metadata = [
		item.source.toUpperCase(),
		item.author,
		item.publishedAt
	].filter((value) => value !== void 0);
	const suffix = metadata.length === 0 ? "" : " - " + metadata.join(" | ");
	const preview = item.snippet === void 0 ? "" : "\n   " + inline(item.snippet);
	return String(index + 1) + ". [" + label(item.title) + "](" + item.url + ")" + suffix + preview;
}
function formatSearchOutput(value) {
	const parts = [];
	if (value.answer !== void 0) parts.push(value.answer);
	if (value.results.length === 0) parts.push("No results found.");
	else parts.push("Sources:\n" + value.results.map(resultLine).join("\n"));
	const failures = value.coverage.filter((entry) => entry.status === "error");
	if (failures.length > 0) parts.push("Unavailable sources:\n" + failures.map((entry) => "- " + entry.source + ": " + (entry.error ?? "request failed")).join("\n"));
	if (value.truncated) parts.push("Some sources returned more results than the configured limit.");
	parts.push("Cite the relevant URLs above as markdown links in your answer.");
	return parts.join("\n\n");
}
function formatExtractOutput(value) {
	const parts = value.documents.map((document) => {
		const title = document.title ?? document.url;
		const note = document.truncated ? "\n\n(Content truncated by the configured output limit.)" : "";
		return "## [" + label(title) + "](" + document.url + ")\n\n" + document.content + note;
	});
	if (value.failures.length > 0) parts.push("## Failed URLs\n\n" + value.failures.map((failure) => "- [" + label(failure.url) + "](" + failure.url + "): " + failure.error).join("\n"));
	return parts.length === 0 ? "No content was extracted." : parts.join("\n\n");
}
function searchMeta(value) {
	return {
		sources: value.results.map((item) => ({
			url: item.url,
			title: item.title,
			...item.snippet === void 0 ? {} : { snippet: item.snippet },
			...item.publishedAt === void 0 ? {} : { publishedAt: item.publishedAt }
		})),
		truncated: value.truncated,
		...value.answer === void 0 ? {} : { answer: value.answer }
	};
}
function webSource(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const source = value;
	return typeof source.url === "string" && (source.title === void 0 || typeof source.title === "string") && (source.snippet === void 0 || typeof source.snippet === "string") && (source.publishedAt === void 0 || typeof source.publishedAt === "string");
}
function searchPresentation(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const meta = value;
	if (!Array.isArray(meta.sources) || !meta.sources.every(webSource)) return void 0;
	if (typeof meta.truncated !== "boolean") return void 0;
	if (meta.answer !== void 0 && typeof meta.answer !== "string") return void 0;
	return {
		sources: meta.sources,
		truncated: meta.truncated,
		...meta.answer === void 0 ? {} : { answer: meta.answer }
	};
}
function presentSearchCall(args) {
	return {
		card: "generic",
		kind: "search",
		title: args.query,
		rawInput: args.query
	};
}
function presentSearchResult(args, result) {
	if (result.isError) return void 0;
	const meta = searchPresentation(result.meta);
	if (meta === void 0) return void 0;
	return {
		card: "web",
		kind: "search",
		title: args.query,
		sources: meta.sources,
		truncated: meta.truncated,
		...meta.answer === void 0 ? {} : { answer: meta.answer }
	};
}
function extractMeta(value) {
	const [document] = value.documents;
	if (document === void 0 || value.documents.length !== 1) return {};
	return {
		url: document.url,
		statusCode: 200,
		truncated: document.truncated
	};
}
function presentExtractResult(result) {
	if (result.isError || typeof result.meta !== "object" || result.meta === null || Array.isArray(result.meta)) return;
	const meta = result.meta;
	if (typeof meta.url !== "string" || typeof meta.statusCode !== "number" || typeof meta.truncated !== "boolean") return;
	return {
		card: "web",
		kind: "fetch",
		title: meta.url,
		url: meta.url,
		statusCode: meta.statusCode,
		truncated: meta.truncated
	};
}
function createEasySearchTool(service) {
	return defineTool({
		name: "easy_search",
		description: "Search one topic across selected AIsa sources in parallel. Choose only the sources relevant to the question. Returns citeable URLs and per-source coverage.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "Focused search query."
			},
			sources: {
				type: "array",
				required: true,
				description: "One or more sources: web, x, youtube, scholar.",
				items: {
					type: "string",
					enum: [
						"web",
						"x",
						"youtube",
						"scholar"
					]
				}
			},
			max_results: {
				type: "integer",
				description: "Maximum results retained from each source."
			},
			web_depth: {
				type: "string",
				enum: [
					"basic",
					"advanced",
					"fast",
					"ultra-fast"
				],
				description: "Tavily depth. Defaults to basic; advanced costs more."
			},
			x_order: {
				type: "string",
				enum: ["Latest", "Top"],
				description: "X ordering. Defaults to Latest."
			},
			web_country: {
				type: "string",
				description: "Country name used to boost Tavily web results."
			},
			youtube_region: {
				type: "string",
				description: "Two-letter YouTube region code, such as us or jp."
			},
			youtube_language: {
				type: "string",
				description: "YouTube interface language, such as en or ja."
			},
			year_from: {
				type: "integer",
				description: "Scholar lower publication-year bound."
			},
			year_to: {
				type: "integer",
				description: "Scholar upper publication-year bound."
			}
		},
		output: {
			schema: SEARCH_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: formatSearchOutput(value)
			}],
			presentationMeta: (_args, value) => searchMeta(value)
		},
		timeoutMs: MAX_REQUEST_TIMEOUT_MS,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const outcome = await service.search({
				query: args.query,
				sources: args.sources,
				...args.max_results === void 0 ? {} : { maxResults: args.max_results },
				...args.web_depth === void 0 ? {} : { webDepth: args.web_depth },
				...args.x_order === void 0 ? {} : { xOrder: args.x_order },
				...args.web_country === void 0 ? {} : { webCountry: args.web_country },
				...args.youtube_region === void 0 ? {} : { youtubeRegion: args.youtube_region },
				...args.youtube_language === void 0 ? {} : { youtubeLanguage: args.youtube_language },
				...args.year_from === void 0 ? {} : { yearFrom: args.year_from },
				...args.year_to === void 0 ? {} : { yearTo: args.year_to }
			}, exec.signal);
			return {
				query: outcome.query,
				coverage: [...outcome.coverage],
				results: [...outcome.results],
				truncated: outcome.truncated,
				...outcome.answer === void 0 ? {} : { answer: outcome.answer }
			};
		},
		presentCall: presentSearchCall,
		presentResult: (args, result) => presentSearchResult(args, result)
	});
}
function createEasyExtractTool(service) {
	return defineTool({
		name: "easy_extract",
		description: "Extract clean markdown from one to three known public HTTP(S) URLs through AIsa. Use after search when full page content is needed.",
		parameters: {
			urls: {
				type: "array",
				required: true,
				description: "One to three public HTTP(S) URLs.",
				items: { type: "string" }
			},
			depth: {
				type: "string",
				enum: ["basic", "advanced"],
				description: "Extraction depth. Defaults to basic; advanced costs more."
			}
		},
		output: {
			schema: EXTRACT_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: formatExtractOutput(value)
			}],
			presentationMeta: (_args, value) => extractMeta(value)
		},
		timeoutMs: MAX_REQUEST_TIMEOUT_MS,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const outcome = await service.extract({
				urls: args.urls,
				...args.depth === void 0 ? {} : { depth: args.depth }
			}, exec.signal);
			return {
				documents: [...outcome.documents],
				failures: [...outcome.failures],
				...outcome.requestId === void 0 ? {} : { requestId: outcome.requestId }
			};
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "fetch",
			title: args.urls.length === 1 ? args.urls[0] ?? "Extract page" : "Extract " + String(args.urls.length) + " pages",
			rawInput: args.urls.join("\n")
		}),
		presentResult: (_args, result) => presentExtractResult(result)
	});
}
function registerEasySearchTools(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:easy-search",
		order: 112,
		text: "Use easy_search for current, source-grounded research across the open web, X, YouTube, and Scholar. Select only relevant sources. Use easy_extract for full content only when snippets are insufficient. Cite relevant returned URLs as markdown links."
	});
	ctx.tools.register(createEasySearchTool(service));
	ctx.tools.register(createEasyExtractTool(service));
}
//#endregion
//#region src/index.ts
const name = "easy-search";
const inject = [
	"credentials",
	"tools",
	"systemPrompt"
];
const EASY_SEARCH_SETTINGS_NAMESPACE = settingsNamespace("easy-search");
function apply(ctx, config = {}) {
	resolveConfig(config);
	let current = () => config;
	installSettingsSection(ctx, EASY_SEARCH_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
		validate: (value) => {
			resolveConfig(value);
		}
	});
	const resolved = () => resolveConfig(current());
	registerEasySearchTools(ctx, new EasySearchService(new AisaClient({
		config: resolved,
		resolveApiKey: async (reference) => (await ctx.credentials.resolve(credentialRef(reference)))?.value
	}), resolved));
}
//#endregion
export { Config, EASY_SEARCH_SETTINGS_NAMESPACE, EasySearchService, SEARCH_SOURCES, WEB_DEPTHS, X_ORDERS, apply, inject, name, parseExtractOptions, parseSearchOptions, publicUrl };

//# sourceMappingURL=index.js.map