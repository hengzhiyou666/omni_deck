import { useSettingsStore } from '../stores/useSettingsStore';
import type { Subscription } from './transport';

/** Reconcile this client's subscriptions only; publishers on the robot stay unchanged. */
export function mediaSubscription(type: string, subscribe: () => Subscription): Subscription {
  const key = /(?:^|\/)PointCloud2$/.test(type) ? 'cloudEnabled'
    : /(?:^|\/)(?:Image|CompressedImage|CompressedVideo)$/.test(type) ? 'videoEnabled' : null;
  if (!key) return subscribe();
  let enabled = useSettingsStore.getState()[key];
  let active = enabled ? subscribe() : null;
  const stop = useSettingsStore.subscribe(state => {
    if (state[key] === enabled) return;
    enabled = state[key];
    active?.unsubscribe(); active = enabled ? subscribe() : null;
  });
  return { unsubscribe() { stop(); active?.unsubscribe(); active = null; } };
}
