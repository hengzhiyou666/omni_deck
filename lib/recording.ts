import type { Transport } from './transport';

export const RECORDING_STATUS = '/omni/recording/status';
export type RecordingTopic = {
  name: string;
  type: string;
  publisher_count: number;
  received: boolean;
  last_message_age_sec: number | null;
  transient_local: boolean;
  required: boolean;
  frequency_hz?: number;
};
export type RecordingStatus = {
  state: 'idle' | 'starting' | 'recording' | 'stopping' | 'saved' | 'error';
  duration_sec: number;
  size_bytes: number;
  directory: string;
  error: string;
  missing_topics: string[];
  topics?: RecordingTopic[];
  selected_topics?: string[];
};
export function parseRecordingStatus(message: unknown): RecordingStatus | null {
  try {
    const data = JSON.parse((message as { data: string }).data);
    if (!['idle', 'starting', 'recording', 'stopping', 'saved', 'error'].includes(data.state) ||
      !Number.isFinite(data.duration_sec) || data.duration_sec < 0 ||
      !Number.isFinite(data.size_bytes) || data.size_bytes < 0 ||
      typeof data.directory !== 'string' || typeof data.error !== 'string' ||
      !Array.isArray(data.missing_topics) || !data.missing_topics.every((t: unknown) => typeof t === 'string')) return null;
    if (data.topics !== undefined && (!Array.isArray(data.topics) || !data.topics.every((topic: RecordingTopic) =>
      topic && typeof topic.name === 'string' && topic.name.length > 0 && typeof topic.type === 'string' &&
      Number.isInteger(topic.publisher_count) && topic.publisher_count >= 0 && typeof topic.received === 'boolean' &&
      (topic.last_message_age_sec === null || (Number.isFinite(topic.last_message_age_sec) && topic.last_message_age_sec >= 0)) &&
      typeof topic.transient_local === 'boolean' && typeof topic.required === 'boolean' &&
      (topic.frequency_hz === undefined || (Number.isFinite(topic.frequency_hz) && topic.frequency_hz >= 0))))) return null;
    if (data.selected_topics !== undefined && (!Array.isArray(data.selected_topics) ||
      !data.selected_topics.every((topic: unknown) => typeof topic === 'string'))) return null;
    return data;
  } catch { return null; }
}
export async function requestRecording(transport: Transport, action: 'start' | 'stop', topics?: string[]) {
  if (action === 'start' && !topics?.length) throw new Error('Select at least one recording topic');
  const reply = action === 'start'
    ? await transport.callService('/omni/recording/start_selected',
      'omni_robot_interfaces/srv/StartBagRecording', { topics }, { timeoutMs: 5000 })
    : await transport.callService('/omni/recording/stop', 'std_srvs/srv/Trigger', {}, { timeoutMs: 5000 });
  if (!reply?.success) throw new Error(reply?.message || 'Recording request rejected');
}
export function recordingDuration(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
