jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity', Modal: 'Modal', ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ width: 760 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../../hooks/useAppTheme', () => ({ useThemeStyles: (factory: any) => {
  const theme = { colors: { accentPrimary: '#00f', textPrimary: '#111', textSecondary: '#666',
    textMuted: '#888', bgSurface: '#fff', bgElevated: '#fff', statusError: '#f00',
    statusErrorGlow: '#fee', statusConnecting: '#fa0', statusConnected: '#080', borderDefault: '#ddd', onAccent: '#fff' } };
  return { theme, styles: factory(theme) };
} }));
jest.mock('../../stores/useRosStore', () => ({
  useRosStore: require('zustand').create(() => ({ transport: null,
    connection: { status: 'disconnected', url: '', ros: null, error: null } })),
}));

import React from 'react';
import { RecordingControl } from '../../components/RecordingControl';
import { useRosStore } from '../../stores/useRosStore';
import type { RecordingStatus, RecordingTopic } from '../../lib/recording';
import type { Transport } from '../../lib/transport';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let tree: any;
let receive: (message: unknown) => void;
let transport: Transport;
const topic = (name: string, extra: Partial<RecordingTopic> = {}): RecordingTopic => ({
  name, type: 'sensor_msgs/msg/PointCloud2', publisher_count: 1, received: true,
  last_message_age_sec: 0.1, transient_local: false, required: false, ...extra,
});
const topics = [topic('/points', { required: true }), topic('/imu', { required: true }),
  topic('/video', { required: true }), topic('/tf_static', { transient_local: true, last_message_age_sec: 600 }),
  topic('/path', { publisher_count: 0, received: false, last_message_age_sec: null })];
const status: RecordingStatus = { state: 'idle', duration_sec: 0, size_bytes: 0, directory: '', error: '',
  missing_topics: [], topics, selected_topics: [] };
const update = (extra: Partial<RecordingStatus> = {}) => receive({ data: JSON.stringify({ ...status, ...extra }) });
const button = (label: string) => tree.root.findAllByType('TouchableOpacity')
  .find((node: any) => node.props.accessibilityLabel === label);
const modal = () => tree.root.findByType('Modal');
const connect = (next: Transport) => useRosStore.setState({ transport: next,
  connection: { status: 'connected', url: 'ws://robot:8765', ros: null, error: null } });

beforeEach(async () => {
  jest.useFakeTimers();
  transport = { getStatus: () => 'connected', callService: jest.fn().mockResolvedValue({ success: true }),
    subscribe: jest.fn((_topic, _type, callback) => { receive = callback; return { unsubscribe: jest.fn() }; }) } as unknown as Transport;
  connect(transport);
  await act(async () => { tree = create(<RecordingControl zh />); });
  await act(async () => { update(); });
});
afterEach(async () => {
  await act(async () => { tree.unmount(); });
  useRosStore.setState({ transport: null });
  jest.useRealTimers();
});

test('opens topic checks without starting, preserves mandatory topics, and submits only checked topics', async () => {
  await act(async () => { button('开始录包').props.onPress(); });
  expect(modal().props.visible).toBe(true);
  expect(transport.callService).not.toHaveBeenCalled();
  expect(button('/points').props.disabled).toBe(true);
  expect(button('/points').props.accessibilityState.checked).toBe(true);
  expect(button('确认开始录包').props.disabled).toBe(false);
  await act(async () => { button('/tf_static').props.onPress(); });
  expect(button('/tf_static').props.accessibilityState.checked).toBe(false);
  await act(async () => { button('确认开始录包').props.onPress(); });
  expect(transport.callService).toHaveBeenCalledTimes(1);
  expect((transport.callService as jest.Mock).mock.calls[0].slice(0, 3)).toEqual([
    '/omni/recording/start_selected', 'omni_robot_interfaces/srv/StartBagRecording',
    { topics: ['/points', '/imu', '/video', '/path'] },
  ]);
  expect(modal().props.visible).toBe(false);
});

test('uses three compact columns at the phone’s 760dp landscape window width', async () => {
  await act(async () => { button('开始录包').props.onPress(); });
  expect(button('/points').props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ width: '32.5%' }),
  ]));
});

test('mandatory absent publisher, missing samples, or stale data block confirmation until healthy', async () => {
  await act(async () => { button('开始录包').props.onPress(); });
  for (const unhealthy of [{ publisher_count: 0 }, { received: false, last_message_age_sec: null }, { last_message_age_sec: 2.1 }]) {
    await act(async () => { update({ topics: [topic('/points', { required: true, ...unhealthy })] }); });
    expect(button('确认开始录包').props.disabled).toBe(true);
    await act(async () => { button('确认开始录包').props.onPress(); });
    expect(transport.callService).not.toHaveBeenCalled();
  }
  await act(async () => { update(); });
  expect(button('确认开始录包').props.disabled).toBe(false);
});

test('raw video is optional and unchecked by default but can be selected for this bag', async () => {
  await act(async () => { update({ topics: [...topics, topic('/image_left_raw/h265')] }); });
  await act(async () => { button('开始录包').props.onPress(); });
  expect(button('/image_left_raw/h265').props.disabled).toBe(false);
  expect(button('/image_left_raw/h265').props.accessibilityState.checked).toBe(false);
  await act(async () => { button('/image_left_raw/h265').props.onPress(); });
  expect(button('/image_left_raw/h265').props.accessibilityState.checked).toBe(true);
  await act(async () => { button('确认开始录包').props.onPress(); });
  expect((transport.callService as jest.Mock).mock.calls[0][2].topics).toEqual([
    ...topics.map(value => value.name), '/image_left_raw/h265',
  ]);
});

