import { brandTileBackground, serviceBrand, serviceInitials } from '@/features/numbers/brand-registry';
import { brandArtwork } from '@/features/numbers/brand-artwork';

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
  expect(serviceBrand('WhatsApp')?.uri).toMatch(/^data:image\/svg\+xml/);
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
