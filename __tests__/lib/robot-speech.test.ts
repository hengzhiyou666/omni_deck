jest.mock('react-native', () => ({
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn(),
  },
  Platform: { OS: 'android' },
}));
jest.mock('../../modules/expo-robot-speech/src', () => ({ robotSpeech: {
  prepare: jest.fn(async () => {}), recognize: jest.fn(), cancel: jest.fn(async () => {}),
  addListener: jest.fn(),
} }));

import { PermissionsAndroid } from 'react-native';
import { robotSpeech } from '../../modules/expo-robot-speech/src';
import { cancelRobotCommandRecognition, prepareRobotCommandRecognition, recognizeRobotCommand } from '../../lib/robot-speech';

const speech = robotSpeech!;
let remove: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  remove = jest.fn();
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('granted');
  (speech.addListener as jest.Mock).mockReturnValue({ remove });
});

test('prepares the model without microphone permission or recording', async () => {
  await prepareRobotCommandRecognition();
  expect(speech.prepare).toHaveBeenCalledTimes(1);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  expect(speech.recognize).not.toHaveBeenCalled();
});

test('forwards native readiness states and removes its listener after the final result', async () => {
  let finish!: (text: string) => void;
  (speech.recognize as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const onState = jest.fn();
  const result = recognizeRobotCommand(onState);
  await Promise.resolve();
  expect(speech.addListener).toHaveBeenCalledWith('onStateChanged', expect.any(Function));
  const notify = (speech.addListener as jest.Mock).mock.calls[0][1];
  notify({ state: 'listening' });
  notify({ state: 'recognizing' });
  expect(onState.mock.calls).toEqual([['listening'], ['recognizing']]);
  finish('向前走1.5米');
  await expect(result).resolves.toBe('向前走1.5米');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('does not begin recording if cancelled while requesting permission', async () => {
  let grant!: (result: string) => void;
  (PermissionsAndroid.request as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { grant = resolve; }));
  const result = recognizeRobotCommand();
  await cancelRobotCommandRecognition();
  grant('granted');
  await expect(result).resolves.toBeNull();
  expect(speech.recognize).not.toHaveBeenCalled();
  expect(speech.addListener).not.toHaveBeenCalled();
});

test('ignores cancelled native states and late results and removes its listener', async () => {
  let finish!: (text: string) => void;
  (speech.recognize as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const onState = jest.fn();
  const result = recognizeRobotCommand(onState);
  await Promise.resolve();
  const notify = (speech.addListener as jest.Mock).mock.calls[0][1];
  await cancelRobotCommandRecognition();
  notify({ state: 'recognizing' });
  finish('站起来');
  await expect(result).resolves.toBeNull();
  expect(onState).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('removes the state listener when native recognition fails', async () => {
  (speech.recognize as jest.Mock).mockRejectedValueOnce(new Error('录音失败'));
  await expect(recognizeRobotCommand()).rejects.toThrow('录音失败');
  expect(remove).toHaveBeenCalledTimes(1);
});
