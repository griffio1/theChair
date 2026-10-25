import type { Contract, Conflict } from "../../shared/types";

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
  slug?: string;
}
export interface ProjectInfo {
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  hackathonMode: boolean;
  deadline: string | null;
  revision: number;
  updatedAt: string;
  images: ChatImage[];
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
  images?: ChatImage[];
  createdAt: string;
}
export interface ChatImage {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
}
export interface WorkspaceDetail {
  workspace: Workspace;
  chats: WorkspaceChat[];
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  contracts: Contract[];
  conflicts: Conflict[];
}
