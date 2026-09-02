import {
  usesDesktopWebLayout,
  WEB_CONTENT_MAX_WIDTH,
  WEB_DESKTOP_BREAKPOINT,
  WEB_NAV_HEIGHT,
} from '@/constants/web-layout';

describe('web layout breakpoints', () => {
  it('keeps phone and tablet-sized views on mobile navigation', () => {
    expect(usesDesktopWebLayout(390, 1)).toBe(false);
    expect(usesDesktopWebLayout(WEB_DESKTOP_BREAKPOINT - 1, 1)).toBe(false);
  });

  it('uses desktop navigation when there is enough room', () => {
    expect(usesDesktopWebLayout(WEB_DESKTOP_BREAKPOINT, 1)).toBe(true);
    expect(usesDesktopWebLayout(1440, 1.2)).toBe(true);
  });

  it('protects enlarged text from a cramped desktop navigation', () => {
    expect(usesDesktopWebLayout(1440, 1.36)).toBe(false);
  });

  it('keeps positive content and navigation dimensions', () => {
    expect(WEB_CONTENT_MAX_WIDTH).toBeGreaterThan(WEB_DESKTOP_BREAKPOINT);
    expect(WEB_NAV_HEIGHT).toBeGreaterThan(0);
  });
});
