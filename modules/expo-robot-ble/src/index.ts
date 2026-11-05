import { requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

export const robotBle = requireOptionalNativeModule('ExpoRobotBle');
export async function requestWifiPermission() {
  if (Platform.OS !== 'android' || !robotBle?.joinWifi) throw new Error('请安装新版 Android APK / Updated Android APK required');
  const permission = Number(Platform.Version) >= 33
    ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
    : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const result = await PermissionsAndroid.request(permission);
  if (result !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error('请允许连接附近 Wi-Fi 的权限 / Wi-Fi permission required');
}
export async function requestBlePermission() {
  if (Platform.OS !== 'android' || !robotBle) throw new Error('请使用新版 Android APK / Android APK required');
  const permissions = Number(Platform.Version) >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED))
    throw new Error('请允许蓝牙扫描权限 / Bluetooth permission required');
}
