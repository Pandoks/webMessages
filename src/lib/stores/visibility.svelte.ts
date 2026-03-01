class VisibilityStore {
	tabVisible = $state(!document.hidden);
	windowFocused = $state(document.hasFocus());
	isActive = $derived(this.tabVisible && this.windowFocused);

	private onVisibilityChange = () => {
		this.tabVisible = !document.hidden;
	};
	private onFocus = () => {
		this.windowFocused = true;
	};
	private onBlur = () => {
		this.windowFocused = false;
	};

	start() {
		document.addEventListener('visibilitychange', this.onVisibilityChange);
		window.addEventListener('focus', this.onFocus);
		window.addEventListener('blur', this.onBlur);
	}

	stop() {
		document.removeEventListener('visibilitychange', this.onVisibilityChange);
		window.removeEventListener('focus', this.onFocus);
		window.removeEventListener('blur', this.onBlur);
	}
}

export const visibilityStore = new VisibilityStore();
