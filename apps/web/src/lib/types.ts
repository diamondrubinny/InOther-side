import type { Locale, MediaKind, MediaStatus, Relation } from "@inother/shared";

export interface Me {
  id: string;
  email: string;
  displayName: string;
  locale: Locale;
  dir: "rtl" | "ltr";
  emailVerified: boolean;
  mfaEnabled: boolean;
  role: "user" | "staff";
  reauthValid: boolean;
}

export interface VaultSummary {
  id: string;
  status: "building" | "release_pending" | "released" | "never_release";
  releaseWaitDays: number;
  requireSecondExecutor: boolean;
  neverRelease: boolean;
  openingMessage: string | null;
  counts: { beneficiaries: number; executors: number; stories: number; answers: number; media: number };
  completeness: {
    answered: number;
    totalQuestions: number;
    percent: number;
    topics: { id: string; total: number; answered: number }[];
    checklist: { hasBeneficiary: boolean; hasExecutor: boolean; hasSecondExecutor: boolean; hasOpeningMessage: boolean };
  };
}

export interface Person {
  id: string;
  name: string;
  email: string;
  relation: Relation;
  notifyBeforeDeath?: boolean;
  status: "designated" | "invited" | "confirmed" | "accepted" | "declined" | "removed";
}

export interface StoryMeta {
  id: string;
  title: string;
  audience: "all" | "specific";
  beneficiaryIds: string[];
  releaseRule: "on_release" | "date" | "on_topic";
  releaseAt: string | null;
  topic: string | null;
  delivery: "persona_tells" | "original_only";
  sensitivityAck: boolean;
}
export interface Story extends StoryMeta {
  body: string;
}

export interface Answer {
  questionId: string;
  text: string;
  updatedAt: string;
}

export interface CatalogTopic {
  id: string;
  title: string;
  questions: { id: string; text: string; sensitive: boolean }[];
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  statusReason: string | null;
  contentType: string;
  sizeBytes: number;
  label: string | null;
  storyId: string | null;
  createdAt: string;
  transcriptStatus?: "none" | "pending" | "done" | "failed";
}
