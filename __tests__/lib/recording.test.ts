import { parseRecordingStatus, recordingDuration, requestRecording } from '../../lib/recording';
import type { Transport } from '../../lib/transport';
const status = { state: 'recording', duration_sec: 61.8, size_bytes: 1000, directory: '/bags/one', error: '', missing_topics: [] };
test('accepts robot status and rejects malformed/stale wire shapes', () => {
  expect(parseRecordingStatus({ data: JSON.stringify(status) })).toEqual(status);
  for (const invalid of [null, { data: 'bad' }, { data: JSON.stringify({ ...status, state: 'unknown' }) },
    { data: JSON.stringify({ ...status, size_bytes: -1 }) }, { data: JSON.stringify({ ...status, missing_topics: [4] }) }]) {
    expect(parseRecordingStatus(invalid)).toBeNull();
  }
  expect(recordingDuration(61.8)).toBe('01:01');
});
test('uses only recorder services and propagates rejection', async () => {
  const callService = jest.fn().mockResolvedValue({ success: true });
  const transport = { callService } as unknown as Transport;
  await requestRecording(transport, 'start');
  await requestRecording(transport, 'stop');
  expect(callService.mock.calls.map((c) => c[0])).toEqual(['/omni/recording/start', '/omni/recording/stop']);
  expect(callService.mock.calls[0][1]).toBe('std_srvs/srv/Trigger');
  callService.mockResolvedValue({ success: false, message: 'disk full' });
  await expect(requestRecording(transport, 'start')).rejects.toThrow('disk full');
});
