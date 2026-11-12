type ViewportSource = {
  innerHeight: number;
  visualViewport: { height: number; offsetTop: number } | null;
};

// The app root uses the viewport bottom. Portal modals need its actual height
// and top separately: mobile keyboards shrink/pan the visual, not layout, view.
export function syncWebViewport(
  source: ViewportSource,
  style: Pick<CSSStyleDeclaration, 'setProperty'>,
) {
  const height = Math.max(1, source.visualViewport?.height ?? source.innerHeight);
  const top = Math.max(0, source.visualViewport?.offsetTop ?? 0);
  style.setProperty('--billy-app-height', `${Math.ceil(height + top)}px`);
  style.setProperty('--billy-viewport-height', `${height}px`);
  style.setProperty('--billy-viewport-top', `${top}px`);
}
