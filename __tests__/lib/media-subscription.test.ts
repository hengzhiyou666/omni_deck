import { mediaSubscription } from '../../lib/media-subscription';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { payloadSize } from '../../lib/network-traffic';
describe('per-client media transmission', () => {
  beforeEach(() => useSettingsStore.setState({ videoEnabled: true, cloudEnabled: true }));
  it('unsubscribes video while cloud and control telemetry remain live; resumes once', () => {
    const closeVideo = jest.fn(), closeCloud = jest.fn(), closePose = jest.fn();
    const video = jest.fn(() => ({ unsubscribe: closeVideo }));
    const a = mediaSubscription('foxglove_msgs/msg/CompressedVideo', video);
    const b = mediaSubscription('sensor_msgs/msg/PointCloud2', () => ({ unsubscribe: closeCloud }));
    const c = mediaSubscription('nav_msgs/msg/Odometry', () => ({ unsubscribe: closePose }));
    useSettingsStore.getState().setVideoEnabled(false);
    expect(closeVideo).toHaveBeenCalledTimes(1); expect(closeCloud).not.toHaveBeenCalled(); expect(closePose).not.toHaveBeenCalled();
    useSettingsStore.getState().setVideoEnabled(true); expect(video).toHaveBeenCalledTimes(2);
    a.unsubscribe(); b.unsubscribe(); c.unsubscribe();
    useSettingsStore.getState().setVideoEnabled(false); useSettingsStore.getState().setVideoEnabled(true);
    expect(video).toHaveBeenCalledTimes(2);
  });
  it('does not start a cloud subscription while off, including late widgets', () => {
    useSettingsStore.getState().setCloudEnabled(false);
    const close = jest.fn(), start = jest.fn(() => ({ unsubscribe: close }));
    const sub = mediaSubscription('sensor_msgs/msg/PointCloud2', start);
    expect(start).not.toHaveBeenCalled();
    useSettingsStore.getState().setCloudEnabled(true); expect(start).toHaveBeenCalledTimes(1);
    sub.unsubscribe(); expect(close).toHaveBeenCalledTimes(1);
  });
  it('counts UTF-8 and sliced binary payloads correctly', () => {
    expect(payloadSize('中😀a')).toBe(8);
    expect(payloadSize(new Uint8Array(100).subarray(5, 15))).toBe(10);
  });
});
