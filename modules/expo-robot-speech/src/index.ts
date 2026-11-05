import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type RobotSpeechState = 'preparing' | 'listening' | 'recognizing';

declare class RobotSpeechModule extends NativeModule<{
  onStateChanged(event: { state: RobotSpeechState }): void;
}> {
  prepare(): Promise<void>;
  recognize(): Promise<string | null>;
  cancel(): Promise<void>;
}

export const robotSpeech = requireOptionalNativeModule<RobotSpeechModule>('ExpoRobotSpeech');
