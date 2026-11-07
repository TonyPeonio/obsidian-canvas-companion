// A small HTML → markdown converter for Canvas announcement bodies. Handles what instructors
// actually write (paragraphs, line breaks, links, bold/italic, lists, headings) and strips
// everything else; never executes or renders anything.

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
};

export function decodeEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
		.replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function textOf(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function htmlToMarkdown(html: string): string {
	let s = html.replace(/\r/g, "");
	s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
	s = s.replace(/<!--[\s\S]*?-->/g, "");
	// Ordered lists first so their items get numbers; remaining items become bullets.
	s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => "\n" + inner.replace(/<li\b[^>]*>/gi, "\n1. ") + "\n");
	s = s.replace(/<li\b[^>]*>/gi, "\n- ");
	s = s.replace(/<\/li>/gi, "");
	s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _lvl: string, inner: string) => `\n\n**${textOf(inner)}**\n\n`);
	s = s.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
		const text = textOf(inner);
		const url = decodeEntities(href.trim());
		if (!url) return text;
		return text && text !== url ? `[${text}](${url})` : url;
	});
	s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => {
		const text = textOf(inner);
		return text ? `**${text}**` : "";
	});
	s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => {
		const text = textOf(inner);
		return text ? `*${text}*` : "";
	});
	s = s.replace(/<\/(p|div|blockquote|tr|table|section|article)>/gi, "\n\n");
	s = s.replace(/<\/(td|th)>/gi, " ");
	s = s.replace(/<[^>]+>/g, "");
	s = decodeEntities(s);
	// Tidy whitespace: trim lines, collapse runs of blank lines, drop stray spaces before bullets.
	// \s covers tabs and non-breaking spaces; newlines were split off already.
	const lines = s.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
	const out: string[] = [];
	for (const line of lines) {
		if (line === "" && out[out.length - 1] === "") continue;
		out.push(line);
	}
	return out.join("\n").trim();
}
