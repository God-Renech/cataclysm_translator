# P1 Responsibility Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the highest-risk responsibilities out of the monolithic renderer and backend entry files without changing functional behavior.

**Architecture:** Start with a renderer-first extraction that moves cohesive stateful helpers into focused sibling modules while keeping `renderer.ts` as the orchestration shell. After the renderer slice is verified, continue with the same pattern for Rust by separating command wiring from workflow logic.

**Tech Stack:** TypeScript, Tauri, Rust, Node test runner, Cargo test

---

### Task 1: Extract Renderer PO Tab State

**Files:**
- Create: `src/renderer/po-tabs.ts`
- Modify: `src/renderer/renderer.ts`
- Test: `scripts/*.test.mjs`

- [ ] **Step 1: Add a focused PO tab module**

Create a module that owns PO tab state transitions but does not touch DOM directly.

- [ ] **Step 2: Move pure PO tab helpers**

Move these helpers from `renderer.ts` into `po-tabs.ts`:
- `makeContextKey`
- `setPoLanguageSelection` equivalent as an injected callback helper if needed
- `persistActivePoTabContent` logic shape, but parameterized
- `switchPoTab`
- `closePoTab`
- `upsertPoTab`
- PO tab list state types

- [ ] **Step 3: Keep renderer as orchestration shell**

Keep DOM reads/writes in `renderer.ts`, but route tab mutations through the new module.

- [ ] **Step 4: Run verification**

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit message:

```bash
git commit -m "refactor: extract renderer po tab state"
```

### Task 2: Extract Renderer Lang Workflow Helpers

**Files:**
- Create: `src/renderer/lang-workflow.ts`
- Modify: `src/renderer/renderer.ts`
- Test: `scripts/*.test.mjs`

- [ ] **Step 1: Move configuration assembly helpers**

Extract:
- `getModDirsForRun`
- `getLangWorkflowConfig`
- `resolveCfgForMod`
- `pathBaseName`

- [ ] **Step 2: Move workflow action helpers**

Extract reusable async helpers that operate on injected dependencies for:
- scan mods
- prepare/load/save PO
- extract workspace PO segments
- apply workspace back to PO
- bridge inline to lang
- bridge PO to code
- compile MO

- [ ] **Step 3: Leave event binding in renderer**

Keep button wiring in `renderer.ts`, but delegate action bodies to `lang-workflow.ts`.

- [ ] **Step 4: Run verification**

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit message:

```bash
git commit -m "refactor: extract renderer lang workflow helpers"
```

### Task 3: Extract Renderer Workspace Controller

**Files:**
- Create: `src/renderer/workspace-controller.ts`
- Modify: `src/renderer/renderer.ts`
- Test: `scripts/*.test.mjs`

- [ ] **Step 1: Move workspace rendering and refresh helpers**

Extract:
- `getFilteredSegments`
- `updateWorkspaceStats`
- `rebuildWorkspaceIndexes`
- `syncSameSourceTargets`
- `ensureWorkspaceVirtualDom`
- `renderWorkspaceWindow`
- `refreshWorkspaceRows`
- `scheduleWorkspaceRefresh`
- `renderSegments`
- `renderTranslations`

- [ ] **Step 2: Inject DOM/state dependencies**

Build the module as a controller factory that receives state getters/setters and DOM refs instead of importing globals.

- [ ] **Step 3: Keep renderer.ts as boot file**

`renderer.ts` should only:
- resolve DOM
- hold top-level app state
- assemble controllers
- bind events

- [ ] **Step 4: Run verification**

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit message:

```bash
git commit -m "refactor: extract renderer workspace controller"
```

### Task 4: Start Rust Responsibility Split

**Files:**
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/lang_workflow.rs`
- Create: `src-tauri/src/python_runtime.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/main.rs`

- [ ] **Step 1: Move command function declarations into command-focused modules**

Start with lang-related commands only:
- `lang_generate_pot`
- `lang_generate_po`
- `lang_regenerate_po`
- `lang_read_po`
- `lang_write_po`
- `lang_extract_po_segments`
- `lang_apply_po_translations`
- `lang_compile_mo`
- `lang_cleanup_po_plural`
- `lang_bridge_inline_to_lang`
- `lang_bridge_po_to_code`

- [ ] **Step 2: Move Python helpers into `python_runtime.rs`**

Move:
- runtime Python resolution
- command spawning wrappers
- module ensure/install helpers

- [ ] **Step 3: Keep `main.rs` as module wiring + invoke handler**

`main.rs` should mainly:
- declare modules
- re-export used commands
- define the Tauri `invoke_handler`
- host tests only until a later test split

- [ ] **Step 4: Run verification**

Run: `npm run verify`

- [ ] **Step 5: Commit**

Commit message:

```bash
git commit -m "refactor: split tauri lang workflow modules"
```
