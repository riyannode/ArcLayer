/**
 * Runner Registry — Console-side module for managing registered runners,
 * HMAC-signed dispatch, and dispatch logging.
 *
 * Usage:
 *   import { dispatchToRunner, registerRunner, listRunners } from '@/lib/runner-registry';
 */
export * from './types';
export { registerRunner, getRunner, getRunnerSecret, listRunners, findRunnerForTask, touchRunner, insertDispatchLog, listDispatchLogs } from './store';
export { signDispatchRequest, buildHmacPayload, sha256Hex, hmacSha256Hex } from './hmac-signer';
export { dispatchToRunner } from './dispatch';
