import type { LangWorkflowConfig } from "./lang-workflow.js";

export type ActionMod = {
  path: string;
  name: string;
};

export type ActionPoTab = {
  key: string;
  modPath: string;
  language: string;
  name: string;
  content: string;
  dirty: boolean;
};

export type BridgeInlineOptions = {
  conflictStrategy: "skip" | "frequency" | "frequency2";
  arrayMatchById: boolean;
};

export type Segment = {
  id: string;
  file: string;
  path: string[];
  source: string;
  placeholders: string[];
};

export type WorkspaceTranslation = {
  id: string;
  target: string;
  valid: boolean;
};

export type WorkspaceContextInfo = {
  modPath: string;
  language: string;
  name: string;
};

export type { LangWorkflowConfig };
