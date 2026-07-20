/**
 * PlanManager — Task decomposition and execution tracking (OpenHands-style)
 * 
 * Breaks complex tasks into steps, tracks progress, handles failures.
 * The plan is a living document that evolves as the agent works.
 */
import { bus } from '../core/event-bus.js';
import { debug } from '../core/logger.js';

export const StepStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

export class PlanStep {
  constructor({ id, description, status = StepStatus.PENDING, result = null, error = null }) {
    this.id = id;
    this.description = description;
    this.status = status;
    this.result = result;
    this.error = error;
    this.startedAt = null;
    this.completedAt = null;
  }

  start() {
    this.status = StepStatus.IN_PROGRESS;
    this.startedAt = Date.now();
  }

  complete(result) {
    this.status = StepStatus.COMPLETED;
    this.result = result;
    this.completedAt = Date.now();
  }

  fail(error) {
    this.status = StepStatus.FAILED;
    this.error = error;
    this.completedAt = Date.now();
  }

  skip(reason) {
    this.status = StepStatus.SKIPPED;
    this.result = reason;
    this.completedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      description: this.description,
      status: this.status,
      result: this.result,
      error: this.error,
      duration: this.completedAt && this.startedAt ? this.completedAt - this.startedAt : null,
    };
  }
}

