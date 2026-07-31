import { getQuickActionColumnCount } from '@/features/home/components/quick-actions-grid';

describe('getQuickActionColumnCount', () => {
  it.each([
    { columns: 2, fontScale: 1, width: 320 },
    { columns: 2, fontScale: 1, width: 360 },
    { columns: 3, fontScale: 1, width: 384 },
    { columns: 3, fontScale: 1, width: 412 },
    { columns: 3, fontScale: 1, width: 720 },
  ])('uses $columns columns at $width px and font scale $fontScale', ({
    columns,
    fontScale,
    width,
  }) => {
    expect(getQuickActionColumnCount(width, fontScale)).toBe(columns);
  });

  it('reduces the column count when text needs more room', () => {
    expect(getQuickActionColumnCount(384, 1.5)).toBe(2);
  });

  it('keeps a large phone on three columns at common accessibility scaling', () => {
    expect(getQuickActionColumnCount(412, 1.15)).toBe(3);
  });
});
