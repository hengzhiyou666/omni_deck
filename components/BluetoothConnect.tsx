import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ProductButton } from './ProductUI';
import { robotBle, requestBlePermission } from '../modules/expo-robot-ble/src';
import { useRosStore } from '../stores/useRosStore';
import { theme } from '../constants/theme';

export function BluetoothConnect() {
  const router = useRouter();
  const [devices, setDevices] = useState<Record<string, { id: string; name: string; rssi: number }>>({});
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const found = robotBle?.addListener('device', (device: { id: string; name: string; rssi: number }) =>
      setDevices((old) => ({ ...old, [device.id]: device })));
    const failed = robotBle?.addListener('scanError', ({ error }: { error: string }) => { setError(error); setScanning(false); });
    return () => { found?.remove(); failed?.remove(); void robotBle?.stopScan(); };
  }, []);
  useEffect(() => {
    if (!scanning) return;
    const timer = setTimeout(() => setScanning(false), 10000);
    return () => clearTimeout(timer);
  }, [scanning]);
  const scan = async () => {
    try {
      setError(''); await requestBlePermission(); setDevices({});
      await robotBle!.scan(); setScanning(true);
    } catch (e) { setError((e as Error).message); }
  };
  const connect = async (id: string) => {
    setConnecting(true); setError('');
    try {
      useRosStore.getState().setTransportType('ble');
      await useRosStore.getState().connectToUrl(`ble://${id}`);
      const { connection } = useRosStore.getState();
      if (connection.status === 'connected') router.push('/(tabs)/control');
      else setError(connection.error ?? 'Bluetooth connection failed');
    } finally { setConnecting(false); }
  };
  return <View style={{ gap: 10 }}>
    <ProductButton label={scanning ? '扫描中 / Scanning…' : '蓝牙扫描 / Bluetooth scan'} icon="bluetooth" onPress={scan} disabled={scanning || connecting} />
    <Text style={{ color: theme.colors.textSecondary }}>蓝牙支持遥控、姿态和状态回传；视频与点云请使用 Wi-Fi。</Text>
    {Object.values(devices).map((device) => <ProductButton key={device.id}
      label={`${device.name} · ${device.rssi} dBm`} icon="bluetooth" disabled={connecting}
      onPress={() => void connect(device.id)} />)}
    {!!error && <Text style={{ color: '#FF8D83' }}>{error}</Text>}
  </View>;
}
