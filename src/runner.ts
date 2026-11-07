import { spawn, type ChildProcess } from 'node:child_process';
import { constants, accessSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { HostRunner, RunRequest, RunResult } from './types.js';

const MAX_OUTPUT = 1_000_000;

export function createRealRunner(): HostRunner {
  return {
    lookup: findExecutable,
    run: runProcess,
  };
}

export function findExecutable(bin: string): string | null {
  if (bin.includes('/') || bin.includes('\\')) {
    return canExecute(bin) ? bin : null;
  }
  const pathEnv = process.env.PATH ?? '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, bin + extension);
      if (canExecute(candidate)) return candidate;
    }
  }
  return null;
}

function canExecute(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function runProcess(request: RunRequest): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(request.bin, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish({
        exitCode: null,
        signal: 'SIGTERM',
        stdout,
        stderr,
        timedOut: true,
      });
    }, request.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.slice(0, MAX_OUTPUT - stdout.length);
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
    });
    child.on('error', (error) => {
      killTree(child);
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        spawnError: error.message,
      });
    });
    child.on('close', (code, signal) => {
      killTree(child);
      finish({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

function killTree(child: ChildProcess): void {
  signalGroup(child, 'SIGTERM');
  const followUp = setTimeout(() => signalGroup(child, 'SIGKILL'), 500);
  followUp.unref();
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already be gone.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}
