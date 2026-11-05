jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, StyleSheet: { create: (styles: unknown) => styles },
  Keyboard: { dismiss: jest.fn() }, TextInput: 'TextInput',
  Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('../../lib/robot-speech', () => ({
  recognizeRobotCommand: jest.fn(), cancelRobotCommandRecognition: jest.fn(async () => {}),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../../hooks/useAppTheme', () => ({ useThemeStyles: (factory: any) => {
  const theme = { colors: { accentPrimary: '#00f', textPrimary: '#111', textSecondary: '#666', bgSurface: '#fff' } };
  return { theme, styles: factory(theme) };
} }));
jest.mock('../../stores/useRosStore', () => ({
  useRosStore: require('zustand').create(() => ({ transport: null,
    connection: { status: 'disconnected', url: '', ros: null, error: null } })),
}));

import React from 'react';
import { Alert } from 'react-native';
import { HarnessTestControl } from '../../components/HarnessTestControl';
import { useRosStore } from '../../stores/useRosStore';
import type { Transport } from '../../lib/transport';
import { cancelRobotCommandRecognition, recognizeRobotCommand } from '../../lib/robot-speech';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let tree: any;
let receive: (message: unknown) => void;
let transport: Transport;
const status = (state: string, request_id = '', step = '', message = '') =>
  receive({ data: JSON.stringify({ state, request_id, step, message }) });
const labelled = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
const button = () => tree.root.findAllByType('TouchableOpacity').find((node: any) =>
  ['前进1m测试', '停止任务', '停止中', '测试服务未就绪'].includes(node.props.accessibilityLabel));
const connect = (next: Transport) => useRosStore.setState({ transport: next,
  connection: { status: 'connected', url: 'ws://robot:8765', ros: null, error: null } });

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  transport = { getStatus: () => 'connected', publish: jest.fn(),
    subscribe: jest.fn((_topic, _type, callback) => { receive = callback; return { unsubscribe: jest.fn() }; }) } as unknown as Transport;
  connect(transport);
  await act(async () => { tree = create(<HarnessTestControl zh canStart />); });
});
afterEach(async () => {
  await act(async () => { tree.unmount(); });
  useRosStore.setState({ transport: null });
  jest.useRealTimers();
});

test('requires a live harness and the caller’s idle/authority gate before starting', async () => {
  expect(button().props.disabled).toBe(true);
  await act(async () => { status('idle'); });
  expect(button().props.disabled).toBe(false);
  await act(async () => { tree.update(<HarnessTestControl zh canStart={false} />); });
  expect(button().props.disabled).toBe(true);
  await act(async () => { button().props.onPress(); });
  expect(transport.publish).not.toHaveBeenCalled();
});

test('starts once, correlates replies, and cancels without needing a new control lease', async () => {
  await act(async () => { status('idle'); });
  const start = button().props.onPress;
  await act(async () => { start(); start(); });
  expect(transport.publish).toHaveBeenCalledTimes(1);
  const request = JSON.parse((transport.publish as jest.Mock).mock.calls[0][2].data);
  await act(async () => { status('completed', 'unrelated'); });
  expect(button().props.accessibilityLabel).toBe('停止任务');
  await act(async () => {
    status('running', request.request_id, 'move_forward');
    tree.update(<HarnessTestControl zh canStart={false} />);
  });
  expect(button().props.disabled).toBe(false);
  const stop = button().props.onPress;
  await act(async () => { stop(); stop(); });
  expect(transport.publish).toHaveBeenCalledTimes(2);
  expect(JSON.parse((transport.publish as jest.Mock).mock.calls[1][2].data)).toEqual({
    request_id: request.request_id, action: 'cancel',
  });
  await act(async () => { status('cancelling', request.request_id); });
  expect(button().props.disabled).toBe(true);
  expect(button().props.accessibilityLabel).toBe('停止中');
  await act(async () => {
    status('cancelled', request.request_id, '', '已停止并释放控制权');
    tree.update(<HarnessTestControl zh canStart />);
  });
  expect(button().props.disabled).toBe(false);
});

test('sends the entered task once and disables additional text or voice while pending', async () => {
  await act(async () => {
    status('idle');
    labelled('文字任务').props.onChangeText('  站起来，向前走1.5m，然后卧下  ');
  });
  const send = labelled('发送任务').props.onPress;
  await act(async () => { send(); send(); });
  expect(transport.publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse((transport.publish as jest.Mock).mock.calls[0][2].data).prompt)
    .toBe('站起来，向前走1.5m，然后卧下');
  expect(labelled('发送任务').props.disabled).toBe(true);
  expect(labelled('语音输入').props.disabled).toBe(true);
  expect(labelled('文字任务').props.editable).toBe(false);
  expect(button().props.accessibilityLabel).toBe('停止任务');
  expect(recognizeRobotCommand).not.toHaveBeenCalled();
});

