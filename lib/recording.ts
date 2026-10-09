import type { Transport } from './transport';

export const RECORDING_STATUS = '/omni/recording/status';
export type RecordingStatus = {
  state: 'idle' | 'starting' | 'recording' | 'stopping' | 'saved' | 'error';
  duration_sec: number;
  size_bytes: number;
  directory: string;
  error: string;
  missing_topics: string[];
};
export function parseRecordingStatus(message: unknown): RecordingStatus | null {
  try {
    const data = JSON.parse((message as { data: string }).data);
    if (!['idle', 'starting', 'recording', 'stopping', 'saved', 'error'].includes(data.state) ||
      !Number.isFinite(data.duration_sec) || data.duration_sec < 0 ||
      !Number.isFinite(data.size_bytes) || data.size_bytes < 0 ||
      typeof data.directory !== 'string' || typeof data.error !== 'string' ||
      !Array.isArray(data.missing_topics) || !data.missing_topics.every((t: unknown) => typeof t === 'string')) return null;
    return data;
  } catch { return null; }
}
export async function requestRecording(transport: Transport, action: 'start' | 'stop') {
  const reply = await transport.callService(`/omni/recording/${action}`,
    'std_srvs/srv/Trigger', {}, { timeoutMs: 5000 });
  if (!reply?.success) throw new Error(reply?.message || 'Recording request rejected');
}
export function recordingDuration(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
