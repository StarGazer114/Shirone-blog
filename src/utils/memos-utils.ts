/**
 * Memos → MomentItem 适配层（运行时按需平面）。
 *
 * 契约见 docs/remote-data-system.md：
 * - 显式超时（8s）与外部 AbortSignal 联动，页面切换可中断；
 * - 同一 URL 的并发请求共享同一个 Promise（in-flight 去重）；
 * - 响应体上限 512KB，字段按白名单清洗后再进入 UI；
 * - 正文一律转义后重新拼装，不直接注入远端 HTML。
 */
import type { ResolvedMemosOptions } from "@/types/memosConfig";
import type { MomentImage, MomentItem } from "@utils/content-utils";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 512 * 1024;

type RawAttachment = {
	name?: unknown;
	filename?: unknown;
	type?: unknown;
	mimeType?: unknown;
	mediaType?: unknown;
};

type RawMemo = {
	name?: unknown;
	state?: unknown;
	createTime?: unknown;
	displayTime?: unknown;
	content?: unknown;
	visibility?: unknown;
	tags?: unknown;
	pinned?: unknown;
	attachments?: unknown;
	resources?: unknown;
	location?: unknown;
};

type MemosResponse = { memos?: unknown };

const inFlight = new Map<string, Promise<MomentItem[]>>();

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** 纯文本/Markdown 子集 → 安全 HTML（只放行 http/https 链接） */
export function memosContentToHtml(content: string): string {
	const escaped = escapeHtml(content.trim());
	const linked = escaped.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		(_match, text: string, href: string) =>
			`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`,
	);
	const autoLinked = linked.replace(
		/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
		(_match, prefix: string, href: string) =>
			`${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`,
	);
	return autoLinked.replace(/\r?\n/g, "<br />");
}

function toAttachments(raw: unknown): RawAttachment[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((item): item is RawAttachment =>
		Boolean(item) && typeof item === "object",
	);
}

/** 附件 → 图片列表（Memos 资源地址：<assetBase>/o/r/<id>/<filename>） */
function toImages(memo: RawMemo, assetBaseUrl: string): MomentImage[] {
	const attachments = [
		...toAttachments(memo.attachments),
		...toAttachments(memo.resources),
	];
	const images: MomentImage[] = [];
	for (const attachment of attachments) {
		const mime = asString(
			attachment.type ?? attachment.mimeType ?? attachment.mediaType,
		);
		if (!mime.startsWith("image/")) continue;
		const filename = asString(attachment.filename);
		const resourceId = asString(attachment.name).replace(
			/^(attachments|resources)\//,
			"",
		);
		if (!filename || !resourceId || !assetBaseUrl) continue;
		images.push({
			src: `${assetBaseUrl}/o/r/${resourceId}/${filename}`,
			alt: filename,
		});
	}
	return images;
}

/** 单条 memo → MomentItem；非公开或已归档返回 null */
export function transformMemo(
	memo: RawMemo,
	assetBaseUrl: string,
): MomentItem | null {
	if (asString(memo.state) !== "NORMAL") return null;
	if (asString(memo.visibility) !== "PUBLIC") return null;
	const id = asString(memo.name).replace(/^memos\//, "");
	const published = asString(memo.displayTime) || asString(memo.createTime);
	const content = asString(memo.content);
	if (!id || !published) return null;
	const locationRaw = memo.location;
	const location =
		locationRaw && typeof locationRaw === "object"
			? asString((locationRaw as { placeholder?: unknown }).placeholder)
			: "";
	return {
		id,
		published,
		html: memosContentToHtml(content),
		pinned: memo.pinned === true,
		location,
		mood: "",
		tags: asStringArray(memo.tags),
		images: toImages(memo, assetBaseUrl),
	};
}

function sortMoments(moments: MomentItem[]): MomentItem[] {
	return moments.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return new Date(b.published).getTime() - new Date(a.published).getTime();
	});
}

async function requestMemos(
	options: ResolvedMemosOptions,
	signal?: AbortSignal,
): Promise<MomentItem[]> {
	const endpoint = new URL(options.apiUrl);
	endpoint.searchParams.set("pageSize", String(options.pageSize));
	if (options.filter) endpoint.searchParams.set("filter", options.filter);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		const response = await fetch(endpoint, {
			signal: controller.signal,
			credentials: "omit",
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`Memos responded ${response.status}`);
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			throw new Error("Memos returned a non-JSON payload");
		}
		const text = await response.text();
		if (text.length > MAX_RESPONSE_BYTES) {
			throw new Error("Memos payload exceeds the size budget");
		}
		const payload = JSON.parse(text) as MemosResponse;
		const rawMemos = Array.isArray(payload.memos) ? payload.memos : [];
		const moments: MomentItem[] = [];
		for (const raw of rawMemos) {
			if (!raw || typeof raw !== "object") continue;
			const moment = transformMemo(raw as RawMemo, options.assetBaseUrl);
			if (moment) moments.push(moment);
		}
		return sortMoments(moments);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * 拉取并转换 Memos 说说。相同 URL 的并发调用共享同一个请求。
 */
export function fetchMemosMoments(
	options: ResolvedMemosOptions,
	signal?: AbortSignal,
): Promise<MomentItem[]> {
	const key = `${options.apiUrl}|${options.pageSize}|${options.filter}`;
	const existing = inFlight.get(key);
	if (existing) return existing;
	const task = requestMemos(options, signal).finally(() => {
		inFlight.delete(key);
	});
	inFlight.set(key, task);
	return task;
}
