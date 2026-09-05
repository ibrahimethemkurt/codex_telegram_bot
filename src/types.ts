export type Project = {
  slug: string;
  name: string;
  path: string;
};

export type AccessMode = "readOnly" | "workspaceWrite";

export type ThreadSummary = {
  id: string;
  name?: string | null;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  cwd?: string;
  source?: unknown;
  status?:
    | string
    | {
        type?: string;
        activeFlags?: string[];
      };
};

export type StoredThreadItem = {
  type: string;
  text?: string;
  phase?: string | null;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

export type StoredThreadTurn = {
  id: string;
  status: string;
  completedAt?: number | null;
  error?: { message?: string } | null;
  items: StoredThreadItem[];
};

export type StoredThread = ThreadSummary & {
  turns: StoredThreadTurn[];
};

export type TurnResult = {
  turnId: string;
  status: "completed" | "interrupted" | "failed" | string;
  text: string;
  error?: string;
};
