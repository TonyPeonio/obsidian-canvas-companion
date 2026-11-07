import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToMarkdown } from "../src/core/html";

describe("htmlToMarkdown", () => {
	it("converts paragraphs, breaks, emphasis, links and lists", () => {
		const html = `<p>The <strong>midterm</strong> is moved to <em>Friday</em>.<br>Bring a calculator.</p>
<p>See <a href="https://school.instructure.com/courses/1/pages/exam">the exam page</a> and <a href="https://x.y/z">https://x.y/z</a>.</p>
<ul><li>Chapters 1&ndash;4</li><li>Lecture notes &amp; slides</li></ul>
<ol><li>First</li><li>Second</li></ol>
<h3>Office hours</h3><div>Tue 2&nbsp;pm</div><script>alert(1)</script>`;
		expect(htmlToMarkdown(html)).toBe(
			[
				"The **midterm** is moved to *Friday*.",
				"Bring a calculator.",
				"",
				"See [the exam page](https://school.instructure.com/courses/1/pages/exam) and https://x.y/z.",
				"",
				"- Chapters 1–4",
				"- Lecture notes & slides",
				"",
				"1. First",
				"1. Second",
				"",
				"**Office hours**",
				"",
				"Tue 2 pm",
			].join("\n"),
		);
	});

	it("decodes entities and survives empty or plain input", () => {
		expect(decodeEntities("a &lt; b &#39;c&#x27; &quot;d&quot; &unknown;")).toBe("a < b 'c' \"d\" &unknown;");
		expect(htmlToMarkdown("")).toBe("");
		expect(htmlToMarkdown("plain text")).toBe("plain text");
		expect(htmlToMarkdown("<p></p><p>  </p><p>x</p>")).toBe("x");
	});
});
