/**
 * Supervisor - Erlang-style Supervision Tree for Off-chain Processes
 * 
 * Implements the core supervision patterns:
 * - OneForOne: Restart only the crashed process
 * - OneForAll: Restart all children when one crashes
 * - RestForOne: Restart crashed process and all after it
 * 
 * Following the "let it crash" philosophy:
 * - Processes are isolated and fail independently
 * - Supervisors restart failed processes with clean state
 * - Failures propagate up the tree until handled
 */

import { EventEmitter } from 'events';
import type {
  SupervisionStrategy,
  SupervisedProcessConfig,
  SupervisorConfig,
  ProcessStatus,
  Result,
} from '../types.js';

// ============================================================================
// PROCESS INTERFACE
// ============================================================================

/**
 * Interface for supervised processes
 */
export interface SupervisedProcess {
  /** Unique process identifier */
  readonly id: string;
  /** Start the process */
  start(): Promise<void>;
  /** Stop the process gracefully */
  stop(): Promise<void>;
  /** Get current status */
  getStatus(): ProcessStatus;
  /** Check if process is healthy */
  isHealthy(): boolean;
}

/**
 * Events emitted by supervised processes
 */
export interface ProcessEvents {
  started: { id: string };
  stopped: { id: string };
  crashed: { id: string; error: Error };
  restarted: { id: string; attempt: number };
}

// ============================================================================
// SUPERVISOR IMPLEMENTATION
// ============================================================================

/**
 * Supervisor manages a set of child processes according to a strategy
 */
export class Supervisor extends EventEmitter {
  private readonly config: SupervisorConfig;
  private readonly processes: Map<string, SupervisedProcess> = new Map();
  private readonly restartCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private supervisorRestarts: { count: number; windowStart: number } = { count: 0, windowStart: Date.now() };
  private isRunning = false;

  constructor(config: SupervisorConfig) {
    super();
    this.config = config;
  }

  /**
   * Register a process with the supervisor
   */
  registerProcess(process: SupervisedProcess): void {
    if (this.processes.has(process.id)) {
      throw new Error(`Process ${process.id} already registered`);
    }
    this.processes.set(process.id, process);
    this.restartCounts.set(process.id, { count: 0, windowStart: Date.now() });
  }

  /**
   * Start all supervised processes
   */
  async startAll(): Promise<Result<void>> {
    try {
      this.isRunning = true;
      
      for (const [id, process] of this.processes) {
        await this.startProcess(id);
      }
      
      this.emit('started', { supervisorId: this.config.strategy });
      return { success: true, value: undefined };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Stop all supervised processes
   */
  async stopAll(): Promise<void> {
    this.isRunning = false;
    
    // Stop in reverse order
    const processIds = Array.from(this.processes.keys()).reverse();
    
    for (const id of processIds) {
      await this.stopProcess(id);
    }
    
    this.emit('stopped', { supervisorId: this.config.strategy });
  }

  /**
   * Handle a process crash according to supervision strategy
   */
  async handleCrash(processId: string, error: Error): Promise<void> {
    if (!this.isRunning) return;
    
    this.emit('processCrashed', { id: processId, error });
    
    // Check if we should escalate to supervisor crash
    if (this.shouldEscalate(processId)) {
      await this.escalate(error);
      return;
    }
    
    // Apply supervision strategy
    switch (this.config.strategy) {
      case 'OneForOne':
        await this.restartProcess(processId);
        break;
      
      case 'OneForAll':
        await this.restartAll();
        break;
      
      case 'RestForOne':
        await this.restartFromProcess(processId);
        break;
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async startProcess(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (!process) throw new Error(`Process ${id} not found`);
    
    try {
      await process.start();
      this.emit('processStarted', { id });
    } catch (error) {
      // Process failed to start - treat as crash
      await this.handleCrash(id, error as Error);
    }
  }

  private async stopProcess(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (!process) return;
    
    try {
      await process.stop();
      this.emit('processStopped', { id });
    } catch (error) {
      // Log but continue - process may already be crashed
      console.error(`Error stopping process ${id}:`, error);
    }
  }

  private async restartProcess(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (!process) return;
    
    const restartInfo = this.restartCounts.get(id)!;
    const config = this.config.children.find(c => c.id === id);
    
    // Update restart count
    restartInfo.count++;
    this.emit('processRestarting', { id, attempt: restartInfo.count });
    
    // Apply backoff delay
    if (config) {
      await this.delay(config.backoffMs * restartInfo.count);
    }
    
    await this.stopProcess(id);
    await this.startProcess(id);
    
    this.emit('processRestarted', { id, attempt: restartInfo.count });
  }

  private async restartAll(): Promise<void> {
    // Stop all in reverse order
    const processIds = Array.from(this.processes.keys()).reverse();
    for (const id of processIds) {
      await this.stopProcess(id);
    }
    
    // Start all in order
    for (const id of this.processes.keys()) {
      await this.startProcess(id);
    }
  }

  private async restartFromProcess(crashedId: string): Promise<void> {
    const processIds = Array.from(this.processes.keys());
    const crashedIndex = processIds.indexOf(crashedId);
    
    // Stop crashed and all after it (reverse order)
    const toRestart = processIds.slice(crashedIndex).reverse();
    for (const id of toRestart) {
      await this.stopProcess(id);
    }
    
    // Restart in order
    for (const id of toRestart.reverse()) {
      await this.startProcess(id);
    }
  }

  private shouldEscalate(processId: string): boolean {
    const restartInfo = this.restartCounts.get(processId)!;
    const config = this.config.children.find(c => c.id === processId);
    
    if (!config) return false;
    
    const now = Date.now();
    
    // Reset count if outside window
    if (now - restartInfo.windowStart > config.restartWindow) {
      restartInfo.count = 0;
      restartInfo.windowStart = now;
    }
    
    return restartInfo.count >= config.maxRestarts;
  }

  private async escalate(error: Error): Promise<void> {
    // Update supervisor restart count
    const now = Date.now();
    
    if (now - this.supervisorRestarts.windowStart > this.config.restartWindow) {
      this.supervisorRestarts.count = 0;
      this.supervisorRestarts.windowStart = now;
    }
    
    this.supervisorRestarts.count++;
    
    if (this.supervisorRestarts.count >= this.config.maxRestarts) {
      // Supervisor itself crashes - propagate to parent
      this.emit('supervisorCrashed', { error });
      await this.stopAll();
      throw error;
    }
    
    // Restart entire supervision tree
    this.emit('escalated', { error });
    await this.restartAll();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get status of all processes
   */
  getStatus(): Map<string, ProcessStatus> {
    const status = new Map<string, ProcessStatus>();
    
    for (const [id, process] of this.processes) {
      status.set(id, process.getStatus());
    }
    
    return status;
  }
}

// ============================================================================
// ABSTRACT PROCESS BASE CLASS
// ============================================================================

/**
 * Base class for supervised processes
 */
export abstract class BaseProcess implements SupervisedProcess {
  readonly id: string;
  protected status: ProcessStatus = { type: 'Stopped' };
  
  constructor(id: string) {
    this.id = id;
  }
  
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  
  getStatus(): ProcessStatus {
    return this.status;
  }
  
  isHealthy(): boolean {
    return this.status.type === 'Running';
  }
  
  protected setRunning(): void {
    this.status = { type: 'Running' };
  }
  
  protected setStopped(): void {
    this.status = { type: 'Stopped' };
  }
  
  protected setCrashed(errorCode: number, message: string): void {
    this.status = { type: 'Crashed', errorCode, message };
  }
  
  protected setRestarting(): void {
    this.status = { type: 'Restarting' };
  }
}
