(() => {
	"use strict";

	const OUTER_ORIGIN = "https://outer.example";
	let lastState = "";

	function sendState() {
		const state = location.href + "\n" + document.title;
		if (state === lastState) return;

		lastState = state;
		parent.postMessage(
			{
			href: location.href,
			title: document.title
			},
			OUTER_ORIGIN
		);
	}

	const pushState = history.pushState;
	const replaceState = history.replaceState;

	history.pushState = function (...args) {
		const result = pushState.apply(this, args);
		sendState();
		return result;
	};

	history.replaceState = function (...args) {
		const result = replaceState.apply(this, args);
		sendState();
		return result;
	};

	sendState();
	window.addEventListener("pageshow", sendState);
	window.addEventListener("popstate", sendState);
	window.addEventListener("hashchange", sendState);

	new MutationObserver(sendState).observe(document.head, {
		childList: true,
		subtree: true,
		characterData: true
	});
})();