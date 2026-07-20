/**
 * AgentController — Orchestrates the entire agent system (OpenHands-style)
 * 
 * This is the main entry point for the agent. It:
 * - Initializes all components
 * - Manages the agent loop
 * - Handles plan generation and execution
 * - Manages context and history
 * - Provides the interface for the TUI
 */
import { AgentLoop, AgentState } from './agent-loop.js';
import { PlanManager } from './plan-manager.js';
import { LLMClient } from './llm-client.js';
import { ContextBuilder } from './context-builder.js';
import { HistoryCondenser } from './history-condenser.js';
import { buildSystemPrompt, matchMicroagents } from './system-prompt.js';
import { bus } from '../core/event-bus.js';
import { log, debug } from '../core/logger.js';
import { getConfig } from '../core/config.js';

export class AgentController {
  #loop;
  #planManager;
  #llm;
  #contextBuilder;
  #historyCondenser;
  #registry;
  #sandbox;
  #confirm;
  #config;
  #microagents = [];
  #isRunning = false;

  constructor({ registry, mqtt, sandbox, confirm, config }) {
    this.#registry = registry;
    this.#sandbox = sandbox;
    this.#confirm = confirm;
    this.#config = config || getConfig();

    // Initialize components
    this.#loop = new AgentLoop({
      maxIterations: this.#config.agent?.max_iterations || 100,
      onStateChange: (old, newState) => this.#onStateChange(old, newState),
      onIteration: (data) => this.#onIteration(data),
    });

    this.#planManager = new PlanManager();
    this.#llm = new LLMClient(mqtt, this.#config);
    this.#contextBuilder = new ContextBuilder();
    this.#historyCondenser = new HistoryCondenser({
      maxMessages: this.#config.agent?.max_history || 50,
      maxTokens: this.#config.agent?.max_tokens || 100000,
    });
  }

  // Getters
  get isRunning() { return this.#isRunning; }
  get state() { return this.#loop.state; }
  get plan() { return this.#planManager.currentPlan; }
  get summary() {
    return {
      ...this.#loop.getSummary(),
      hasPlan: !!this.#planManager.currentPlan,
      plan: this.#planManager.currentPlan?.toJSON(),
    };
  }

  /**
   * Load microagents/skills from workspace
   */
  async loadMicroagents(workspace) {
    // Load from .openhands/microagents/ or .pelulu/skills/
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { existsSync } = await import('fs');

    this.#microagents = [];

    // Check common skill locations
    const skillDirs = [
      join(workspace, '.pelulu', 'skills'),
      join(workspace, '.openhands', 'microagents'),
      join(workspace, '.agents', 'skills'),
    ];

    for (const dir of skillDirs) {
      if (!existsSync(dir)) continue;
      try {
        const { readdir } = await import('fs/promises');
        const files = await readdir(dir);
        for (const file of files.filter(f => f.endsWith('.md'))) {
          const content = await readFile(join(dir, file), 'utf-8');
          const parsed = this.#parseSkillFile(content, file);
          if (parsed) this.#microagents.push(parsed);
        }
      } catch {}
    }

    debug('agent', `Loaded ${this.#microagents.length} microagents`);
    return this.#microagents;
  }

  /**
   * Parse a skill/microagent markdown file
   */
  #parseSkillFile(content, filename) {
    // Check for YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      // No frontmatter - always active
      return {
        name: filename.replace('.md', ''),
        trigger: null,
        content: content.trim(),
      };
    }

    // Parse frontmatter
    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // Simple YAML parser for triggers
    const triggerMatch = frontmatter.match(/triggers:\s*\n((?:\s*-\s*.+\n?)+)/);
    let triggers = null;
    if (triggerMatch) {
      triggers = triggerMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
    }

    return {
      name: filename.replace('.md', ''),
      trigger: triggers,
      content: body.trim(),
    };
  }

  /**
   * Run the agent for a user prompt
   */
  async run(userPrompt, options = {}) {
    if (this.#isRunning) {
      throw new Error('Agent is already running');
    }

    this.#isRunning = true;
    const startTime = Date.now();

    try {
      // Build context
      debug('agent', 'Building context...');
      const context = await this.#contextBuilder.build();

      // Match microagents based on user input
      const matchedAgents = matchMicroagents(userPrompt, this.#microagents);

      // Build system prompt
      const systemPrompt = buildSystemPrompt({
        registry: this.#registry,
        config: this.#config,
        context,
        microagents: matchedAgents,
        plan: this.#planManager.currentPlan,
      });

      // If prompt is too long for XiaoZhi, break it into steps first
      const MAX_PROMPT_LEN = 70;
      let effectivePrompt = userPrompt;
      
      if (userPrompt.length > MAX_PROMPT_LEN) {
        debug('agent', `Prompt too long (${userPrompt.length} chars), breaking into steps`);
        bus.emit('agent:decomposing', { task: userPrompt });
        
        // Ask XiaoZhi to break it down (using shorter prompt)
        const shortPrompt = userPrompt.slice(0, MAX_PROMPT_LEN - 20) + '...';
        const decomposeResult = await this.#loop.run(shortPrompt, {
          llm: this.#llm,
          tools: this.#registry,
          context,
          systemPrompt: 'Break this task into 2-3 short steps. Each step max 50 chars.',
          sandbox: this.#sandbox,
          confirm: this.#confirm,
        });
        
        // Use the decomposed result as the effective prompt
        if (decomposeResult.success && decomposeResult.result) {
          effectivePrompt = decomposeResult.result;
          debug('agent', `Decomposed to: ${effectivePrompt}`);
        }
      }

      // Check if we need to generate a plan
      const shouldPlan = options.generatePlan ||
        (this.#config.agent?.auto_plan && this.#isComplexTask(effectivePrompt));

      if (shouldPlan && !this.#planManager.currentPlan) {
        debug('agent', 'Generating plan...');
        bus.emit('agent:planning', { task: effectivePrompt });

        await this.#planManager.generatePlan(
          effectivePrompt,
          this.#llm,
          context
        );

        bus.emit('agent:plan:created', { plan: this.#planManager.currentPlan.toJSON() });

        // Start first step
        const firstStep = this.#planManager.currentPlan.nextPending;
        if (firstStep) {
          this.#planManager.currentPlan.startStep(firstStep.id);
        }
      }

      // Run the agent loop
      const result = await this.#loop.run(effectivePrompt, {
        llm: this.#llm,
        tools: this.#registry,
        context,
        systemPrompt,
        sandbox: this.#sandbox,
        confirm: this.#confirm,
      });

      // Update plan status
      if (this.#planManager.currentPlan) {
        if (result.success) {
          this.#planManager.advanceCurrent(result.result);
        } else {
          this.#planManager.failCurrent(result.result);
        }
      }

      const duration = Date.now() - startTime;
      debug('agent', `Completed in ${duration}ms, ${result.iterations} iterations`);

      return {
        ...result,
        duration,
        plan: this.#planManager.currentPlan?.toJSON(),
      };

    } finally {
      this.#isRunning = false;
    }
  }

  /**
   * Run a single step of the current plan
   */
  async runStep(stepId) {
    const plan = this.#planManager.currentPlan;
    if (!plan) throw new Error('No active plan');

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    plan.startStep(stepId);

    try {
      const result = await this.run(step.description, { generatePlan: false });
      if (result.success) {
        plan.completeStep(stepId, result.result);
      } else {
        plan.failStep(stepId, result.result);
      }
      return result;
    } catch (error) {
      plan.failStep(stepId, error.message);
      throw error;
    }
  }

  /**
   * Abort the current run
   */
  abort() {
    this.#loop.abort();
    debug('agent', 'Abort requested');
  }

  /**
   * Get context for display
   */
  async getContext() {
    return this.#contextBuilder.build();
  }

  /**
   * Get plan status
   */
  getPlanStatus() {
    return this.#planManager.getStatus();
  }

  /**
   * Create a manual plan
   */
  createPlan(goal, steps) {
    return this.#planManager.create(goal, steps);
  }

  /**
   * Clear plan
   */
  clearPlan() {
    this.#planManager.clear();
  }

  /**
   * Reset for new conversation
   */
  reset() {
    this.#loop.clearHistory();
    this.#planManager.clear();
    this.#contextBuilder.clearCache();
    this.#isRunning = false;
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.#loop.history;
  }

  /**
   * Get condensed history for context
   */
  async getCondensedHistory() {
    const history = this.#loop.history;
    if (this.#historyCondenser.needsCondensation(history)) {
      return this.#historyCondenser.condense(history, this.#llm);
    }
    return history;
  }

  // Private methods

  #onStateChange(oldState, newState) {
    bus.emit('agent:state', { from: oldState, to: newState });
  }

  #onIteration(data) {
    bus.emit('agent:iteration', data);

    // Update plan progress
    const plan = this.#planManager.currentPlan;
    if (plan && plan.currentStep) {
      // Auto-advance plan based on tool calls
      for (const tc of data.toolCalls) {
        if (tc.name === 'finish') {
          this.#planManager.advanceCurrent('Completed');
        }
      }
    }
  }

  /**
   * Detect if a task is complex enough to warrant planning
   */
  #isComplexTask(prompt) {
    const complexIndicators = [
      /implement/i,
      /create.*(?:class|function|module|system|feature)/i,
      /refactor/i,
      /migrate/i,
      /fix.*(?:bug|issue|error)/i,
      /add.*(?:support|feature|integration)/i,
      /build/i,
      /design/i,
      /optimize/i,
    ];

    return complexIndicators.some(re => re.test(prompt)) && prompt.length > 50;
  }
}
