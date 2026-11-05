import { PermissionsAndroid, Platform } from 'react-native';
import { robotSpeech as speech, type RobotSpeechState } from '../modules/expo-robot-speech/src';

export type { RobotSpeechState } from '../modules/expo-robot-speech/src';

let attempt = 0;

export async function prepareRobotCommandRecognition(): Promise<void> {
  if (Platform.OS === 'android') await speech?.prepare();
}

export async function recognizeRobotCommand(onState?: (state: RobotSpeechState) => void): Promise<string | null> {
  if (Platform.OS !== 'android' || !speech) {
    throw new Error('请安装支持语音输入的 Android APK');
  }
  const current = ++attempt;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (current !== attempt) return null;
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('请允许麦克风权限以识别语音');
  }
  const subscription = speech.addListener('onStateChanged', event => {
    if (current === attempt) onState?.(event.state);
  });
  try {
    const text = await speech.recognize();
    return current === attempt ? text : null;
  }
  finally { subscription.remove(); }
}

export async function cancelRobotCommandRecognition(): Promise<void> {
  attempt += 1;
  await speech?.cancel();
}
