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
import { usePairingStore } from '../../stores/usePairingStore';
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

describe('remote gateway connection', () => {
  const originalRos = useRosStore.getState();
  const originalPairing = usePairingStore.getState();
  let tree: any;
  let connect: jest.Mock;
  const data = { subscribe: () => ({ unsubscribe() {} }) } as unknown as Transport;
  const button = (label: string) => tree.root.findAll((n: any) => n.type === 'ProductButton' && n.props.label === label)[0];
  const fill = async (endpoint: string, token = 'test-token') => {
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: 'Remote endpoint' }).props.onChangeText(endpoint);
      tree.root.findByProps({ accessibilityLabel: 'Remote access token' }).props.onChangeText(token);
    });
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    usePairingStore.setState({ pairing: null, loaded: true });
    useSettingsStore.setState({ language: 'zh' });
    connect = jest.fn(async (url: string) => {
      expect(usePairingStore.getState().pairing).toEqual({ host: 'robot.example.com', user: 'operator', token: 'test-token' });
      useRosStore.setState({ transport: data, connection: { url, status: 'connected', ros: null, error: null } });
    });
    useRosStore.setState({ transport: null, savedConnections: [], connectToUrl: connect,
      connection: { url: '', status: 'disconnected', ros: null, error: null } });
    await act(async () => { tree = create(<NetworkSettings onConnected={() => {}} />); });
    await act(async () => { button('公网连接').props.onPress(); });
  });
  afterEach(async () => {
    await act(async () => { tree.unmount(); });
    useRosStore.setState(originalRos);
    usePairingStore.setState(originalPairing);
  });
  it('saves credentials before connecting and confirms real robot status without joining Wi-Fi', async () => {
    await fill('wss://robot.example.com:443/dog4');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).toHaveBeenCalledWith('wss://robot.example.com:443/dog4');
    expect(waitForRobotControl).toHaveBeenCalledWith(data);
    expect(robotBle!.joinWifi).not.toHaveBeenCalled();
    expect(button('进入控制')).toBeDefined();
  });
  it.each(['ws://robot.example.com', 'https://robot.example.com', 'robot.example.com'])('rejects %s before sending credentials', async (endpoint) => {
    await fill(endpoint);
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).not.toHaveBeenCalled();
    expect(usePairingStore.getState().pairing).toBeNull();
    expect(button('进入控制')).toBeUndefined();
  });
  it('rejects missing credentials', async () => {
    await fill('wss://robot.example.com', '');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(connect).not.toHaveBeenCalled();
  });
  it('does not show robot ready when the gateway has no robot telemetry', async () => {
    (waitForRobotControl as jest.Mock).mockRejectedValueOnce(new Error('Robot offline'));
    await fill('wss://robot.example.com');
    await act(async () => { button('连接公网服务').props.onPress(); });
    expect(button('进入控制')).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).toContain('Robot offline');
  });
});
