import { requireOptionalNativeModule } from 'expo-modules-core';

export const robotSpeech = requireOptionalNativeModule<{
  recognize(): Promise<string | null>;
  cancel(): Promise<void>;
}>('ExpoRobotSpeech');
