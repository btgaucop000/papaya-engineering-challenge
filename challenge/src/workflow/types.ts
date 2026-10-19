export type WorkflowState = {
  readonly id: string;
  readonly label: string;
};

export type EffectPhase = "transactional" | "afterCommit";

export type EffectDescriptor = {
  readonly type: string;
  readonly phase: EffectPhase;
  readonly args: Readonly<Record<string, unknown>>;
};

export type LeafCondition = {
  readonly fact: string;
  readonly operator: string;
  readonly value?: unknown;
  readonly valueFromFact?: string;
  readonly description: string;
};

export type Condition =
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition }
  | LeafCondition;

export type WorkflowTransition = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly roles: readonly string[];
  readonly precondition: Condition;
  readonly effects: readonly EffectDescriptor[];
};

export type CycleLimit = {
  readonly transitionId: string;
  readonly counterFact: string;
  readonly max: number;
  readonly errorMessage: string;
};

export type WorkflowDefinition = {
  readonly id: string;
  readonly version: number;
  readonly settings: {
    readonly appealPeriodDays: number;
  };
  readonly roles: readonly string[];
  readonly states: readonly WorkflowState[];
  readonly transitions: readonly WorkflowTransition[];
  readonly cycleLimits: readonly CycleLimit[];
};

export type FactContext = Readonly<Record<string, unknown>>;

export type Actor = {
  readonly userId: string;
  readonly role: string;
};

export type TransitionRequest = {
  readonly currentState: string;
  readonly transitionId: string;
  readonly actor: Actor;
  readonly facts: FactContext;
  readonly reason?: string;
};

export type CounterUpdate = {
  readonly fact: string;
  readonly previousValue: number;
  readonly nextValue: number;
};

export type TransitionPlan = {
  readonly workflowId: string;
  readonly transitionId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actor: Actor;
  readonly reason?: string;
  readonly counterUpdates: readonly CounterUpdate[];
  readonly transactionalEffects: readonly EffectDescriptor[];
  readonly afterCommitEffects: readonly EffectDescriptor[];
};

export type ConditionFailureCode = "CONDITION_NOT_MET" | "FACT_MISSING";

export type ConditionFailure = {
  readonly code: ConditionFailureCode;
  readonly fact?: string;
  readonly message: string;
};

export type OperatorDefinition = {
  readonly operand: "none" | "literal" | "fact";
  readonly evaluate: (left: unknown, right: unknown) => boolean;
};

export type WorkflowRegistries = {
  readonly roles: ReadonlySet<string>;
  readonly facts: ReadonlySet<string>;
  readonly operators: Readonly<Record<string, OperatorDefinition>>;
  readonly effects: Readonly<Record<string, EffectPhase>>;
};
