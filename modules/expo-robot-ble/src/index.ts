import { requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

export const robotBle = requireOptionalNativeModule('ExpoRobotBle');
export async function requestBlePermission() {
  if (Platform.OS !== 'android' || !robotBle) throw new Error('请使用新版 Android APK / Android APK required');
  const permissions = Number(Platform.Version) >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED))
    throw new Error('请允许蓝牙扫描权限 / Bluetooth permission required');
}
