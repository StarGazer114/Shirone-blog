/**
 * Memos 说说接入配置。
 *
 * 启用后动态页不再只展示 `content/moments` 里的本地条目，
 * 而是由客户端按需拉取 Memos 公开 API，把说说即时渲染出来。
 */
export type MemosConfig = {
	/** 总开关：false 时只展示本地 moments，零运行时请求 */
	enable: boolean;
	/** Memos API 地址，例如 https://memo.example.com/api/v1/memos */
	apiUrl: string;
	/** 资源基地址，用于拼接附件图片；留空则从 apiUrl 推导 */
	assetBaseUrl: string;
	/** 单次拉取条数（1-200） */
	pageSize: number;
	/** 附加的 Memos filter 表达式，留空则只按 PUBLIC/NORMAL 过滤 */
	filter: string;
	/** 拉取失败时是否回退展示本地 moments */
	fallbackToLocal: boolean;
};

/** 校验并归一化后的运行期参数 */
export type ResolvedMemosOptions = {
	apiUrl: string;
	assetBaseUrl: string;
	pageSize: number;
	filter: string;
	fallbackToLocal: boolean;
};
