import type { Harness } from "shared/types";
import type { SpecBacktestAdapter, SpecBacktestResult } from "@/lib/specx/types";
import { backtestCompiledContract } from "@/lib/specx/contract";

export class LocalSpecBacktestAdapter implements SpecBacktestAdapter {
  async backtest(args: { source: string; compiled: string; harness: Harness; agent: import("shared/types").AgentNode }): Promise<SpecBacktestResult> {
    const source = JSON.parse(args.source) as Parameters<typeof backtestCompiledContract>[1];
    return backtestCompiledContract(args.compiled, source, args.harness, args.agent);
  }
}
