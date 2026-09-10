import { ContentStore } from "./content-store.js";
import { readContentDocuments } from "./content-documents.js";
import {
  ContentError,
  parseContentRequest,
  type ContentGenerationOptions,
  type ContentGenerationView,
  type ContentGenerator,
  type ContentJob,
} from "./content-types.js";
export type {
  ContentGenerator,
  ContentGenerationOptions,
} from "./content-types.js";

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new ContentError(`${name} must be an integer from ${min} to ${max}`);
  return result;
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Content generation failed")
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+[^\s"']+)/g, "[redacted]")
    .slice(0, 800);
}
export class ContentGenerationQueue {
  private readonly options: Required<ContentGenerationOptions>;
  private readonly generator: ContentGenerator;
  private readonly active = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  private attempts = 0;
  private paused?: string;
  private closed = false;
  constructor(
    private readonly store: ContentStore,
    generator?: ContentGenerator,
    options: ContentGenerationOptions = {},
    private readonly projectDir?: string,
    private readonly budget?: { remaining(): number; take(): boolean },
  ) {
    this.options = {
      maxAttempts: bounded(options.maxAttempts, 12, 0, 100, "maxAttempts"),
      concurrency: bounded(options.concurrency, 1, 1, 4, "content concurrency"),
      maxQueued: bounded(options.maxQueued, 3, 1, 9, "content maxQueued"),
      timeoutMs: bounded(
        options.timeoutMs,
        120000,
        1,
        300000,
        "content timeoutMs",
      ),
      enabled: options.enabled ?? true,
    };
    this.generator =
      generator ??
      (async (request, signal) => {
        const { createPiContentGenerator } = await import("./content-pi.js");
        return createPiContentGenerator(this.store.worldDir)(request, signal);
      });
    store.recover();
    queueMicrotask(() => this.pump());
  }
  private admit(): void {
    if (this.closed)
      throw new ContentError("Content generation host is closing", 409);
    if (!this.options.enabled)
      throw new ContentError(
        "AI content generation is disabled in demo mode",
        429,
      );
    if (this.paused) throw new ContentError(this.paused, 429);
    const pending = this.store.pendingJobs().length;
    if (
      this.attempts + pending >= this.options.maxAttempts ||
      (this.budget && this.budget.remaining() <= pending)
    )
      throw new ContentError(
        "Content generation budget reached. Restart play with a higher --generation-budget.",
        429,
      );
    if (pending >= this.options.maxQueued)
      throw new ContentError(
        "Content generation queue is full. Wait for a running request to complete.",
        429,
      );
  }
  submit(input: unknown): { job: ContentJob; created: boolean } {
    const request = parseContentRequest(input);
    const existing = this.store.matchingJob(request);
    if (existing) {
      this.pump();
      return { job: this.store.getJob(existing.id)!, created: false };
    }
    this.admit();
    const job = this.store.insert(request);
    this.pump();
    return { job: this.store.getJob(job.id)!, created: true };
  }
  retry(id: string): ContentJob {
    const job = this.store.getJob(id);
    if (!job) throw new ContentError("Unknown content job", 404);
    if (job.status === "ready") return job;
    if (job.status !== "failed")
      throw new ContentError("Only failed content jobs can be retried", 409);
    // Login failures require an explicit retry after the user has fixed authentication.
    const paused = this.paused;
    this.paused = undefined;
    try {
      this.admit();
    } catch (error) {
      this.paused = paused;
      throw error;
    }
    this.store.retry(id);
    this.pump();
    return this.store.getJob(id)!;
  }
  cancel(id: string): ContentJob {
    if (!this.store.getJob(id))
      throw new ContentError("Unknown content job", 404);
    this.store.fail(
      id,
      "Content generation cancelled. Retry this job to resume.",
    );
    this.active.get(id)?.abort.abort(new Error("Content generation cancelled"));
    return this.store.getJob(id)!;
  }
  private pump(): void {
    if (this.closed || this.paused || !this.options.enabled) return;
    while (
      this.active.size < this.options.concurrency &&
      this.attempts < this.options.maxAttempts &&
      (!this.budget || this.budget.remaining() > 0)
    ) {
      const pending = this.store
        .pendingJobs()
        .find((job) => !this.active.has(job.id));
      if (!pending) return;
      const job = this.store.claim(pending.id);
      if (!job) continue;
      if (this.budget && !this.budget.take()) {
        this.store.fail(
          job.id,
          "Content generation budget reached. Retry after restarting play with a higher budget.",
          job.attempt,
        );
        return;
      }
      this.attempts++;
      const abort = new AbortController();
      const promise = Promise.resolve()
        .then(() => this.run(job, abort))
        .finally(() => {
          this.active.delete(job.id);
          this.pump();
        });
      this.active.set(job.id, { abort, promise });
    }
  }
  private async run(job: ContentJob, abort: AbortController): Promise<void> {
    const timer = setTimeout(
      () =>
        abort.abort(
          new Error(
            "Content generation timed out. Retry or choose a faster model.",
          ),
        ),
      this.options.timeoutMs,
    );
    let listener: (() => void) | undefined;
    try {
      const input = {
        request: this.store.requestFor(job.id),
        continuity: this.store.continuityFor(job.namespace, job.id),
        ...readContentDocuments(this.store.worldDir, this.projectDir),
      };
      const cancelled = new Promise<never>((_resolve, reject) => {
        listener = () =>
          reject(
            abort.signal.reason ?? new Error("Content generation cancelled"),
          );
        abort.signal.addEventListener("abort", listener, { once: true });
        if (abort.signal.aborted) listener();
      });
      const result = await Promise.race([
        this.generator(input, abort.signal),
        cancelled,
      ]);
      abort.signal.throwIfAborted();
      this.store.publish(job, result);
    } catch (error) {
      if (!this.closed) {
        const message = safeError(error);
        this.store.fail(job.id, message, job.attempt);
        if (
          /authenticat|unauthorized|api.?key|\blogin\b|selected pi model is unavailable|\b401\b|\b403\b/i.test(
            message,
          )
        ) {
          this.paused = message;
          for (const pending of this.store.pendingJobs())
            this.store.fail(pending.id, message);
        }
      }
    } finally {
      clearTimeout(timer);
      if (listener) abort.signal.removeEventListener("abort", listener);
    }
  }
  view(): ContentGenerationView {
    const budgetRemaining = Math.max(
      0,
      Math.min(
        this.options.maxAttempts - this.attempts,
        this.budget?.remaining() ?? Infinity,
      ),
    );
    return {
      active: this.active.size,
      queued: this.store.pendingJobs().length,
      budgetRemaining,
      ...(!this.options.enabled
        ? { blockedReason: "AI content generation is disabled in demo mode" }
        : this.paused
          ? { blockedReason: this.paused }
          : !budgetRemaining
            ? {
                blockedReason:
                  "Content generation budget reached. Saved content remains playable. Restart play with a higher --generation-budget.",
              }
            : {}),
    };
  }
  async idle(): Promise<void> {
    while (this.active.size)
      await Promise.all([...this.active.values()].map((task) => task.promise));
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.active.values())
      task.abort.abort(new Error("Host closing"));
    await this.idle();
    this.store.recover();
  }
}
