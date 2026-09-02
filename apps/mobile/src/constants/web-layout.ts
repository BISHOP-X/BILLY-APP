export const WEB_DESKTOP_BREAKPOINT = 960;
export const WEB_CONTENT_MAX_WIDTH = 1120;
export const WEB_NAV_HEIGHT = 96;

export function usesDesktopWebLayout(width: number, fontScale: number) {
  return width >= WEB_DESKTOP_BREAKPOINT && fontScale <= 1.35;
}
