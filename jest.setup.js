jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'android',
  select: (obj) => obj.android || obj.default,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Node-based tests have no Android Bluetooth runtime. Transport tests replace
// this native boundary with their own event/acknowledgement fixture.
jest.mock('./modules/expo-robot-ble/src', () => ({
  robotBle: null,
  requestBlePermission: jest.fn(async () => { throw new Error('Android APK required'); }),
}));