test('displays only the final voice result and sends it once through the same task channel', async () => {
  let finish!: (text: string) => void;
  (recognizeRobotCommand as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  await act(async () => { status('idle'); });
  const recognize = labelled('语音输入').props.onPress;
  await act(async () => { void recognize(); });
  expect(recognizeRobotCommand).toHaveBeenCalledTimes(1);
  expect(transport.publish).not.toHaveBeenCalled();
  expect(button().props.disabled).toBe(true);
  expect(labelled('取消语音').props.disabled).toBe(false);
  await act(async () => { finish('站起来，向前走1m，然后卧下'); });
  expect(labelled('语音识别结果').props.value).toBe('站起来，向前走1m，然后卧下');
  expect(transport.publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse((transport.publish as jest.Mock).mock.calls[0][2].data).prompt)
    .toBe('站起来，向前走1m，然后卧下');
});

test('cancels recording and ignores a late final result without sending a task', async () => {
  let finish!: (text: string) => void;
  (recognizeRobotCommand as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  await act(async () => { status('idle'); });
  await act(async () => { void labelled('语音输入').props.onPress(); });
  await act(async () => { await labelled('取消语音').props.onPress(); });
  expect(cancelRobotCommandRecognition).toHaveBeenCalledTimes(1);
  expect(labelled('语音输入').props.disabled).toBe(false);
  await act(async () => { finish('站起来'); });
  expect(transport.publish).not.toHaveBeenCalled();
});

test.each(['gate', 'stale', 'disconnect', 'reconnect', 'running'])(
  'keeps the transcript but does not execute if %s changes during recognition', async change => {
    let finish!: (text: string) => void;
    (recognizeRobotCommand as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => { status('idle'); });
    await act(async () => { void labelled('语音输入').props.onPress(); });
    const next = { ...transport, publish: jest.fn() } as Transport;
    await act(async () => {
      if (change === 'gate') tree.update(<HarnessTestControl zh canStart={false} />);
      if (change === 'stale') jest.advanceTimersByTime(5000);
      if (change === 'disconnect') useRosStore.setState({
        connection: { status: 'disconnected', url: 'ws://robot:8765', ros: null, error: null },
      });
      if (change === 'reconnect') { connect(next); }
      if (change === 'running') status('running', 'another-task', 'move_forward');
    });
    await act(async () => { finish('站起来'); });
    expect(labelled('语音识别结果').props.value).toBe('站起来');
    expect(transport.publish).not.toHaveBeenCalled();
    expect(next.publish).not.toHaveBeenCalled();
    // Fresh heartbeats or restoration of the gate must never replay speech.
    await act(async () => { status('idle'); tree.update(<HarnessTestControl zh canStart />); });
    expect(transport.publish).not.toHaveBeenCalled();
    expect(next.publish).not.toHaveBeenCalled();
  });

test('speech cancellation and errors do not send a task or keep the input locked', async () => {
  (recognizeRobotCommand as jest.Mock).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('没有可用语音服务'));
  await act(async () => { status('idle'); });
  await act(async () => { await labelled('语音输入').props.onPress(); });
  expect(transport.publish).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => { await labelled('语音输入').props.onPress(); });
  expect(transport.publish).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('语音识别失败', 'Error: 没有可用语音服务');
  expect(labelled('语音输入').props.disabled).toBe(false);
});

test('does not send a voice result after the control panel has unmounted', async () => {
  let finish!: (text: string) => void;
  (recognizeRobotCommand as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  await act(async () => { status('idle'); });
  await act(async () => { void labelled('语音输入').props.onPress(); });
  await act(async () => { tree.unmount(); });
  expect(cancelRobotCommandRecognition).toHaveBeenCalledTimes(1);
  await act(async () => { finish('站起来'); });
  expect(transport.publish).not.toHaveBeenCalled();
});

test('shows the failure instead of a retained step and never retries after status loss or reconnect', async () => {
  await act(async () => { status('idle'); button().props.onPress(); });
  // The first render was still disabled until the idle status was applied.
  await act(async () => { button().props.onPress(); });
  const request = JSON.parse((transport.publish as jest.Mock).mock.calls[0][2].data);
  await act(async () => { status('failed', request.request_id, 'move_forward', '停车未确认'); });
  expect(tree.root.findAllByType('Text').map((node: any) => node.props.children)).toContain('停车未确认');
  await act(async () => { button().props.onPress(); });
  expect(transport.publish).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(button().props.disabled).toBe(true);
  const oldReceive = receive;
  const next = { ...transport, publish: jest.fn() } as Transport;
  await act(async () => { connect(next); });
  await act(async () => {
    oldReceive({ data: JSON.stringify({ state: 'completed', request_id: request.request_id, step: '', message: '' }) });
  });
  expect(button().props.disabled).toBe(true);
  expect(next.publish).not.toHaveBeenCalled();
  expect(transport.publish).toHaveBeenCalledTimes(2);
});
