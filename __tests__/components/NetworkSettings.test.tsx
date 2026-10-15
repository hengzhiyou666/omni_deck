jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, Linking: {}, Platform: { OS: 'android' },
  StyleSheet: { create: (s: any) => s }, Text: 'Text', TextInput: 'TextInput', View: 'View', Switch: 'Switch',
  useColorScheme: () => 'light',
}));
jest.mock('../../components/ProductUI', () => ({ ProductButton: 'ProductButton', ProductCard: 'View', SectionHeader: 'Text' }));
jest.mock('../../components/TrafficPanel', () => ({ TrafficPanel: () => null }));
jest.mock('../../components/BluetoothConnect', () => ({ BluetoothConnect: () => null }));
jest.mock('../../modules/expo-robot-ble/src', () => ({
  robotBle: { joinWifi: jest.fn(async () => {}) }, requestWifiPermission: jest.fn(async () => {}),
}));
jest.mock('../../lib/robot-hotspot', () => ({
  ...jest.requireActual('../../lib/robot-hotspot'), waitForRobotControl: jest.fn(async () => {}),
}));

import React from 'react';
import { Alert } from 'react-native';
const { act, create } = require('react-test-renderer');
import { NetworkSettings } from '../../components/NetworkSettings';
import { BleTransport } from '../../lib/ble-transport';
import { robotBle } from '../../modules/expo-robot-ble/src';
import { waitForRobotControl } from '../../lib/robot-hotspot';
import { useRosStore } from '../../stores/useRosStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { Transport } from '../../lib/transport';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('switches hotspot to external Wi-Fi over BLE, then joins the phone and verifies the returned data endpoint', async () => {
  const original = useRosStore.getState();
  const ble = new BleTransport();
  const request = jest.spyOn(ble, 'requestNetwork').mockResolvedValue({ mode: 'wifi', endpoint: 'ws://192.168.10.100:8765' });
  const data = { subscribe: () => ({ unsubscribe() {} }) } as unknown as Transport;
  const connect = jest.fn(async (url: string) => {
    useRosStore.setState({ transport: data, connection: { url, status: 'connected', ros: null, error: null } });
  });
  useSettingsStore.setState({ language: 'zh' });
  useRosStore.setState({ transport: ble, connectToUrl: connect,
    connection: { url: 'ble://AA:BB:CC:DD:EE:FF', status: 'connected', ros: null, error: null } });
  let tree: any;
  const button = (label: string) => tree.root.findAll((n: any) => n.type === 'ProductButton' && n.props.label === label)[0];
  try {
    await act(async () => { tree = create(<NetworkSettings />); });
    await act(async () => { button('连接外部 Wi-Fi').props.onPress(); });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Wi-Fi SSID' }).props.onChangeText('test-router');
      tree.root.findByProps({ accessibilityLabel: 'Wi-Fi 密码' }).props.onChangeText('test-password');
    });
    expect(button('关闭热点并连接此 Wi-Fi').props.disabled).toBe(false);
    await act(async () => { button('关闭热点并连接此 Wi-Fi').props.onPress(); });
    expect(request).not.toHaveBeenCalled(); // User must confirm the disruptive network switch.
    const actions = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    await act(async () => { actions[1].onPress(); });
    expect(request).toHaveBeenCalledWith({ action: 'wifi', ssid: 'test-router', password: 'test-password' });
    expect(robotBle!.joinWifi).toHaveBeenCalledWith('test-router', 'test-password', '192.168.10.100');
    expect(connect).toHaveBeenCalledWith('ws://192.168.10.100:8765');
    expect(waitForRobotControl).toHaveBeenCalledWith(data);
  } finally {
    await act(async () => { tree?.unmount(); });
    useRosStore.setState(original);
    request.mockRestore();
  }
});
