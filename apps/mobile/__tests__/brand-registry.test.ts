import { brandTileBackground, serviceBrand, serviceInitials } from '@/features/numbers/brand-registry';
import { brandArtwork } from '@/features/numbers/brand-artwork';
import { brandRasters } from '@/features/numbers/brand-rasters';

test('specific aliases win without substring false positives', () => {
  expect(serviceBrand('Uber Eats SMS')?.icon).toBe('ubereats');
  expect(serviceBrand('Uber SMS')?.icon).toBe('uber');
  expect(serviceBrand('FB verification')?.icon).toBe('facebook');
  expect(serviceBrand('IG verification')?.icon).toBe('instagram');
  expect(serviceBrand('Google Voice')?.icon).toBe('google');
  expect(serviceBrand('Outlook / Hotmail')?.icon).toBe('microsoft');
  for (const name of ['Example', 'Digital', 'Online', 'Steamship', 'Box']) {
    expect(serviceBrand(name)).toBeNull();
  }
});

test('every sourced mark has local SVG artwork and provenance', () => {
  expect(Object.keys(brandArtwork).length).toBeGreaterThan(120);
  for (const item of Object.values(brandArtwork)) {
    expect(item.path).toMatch(/^[Mm]/);
    expect(item.color).toMatch(/^#[A-Fa-f0-9]{6}$/);
    expect(item.source).toMatch(/^https:\/\//);
  }
  const whatsapp=serviceBrand('WhatsApp');
  expect(whatsapp?.uri?.startsWith('data:image/svg+xml')||whatsapp?.asset!==undefined).toBe(true);
});

test('unknown brands use deterministic readable initials without made-up logos', () => {
  expect(serviceInitials('New Brand SMS')).toEqual(serviceInitials('New Brand verification'));
  expect(serviceInitials('New Brand SMS').initials).toBe('NB');
  expect(serviceInitials('').initials).toBe('SMS');
});

test('bright logos keep their brand colour on a contrasting tile', () => {
  expect(brandTileBackground('#FFFC00')).toBe('#15231B');
  expect(brandTileBackground('#000000')).toBe('#FFFFFF');
});

test('regional and homonymous apps cannot supply an unrelated service logo', () => {
  expect(brandRasters['app-589653414'].source).toContain('7-eleven-rewards-shopping');
  expect(brandRasters['app-1472322409'].source).toContain('soul-chat-match-party');
  for(const id of ['403756560','6755092667','1551072628','6754170804','6785268852']) {
    expect(brandRasters['app-'+id]).toBeUndefined();
  }
  for(const name of ['DOSH','Gamut','Cash Up'])expect(serviceBrand(name)).toBeNull();
});
