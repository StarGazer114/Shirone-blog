import type {
	MemosConfig,
	ResolvedMemosOptions,
} from "../types/memosConfig.ts";
import { withUserConfig } from "../utils/config-overlay.ts";

/**
 * Memos 说说接入。
 *
 * 遵循「零额外负担」原则：enable 为 false 时不产生任何外部请求与占位 DOM。
 * 内容仓可用 `config/memos.yaml` 覆盖，只写需要的键。
 */
export const memosConfig: MemosConfig = withUserConfig("memos", {
	enable: false,
	apiUrl: "",
	assetBaseUrl: "",
	pageSize: 50,
	filter: "",
	fallbackToLocal: true,
});

const MAX_PAGE_SIZE = 200;

/** 从 apiUrl 推导资源基地址：去掉末尾的 /api/v1/memos */
function deriveAssetBase(apiUrl: string): string {
	try {
		const parsed = new URL(apiUrl);
		const path = parsed.pathname.replace(/\/api\/v1\/memos\/?$/, "");
		return `${parsed.origin}${path}`.replace(/\/$/, "");
	} catch {
		return "";
	}
}

/**
 * 解析并校验 Memos 配置。未启用或缺少地址时返回 null（页面退回纯本地模式）。
 */
export function resolveMemosOptions(
	config: MemosConfig,
): ResolvedMemosOptions | null {
	if (!config.enable) return null;
	const apiUrl = config.apiUrl.trim();
	if (!apiUrl) return null;
	const pageSize = Math.min(
		MAX_PAGE_SIZE,
		Math.max(1, Math.trunc(Number(config.pageSize) || 50)),
	);
	const assetBaseUrl =
		config.assetBaseUrl.trim().replace(/\/$/, "") || deriveAssetBase(apiUrl);
	return {
		apiUrl,
		assetBaseUrl,
		pageSize,
		filter: config.filter.trim(),
		fallbackToLocal: config.fallbackToLocal !== false,
	};
}
