import { router, type Href } from 'expo-router';
import { Keyboard } from 'react-native';

export function parentPage(path: string): string {
  if (/^\/bills\//.test(path)) return '/bills';
  if (/^\/gift-cards\//.test(path)) return '/gift-cards';
  if (/^\/security\//.test(path)) return '/security';
  if (/^\/(account\/|security$|notifications$|support)/.test(path)) return '/account';
  if (/^\/(transaction|receipt)\//.test(path)) return '/activity';
  if (/^\/card-order\//.test(path)) return '/cards';
  return '/home';
}

// Memory-only, account-scoped, and bounded. Never retain auth/callback URLs or
// query strings. Browser history can point outside Billy or back to a login gate.
export class AppNavigationTrail {
  private owner: string | null = null;
  private pages: string[] = [];
  record(path: string, owner: string | null, insideApp: boolean) {
    if (owner !== this.owner) { this.pages = []; this.owner = owner; }
    // Expo briefly reports its redirect-only root while restoring a deep link.
    // It is not a visited screen and must not become a Back destination.
    if (path === '/' && owner) return;
    if (!insideApp || !owner) { this.pages = []; return; }
    const clean = path.split('?')[0];
    if (!clean.startsWith('/') || clean.startsWith('//')) return;
    if (this.pages.at(-1) === clean) return;
    const prior = this.pages.lastIndexOf(clean);
    this.pages = prior >= 0 ? this.pages.slice(0, prior + 1) : [...this.pages, clean].slice(-32);
  }
  backTarget() {
    const current = this.pages.at(-1) ?? '/home';
    if (this.pages.length > 1) this.pages.pop();
    else this.pages = [parentPage(current)];
    return this.pages.at(-1)!;
  }
}

export const appNavigationTrail = new AppNavigationTrail();
let lastBackAt = 0;
export function goBackSafely() {
  Keyboard.dismiss();
  if (Date.now() - lastBackAt < 350) return;
  lastBackAt = Date.now();
  const target = appNavigationTrail.backTarget() as Href;
  // Pop to the known app page, or replace when opened/refreshed directly.
  // Unlike back(), dismissTo also works when there is no history entry.
  router.dismissTo(target);
}
