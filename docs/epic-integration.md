# Capturing SOPs: Epic Referral Intake

## The Problem Isn't the Integration

An engineering team is building for medical back-office customers who process referral intake. The customers know how to do this work. They know that BlueCross referrals in Texas require a specific prior-auth form submitted through the payer portal before the clinical documents are attached. They know that Epic flags certain `ServiceRequest` resources as urgent but the actual urgency depends on the referring provider's specialty. They know that when a coverage check returns `active` but the plan code starts with `HMO-`, there's an additional step the system doesn't surface.

This knowledge is institutional. It lives in the heads of intake coordinators who've been doing this for years. Some of it is written down — in training binders, in shared docs that were last updated eighteen months ago, in Slack threads that nobody will ever find again. Most of it isn't written down at all. It's the "ask Linda" layer of operations.

The engineering team doesn't need another integration platform. They need a way to capture what Linda knows and make it executable. When Linda leaves or the team scales from five coordinators to fifty, the knowledge should still be there — not as documentation that someone has to read and interpret, but as compiled tools that run the process the way Linda would.

That's the actual problem. Epic's FHIR APIs are the data layer. The institutional knowledge is the value layer. Long Tail is the machine that converts one into the other.

---

## Why Not Traditional Tools

The engineering team has evaluated the usual options:

**Integration middleware** builds point-to-point connections between systems. It moves data. It doesn't encode decisions. The middleware can sync a `ServiceRequest` from Epic to an internal queue, but it can't encode the rule that BlueCross-Texas referrals need a payer portal submission before document attachment. That logic ends up in custom code bolted onto the middleware, maintained by engineers who don't understand the clinical workflow, informed by specs that were wrong the day they were written.

**RPA** records clicks and replays them. It captures *what* the coordinator does in the browser, not *why*. When Epic's UI changes — and it changes often — the recording breaks. When the underlying rule changes — a payer updates their prior-auth requirements — the recording doesn't know. RPA captures motion, not knowledge.

**Custom software** works if the requirements are static. They aren't. Payers change rules quarterly. Epic releases updates. New customers bring new Epic configurations. The engineering team would spend most of their time maintaining the gap between what the software does and what the process requires, mediated by Jira tickets that describe the problem in terms the coordinator understands but the engineer has to translate.

The team wants to bypass all of this. Connect directly to Epic's FHIR APIs. Let the people who know the process describe it. Compile what works into tools. When something changes, the tool fails, the right person fixes it, and the updated knowledge compiles back in. No translation layer between the domain expert and the executable process.

---

## The Starting Point: Epic as Data Layer

Epic exposes FHIR R4 APIs through open.epic.com. The engineering team registers a custom MCP server that wraps the FHIR endpoints their referral workflows need. Each tool maps to a FHIR operation:

- `search_service_requests` — find referrals by patient, date, status, referring provider
- `get_patient` — retrieve patient demographics by MRN or FHIR ID
- `search_coverage` — check insurance status and plan details
- `search_document_references` — find clinical documents linked to a referral
- `create_task` — post a follow-up action back to Epic
- `update_service_request` — transition referral status

The server handles FHIR serialization, pagination, and query syntax. The team tags it `['ehr', 'epic', 'fhir', 'referrals']`. They also register the browser automation server for payer portals that don't have APIs.

This is plumbing. It takes a week. The interesting part is what happens next.

---

## Capturing the First SOP

### The Session with Linda

The engineering team sits with Linda, the senior intake coordinator. They open the Pipeline Designer — the development environment where AI-assisted exploration is allowed — and ask Linda to walk through a referral.

Linda describes it as she does it:

> *"First I pull up the referral in Epic and check the insurance. If it's BlueCross and the plan code starts with HMO, I have to go to the BlueCross portal and submit a prior-auth request before I can attach the clinical docs. If it's Aetna, I check whether the referring provider is in-network first, because out-of-network Aetna referrals need a different form. For everything else, I just verify the coverage is active and move to documents."*

The engineer translates this into a prompt. The dynamic path runs — the LLM discovers the FHIR tools, executes the queries Linda described, follows her branching logic, and produces the result. Every FHIR call is checkpointed. The execution trace captures not just the API calls but the decision structure: the payer-specific branches, the ordering constraints, the conditions that trigger each path.

