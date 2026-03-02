export interface AgentResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface AgentAdapter {
  name: string;

  isAvailable(): Promise<boolean>;

  execute(opts: {
    prompt: string;
    cwd: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
  }): Promise<AgentResult>;
}
