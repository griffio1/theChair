import type { Message } from "../../shared/types";
import type { ChatImage } from "./workspace-types";

export type TeamMessageRow = {
  author_user_id?: string;
  image_author_id?: string;
  deleted_at?: string | null;
  id: string;
  author_type: Message["author"]["type"];
  author_name: string;
  kind: Message["kind"];
  body: string;
  ref_id?: string;
  images?: ChatImage[];
  created_at: string;
};

export function teamMessageRows(messages: (Message & { images?: ChatImage[] })[]): TeamMessageRow[] {
  // The chat API also returns synthetic proposal summaries named contractId@version.
  // Only database UUIDs identify real messages that can receive reactions. The
  // ledger refresh supplies each proposal's actual system message and UUID.
  return messages.filter(message => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(message.id))
    .map(message => ({
      id: message.id, author_type: message.author.type, author_name: message.author.name,
      kind: message.kind, body: message.body, ref_id: message.refId,
      images: message.images, created_at: message.createdAt,
    }));
}

export function mergeTeamMessages(previous: TeamMessageRow[], incoming: TeamMessageRow[]): TeamMessageRow[] {
  const rows=new Map(previous.map(row=>[row.id,row]));
  for(const row of incoming)if(!rows.get(row.id)?.deleted_at)rows.set(row.id,row);
  return [...rows.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-200);
}