Linda looks at the output. "That's right, except when the coverage check returns `active` but there's a `copay-exception` extension, you need to flag it for manual review." The engineer adds this to the prompt and reruns. The LLM adjusts.

### What Just Happened

Linda's institutional knowledge — the payer-specific rules, the ordering constraints, the exception handling — is now captured in an execution trace. Not in a spec document. Not in a Jira ticket. In a recorded sequence of API calls with decision points and branching logic that produced the correct result.

The AI is scaffolding here. It translated Linda's description into tool calls. It won't be in the production path. But it bridged the gap between "how Linda describes the process" and "a sequence of API operations that implements it." That gap is where traditional approaches lose fidelity.

### Compilation

The team opens the Compilation Wizard. The compiler examines the execution trace and separates what's fixed (the branching logic, the FHIR query patterns, the payer-specific rules) from what's dynamic (the patient ID, the referral ID, the specific plan code values). It produces a deterministic DAG with typed inputs and typed outputs.

The team names it `intake-referral-coverage-check`, tags it `['referrals', 'insurance', 'epic', 'intake']`, and deploys it. Linda's knowledge about payer-specific coverage rules is now a compiled, versioned, executable tool. No LLM in the execution path. It runs the process the way Linda described it, every time, without Linda.

---

## Capturing the Next SOP, and the Next

The team runs more sessions. Each one captures a different piece of the intake process:

**Document verification.** Maria knows which clinical documents are required for each referral type. Orthopedic referrals need recent imaging. Cardiology needs an EKG report and recent labs. Behavioral health needs a clinical summary but not labs. Maria walks through the logic. The system captures it. The compiled tool checks `DocumentReference` resources against referral-type requirements and identifies what's missing.

**Provider validation.** James knows the receiving provider network. He knows which practices have stopped accepting certain insurance plans, which have capacity constraints, and which require specific referral formats. The compiled tool queries `Practitioner` and `Organization` resources and validates the referral against James's routing knowledge.

**Status transitions.** The team captures the full referral lifecycle: `draft` → `active` → `on-hold` (waiting for documents) → `active` (documents received) → `completed` (scheduled). Each transition has preconditions. Each precondition is a compiled check. The workflow won't advance a referral to `active` unless coverage is verified and required documents are attached — because that's how Linda's team actually does it.

Each compiled tool encodes one person's domain knowledge as an executable, testable, versionable artifact. The SOP isn't a document anymore. It's a tool.

---

## Connecting Directly

### No Middleware in the Middle

The compiled workflows call Epic's FHIR APIs directly. There's no integration platform transforming data between systems. The `ServiceRequest` resource in Epic is the referral. The `Coverage` resource is the insurance. The `Task` resource is the follow-up action. Epic is the source of truth, and the workflows read and write to it without translation.

This matters for a practical reason: when Epic changes something — a new required field, a modified search parameter, an updated extension — the impact is immediate and visible. The compiled tool fails. The system creates an escalation with the full FHIR `OperationOutcome` error. The team knows exactly what changed and where.

With middleware in between, the same change produces a vague data-mapping error three layers deep, and someone spends a week figuring out which system changed what.

### FHIR as the Shared Language

The tools the team builds speak FHIR. This means:

**Epic is the canonical record.** Workflows don't maintain shadow copies of referrals in a separate database. They query Epic for current state and write results back to Epic. If an intake coordinator opens Epic directly, they see the same status the workflow set.

**Tasks stay in Epic.** When a workflow identifies missing documents, it creates a FHIR `Task` resource assigned to the appropriate party. The referring provider's office sees the task in their Epic instance. No separate task-tracking system. No "check the portal for your action items" emails.

**Audit is in the workflow engine.** Every FHIR call, every decision branch, every escalation is recorded in the workflow execution history. The compliance team can trace a referral from intake to scheduling, including which credentials were used, which rules were applied, and which human decisions were made along the way.

---

## Identity: Who's Acting, On Whose Behalf

The engineering team serves multiple back-office customers. Each customer connects to their own Epic instance with their own SMART on FHIR credentials (registered at open.epic.com). The same compiled workflows run against different Epic environments.

**Service accounts per customer.** Each customer gets a bot account with stored Epic credentials — the SMART on FHIR private key, client ID, and token endpoint, encrypted at rest. When a workflow runs for Customer A, the credential cascade resolves Customer A's Epic token automatically.

