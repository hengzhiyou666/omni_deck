import { PermissionsAndroid, Platform } from 'react-native';
import { robotSpeech as speech } from '../modules/expo-robot-speech/src';

let attempt = 0;

export async function recognizeRobotCommand(): Promise<string | null> {
  if (Platform.OS !== 'android' || !speech) {
    throw new Error('请安装支持语音输入的 Android APK');
  }
  const current = ++attempt;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (current !== attempt) return null;
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('请允许麦克风权限以识别语音');
  }
  return speech.recognize();
}

export async function cancelRobotCommandRecognition(): Promise<void> {
  attempt += 1;
  await speech?.cancel();
}
