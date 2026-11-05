jest.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (s: Record<string, unknown>) => s },
  Platform: { OS: 'android', select: (obj: any) => obj.android || obj.default },
  Vibration: { vibrate: jest.fn() },
}));

jest.mock('react-native-gesture-handler', () => ({
  Gesture: { Pan: () => ({ onStart: jest.fn().mockReturnThis(), onUpdate: jest.fn().mockReturnThis(), onEnd: jest.fn().mockReturnThis() }) },
  GestureDetector: 'GestureDetector',
}));

jest.mock('react-native-reanimated', () => ({
  default: { View: 'Animated.View' },
  useSharedValue: jest.fn((v: number) => ({ value: v })),
  useAnimatedStyle: jest.fn((f: () => unknown) => f()),
  withSpring: jest.fn((v: number) => v),
}));

import { calculateVelocity, calculateYawVelocity, calculateManualVelocity } from '../../components/Joystick';

describe('calculateVelocity', () => {
  const radius = 60;

  it('returns zero normalized axes at center', () => {
    const { nx, ny } = calculateVelocity(0, 0, radius);
    expect(nx).toBe(0);
    expect(ny).toBe(0);
  });

  it('returns full positive Y when pushed fully forward', () => {
    const { nx, ny } = calculateVelocity(0, -radius, radius);
    expect(ny).toBeCloseTo(1);
    expect(nx).toBeCloseTo(0);
  });

  it('returns negative Y when pulled fully back', () => {
    const { ny } = calculateVelocity(0, radius, radius);
    expect(ny).toBeCloseTo(-1);
  });

  it('returns positive X when pushed fully left', () => {
    const { nx } = calculateVelocity(-radius, 0, radius);
    expect(nx).toBeCloseTo(1);
  });

  it('returns negative X when pushed fully right', () => {
    const { nx } = calculateVelocity(radius, 0, radius);
    expect(nx).toBeCloseTo(-1);
  });

  it('clamps to max values when pushed beyond radius', () => {
    const { ny } = calculateVelocity(0, -radius * 2, radius);
    expect(ny).toBe(1);
  });

  it.each([-40, 0, 40])('ignores lateral finger drift (%s) inside the forward/backward sector', (dx) => {
    expect(calculateVelocity(dx, -60, radius)).toEqual({ nx: 0, ny: 1 });
    expect(calculateVelocity(dx, 60, radius)).toEqual({ nx: 0, ny: -1 });
  });

  it.each([-1, 1])('includes exactly 45 degrees in forward/backward (%s)', (sign) => {
    expect(calculateVelocity(30, sign * 30, radius).nx).toBe(0);
    expect(calculateVelocity(30, sign * 30, radius).ny).toBeCloseTo(-sign * Math.SQRT1_2);
  });

  it('commands only lateral movement beyond 45 degrees', () => {
    expect(calculateVelocity(-60, -59, radius)).toEqual({ nx: 1, ny: 0 });
    expect(calculateVelocity(60, 59, radius)).toEqual({ nx: -1, ny: 0 });
  });
});

describe('manual driving trim', () => {
  const command = (side: number, forward: number, yaw: number) =>
    calculateManualVelocity(side, forward, yaw, 0.4, 0.4, 1.5, 0.03, -0.06);

  it('scales drift compensation with forward/backward stick strength', () => {
    expect(command(0, 1, 0)).toEqual({ linearX: 0.4, linearY: 0.03, angularZ: -0.06 });
    expect(command(0, -0.5, 0)).toEqual({ linearX: -0.2, linearY: 0.015, angularZ: -0.03 });
  });

  it('preserves the other hand on release and removes trim when translation ends', () => {
    expect(command(0, 1, 0.2).angularZ).toBeCloseTo(0.24);
    expect(command(0, 1, 0).angularZ).toBeCloseTo(-0.06);
    expect(command(0, 0, 0.2)).toEqual({ linearX: 0, linearY: 0, angularZ: expect.closeTo(0.3) });
    expect(command(0, 0, 0)).toEqual({ linearX: 0, linearY: 0, angularZ: 0 });
  });

  it('keeps pure lateral movement unchanged and clamps combined yaw', () => {
    expect(command(1, 0, 0)).toEqual({ linearX: 0, linearY: 0.4, angularZ: 0 });
    expect(command(0, 1, -1).angularZ).toBe(-1.5);
  });
});

describe('calculateYawVelocity', () => {
  const radius = 60;

  it('uses only the horizontal displacement', () => {
    expect(calculateYawVelocity(-radius, radius)).toBe(1);
    expect(calculateYawVelocity(radius, radius)).toBe(-1);
    expect(calculateYawVelocity(0, radius)).toBe(0);
  });

  it('clamps yaw to the normalized range', () => {
    expect(calculateYawVelocity(-radius * 3, radius)).toBe(1);
    expect(calculateYawVelocity(radius * 3, radius)).toBe(-1);
  });
});
