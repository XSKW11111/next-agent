# Coding Style Guidelines

## Purpose and Scope

This document defines language-agnostic coding guidelines for people and agents working in this repository. It applies when planning, implementing, reviewing, or testing code changes.

Language-specific tools and project-specific architecture belong in the relevant project documentation. Those rules may strengthen this guide. They may override a **Should** rule when the reason is documented, but they must not silently override a **Must** rule.

The terms in this document have these meanings:

- **Must**: required for correctness, security, data integrity, or reliable delivery.
- **Should**: the default; deviate only when the alternative is clearer or safer.
- **May**: optional guidance to apply when it improves the code.

When a **Must** rule cannot be followed, document the exception, its risk, and its verification in the relevant code, design, or implementation plan.

## Clarity and Change Scope

- Code must prioritize correctness and clarity over cleverness.
- Names and structure should make the normal execution path easy to follow.
- A source file should stay within 800 lines. Past that limit, split along a domain boundary so each resulting file still has one cohesive path. Do not split a file only to satisfy the limit when the result is a pass-through.
- Preserve existing system behavior unless an approved specification or plan explicitly changes it.
- Understand and characterize affected behavior before editing existing code.
- Make the smallest coherent change that fully satisfies the requirement. The fewest changed lines are not necessarily the safest change.
- Prefer small, incremental changes that can be verified independently and leave the system in a valid state.
- Avoid unrelated refactors, renames, dependency upgrades, or architectural changes.
- Test the intended new behavior and important unchanged behavior near the modification.
- If a broader change is safer than a narrow patch, document why the smaller alternative is inadequate.
- Do not use minimal change as justification for duplicating unsafe logic or bypassing established boundaries.

## Abstraction and Reuse

- Extract an abstraction only when it represents a stable shared concept.
- Small local duplication is acceptable when combining the code would hide meaningful differences.
- Avoid speculative extension points, generic factories, and configuration for hypothetical needs.
- Prefer straightforward composition. Do not impose a programming paradigm when another approach expresses the domain more clearly.
- A wrapper should add a meaningful boundary, policy, or translation; it should not merely rename an already-clear API.

## Naming and API Design

- Use domain language consistently across code, tests, logs, and API contracts.
- Name operations with verbs that describe observable behavior.
- Name boolean values as predicates, such as `is ready`, `has access`, or `can retry`.
- Include units in names when the unit could be ambiguous.
- Avoid unexplained abbreviations and vague names such as `data`, `item`, `manager`, or `helper` when a domain-specific name is available.
- Keep public interfaces minimal and make invalid states difficult to represent.
- Prefer named options when positional arguments would be ambiguous.
- Avoid boolean mode arguments when they substantially change behavior; use explicit operations or explicitly modeled options.
- Do not break a public contract without an approved migration decision.

## Types and Data Modeling

- Reuse a shared type when the meaning, invariants, ownership, and lifecycle are the same.
- Do not share a type solely because two values currently have a similar shape.
- Avoid aliases that only rename another type without adding domain meaning.
- Do not create separate types for layers whose contracts are genuinely identical.
- Create a distinct type when crossing a trust boundary, exposing a different contract, or representing different valid states.
- Prefer inference, narrowing, validation, and explicit state models over unchecked conversions.
- Unsafe casts must not be used to silence a design or type error.
- When an unchecked conversion is unavoidable because the language cannot express an already-proven invariant, keep it narrow and explain the proof when it is not obvious.

## External Input and Validation

Every external input must be treated as potentially absent, malformed, duplicated, or hostile at runtime. This includes API payloads, files, environment values, database results, messages, and third-party responses.

- Accept external data in an untrusted or raw representation.
- Validate required presence, type, range, format, and cross-field rules at the trust boundary.
- Apply defaults only when the contract explicitly defines them.
- Convert successfully validated input into a strict internal representation.
- Required internal fields should remain required after validation.
- Do not weaken internal contracts merely to avoid boundary validation.
- Do not use a non-null or equivalent assertion to pretend an unvalidated value exists.

Language-neutral example:

```text
function parse create-order input(raw input):
    email = require valid email from raw input
    items = require non-empty valid items from raw input
    return validated create-order input(email, items)
```

## Functions, State, and Side Effects

- Each unit should have one cohesive responsibility at its current level of abstraction.
- Prefer immutable values and explicit state transitions.
- Keep domain transformations pure where practical.
- Keep side effects at visible boundaries such as repositories, network clients, files, clocks, and message queues.
- Prefer passing dependencies explicitly.
- Time, randomness, and external identifiers should be controllable when deterministic tests require it.
- Do not duplicate the same authoritative state across layers.

Global state may be used when it represents a genuinely application-wide resource or invariant and materially simplifies the implementation.

- Suitable global resources may include immutable configuration, process-wide telemetry, shared connection pools, and concurrency-safe caches.
- Request, user, session, tenant, or feature-local mutable state must not be global.
- Global resources must have a clear initialization and shutdown lifecycle.
- Global dependencies must be replaceable or resettable in tests.
- Document why application-wide scope is correct when it is not obvious.
- Keep necessary mutation narrow and document its invariant when it is non-obvious.

## Error Classification and Handling

Business outcomes and service failures must be modeled separately.

### Business outcomes

A business outcome is an expected result such as a missing order, an expired offer, insufficient inventory, or a duplicate request.

- Represent it as an explicit result in the normal service flow, not as an unexpected exception.
- Map it to the intended normal protocol response rather than a service-failure response.
- Record it as a structured event.
- Use informational severity for ordinary outcomes and warning severity for suspicious or operationally important outcomes.

### Service failures

A service failure is an unexpected condition such as a dependency outage, timeout, database failure, corrupted response, or programming error.

