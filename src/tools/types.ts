export interface VstackTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: unknown) => Promise<{ content: string }>;
}
