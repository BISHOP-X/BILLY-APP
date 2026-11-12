import { syncWebViewport } from '@/lib/web-viewport';

test('portal tracks the keyboard viewport and Safari pan separately', () => {
  const values: Record<string, string> = {};
  const style = { setProperty: (key: string, value: string | null) => { values[key] = value ?? ''; } };
  const source = { innerHeight: 844, visualViewport: { height: 844, offsetTop: 0 } };
  syncWebViewport(source, style);
  expect(values['--billy-viewport-height']).toBe('844px');
  source.visualViewport = { height: 420.5, offsetTop: 62 };
  syncWebViewport(source, style);
  expect(values).toEqual({
    '--billy-app-height': '483px',
    '--billy-viewport-height': '420.5px',
    '--billy-viewport-top': '62px',
  });
  source.visualViewport = { height: 844, offsetTop: 0 };
  syncWebViewport(source, style);
  expect(values['--billy-viewport-height']).toBe('844px');
  expect(values['--billy-viewport-top']).toBe('0px');
});

test('older browsers use innerHeight and empty viewports stay positive', () => {
  const setProperty = jest.fn();
  syncWebViewport({ innerHeight: 600, visualViewport: null }, { setProperty });
  expect(setProperty).toHaveBeenCalledWith('--billy-viewport-height', '600px');
  syncWebViewport({ innerHeight: 0, visualViewport: null }, { setProperty });
  expect(setProperty).toHaveBeenCalledWith('--billy-viewport-height', '1px');
});
