# Agent Context Debugging

This context describes how a developer inspects and tests the instructions and skills available to coding agents for a task.

## Language

**Context surface**:
An agent-specific place through which instructions or knowledge may become available, such as an instruction file, rule, skill, memory file, or import.
_Avoid_: Memory, prompt

**Effective context**:
The instructions and knowledge a supported agent is expected to receive from the context surfaces this tool can inspect.
_Avoid_: Hidden prompt, actual context

**Context contract**:
A readable, task-scoped set of assertions about what an agent must find, must not receive, or which skill it must expose.
_Avoid_: Prompt, test prompt

**Context assertion**:
One deterministic expectation inside a context contract.
_Avoid_: Rule, prompt

**Static inspection**:
Evidence derived by examining supported context surfaces without running the target agent.
_Avoid_: Context test

**Context trace**:
A report connecting a context assertion to its static evidence and any uncertainty.
_Avoid_: Log, chain of thought

**Agent context test**:
A tool that compares context contracts and statically discoverable agent context to explain missing, different, shadowed, or overexposed instructions.
_Avoid_: Memory layer, context compiler
