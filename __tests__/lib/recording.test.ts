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
  await requestRecording(transport, 'start', ['/image_left_raw/h265_undistort', '/tf_static']);
  await requestRecording(transport, 'stop');
  expect(callService.mock.calls.map((c) => c[0])).toEqual(['/omni/recording/start_selected', '/omni/recording/stop']);
  expect(callService.mock.calls[0][1]).toBe('omni_robot_interfaces/srv/StartBagRecording');
  expect(callService.mock.calls[0][2]).toEqual({ topics: ['/image_left_raw/h265_undistort', '/tf_static'] });
  expect(callService.mock.calls[1][1]).toBe('std_srvs/srv/Trigger');
  await expect(requestRecording(transport, 'start', [])).rejects.toThrow('Select at least one');
  expect(callService).toHaveBeenCalledTimes(2);
  callService.mockResolvedValue({ success: false, message: 'disk full' });
  await expect(requestRecording(transport, 'start', ['/tf'])).rejects.toThrow('disk full');
});
test('validates robot-side topic checks and accepts old status without permitting a default start', () => {
  const topic = { name: '/tf_static', type: 'tf2_msgs/msg/TFMessage', publisher_count: 1,
    received: true, last_message_age_sec: 600, transient_local: true, required: true };
  const withTopics = { ...status, topics: [topic], selected_topics: ['/tf_static'] };
  expect(parseRecordingStatus({ data: JSON.stringify(withTopics) })).toEqual(withTopics);
  expect(parseRecordingStatus({ data: JSON.stringify({ ...withTopics, topics: [{ ...topic, received: false, last_message_age_sec: null }] }) })).not.toBeNull();
  for (const invalid of [null, { ...topic, publisher_count: -1 }, { ...topic, last_message_age_sec: -1 },
    { ...topic, received: 'yes' }, { ...topic, transient_local: 1 }]) {
    expect(parseRecordingStatus({ data: JSON.stringify({ ...withTopics, topics: [invalid] }) })).toBeNull();
  }
  expect(parseRecordingStatus({ data: JSON.stringify({ ...withTopics, selected_topics: [5] }) })).toBeNull();
});

test('accepts measured frequency, preserves old status without it, and rejects invalid Hz', () => {
  const topic = { name: '/imu', type: 'sensor_msgs/msg/Imu', publisher_count: 1,
    received: true, last_message_age_sec: 0.1, transient_local: false, required: true };
  for (const frequency_hz of [0, 12.5, undefined]) {
    const checked = parseRecordingStatus({ data: JSON.stringify({ ...status, topics: [{ ...topic, frequency_hz }] }) });
    expect(checked?.topics?.[0].frequency_hz).toBe(frequency_hz);
  }
  for (const frequency_hz of [-1, '20', null, Infinity]) {
    expect(parseRecordingStatus({ data: JSON.stringify({ ...status, topics: [{ ...topic, frequency_hz }] }) })).toBeNull();
  }
});