**Dual identity.** Every workflow execution records who initiated it (the scheduler, the webhook, the human operator) and who it runs as (the customer's service account). The audit trail answers both questions.

**Scope enforcement.** The interceptor injects the principal's scopes into every activity. A customer scoped to `['epic:read', 'epic:referral:write']` cannot trigger a `Task` creation that requires `epic:task:write`. The FHIR token might allow it. The workflow layer doesn't.

**Ephemeral credentials for payer portals.** When a workflow needs to submit a prior-auth form on a payer's web portal, it escalates to a human operator for login credentials. The credential is encrypted, stored with a TTL, exchanged atomically at dispatch time, and deleted after use. It never persists in workflow state.

This isn't a section the team's customers think about. It's plumbing the engineering team builds once. But it's the plumbing that makes "one codebase, many customers, many Epic instances" possible without credential leakage or cross-tenant contamination.

---

## The Living Part: When Knowledge Needs to Update

### Payer Rule Changes

Aetna updates their prior-authorization requirements for orthopedic referrals. The compiled `intake-referral-coverage-check` tool doesn't know this — it encodes last quarter's rules. Referrals that should trigger prior-auth are sailing through without it.

The failure surfaces when a downstream scheduling workflow can't complete because the payer rejects the referral. The escalation includes the full context: which referral, which payer, which step failed, and the payer's rejection reason.

The team brings Linda back to the Pipeline Designer. "Oh, Aetna changed this in March. Now any ortho referral with a plan code starting with `PPO-` also needs prior auth, not just the HMO plans." The engineer reruns the dynamic path with the updated logic. It succeeds. They compile. The new version deploys. The old version is still there for rollback.

Linda's updated knowledge is now in the system. The SOP evolved. No spec document was rewritten. No Jira ticket went through a sprint. The compiled tool *is* the current SOP.

### Epic API Changes

Epic updates their FHIR implementation. A field that was optional on `ServiceRequest` is now required. The compiled tool starts returning 422 errors.

The system doesn't swallow these. Non-2xx FHIR responses throw typed errors with the status code, the `OperationOutcome` body, and the request context. The interceptor catches the failure and escalates with full diagnostic information.

The team uses the dynamic path in development — AI is allowed there — to explore the change against Epic's sandbox. The LLM reads the error, adjusts the query, succeeds. The team compiles the corrected pattern. Production resumes.

### New Customer, Different Epic Configuration

A new customer's Epic instance has a custom extension on `Coverage` resources that indicates whether a plan requires a specialist referral versus an open-access referral. The existing compiled tools don't read this extension.

The team doesn't rewrite the tools. They run a dynamic session against the new customer's sandbox, discover the extension, and compile a customer-specific variant of the coverage check. They tag it `['referrals', 'insurance', 'epic', 'customer-b']`. The routing layer uses tags to match the right tool to the right customer.

The core intake workflow stays the same. The coverage-check step resolves to a different compiled tool depending on which customer's service account is running. The process is the same. The payer-specific and Epic-specific details differ. The tag system handles the routing.

---

## The Composition: SOPs Build on SOPs

Individual compiled tools are building blocks. The full referral intake process composes them:

1. **Validate referral** — check required FHIR fields, verify referring provider, confirm receiving practice accepts the referral type
2. **Check coverage** — payer-specific insurance verification with prior-auth detection
3. **Verify documents** — referral-type-specific clinical document requirements
4. **Resolve gaps** — if documents are missing or prior-auth is needed, escalate to the appropriate party and wait
5. **Transition status** — advance the referral through Epic's status lifecycle with appropriate `Task` creation

Each step is a compiled tool that encodes one person's domain knowledge. The composition is itself compiled — a deterministic DAG that sequences the steps with conditional branches and escalation points. No LLM anywhere in the production path.

The escalation in step 4 is where institutional knowledge grows. When the workflow pauses for a missing document, the coordinator who resolves it might say: "This always happens with referrals from Dr. Chen's office — they never attach the imaging report." That pattern becomes a compiled pre-check that flags Dr. Chen's referrals for document follow-up *before* the gap-resolution step. The SOP gets tighter with use.

---

## The Browser Layer: Payer Portals Without APIs

Some parts of referral intake require browser interaction. Payer authorization portals, legacy fax gateways, state Medicaid enrollment systems — these have web interfaces but no APIs.

The team compiles browser workflows the same way they compile FHIR workflows. In development, the LLM navigates the portal, discovers the form fields, submits the request, and captures the confirmation. The engineer reviews the execution, corrects any brittle selectors, and compiles. In production, the compiled DAG replays the exact browser sequence — no LLM, deterministic, durable.

When a portal redesigns its interface, the compiled script fails. The escalation includes a screenshot of the new layout. The team recompiles against the updated page. The browser backend is pluggable — Playwright locally, a managed browser service in production — but the compiled workflow doesn't change.

This is where "bypassing traditional tools" is most literal. Instead of an RPA platform that records mouse movements and breaks on every UI change, the team has compiled browser workflows that encode the *intent* (submit prior-auth form with these fields) in a structure that can be updated when the surface changes.

---

## What the Engineering Team Built

After three months, the engineering team has delivered something that none of the traditional tools could:

**Executable SOPs.** Each compiled workflow encodes a specific piece of the intake process as described by the people who do it. The SOPs aren't documents — they're running code that produces the same result the domain expert would, deterministically, across every customer's Epic instance.

**A knowledge inventory that grows.** Every session with a domain expert produces compiled tools. Every escalation resolution that reveals a repeatable pattern produces another. The system accumulates operational knowledge monotonically — new compilations add capabilities, version history preserves the evolution.

**Self-maintaining integrations.** When Epic's API changes, the affected tool fails and escalates with precise diagnostic context. The fix is a recompilation, not a rewrite. When a payer changes rules, the domain expert describes the change, the dynamic path validates it, and the compiled tool updates. The engineering team isn't maintaining a gap between spec and implementation because there is no spec — the compiled tool is the specification.

**Customer isolation without code branches.** Service accounts, credential scoping, and tag-based routing handle multi-tenancy. The same compiled workflows serve every customer. Customer-specific variations are separate compiled tools selected by the routing layer. No `if (customer === 'A')` branches in the codebase.

**A compliance-ready audit trail.** Every referral processed has a complete execution record: which FHIR calls were made, which credentials were used, which human decisions were involved, which compiled tool version ran. The data is in Postgres — queryable, exportable, backupable.

### What Didn't Ship

No middleware platform. No RPA licenses. No integration-platform-as-a-service subscription. No custom application with a six-month development timeline and a maintenance budget.

The engineering team wrote one MCP server that wraps Epic's FHIR APIs. They compiled workflows from sessions with domain experts. They deployed it on their own infrastructure — Postgres and containers. The institutional knowledge that previously lived in Linda's head and Maria's training binder now lives in compiled tools that run without either of them present.

---

## From 0 to 1, and 1 to 1.5

The system didn't arrive complete. It grew.

**0 to 1** was the first compiled SOP: Linda's coverage-check workflow running against Epic's sandbox. A single tool that encoded a single person's knowledge about a single piece of the intake process. It proved the concept — institutional knowledge could be captured as a compiled tool and executed without AI, without the domain expert present, against a real FHIR API.

**1 to 1.1** was multi-tenancy: the same tool running against multiple customers' Epic instances with proper credential isolation.

**1.1 to 1.2** was breadth: capturing more SOPs from more domain experts. Document verification from Maria. Provider routing from James. Each session added to the tool inventory.

**1.2 to 1.3** was composition: individual tools assembled into the full intake pipeline, with escalation points where human judgment is still required.

**1.3 to 1.5** is the living part: the system updating itself when the landscape shifts. A payer changes rules, a compiled tool fails, the domain expert describes the change, the tool recompiles. The gap between "how the process works" and "what the system does" stays small because the feedback loop is tight — failure to escalation to resolution to recompilation.

**1.5 to 2** is where it gets interesting. The escalation history reveals patterns. Which payers change rules most often. Which Epic configurations cause the most failures. Which referral types need the most human intervention. The engineering team uses this data to prioritize: build more specific tools where the escalation rate is highest. The system's own operational history guides its evolution.

The long tail of referral edge cases gets shorter. Not because someone anticipated every case, but because the system compiled solutions as the team encountered them. Each solved case is a permanent capability. The SOP library grows. The escalation rate drops. The domain experts spend less time on routine intake and more time on the genuinely novel cases — the ones that actually need human judgment.

That's what a living system looks like. Not software that was correct when it shipped. Software that gets more correct the longer it runs, because it absorbs what the people around it know.
