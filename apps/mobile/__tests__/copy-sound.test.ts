import { Platform } from 'react-native';
import { copyWithSound, muteCopySound } from '@/features/numbers/copy-sound';

test('copy feedback only sounds after successful clipboard write and respects mute', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const start = jest.fn();
  const Original = window.AudioContext;
  window.AudioContext = class {
    state = 'running'; currentTime = 0; destination = {};
    resume = async () => {};
    createOscillator = () => ({ connect: jest.fn(), frequency: { value: 0 }, start, stop: jest.fn(), disconnect: jest.fn() });
    createGain = () => ({ connect: jest.fn(), disconnect: jest.fn(), gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() } });
  } as unknown as typeof AudioContext;
  try {
    muteCopySound(false);
    await expect(copyWithSound('number', async () => false)).rejects.toThrow('Could not copy');
    expect(start).not.toHaveBeenCalled();
    await copyWithSound('number', async () => true);
    expect(start).toHaveBeenCalledTimes(1);
    muteCopySound(true);
    await copyWithSound('code', async () => true);
    expect(start).toHaveBeenCalledTimes(1);
    await expect(copyWithSound('code', async () => { throw new Error('clipboard denied'); })).rejects.toThrow('clipboard denied');
  } finally {
    window.AudioContext = Original;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    muteCopySound(false);
  }
});
