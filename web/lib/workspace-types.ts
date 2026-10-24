import type { Contract, Conflict } from "../../shared/types";

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
}
export interface WorkspaceChat {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
}
export interface WorkspaceMember {
  userId: string;
  displayName: string;
  role: "owner" | "member";
  joinedAt: string;
}
export interface WorkspaceInvitation {
  id: string;
  email: string;
  status: "pending" | "accepted" | "expired";
  expiresAt: string;
  inviteUrl?: string;
}
export interface WorkspaceMessage {
  id: string;
  chatId: string;
  workspaceId: string;
  author: { userId: string; name: string; type: "human" };
  body: string;
  createdAt: string;
}
export interface WorkspaceDetail {
  workspace: Workspace;
  chats: WorkspaceChat[];
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  contracts: Contract[];
  conflicts: Conflict[];
}
