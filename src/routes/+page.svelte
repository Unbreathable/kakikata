<script>
	import { onMount, tick } from 'svelte';
	import { chars, kanaKind, loadStrokes } from '#lib/kanji.js';

	const fromUrl = new URLSearchParams(location.search).get('q') || '';

	let query = $state(fromUrl);
	let draft = $state(fromUrl);
	const SPEEDS = { immediate: 0, fast: 150, normal: 350, slow: 700 }; // ms per stroke
	const SPEED_KEYS = { 1: 'immediate', 2: 'fast', 3: 'normal', 4: 'slow' };

	// Settings persisted in localStorage
	function stored(key, fallback, valid = () => true) {
		try {
			const v = JSON.parse(localStorage.getItem(key));
			return v !== null && valid(v) ? v : fallback;
		} catch {
			return fallback;
		}
	}
	let mode = $state(stored('kakikata.speed', 'normal', (v) => v in SPEEDS));
	let showNumbers = $state(stored('kakikata.numbers', true, (v) => typeof v === 'boolean'));
	const speed = $derived(SPEEDS[mode]);

	function setMode(m) {
		mode = m;
		localStorage.setItem('kakikata.speed', JSON.stringify(m));
		replay();
	}

	function toggleNumbers() {
		showNumbers = !showNumbers;
		localStorage.setItem('kakikata.numbers', JSON.stringify(showNumbers));
	}
	let entries = $state([]); // {c, svg, kind}
	let loaded = $state(false);
	let armed = $state(false); // hide word until strokes are reset (no flicker)
	let toast = $state('');
	let copied = $state(false);
	let inputEl = $state();
	let wordEl = $state();
	let winW = $state(1200);
	let winH = $state(800);

	const list = $derived(chars(query));
	// Scale the whole word to fit: height cap, and width split across chars
	const cell = $derived(
		list.length ? Math.max(40, Math.min(winH * 0.5, (winW * 0.9) / list.length, 560)) : 0
	);

	let loadRun = 0;
	let animRun = 0;

	// Load stroke + dictionary data for every char in the word
	$effect(() => {
		const cs = list;
		const id = ++loadRun;
		loaded = false;
		armed = false;
		entries = cs.map((c) => ({ c, svg: null, kind: kanaKind(c) }));
		if (!cs.length) return;
		Promise.all(
			cs.map(async (c) => ({
				c,
				svg: await loadStrokes(c),
				kind: kanaKind(c)
			}))
		).then((res) => {
			if (id !== loadRun) return;
			entries = res;
			loaded = true;
		});
	});

	// Animate once all SVGs are in the DOM
	$effect(() => {
		if (loaded) tick().then(replay);
	});

	const SVG_NS = 'http://www.w3.org/2000/svg';
	let gradSeq = 0;

	// White → gray gradient along each stroke, so the direction is visible
	function gradientFor(p) {
		if (p.dataset.grad) return;
		const svg = p.ownerSVGElement;
		let defs = svg.querySelector(':scope > defs.grads');
		if (!defs) {
			defs = document.createElementNS(SVG_NS, 'defs');
			defs.classList.add('grads');
			svg.prepend(defs);
		}
		const a = p.getPointAtLength(0);
		const b = p.getPointAtLength(p.getTotalLength());
		const id = `stroke-grad-${++gradSeq}`;
		const g = document.createElementNS(SVG_NS, 'linearGradient');
		g.setAttribute('id', id);
		g.setAttribute('gradientUnits', 'userSpaceOnUse');
		g.setAttribute('x1', a.x);
		g.setAttribute('y1', a.y);
		g.setAttribute('x2', b.x);
		g.setAttribute('y2', b.y);
		for (const [offset, color] of [
			[0, '#ffffff'],
			[1, '#6b6b6b']
		]) {
			const stop = document.createElementNS(SVG_NS, 'stop');
			stop.setAttribute('offset', offset);
			stop.setAttribute('stop-color', color);
			g.append(stop);
		}
		defs.append(g);
		p.dataset.grad = id;
	}

	// KanjiVG puts a transform attr on each number <text>. WAAPI transform would
	// override it, so: <g transform=attr><g anim><text/></g></g>, animate the inner g.
	function numberAnimTarget(t) {
		if (t.parentNode.dataset.numAnim) return t.parentNode;
		const outer = document.createElementNS(SVG_NS, 'g');
		const inner = document.createElementNS(SVG_NS, 'g');
		inner.dataset.numAnim = '1';
		outer.setAttribute('transform', t.getAttribute('transform') ?? '');
		t.removeAttribute('transform');
		t.before(outer);
		inner.append(t);
		outer.append(inner);
		return inner;
	}

	function reset(paths, texts) {
		for (const p of paths) {
			p.getAnimations().forEach((a) => a.cancel());
			gradientFor(p);
			const len = p.getTotalLength();
			p.style.strokeDasharray = `${len} ${len}`;
			p.style.strokeDashoffset = `${len}`;
			p.style.stroke = `url(#${p.dataset.grad})`;
		}
		for (const g of texts) {
			g.getAnimations().forEach((a) => a.cancel());
			g.style.transformBox = 'fill-box';
			g.style.transformOrigin = 'center';
			g.style.opacity = '0';
		}
	}

	async function play(id, paths, texts) {
		for (let i = 0; i < paths.length; i++) {
			if (id !== animRun) return;
			const p = paths[i];
			const len = p.getTotalLength();
			// number pops in as its stroke starts
			texts[i]?.animate(
				[
					{ opacity: 0, transform: 'scale(0.2)' },
					{ opacity: 1, transform: 'scale(1)' }
				],
				{ duration: speed, easing: 'ease-out', fill: 'forwards' }
			);
			await p
				.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
					duration: speed,
					easing: 'ease-in-out',
					fill: 'forwards'
				})
				.finished.catch(() => {});
		}
	}

	function replay() {
		if (!wordEl) return;
		const paths = [...wordEl.querySelectorAll('[id^="kvg:StrokePaths"] path')];
		const texts = [...wordEl.querySelectorAll('[id^="kvg:StrokeNumbers"] text')].map(
			numberAnimTarget
		);
		const id = ++animRun;
		reset(paths, texts);
		armed = true;
		play(id, paths, texts);
	}

		function submit(e) {
		e.preventDefault();
		const q = draft.trim();
		query = q;
		const u = new URL(location.href);
		if (q) u.searchParams.set('q', q);
		else u.searchParams.delete('q');
		if (u.href !== location.href) history.pushState(null, '', u);
		inputEl.blur();
	}

	// Back/forward: restore word from URL
	function onPop() {
		const q = new URLSearchParams(location.search).get('q') || '';
		query = q;
		draft = q;
	}

	function showToast(msg) {
		toast = msg;
		clearTimeout(showToast.t);
		showToast.t = setTimeout(() => (toast = ''), 1500);
	}

	function copyLink() {
		navigator.clipboard.writeText(location.href).then(
			() => {
				copied = true;
				clearTimeout(copyLink.t);
				copyLink.t = setTimeout(() => (copied = false), 900);
			},
			() => showToast(location.href)
		);
	}

	function onKey(e) {
		if (e.target === inputEl) {
			if (e.key === 'Escape') inputEl.blur();
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		switch (e.key) {
			case '/':
				e.preventDefault();
				inputEl.focus();
				inputEl.select();
				break;
			case ' ':
			case 'r':
				e.preventDefault();
				replay();
				break;
			case 'n':
				toggleNumbers();
				break;
			case '1':
			case '2':
			case '3':
			case '4':
				setMode(SPEED_KEYS[e.key]);
				break;
			case 'c':
				if (query) copyLink();
				break;
		}
	}

	onMount(() => inputEl.focus());
</script>

<svelte:window onkeydown={onKey} onpopstate={onPop} bind:innerWidth={winW} bind:innerHeight={winH} />

<div
	class="h-dvh overflow-hidden bg-bg-800 text-bg-150 font-mono flex flex-col items-center justify-center gap-6 px-4"
>
	{#if list.length}
		<div
			bind:this={wordEl}
			class="flex items-center justify-center"
			class:hide-nums={!showNumbers}
			class:invisible={!armed}
		>
			{#each entries as e, i (i)}
				<div class="cell flex items-center justify-center" style="width:{cell}px;height:{cell}px">
					{#if e.svg}
						{@html e.svg}
					{:else}
						<span style="font-size:{cell * 0.85}px;line-height:1">{e.c}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex items-center gap-3 w-full max-w-xl justify-center shrink-0">
		<form onsubmit={submit} class="flex-1">
			<input
				bind:this={inputEl}
				bind:value={draft}
				placeholder="type a word…"
				class="w-full rounded-full border border-bg-500 bg-bg-700 px-4 py-2 text-bg-150 placeholder:text-bg-400 outline-none focus:border-p-blue-200"
			/>
		</form>
		{#if query}
			<button
				class="pill {copied ? 'border-p-blue-200 text-p-blue-200' : ''}"
				onclick={copyLink}
			>
				<!-- invisible copy of the longest label reserves the width -->
				<span class="grid">
					<span class="col-start-1 row-start-1 invisible">copy link (c)</span>
					<span class="col-start-1 row-start-1">{copied ? 'copied' : 'copy link (c)'}</span>
				</span>
			</button>
		{/if}
	</div>

	{#if query}
		<footer class="text-xs text-bg-300 text-center flex flex-wrap justify-center items-center gap-2 shrink-0">
			{#each Object.keys(SPEEDS) as m, i (m)}
				<button class="pill text-xs px-3 py-1 {mode === m ? 'pill-active' : ''}" onclick={() => setMode(m)}>
					{i + 1} {m}{m === 'immediate' ? '' : ` ${SPEEDS[m]}ms`}
				</button>
			{/each}
			<button class="pill text-xs px-3 py-1 {showNumbers ? 'pill-active' : ''}" onclick={toggleNumbers}>
				n numbers
			</button>
			<span class="px-2">space / r replay</span>
			<span class="px-2">/ search</span>
			<span class="px-2">c copy link</span>
		</footer>
	{/if}
</div>

{#if toast}
	<div
		class="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-bg-500 bg-bg-700 px-4 py-1.5 text-sm text-p-blue-100"
	>
		{toast}
	</div>
{/if}
