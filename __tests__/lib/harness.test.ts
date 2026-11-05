import { cancelHarnessTest, HARNESS_MESSAGE_TYPE, HARNESS_REQUEST_TOPIC, HARNESS_TEST_PROMPT,
  parseHarnessStatus, requestHarnessTask, requestHarnessTest } from '../../lib/harness';
import type { Transport } from '../../lib/transport';

test('accepts only the harness status contract, including cancellation in progress', () => {
  for (const state of ['idle', 'running', 'cancelling', 'completed', 'failed', 'cancelled']) {
    const status = { request_id: 'one', state, step: 'move_forward', message: '' };
    expect(parseHarnessStatus({ data: JSON.stringify(status) })).toEqual(status);
  }
  for (const value of [null, { data: 'invalid' }, { data: '{}' },
    { data: JSON.stringify({ request_id: 'one', state: 'success', step: '', message: '' }) },
    { data: JSON.stringify({ request_id: 3, state: 'running', step: '', message: '' }) }]) {
    expect(parseHarnessStatus(value)).toBeNull();
  }
});

test('sends the fixed text and cancellation with the same ID, without acquiring phone control', () => {
  const transport = { getStatus: () => 'connected', publish: jest.fn(), callService: jest.fn() } as unknown as Transport;
  expect(requestHarnessTest(transport, 'one')).toBe('one');
  cancelHarnessTest(transport, 'one');
  expect(transport.publish).toHaveBeenNthCalledWith(1, HARNESS_REQUEST_TOPIC, HARNESS_MESSAGE_TYPE,
    { data: JSON.stringify({ request_id: 'one', prompt: HARNESS_TEST_PROMPT }) });
  expect(transport.publish).toHaveBeenNthCalledWith(2, HARNESS_REQUEST_TOPIC, HARNESS_MESSAGE_TYPE,
    { data: JSON.stringify({ request_id: 'one', action: 'cancel' }) });
  expect(transport.callService).not.toHaveBeenCalled();
});

test('does not publish when disconnected or cancel without a task identity', () => {
  const publish = jest.fn();
  const transport = { getStatus: () => 'disconnected', publish } as unknown as Transport;
  expect(() => requestHarnessTest(transport, 'one')).toThrow('disconnected');
  expect(() => requestHarnessTask(transport, '站起来', 'one')).toThrow('disconnected');
  expect(() => cancelHarnessTest(transport, 'one')).toThrow('disconnected');
  expect(() => cancelHarnessTest({ ...transport, getStatus: () => 'connected' }, '')).toThrow('ID');
  expect(publish).not.toHaveBeenCalled();
});

test('sends trimmed user instructions without replacing the requested distance', () => {
  const transport = { getStatus: () => 'connected', publish: jest.fn() } as unknown as Transport;
  const prompt = '站起来，向前走1.5m，然后卧下';
  expect(requestHarnessTask(transport, `  ${prompt}\n`, 'custom')).toBe('custom');
  expect(transport.publish).toHaveBeenCalledWith(HARNESS_REQUEST_TOPIC, HARNESS_MESSAGE_TYPE,
    { data: JSON.stringify({ request_id: 'custom', prompt }) });
});

test('rejects blank or oversized instructions and missing task identities before publishing', () => {
  const transport = { getStatus: () => 'connected', publish: jest.fn() } as unknown as Transport;
  for (const prompt of ['', ' \n ', '前'.repeat(2001)]) {
    expect(() => requestHarnessTask(transport, prompt, 'custom')).toThrow('2000');
  }
  expect(() => requestHarnessTask(transport, '卧下', '')).toThrow('ID');
  expect(transport.publish).not.toHaveBeenCalled();
});
