import type { BudgetBroker } from "./brokers.js";

export interface ModelRequest {
  readonly task: string;
  readonly manuscript: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface ModelResult {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly adapterId: string;
}

export interface ModelAdapter {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResult>;
}

export class MockModelAdapter implements ModelAdapter {
  public readonly id = "mock";

  public async generate(request: ModelRequest): Promise<ModelResult> {
    const addition = `\n\n<!-- Novel Agent Mock Candidate -->\n\n${request.task.trim()}\n`;
    return {
      content: `${request.manuscript.trimEnd()}${addition}`,
      inputTokens: Math.ceil(
        (request.manuscript.length + request.task.length) / 4,
      ),
      outputTokens: Math.ceil(addition.length / 4),
      adapterId: this.id,
    };
  }
}

export class ModelGateway {
  public constructor(
    private readonly adapter: ModelAdapter,
    private readonly budgets: BudgetBroker,
  ) {}

  public get adapterId(): string {
    return this.adapter.id;
  }

  public generate(request: ModelRequest): Promise<ModelResult> {
    this.budgets.reserve({
      maxInputTokens: request.maxInputTokens,
      maxOutputTokens: request.maxOutputTokens,
    });
    return this.adapter.generate(request);
  }
}
