import { generateAutonomyRequestId } from './autonomy-runtime';
import type { Transport } from './transport';

export const HARNESS_REQUEST_TOPIC = '/omni/harness/request';
export const HARNESS_STATUS_TOPIC = '/omni/harness/status';
export const HARNESS_MESSAGE_TYPE = 'std_msgs/msg/String';
export const HARNESS_TEST_PROMPT = '起立，向前走1m，然后卧下';
export type HarnessState = 'idle' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type HarnessStatus = { request_id: string; state: HarnessState; step: string; message: string };

export function parseHarnessStatus(message: unknown): HarnessStatus | null {
  try {
    const status = JSON.parse((message as { data: string }).data);
    if (!status || typeof status.request_id !== 'string' ||
        !['idle', 'running', 'cancelling', 'completed', 'failed', 'cancelled'].includes(status.state) ||
        typeof status.step !== 'string' || typeof status.message !== 'string') return null;
    return status;
  } catch { return null; }
}

export function requestHarnessTask(transport: Transport, prompt: string,
  requestId = generateAutonomyRequestId('harness')): string {
  if (transport.getStatus() !== 'connected') throw new Error('机器人未连接 / Robot disconnected');
  const text = prompt.trim();
  if (!text || text.length > 2000) throw new Error('请输入 1–2000 字的指令 / Enter a command of 1–2000 characters');
  if (!requestId) throw new Error('Missing harness request ID');
  transport.publish(HARNESS_REQUEST_TOPIC, HARNESS_MESSAGE_TYPE, {
    data: JSON.stringify({ request_id: requestId, prompt: text }),
  });
  return requestId;
}

export function requestHarnessTest(transport: Transport, requestId = generateAutonomyRequestId('harness')): string {
  return requestHarnessTask(transport, HARNESS_TEST_PROMPT, requestId);
}

export function cancelHarnessTest(transport: Transport, requestId: string): void {
  if (transport.getStatus() !== 'connected') throw new Error('机器人未连接 / Robot disconnected');
  if (!requestId) throw new Error('Missing harness request ID');
  transport.publish(HARNESS_REQUEST_TOPIC, HARNESS_MESSAGE_TYPE, {
    data: JSON.stringify({ request_id: requestId, action: 'cancel' }),
  });
}