test('optional static and future event topics do not fail a frequency threshold', async () => {
  await act(async () => { button('开始录包').props.onPress(); });
  expect(button('/tf_static').findAllByType('Text').some((node: any) =>
    node.props.children === '发布中')).toBe(true);
  expect(button('/path').props.disabled).toBe(false);
  expect(button('/path').props.accessibilityState.checked).toBe(true);
  expect(button('确认开始录包').props.disabled).toBe(false);
  await act(async () => { button('取消录包').props.onPress(); });
  expect(modal().props.visible).toBe(false);
  expect(transport.callService).not.toHaveBeenCalled();
});

test('puts live topics first with stable priority and uses aligned status/Hz and selection colors', async () => {
  const mixed = [
    topic('/no_sample', { received: false, last_message_age_sec: null, frequency_hz: 0 }),
    topic('/first', { frequency_hz: 8.5 }),
    topic('/latched', { transient_local: true, last_message_age_sec: 600, frequency_hz: 0 }),
    topic('/no_publisher', { publisher_count: 0 }),
    topic('/last', { frequency_hz: 100 }),
  ];
  await act(async () => { update({ topics: mixed }); });
  await act(async () => { button('开始录包').props.onPress(); });
  const order = () => tree.root.findAllByType('TouchableOpacity')
    .filter((node: any) => node.props.accessibilityRole === 'checkbox')
    .map((node: any) => node.props.accessibilityLabel);
  expect(order()).toEqual(['/first', '/latched', '/last', '/no_sample', '/no_publisher']);
  const style = (value: any) => Object.assign({}, ...(Array.isArray(value) ? value : [value]).filter(Boolean));
  expect(style(button('/first').props.style)).toMatchObject({ backgroundColor: '#CFEBD6', borderColor: '#E3AFC7', borderWidth: 1.5 });
  expect(style(button('/no_sample').props.style).backgroundColor).toBe('#ECEFEE');
  const frequency = (name: string) => button(name).findAllByType('Text')
    .find((node: any) => style(node.props.style).width === 42);
  expect(frequency('/first').props.children).toBe('8.5Hz');
  expect(frequency('/latched').props.children).toBe('0.0Hz');
  expect(frequency('/no_publisher').props.children).toBe('--Hz');
  for (const value of mixed) {
    const cell = button(value.name).findAllByType('Text').find((node: any) => style(node.props.style).width === 36);
    expect(cell.props.children).toBe(['/no_sample', '/no_publisher'].includes(value.name) ? '未发布' : '发布中');
  }
  await act(async () => { button('/first').props.onPress(); });
  expect(style(button('/first').props.style).backgroundColor).toBe('#E5F3E8');
  expect(order()).toEqual(['/first', '/latched', '/last', '/no_sample', '/no_publisher']);
});

test('does not fall back to default recording when the robot lacks topic checks', async () => {
  await act(async () => { update({ topics: undefined, selected_topics: undefined }); });
  await act(async () => { button('开始录包').props.onPress(); });
  expect(modal().props.visible).toBe(true);
  expect(button('确认开始录包').props.disabled).toBe(true);
  await act(async () => { button('确认开始录包').props.onPress(); });
  expect(transport.callService).not.toHaveBeenCalled();
});

test('adds late-discovered mandatory topics without resetting optional choices on status refresh', async () => {
  await act(async () => { update({ topics: [] }); });
  await act(async () => { button('开始录包').props.onPress(); });
  expect(button('确认开始录包').props.disabled).toBe(true);
  const lateTopics = [...topics.slice(0, 3), ...Array.from({ length: 16 }, (_, index) => topic(`/optional/${index}`))];
  await act(async () => { update({ topics: lateTopics }); });
  for (const required of ['/points', '/imu', '/video']) {
    expect(button(required).props.accessibilityState.checked).toBe(true);
    expect(button(required).props.disabled).toBe(true);
  }
  expect(button('确认开始录包').props.disabled).toBe(false);
  await act(async () => { button('/optional/0').props.onPress(); });
  expect(button('/optional/0').props.accessibilityState.checked).toBe(true);
  await act(async () => { button('/optional/0').props.onPress(); });
  await act(async () => { update({ topics: lateTopics }); });
  expect(button('/optional/0').props.accessibilityState.checked).toBe(false);
  await act(async () => { button('确认开始录包').props.onPress(); });
  expect((transport.callService as jest.Mock).mock.calls[0][2]).toEqual({ topics: ['/points', '/imu', '/video'] });
});

test('status loss disables confirmation and reconnect clears the previous dialog without sending', async () => {
  await act(async () => { button('开始录包').props.onPress(); });
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(button('确认开始录包').props.disabled).toBe(true);
  const oldReceive = receive;
  const next = { ...transport, callService: jest.fn() } as Transport;
  await act(async () => { connect(next); });
  await act(async () => { oldReceive({ data: JSON.stringify(status) }); });
  expect(modal().props.visible).toBe(false);
  expect(next.callService).not.toHaveBeenCalled();
});

test('stopping an active recording still uses the existing stop service directly', async () => {
  await act(async () => { update({ state: 'recording' }); });
  await act(async () => { button('停止录包').props.onPress(); });
  expect((transport.callService as jest.Mock).mock.calls[0].slice(0, 3)).toEqual([
    '/omni/recording/stop', 'std_srvs/srv/Trigger', {},
  ]);
  expect(modal().props.visible).toBe(false);
});
