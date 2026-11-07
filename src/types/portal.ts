export interface Profile {
  id: string;
  role: 'admin' | 'client';
  display_name: string;
  active: boolean;
}
export interface Client {
  id: string;
  company: string;
  email: string;
  created_at: string;
}
export interface Conversation {
  id: string;
  workspace_id: string;
  subject: string;
  archived_at: string | null;
  created_at: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
}
export interface ReadReceipt {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
}
export interface Announcement {
  id: string;
  workspace_id: string;
  title: string;
  body: string;
  created_at: string;
}
export interface PortalFile {
  id: string;
  workspace_id: string;
  name: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}
export interface PortalData {
  profiles: Profile[];
  clients: Client[];
  conversations: Conversation[];
  messages: Message[];
  reads: ReadReceipt[];
  announcements: Announcement[];
  files: PortalFile[];
}
export const emptyData: PortalData = {
  profiles: [],
  clients: [],
  conversations: [],
  messages: [],
  reads: [],
  announcements: [],
  files: [],
};
