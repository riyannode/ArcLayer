/**
 * Telegram Notifier — Outbound notifications for provider/evaluator workers.
 *
 * Uses native fetch (no Telegram SDK). Worker-safe — failure does not fail the job.
 *
 * Config:
 *   ARCLAYER_TELEGRAM_ENABLED=true
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...
 *   ARCLAYER_TELEGRAM_MIN_LEVEL=info
 *
 * Events:
 *   worker.started, worker.stopped, identity.failed
 *   job.discovered, job_budget_set, job_funded
 *   runtime.started, runtime.failed, runtime.needs_action
 *   x402.payment_requested, x402.payment_completed
 *   deliverable.published, job.submitted
 *   evaluation.started, evaluation.manual_review
 *   job.completed, job.rejected
 *   reputation.queued, reputation.published, reputation.failed
 *   reconciliation.failed
 *
 * Never includes: private keys, MCP tokens, Circle session data, Telegram bot token.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type NotificationLevel = "info" | "warn" | "error" | "critical";

export type NotificationEvent =
  | "worker.started"
  | "worker.stopped"
  | "identity.failed"
  | "circle.session_failed"
  | "mcp.authentication_failed"
  | "job.discovered"
  | "job_budget_set"
  | "job_funded"
  | "runtime.started"
  | "runtime.failed"
  | "runtime.needs_action"
  | "x402.payment_requested"
  | "x402.payment_completed"
  | "deliverable.published"
  | "job.submitted"
  | "evaluation.started"
  | "evaluation.manual_review"
  | "job.completed"
  | "job.rejected"
  | "reputation.queued"
  | "reputation.published"
  | "reputation.failed"
  | "reconciliation.failed"
  | "job.failed";

export type NotificationPayload = {
  event: NotificationEvent;
  level: NotificationLevel;
  agentId: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type NotifierConfig = {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  minLevel: NotificationLevel;
  /** Optional thread ID for topic-based groups */
  threadId?: string;
};

// ── Level hierarchy ────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<NotificationLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

// ── Event → Level mapping ─────────────────────────────────────────────────

const EVENT_LEVELS: Record<NotificationEvent, NotificationLevel> = {
  "worker.started": "info",
  "worker.stopped": "info",
  "identity.failed": "error",
  "circle.session_failed": "error",
  "mcp.authentication_failed": "error",
  "job.discovered": "info",
  "job_budget_set": "info",
  "job_funded": "info",
  "runtime.started": "info",
  "runtime.failed": "error",
  "runtime.needs_action": "warn",
  "x402.payment_requested": "info",
  "x402.payment_completed": "info",
  "deliverable.published": "info",
  "job.submitted": "info",
  "evaluation.started": "info",
  "evaluation.manual_review": "warn",
  "job.completed": "info",
  "job.rejected": "warn",
  "reputation.queued": "info",
  "reputation.published": "info",
  "reputation.failed": "warn",
  "reconciliation.failed": "error",
  "job.failed": "error",
};

// ── Emoji mapping ──────────────────────────────────────────────────────────

const EVENT_EMOJI: Record<NotificationEvent, string> = {
  "worker.started": "🟢",
  "worker.stopped": "🔴",
  "identity.failed": "🚨",
  "circle.session_failed": "🚨",
  "mcp.authentication_failed": "🚨",
  "job.discovered": "📋",
  "job_budget_set": "💰",
  "job_funded": "✅",
  "runtime.started": "⚙️",
  "runtime.failed": "❌",
  "runtime.needs_action": "⚠️",
  "x402.payment_requested": "💳",
  "x402.payment_completed": "✅",
  "deliverable.published": "📦",
  "job.submitted": "📤",
  "evaluation.started": "🔍",
  "evaluation.manual_review": "⚠️",
  "job.completed": "✅",
  "job.rejected": "❌",
  "reputation.queued": "📊",
  "reputation.published": "✅",
  "reputation.failed": "⚠️",
  "reconciliation.failed": "🚨",
  "job.failed": "❌",
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escape Telegram Markdown v1 special characters in user/runtime content.
 * Prevents garbled messages when payload contains `_`, `*`, `` ` ``, etc.
 */
function escapeTelegramMarkdown(value: string): string {
  return value.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// ── Notifier ───────────────────────────────────────────────────────────────

export class TelegramNotifier {
  private config: NotifierConfig;

  constructor(config: Partial<NotifierConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? process.env.ARCLAYER_TELEGRAM_ENABLED === "true",
      botToken: config.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
      chatId: config.chatId ?? process.env.TELEGRAM_CHAT_ID,
      minLevel: config.minLevel ?? (process.env.ARCLAYER_TELEGRAM_MIN_LEVEL as NotificationLevel) ?? "info",
      threadId: config.threadId,
    };
  }

  /**
   * Send a notification. Silently fails — never throws.
   */
  async notify(payload: NotificationPayload): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.config.botToken || !this.config.chatId) return;

    // Check level threshold
    const eventLevel = EVENT_LEVELS[payload.event] ?? "info";
    if (LEVEL_PRIORITY[eventLevel] < LEVEL_PRIORITY[this.config.minLevel]) return;

    const emoji = EVENT_EMOJI[payload.event] ?? "📢";
    const levelTag = eventLevel === "info" ? "" : ` [${eventLevel.toUpperCase()}]`;

    const text = `${emoji} *${escapeTelegramMarkdown(payload.event)}*${levelTag}\n\n${escapeTelegramMarkdown(payload.message)}`;

    try {
      const body: Record<string, unknown> = {
        chat_id: this.config.chatId,
        text,
        parse_mode: "Markdown",
      };

      if (this.config.threadId) {
        body.message_thread_id = Number(this.config.threadId);
      }

      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown");
        console.warn(`[telegram-notifier] API error ${response.status}: ${errorText}`);
      }
    } catch (err) {
      // Telegram failure must not fail the job
      console.warn(`[telegram-notifier] Send failed: ${err}`);
    }
  }

  /**
   * Convenience: send info-level notification.
   */
  async info(event: NotificationEvent, agentId: string, message: string): Promise<void> {
    await this.notify({ event, level: "info", agentId, message });
  }

  /**
   * Convenience: send warn-level notification.
   */
  async warn(event: NotificationEvent, agentId: string, message: string): Promise<void> {
    await this.notify({ event, level: "warn", agentId, message });
  }

  /**
   * Convenience: send error-level notification.
   */
  async error(event: NotificationEvent, agentId: string, message: string): Promise<void> {
    await this.notify({ event, level: "error", agentId, message });
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let defaultNotifier: TelegramNotifier | null = null;

export function getTelegramNotifier(): TelegramNotifier {
  if (!defaultNotifier) {
    defaultNotifier = new TelegramNotifier();
  }
  return defaultNotifier;
}