- Return or propagate an explicit failure contract.
- Map it to the appropriate service-failure or retryable response.
- Log it at error severity with actionable, non-sensitive context.

### General rules

- Never silently swallow an error.
- Validate early and fail with actionable context.
- Catch a failure only to recover, translate it at a boundary, or add useful context.
- Preserve the original cause when wrapping a failure.
- Keep internal diagnostics separate from safe user-facing messages.
- Never return fallback success data after a failure.
- Avoid logging the same failure at every layer; the layer that handles or translates it should normally own the log entry.

Language-neutral example:

```text
result = order service lookup(request)

if result is order not found:
    record business outcome at informational severity
    return expected not-found response

if result is dependency unavailable:
    record service failure at error severity
    return retryable service-failure response
```

## Comments and Technical-Debt Markers

Comments should explain **why** code exists, not narrate what its syntax does.

Comments should document:

- Non-obvious business rules and invariants
- Security, privacy, concurrency, and idempotency constraints
- External-system limitations and compatibility decisions
- Surprising tradeoffs or rejected simpler approaches
- Public behavior that names and contracts cannot express clearly

Comments must not:

- Repeat obvious code or names
- Preserve dead or commented-out code
- Substitute for clearer structure
- Become stale when behavior changes

`TODO` and `FIXME` markers must include either a concrete tracking reference or an explicit next action. Remove markers that are resolved, obsolete, or too vague to act on.

## Test-Driven Development

Test-driven development means writing a failing test, implementing the smallest behavior that makes it pass, and then refactoring while the test remains green.

TDD is required for any project-owned logic, including:

- New APIs and API contract changes
- New business or domain behavior
- Reproducible bug fixes
- Parsers and serializers
- Validation
- Utility functions
- Security and authorization rules
- Concurrency and idempotency behavior
- State transitions
- Project-owned branching, transformation, calculation, or decisions

TDD is preferred but not required for mechanically obvious framework wiring, direct delegation, and pass-through wrappers with no project-owned decision or transformation logic.

Additional testing rules:

- Every behavior change must receive verification proportional to its risk.
- Every reproducible bug fix must include a regression test that fails without the fix.
- Test observable behavior and contracts rather than private implementation details.
- Prefer the narrowest reliable test boundary, then add integration coverage where interaction is the risk.
- Keep tests deterministic and independent of execution order.
- Mock external boundaries, not the behavior under test.
- Critical paths must be covered completely; an arbitrary repository-wide coverage percentage is not a substitute for meaningful tests.
- A passing test suite does not replace review of security, concurrency, or data-integrity invariants.

## Concurrency and Idempotency

- Run operations concurrently only when they are independent.
- Preserve deterministic result ordering when callers depend on input order.
- Serialize operations that share an ordering dependency or mutable resource.
- Bound concurrency for untrusted or potentially large input collections.
- Define whether a group fails fast, returns partial results, or aggregates failures.
- Make retryable side effects idempotent or protect them with an idempotency key.
- Propagate cancellation and timeouts across external calls when supported.
- Do not add concurrency when its complexity has no material benefit.

Language-neutral example:

```text
parallel:
    fetch product recommendations
    execute serial order-resolution lane in request order
    claim promotion using an idempotency key

restore results to caller-visible request order
```

## Security and Privacy

- Validate all data crossing a trust boundary.
- Enforce authentication and authorization at the protected boundary, not only in callers or user interfaces.
- Use least privilege for credentials, permissions, and data access.
- Never place secrets in source code, logs, errors, fixtures, or client-visible output.
- Parameterize executable queries and commands rather than constructing them directly from input.
- Minimize the collection, retention, and exposure of personal or sensitive data.
- Use secure defaults. An omitted security option must not silently disable protection.
- Avoid revealing whether protected records belonging to another user exist.
- Review dependencies and external calls added to sensitive paths.
- Test security rules and failure behavior, not only successful access.

## Dependencies and Third-Party Boundaries

- Prefer existing project capabilities and standard libraries before adding a dependency.
- Add a dependency only when it meaningfully reduces risk, complexity, or maintenance.
- Evaluate maintenance activity, security history, license compatibility, runtime cost, and transitive dependencies.
- Keep third-party APIs behind a small boundary when replacement, translation, or failure handling matters.
- Remove obsolete code made unnecessary by a change, but do not perform speculative cleanup.

## Logging and Observability

- Log at meaningful system boundaries rather than throughout every function.
- Use structured fields and stable event names.
- Include correlation identifiers when available without exposing sensitive data.
- Record the outcome, latency, dependency, and retry information needed for diagnosis.
- Distinguish expected business outcomes from service failures through explicit fields and severity.
- Metrics should measure operational behavior; logs should provide diagnostic context.
- Correctness must not depend on logging succeeding.

## Completion and Review

- Review the final diff, not only individual edited files.
- Run the smallest relevant tests first, followed by the broader checks required by the project.
- Run formatting, static analysis, type checking, builds, and integration checks when the project provides them.
- State exactly what was verified and what remains unverified.
- Do not claim success when required verification did not run or did not pass.
- Keep unrelated changes out of the patch.
- Remove debugging output, temporary flags, stale comments, and dead code.
- Preserve backward compatibility unless an approved change explicitly authorizes a break.
- Update documentation when behavior, contracts, configuration, or operational requirements change.
- Review migrations and other derived artifacts as part of the complete change when applicable.

## Project-Specific Rules and Exceptions

- Project and language-specific documentation may add stricter rules and concrete tools.
- A project-specific rule may override a **Should** guideline when it explains why.
- A **Must** rule may not be overridden silently.
- A necessary exception to a **Must** rule must document the reason, risk, scope, and verification.
- When rules conflict, follow the more specific rule unless doing so would silently weaken a **Must** requirement.
