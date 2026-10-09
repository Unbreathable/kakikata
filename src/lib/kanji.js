// Stroke data: KanjiVG (CC BY-SA 3.0), covers kanji + hiragana + katakana.
const svgCache = new Map();

export const chars = (s) => [...s.trim()].filter((c) => c.trim() !== '');

export function kanaKind(c) {
	const cp = c.codePointAt(0);
	if (cp >= 0x3041 && cp <= 0x309f) return 'hiragana';
	if ((cp >= 0x30a0 && cp <= 0x30ff) || cp === 0x30fc) return 'katakana';
	return null;
}

const hex = (c) => c.codePointAt(0).toString(16).padStart(5, '0');

export function loadStrokes(c) {
	if (!svgCache.has(c)) {
		const url = `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/${hex(c)}.svg`;
		svgCache.set(
			c,
			fetch(url)
				.then((r) => (r.ok ? r.text() : null))
				// drop xml decl + DOCTYPE (internal subset breaks simple regexes)
				.then((t) => (t ? t.slice(t.indexOf('<svg')) : null))
				.catch(() => null)
		);
	}
	return svgCache.get(c);
}