export class Plan {
  constructor({ goal, steps = [] }) {
    this.goal = goal;
    this.steps = steps.map((s, i) => new PlanStep({ id: i + 1, ...s }));
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  get currentStep() {
    return this.steps.find(s => s.status === StepStatus.IN_PROGRESS);
  }

  get nextPending() {
    return this.steps.find(s => s.status === StepStatus.PENDING);
  }

  get progress() {
    const total = this.steps.length;
    const completed = this.steps.filter(s => s.status === StepStatus.COMPLETED).length;
    const failed = this.steps.filter(s => s.status === StepStatus.FAILED).length;
    return { total, completed, failed, percent: total ? Math.round((completed / total) * 100) : 0 };
  }

  get isComplete() {
    return this.steps.every(s =>
      s.status === StepStatus.COMPLETED ||
      s.status === StepStatus.FAILED ||
      s.status === StepStatus.SKIPPED
    );
  }

  get hasFailures() {
    return this.steps.some(s => s.status === StepStatus.FAILED);
  }

  startStep(id) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.start();
      this.updatedAt = Date.now();
      bus.emit('plan:step:start', { step: step.toJSON() });
    }
    return step;
  }

  completeStep(id, result) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.complete(result);
      this.updatedAt = Date.now();
      bus.emit('plan:step:complete', { step: step.toJSON(), progress: this.progress });
    }
    return step;
  }

  failStep(id, error) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.fail(error);
      this.updatedAt = Date.now();
      bus.emit('plan:step:fail', { step: step.toJSON(), progress: this.progress });
    }
    return step;
  }

  skipStep(id, reason) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.skip(reason);
      this.updatedAt = Date.now();
    }
    return step;
  }

  /**
   * Add a new step (plan can be modified during execution)
   */
  addStep(description, afterId = null) {
    const id = this.steps.length + 1;
    const step = new PlanStep({ id, description });
    if (afterId) {
      const idx = this.steps.findIndex(s => s.id === afterId);
      this.steps.splice(idx + 1, 0, step);
    } else {
      this.steps.push(step);
    }
    // Re-number steps
    this.steps.forEach((s, i) => s.id = i + 1);
    this.updatedAt = Date.now();
    bus.emit('plan:updated', { plan: this.toJSON() });
    return step;
  }

  /**
   * Remove a pending step
   */
  removeStep(id) {
    const idx = this.steps.findIndex(s => s.id === id && s.status === StepStatus.PENDING);
    if (idx >= 0) {
      this.steps.splice(idx, 1);
      this.steps.forEach((s, i) => s.id = i + 1);
      this.updatedAt = Date.now();
    }
  }

  /**
   * Format plan as prompt for LLM
   */
  toPrompt() {
    const lines = [`Goal: ${this.goal}`, ''];
    for (const step of this.steps) {
      const icon = {
        [StepStatus.PENDING]: '⬜',
        [StepStatus.IN_PROGRESS]: '🔄',
        [StepStatus.COMPLETED]: '✅',
        [StepStatus.FAILED]: '❌',
        [StepStatus.SKIPPED]: '⏭️',
      }[step.status];

      lines.push(`${icon} Step ${step.id}: ${step.description}`);
      if (step.result && step.status === StepStatus.COMPLETED) {
        lines.push(`   Result: ${step.result}`);
      }
      if (step.error && step.status === StepStatus.FAILED) {
        lines.push(`   Error: ${step.error}`);
      }
    }
    lines.push('');
    lines.push(`Progress: ${this.progress.percent}% (${this.progress.completed}/${this.progress.total})`);
    return lines.join('\n');
  }

  /**
   * Format plan for display
   */
  toDisplay() {
    const lines = [`📋 Plan: ${this.goal}`, '─'.repeat(40)];
    for (const step of this.steps) {
      const icon = {
        [StepStatus.PENDING]: '⬜',
        [StepStatus.IN_PROGRESS]: '🔄',
        [StepStatus.COMPLETED]: '✅',
        [StepStatus.FAILED]: '❌',
        [StepStatus.SKIPPED]: '⏭️',
      }[step.status];
      lines.push(`${icon} ${step.id}. ${step.description}`);
    }
    lines.push('─'.repeat(40));
    lines.push(`Progress: ${this.progress.percent}%`);
    return lines.join('\n');
  }

  toJSON() {
    return {
      goal: this.goal,
      steps: this.steps.map(s => s.toJSON()),
      progress: this.progress,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class PlanManager {
  #currentPlan = null;
  #history = [];

  get currentPlan() { return this.#currentPlan; }
  get history() { return [...this.#history]; }

  /**
   * Create a new plan from a goal
   */
  create(goal, steps = []) {
    if (this.#currentPlan && !this.#currentPlan.isComplete) {
      this.#history.push(this.#currentPlan);
    }
    this.#currentPlan = new Plan({ goal, steps });
    bus.emit('plan:created', { plan: this.#currentPlan.toJSON() });
    debug('plan', `Created plan: ${goal} (${steps.length} steps)`);
    return this.#currentPlan;
  }

  /**
   * Let the LLM generate a plan for a task
   */
  async generatePlan(task, llm, context) {
    const prompt = `You are a task planner. Break this task into clear, actionable steps.

Task: ${task}

${context ? `Context:\n${context}` : ''}

Respond with a JSON object:
{
  "goal": "Brief description of the overall goal",
  "steps": [
    { "description": "Step 1 description" },
    { "description": "Step 2 description" }
  ]
}

Rules:
- Each step should be a single, clear action
- Steps should be in logical order
- Maximum 10 steps
- Be specific and actionable`;

    try {
      const response = await llm.chat([
        { role: 'system', content: 'You are a task planning assistant. Respond only with valid JSON.' },
        { role: 'user', content: prompt },
      ]);

      let content = response.content;
      if (Array.isArray(content)) {
        content = content.filter(c => c.type === 'text').map(c => c.text).join('');
      }

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const planData = JSON.parse(jsonMatch[0]);
        return this.create(planData.goal || task, planData.steps || []);
      }
    } catch (err) {
      debug('plan', `Plan generation failed: ${err.message}`);
    }

    // Fallback: create simple plan
    return this.create(task, [{ description: task }]);
  }

  /**
   * Mark current step as complete and move to next
   */
  advanceCurrent(result) {
    if (!this.#currentPlan) return null;
    const current = this.#currentPlan.currentStep;
    if (current) {
      this.#currentPlan.completeStep(current.id, result);
    }
    const next = this.#currentPlan.nextPending;
    if (next) {
      this.#currentPlan.startStep(next.id);
    }
    return next;
  }

  /**
   * Mark current step as failed
   */
  failCurrent(error) {
    if (!this.#currentPlan) return null;
    const current = this.#currentPlan.currentStep;
    if (current) {
      this.#currentPlan.failStep(current.id, error);
    }
    return current;
  }

  /**
   * Get plan status for display
   */
  getStatus() {
    if (!this.#currentPlan) return 'No active plan';
    return this.#currentPlan.toDisplay();
  }

  /**
   * Clear current plan
   */
  clear() {
    if (this.#currentPlan) {
      this.#history.push(this.#currentPlan);
      this.#currentPlan = null;
    }
  }
}
