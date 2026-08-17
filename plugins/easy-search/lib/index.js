import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { isIP } from "node:net";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/config.ts
const DEFAULT_AISA_BASE_URL = "https://api.aisa.one";
const ROUTING_MODES = [
	"aisa",
	"byok",
	"hybrid"
];
const DEFAULT_ROUTING_MODE = "aisa";
const DEFAULT_AISA_API_KEY_ENV = "AISA_API_KEY";
const DEFAULT_TAVILY_API_KEY_ENV = "TAVILY_API_KEY";
const DEFAULT_X_BEARER_TOKEN_ENV = "X_BEARER_TOKEN";
const DEFAULT_YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY";
const DEFAULT_SERPAPI_API_KEY_ENV = "SERPAPI_API_KEY";
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
const MAX_REQUEST_TIMEOUT_MS = 12e4;
const Config = z.object({
	routingMode: z.union(ROUTING_MODES).default(DEFAULT_ROUTING_MODE),
	aisaApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_AISA_API_KEY_ENV),
	aisaBaseUrl: z.string().default(DEFAULT_AISA_BASE_URL),
	tavilyApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_TAVILY_API_KEY_ENV),
	xBearerTokenEnv: z.string().role("credential-ref").default(DEFAULT_X_BEARER_TOKEN_ENV),
	youtubeApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_YOUTUBE_API_KEY_ENV),
	serpApiKeyEnv: z.string().role("credential-ref").default(DEFAULT_SERPAPI_API_KEY_ENV),
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
	if (!URL.canParse(value)) throw new Error("easy-search: aisaBaseUrl must be an HTTP(S) origin");
	const url = new URL(value);
	const hasRootOnly = url.pathname === "/" && url.search === "" && url.hash === "";
	if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || !hasRootOnly) throw new Error("easy-search: aisaBaseUrl must be an HTTP(S) origin without credentials, path, query, or fragment");
	return url.origin;
}
function resolveConfig(config = {}) {
	const resolved = {
		routingMode: config.routingMode ?? "aisa",
		credentials: {
			aisa: config.aisaApiKeyEnv ?? "AISA_API_KEY",
			tavily: config.tavilyApiKeyEnv ?? "TAVILY_API_KEY",
			x: config.xBearerTokenEnv ?? "X_BEARER_TOKEN",
			youtube: config.youtubeApiKeyEnv ?? "YOUTUBE_API_KEY",
			serpapi: config.serpApiKeyEnv ?? "SERPAPI_API_KEY"
		},
		aisaBaseUrl: origin(config.aisaBaseUrl ?? "https://api.aisa.one"),
		requestTimeoutMs: integerBetween("requestTimeoutMs", config.requestTimeoutMs ?? 3e4, 1, MAX_REQUEST_TIMEOUT_MS),
		maxResponseBytes: integerBetween("maxResponseBytes", config.maxResponseBytes ?? 5242880, 1, 20971520),
		defaultMaxResults: integerBetween("defaultMaxResults", config.defaultMaxResults ?? 5, 1, 20),
		maxResults: integerBetween("maxResults", config.maxResults ?? 10, 1, 20),
		maxSnippetChars: integerBetween("maxSnippetChars", config.maxSnippetChars ?? 1200, 100, 1e4),
		maxExtractChars: integerBetween("maxExtractChars", config.maxExtractChars ?? 1e5, 1e3, 1e6)
	};
	for (const [provider, reference] of Object.entries(resolved.credentials)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new Error("easy-search: " + provider + " credential must be a POSIX environment-variable name");
	if (resolved.defaultMaxResults > resolved.maxResults) throw new Error("easy-search: defaultMaxResults cannot exceed maxResults");
	return resolved;
}
//#endregion
//#region src/normalize.ts
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Upstream returned an invalid " + label);
	return value;
}
function optionalObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function array(value, label) {
	if (!Array.isArray(value)) throw new Error("Upstream returned an invalid " + label);
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
	if (parsed === void 0) throw new Error("Upstream returned an invalid " + label);
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
function normalizeTavilySearch(provider, response, maxResults, config) {
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
		provider,
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
function normalizeAisaX(response, maxResults, config) {
	const root = object(response.data, "X search response");
	const raw = array(root.tweets, "X tweets");
	return {
		provider: "aisa",
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
function normalizeAisaYouTube(response, maxResults, config) {
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
		provider: "aisa",
		source: "youtube",
		results: ranked.slice(0, maxResults).map((entry) => entry.result),
		truncated: ranked.length > maxResults || string(pagination?.next_page_token) !== void 0,
		...id === void 0 ? {} : { requestId: id }
	};
}
function normalizeAisaScholar(response, maxResults, config) {
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
		provider: "aisa",
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
function normalizeTavilyExtract(provider, response, config) {
	const root = object(response.data, "Tavily extract response");
	const documents = array(root.results, "Tavily extract results").map((value, index) => extractedDocument(value, index, config));
	const failures = array(root.failed_results, "Tavily failed results").map((value, index) => ({
		url: requiredString(value, "Tavily failed URL #" + String(index + 1)),
		error: provider + " could not extract this URL"
	}));
	const id = requestId(string(root.request_id), response);
	return {
		provider,
		documents,
		failures,
		...id === void 0 ? {} : { requestId: id }
	};
}
function xApiMetrics(value) {
	const raw = optionalObject(value);
	if (raw === void 0) return void 0;
	const likes = integer(raw.like_count);
	const replies = integer(raw.reply_count);
	const reposts = integer(raw.retweet_count);
	const quotes = integer(raw.quote_count);
	const views = integer(raw.impression_count);
	const metrics = {
		...likes === void 0 ? {} : { likes },
		...replies === void 0 ? {} : { replies },
		...reposts === void 0 ? {} : { reposts },
		...quotes === void 0 ? {} : { quotes },
		...views === void 0 ? {} : { views }
	};
	return Object.keys(metrics).length === 0 ? void 0 : metrics;
}
function xApiAuthor(user) {
	if (user === void 0) return void 0;
	const name = string(user.name);
	const username = string(user.username);
	if (name !== void 0 && username !== void 0) return name + " (@" + username + ")";
	return name ?? (username === void 0 ? void 0 : "@" + username);
}
function xPostUrl(id, user) {
	const username = string(user?.username);
	return "https://x.com/" + (username === void 0 ? "i/web" : encodeURIComponent(username)) + "/status/" + encodeURIComponent(id);
}
function normalizeXApi(response, maxResults, config) {
	const root = object(response.data, "X API search response");
	const raw = optionalArray(root.data, "X API posts");
	const includes = optionalObject(root.includes);
	const users = new Map(optionalArray(includes?.users, "X API users").map((value, index) => {
		const user = object(value, "X API user #" + String(index + 1));
		return [requiredString(user.id, "X API user id"), user];
	}));
	const results = raw.slice(0, maxResults).map((value, index) => {
		const item = object(value, "X API post #" + String(index + 1));
		const id = requiredString(item.id, "X API post id");
		const user = users.get(requiredString(item.author_id, "X API author id"));
		const author = xApiAuthor(user);
		const text = snippet(item.text, config.maxSnippetChars);
		const publishedAt = string(item.created_at);
		const metrics = xApiMetrics(item.public_metrics);
		return result("x", "post", author ?? "X post", xPostUrl(id, user), {
			...text === void 0 ? {} : { snippet: text },
			...publishedAt === void 0 ? {} : { publishedAt },
			...author === void 0 ? {} : { author },
			...metrics === void 0 ? {} : { metrics }
		});
	});
	const meta = optionalObject(root.meta);
	return {
		provider: "x",
		source: "x",
		results,
		truncated: raw.length > maxResults || string(meta?.next_token) !== void 0,
		...response.requestId === void 0 ? {} : { requestId: response.requestId }
	};
}
function youtubeApiUrl(id) {
	const kind = requiredString(id.kind, "YouTube API result kind");
	if (kind === "youtube#video") return {
		kind: "video",
		url: "https://www.youtube.com/watch?v=" + encodeURIComponent(requiredString(id.videoId, "YouTube video id"))
	};
	if (kind === "youtube#channel") return {
		kind: "channel",
		url: "https://www.youtube.com/channel/" + encodeURIComponent(requiredString(id.channelId, "YouTube channel id"))
	};
	if (kind === "youtube#playlist") return {
		kind: "playlist",
		url: "https://www.youtube.com/playlist?list=" + encodeURIComponent(requiredString(id.playlistId, "YouTube playlist id"))
	};
	throw new Error("Upstream returned an unsupported YouTube result kind");
}
function youtubeApiResult(value, index, config) {
	const item = object(value, "YouTube API result #" + String(index + 1));
	const id = object(item.id, "YouTube API result identity");
	const details = object(item.snippet, "YouTube API result snippet");
	const target = youtubeApiUrl(id);
	const description = snippet(details.description, config.maxSnippetChars);
	const publishedAt = string(details.publishedAt);
	const author = string(details.channelTitle);
	return result("youtube", target.kind, requiredString(details.title, "YouTube API result title"), target.url, {
		...description === void 0 ? {} : { snippet: description },
		...publishedAt === void 0 ? {} : { publishedAt },
		...author === void 0 ? {} : { author }
	});
}
function normalizeYouTubeApi(response, maxResults, config) {
	const root = object(response.data, "YouTube API search response");
	const raw = array(root.items, "YouTube API results");
	return {
		provider: "youtube",
		source: "youtube",
		results: raw.slice(0, maxResults).map((value, index) => youtubeApiResult(value, index, config)),
		truncated: raw.length > maxResults || string(root.nextPageToken) !== void 0,
		...response.requestId === void 0 ? {} : { requestId: response.requestId }
	};
}
function normalizeSerpApiScholar(response, maxResults, config) {
	const root = object(response.data, "SerpApi Scholar response");
	const raw = array(root.organic_results, "SerpApi Scholar results");
	const results = raw.slice(0, maxResults).map((value, index) => {
		const item = object(value, "SerpApi Scholar result #" + String(index + 1));
		const publication = optionalObject(item.publication_info);
		const summary = snippet(item.snippet, config.maxSnippetChars);
		const author = string(publication?.summary);
		return result("scholar", "page", requiredString(item.title, "SerpApi Scholar result title"), requiredString(item.link, "SerpApi Scholar result URL"), {
			...summary === void 0 ? {} : { snippet: summary },
			...author === void 0 ? {} : { author }
		});
	});
	const metadata = optionalObject(root.search_metadata);
	const pagination = optionalObject(root.serpapi_pagination);
	const id = requestId(string(metadata?.id), response);
	return {
		provider: "serpapi",
		source: "scholar",
		results,
		truncated: raw.length > maxResults || string(pagination?.next) !== void 0,
		...id === void 0 ? {} : { requestId: id }
	};
}
//#endregion
//#region src/types.ts
const PROVIDER_IDS = [
	"aisa",
	"tavily",
	"x",
	"youtube",
	"serpapi"
];
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
//#region src/providers/runtime.ts
var ProviderCredentialError = class extends Error {
	provider;
	reference;
	constructor(provider, reference) {
		super(provider + " credential " + reference + " is not configured");
		this.provider = provider;
		this.reference = reference;
		this.name = "ProviderCredentialError";
	}
};
var ProviderHttpError = class extends Error {
	provider;
	status;
	requestId;
	constructor(provider, status, requestId) {
		super(provider + " request failed with HTTP status " + String(status));
		this.provider = provider;
		this.status = status;
		this.name = "ProviderHttpError";
		if (requestId !== void 0) this.requestId = requestId;
	}
};
var ProviderDataError = class extends Error {
	provider;
	constructor(provider, message) {
		super(provider + " returned " + message);
		this.provider = provider;
		this.name = "ProviderDataError";
	}
};
function providerFromError(reason) {
	if (typeof reason !== "object" || reason === null || !("provider" in reason)) return void 0;
	const provider = reason.provider;
	return typeof provider === "string" && PROVIDER_IDS.includes(provider) ? provider : void 0;
}
var CredentialSnapshot = class {
	resolveCredential;
	values = /* @__PURE__ */ new Map();
	constructor(resolveCredential) {
		this.resolveCredential = resolveCredential;
	}
	resolve(reference) {
		const existing = this.values.get(reference);
		if (existing !== void 0) return existing;
		const pending = this.resolveCredential(reference).then((value) => {
			const trimmed = value?.trim();
			return trimmed === void 0 || trimmed.length === 0 ? void 0 : trimmed;
		});
		this.values.set(reference, pending);
		return pending;
	}
	async configured(reference) {
		return await this.resolve(reference) !== void 0;
	}
	async require(provider, reference) {
		const value = await this.resolve(reference);
		if (value === void 0) throw new ProviderCredentialError(provider, reference);
		return value;
	}
};
const USER_AGENT = "deepseek-harness/easy-search/0.2.0";
var JsonHttpClient = class {
	config;
	fetchImpl;
	constructor(config, fetchImpl) {
		this.config = config;
		this.fetchImpl = fetchImpl;
	}
	async request(provider, url, init, parentSignal) {
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		headers.set("User-Agent", USER_AGENT);
		const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(this.config.requestTimeoutMs)]);
		const response = await this.fetchImpl(url, {
			...init,
			headers,
			signal
		});
		const requestId = response.headers.get("x-request-id") ?? void 0;
		const text = await readText(response, this.config.maxResponseBytes, provider);
		if (!response.ok) throw new ProviderHttpError(provider, response.status, requestId);
		if (text.length === 0) throw new ProviderDataError(provider, "an empty response");
		return {
			data: JSON.parse(text),
			...requestId === void 0 ? {} : { requestId }
		};
	}
};
async function readText(response, maxBytes, provider = "aisa") {
	const declared = response.headers.get("content-length");
	if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) throw new ProviderDataError(provider, "a response larger than " + String(maxBytes) + " bytes");
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
			throw new ProviderDataError(provider, "a response larger than " + String(maxBytes) + " bytes");
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
//#region src/providers/aisa.ts
var AisaTransport = class {
	config;
	credentials;
	http;
	reference;
	constructor(config, credentials, http) {
		this.config = config;
		this.credentials = credentials;
		this.http = http;
		this.reference = config.credentials.aisa;
	}
	configured() {
		return this.credentials.configured(this.reference);
	}
	async request(path, init, signal) {
		const apiKey = await this.credentials.require("aisa", this.reference);
		const headers = new Headers(init.headers);
		headers.set("Authorization", "Bearer " + apiKey);
		return await this.http.request("aisa", new URL(path, this.config.aisaBaseUrl), {
			...init,
			headers
		}, signal);
	}
};
function createAisaProviderSet(config, credentials, http) {
	const transport = new AisaTransport(config, credentials, http);
	const configured = () => transport.configured();
	return {
		web: {
			configured,
			async search(input, signal) {
				return normalizeTavilySearch("aisa", await transport.request("/apis/v1/tavily/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						query: input.query,
						search_depth: input.webDepth,
						max_results: input.maxResults,
						include_answer: true,
						include_raw_content: false,
						include_images: false,
						...input.webCountry === void 0 ? {} : { country: input.webCountry }
					})
				}, signal), input.maxResults, config);
			}
		},
		x: {
			configured,
			async search(input, signal) {
				const query = new URLSearchParams({
					query: input.query,
					queryType: input.xOrder
				});
				return normalizeAisaX(await transport.request("/apis/v1/twitter/tweet/advanced_search?" + query.toString(), { method: "GET" }, signal), input.maxResults, config);
			}
		},
		youtube: {
			configured,
			async search(input, signal) {
				const query = new URLSearchParams({
					engine: "youtube",
					q: input.query
				});
				if (input.youtubeRegion !== void 0) query.set("gl", input.youtubeRegion.toLowerCase());
				if (input.youtubeLanguage !== void 0) query.set("hl", input.youtubeLanguage);
				return normalizeAisaYouTube(await transport.request("/apis/v1/youtube/search?" + query.toString(), { method: "GET" }, signal), input.maxResults, config);
			}
		},
		scholar: {
			configured,
			async search(input, signal) {
				const query = new URLSearchParams({ max_num_results: String(input.maxResults) });
				if (input.yearFrom !== void 0) query.set("as_ylo", String(input.yearFrom));
				if (input.yearTo !== void 0) query.set("as_yhi", String(input.yearTo));
				return normalizeAisaScholar(await transport.request("/apis/v1/scholar/search/web?" + query.toString(), {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({ query: input.query }).toString()
				}, signal), input.maxResults, config);
			}
		},
		extract: {
			configured,
			async extract(input, signal) {
				return normalizeTavilyExtract("aisa", await transport.request("/apis/v1/tavily/extract", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						urls: input.urls,
						extract_depth: input.depth,
						include_images: false,
						format: "markdown"
					})
				}, signal), config);
			}
		}
	};
}
//#endregion
//#region src/providers/serpapi.ts
const SERPAPI_BASE_URL = "https://serpapi.com";
function createSerpApiScholarProvider(config, credentials, http) {
	const reference = config.credentials.serpapi;
	return {
		configured: () => credentials.configured(reference),
		async search(input, signal) {
			const apiKey = await credentials.require("serpapi", reference);
			const query = new URLSearchParams({
				engine: "google_scholar",
				q: input.query,
				num: String(input.maxResults),
				api_key: apiKey
			});
			if (input.yearFrom !== void 0) query.set("as_ylo", String(input.yearFrom));
			if (input.yearTo !== void 0) query.set("as_yhi", String(input.yearTo));
			return normalizeSerpApiScholar(await http.request("serpapi", new URL("/search.json?" + query.toString(), SERPAPI_BASE_URL), { method: "GET" }, signal), input.maxResults, config);
		}
	};
}
//#endregion
//#region src/providers/tavily.ts
const TAVILY_BASE_URL = "https://api.tavily.com";
var TavilyTransport = class {
	credentials;
	http;
	reference;
	constructor(config, credentials, http) {
		this.credentials = credentials;
		this.http = http;
		this.reference = config.credentials.tavily;
	}
	configured() {
		return this.credentials.configured(this.reference);
	}
	async request(path, body, signal) {
		const apiKey = await this.credentials.require("tavily", this.reference);
		return await this.http.request("tavily", new URL(path, TAVILY_BASE_URL), {
			method: "POST",
			headers: {
				"Authorization": "Bearer " + apiKey,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		}, signal);
	}
};
function createTavilyProviders(config, credentials, http) {
	const transport = new TavilyTransport(config, credentials, http);
	const configured = () => transport.configured();
	return {
		web: {
			configured,
			async search(input, signal) {
				return normalizeTavilySearch("tavily", await transport.request("/search", {
					query: input.query,
					search_depth: input.webDepth,
					max_results: input.maxResults,
					include_answer: true,
					include_raw_content: false,
					include_images: false,
					...input.webCountry === void 0 ? {} : { country: input.webCountry }
				}, signal), input.maxResults, config);
			}
		},
		extract: {
			configured,
			async extract(input, signal) {
				return normalizeTavilyExtract("tavily", await transport.request("/extract", {
					urls: input.urls,
					extract_depth: input.depth,
					include_images: false,
					format: "markdown"
				}, signal), config);
			}
		}
	};
}
//#endregion
//#region src/providers/x.ts
const X_API_BASE_URL = "https://api.x.com";
function createXProvider(config, credentials, http) {
	const reference = config.credentials.x;
	return {
		configured: () => credentials.configured(reference),
		async search(input, signal) {
			const bearerToken = await credentials.require("x", reference);
			const query = new URLSearchParams({
				query: input.query,
				max_results: String(Math.max(10, input.maxResults)),
				sort_order: input.xOrder === "Top" ? "relevancy" : "recency",
				"post.fields": "created_at,public_metrics",
				expansions: "author_id",
				"user.fields": "name,username"
			});
			return normalizeXApi(await http.request("x", new URL("/2/tweets/search/recent?" + query.toString(), X_API_BASE_URL), {
				method: "GET",
				headers: { Authorization: "Bearer " + bearerToken }
			}, signal), input.maxResults, config);
		}
	};
}
//#endregion
//#region src/providers/youtube.ts
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com";
function createYouTubeProvider(config, credentials, http) {
	const reference = config.credentials.youtube;
	return {
		configured: () => credentials.configured(reference),
		async search(input, signal) {
			const apiKey = await credentials.require("youtube", reference);
			const query = new URLSearchParams({
				part: "snippet",
				q: input.query,
				maxResults: String(input.maxResults),
				type: "video,channel,playlist",
				key: apiKey
			});
			if (input.youtubeRegion !== void 0) query.set("regionCode", input.youtubeRegion.toUpperCase());
			if (input.youtubeLanguage !== void 0) query.set("relevanceLanguage", input.youtubeLanguage);
			return normalizeYouTubeApi(await http.request("youtube", new URL("/youtube/v3/search?" + query.toString(), YOUTUBE_API_BASE_URL), { method: "GET" }, signal), input.maxResults, config);
		}
	};
}
//#endregion
//#region src/providers/router.ts
async function selected(mode, direct, aisa) {
	if (mode === "aisa") return aisa;
	if (mode === "byok") return direct;
	return await direct.configured() ? direct : aisa;
}
function sourceProvider(providers, source) {
	switch (source) {
		case "web": return providers.web;
		case "x": return providers.x;
		case "youtube": return providers.youtube;
		case "scholar": return providers.scholar;
	}
}
var RoutedOperation = class {
	routes;
	constructor(routes) {
		this.routes = routes;
	}
	async search(source, input, signal) {
		const direct = sourceProvider(this.routes.direct, source);
		const aisa = sourceProvider(this.routes.aisa, source);
		return await (await selected(this.routes.mode, direct, aisa)).search(input, signal);
	}
	async extract(input, signal) {
		return await (await selected(this.routes.mode, this.routes.direct.extract, this.routes.aisa.extract)).extract(input, signal);
	}
};
var EasySearchProviderClient = class {
	options;
	constructor(options) {
		this.options = options;
	}
	start() {
		const config = this.options.config();
		const credentials = new CredentialSnapshot(this.options.resolveCredential);
		const http = new JsonHttpClient(config, this.options.fetchImpl ?? globalThis.fetch);
		const aisa = createAisaProviderSet(config, credentials, http);
		const tavily = createTavilyProviders(config, credentials, http);
		const direct = {
			web: tavily.web,
			x: createXProvider(config, credentials, http),
			youtube: createYouTubeProvider(config, credentials, http),
			scholar: createSerpApiScholarProvider(config, credentials, http),
			extract: tavily.extract
		};
		return new RoutedOperation({
			mode: config.routingMode,
			aisa,
			direct
		});
	}
};
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
		provider: result.provider,
		status: "ok",
		resultCount: result.results.length,
		...result.requestId === void 0 ? {} : { requestId: result.requestId }
	};
}
function failedCoverage(source, reason) {
	const provider = providerFromError(reason);
	return {
		source,
		...provider === void 0 ? {} : { provider },
		status: "error",
		resultCount: 0,
		error: errorMessage(reason)
	};
}
var EasySearchService = class {
	providers;
	config;
	constructor(providers, config) {
		this.providers = providers;
		this.config = config;
	}
	async search(options, signal) {
		const input = parseSearchOptions(options, this.config());
		const operation = this.providers.start();
		const settled = await Promise.allSettled(input.sources.map((source) => this.searchSource(operation, source, input, signal)));
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
		return await this.providers.start().extract(input, signal);
	}
	searchSource(operation, source, input, signal) {
		return operation.search(source, input, signal);
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
					provider: {
						type: "string",
						enum: [
							"aisa",
							"tavily",
							"x",
							"youtube",
							"serpapi"
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
		provider: {
			type: "string",
			required: true,
			enum: ["aisa", "tavily"]
		},
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
		description: "Search one topic across selected sources in parallel. Choose only the sources relevant to the question. Returns citeable URLs and per-source coverage.",
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
		description: "Extract clean markdown from one to three known public HTTP(S) URLs through the configured provider. Use after search when full page content is needed.",
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
				provider: outcome.provider,
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
	registerEasySearchTools(ctx, new EasySearchService(new EasySearchProviderClient({
		config: resolved,
		resolveCredential: async (reference) => (await ctx.credentials.resolve(credentialRef(reference)))?.value
	}), resolved));
}
//#endregion
export { Config, EASY_SEARCH_SETTINGS_NAMESPACE, EasySearchService, PROVIDER_IDS, SEARCH_SOURCES, WEB_DEPTHS, X_ORDERS, apply, inject, name, parseExtractOptions, parseSearchOptions, publicUrl };

//# sourceMappingURL=index.js.map