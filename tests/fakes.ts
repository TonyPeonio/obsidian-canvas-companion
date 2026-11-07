import type { HttpRequest, HttpRequestOptions, HttpResponse } from "../src/core/http";
import type { NoteStore } from "../src/core/sync";

/** Routes URLs (without query string) to JSON bodies; supports a `Link` header for pagination. */
export class FakeHttp {
	calls: HttpRequestOptions[] = [];
	routes = new Map<string, { status?: number; body: unknown; link?: string } | ((opts: HttpRequestOptions) => { status?: number; body: unknown; link?: string })>();

	on(path: string, body: unknown, extra: { status?: number; link?: string } = {}): this {
		this.routes.set(path, { body, ...extra });
		return this;
	}

	request: HttpRequest = async (opts) => {
		this.calls.push(opts);
		const url = new URL(opts.url);
		const key = url.pathname + (this.routes.has(url.pathname + url.search) ? url.search : "");
		const route = this.routes.get(url.pathname + url.search) ?? this.routes.get(key) ?? this.routes.get(url.pathname);
		if (!route) return { status: 404, headers: {}, text: JSON.stringify({ errors: [{ message: "The specified resource does not exist." }] }), arrayBuffer: new ArrayBuffer(0) } satisfies HttpResponse;
		const r = typeof route === "function" ? route(opts) : route;
		const headers: Record<string, string> = { "content-type": "application/json" };
		if (r.link) headers.Link = r.link;
		return { status: r.status ?? 200, headers, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body), arrayBuffer: new ArrayBuffer(0) };
	};
}

export class MemoryStore implements NoteStore {
	files = new Map<string, string>();
	writes: string[] = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
	}

	async read(path: string): Promise<string | null> {
		return this.files.get(path) ?? null;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
		this.writes.push(path);
	}
}
