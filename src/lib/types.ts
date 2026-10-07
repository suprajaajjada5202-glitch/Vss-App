export type RoleName = "super_admin" | "admin" | "manager" | "employee";

export type UserStatus = "active" | "inactive" | "on_leave";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "completed" | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type ChatType = "direct" | "group" | "announcement";

export type NotificationType =
  | "task_assigned"
  | "task_status"
  | "chat_message"
  | "profile_updated"
  | "announcement"
  | "system";

export type Role = {
  id: string;
  name: RoleName;
  display_name: string;
  description: string | null;
  permissions: Record<string, string[]>;
};

export type AppUser = {
  id: string;
  email: string;
  role_id: string;
  status: UserStatus;
  last_sign_in_at: string | null;
  created_at: string;
  role?: Role;
  profile?: Profile;
  employee?: Employee;
};

export type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  location: string | null;
  bio: string | null;
  date_of_birth: string | null;
};

export type Employee = {
  id: string;
  user_id: string;
  employee_code: string;
  hire_date: string | null;
  manager_id: string | null;
  employment_type: string | null;
  skills: string[] | null;
  user?: AppUser;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  due_date: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  assignments?: TaskAssignment[];
  comments?: TaskComment[];
  history?: TaskHistory[];
};

export type TaskAssignment = {
  id: string;
  task_id: string;
  user_id: string;
  assigned_by: string | null;
  profile?: Profile;
};

export type TaskComment = {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: Profile;
};

export type TaskHistory = {
  id: string;
  task_id: string;
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type Chat = {
  id: string;
  type: ChatType;
  name: string | null;
  created_by: string | null;
  created_at: string;
  participants?: ChatParticipant[];
  last_message?: ChatMessage | null;
  unread?: number;
};

/** One row of the `my_chats()` RPC. */
export type ChatSummary = {
  id: string;
  type: ChatType;
  name: string | null;
  title: string;
  unread: number;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
};

export type ChatParticipant = {
  id: string;
  chat_id: string;
  user_id: string;
  last_read_at: string | null;
  profile?: Profile;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
  sender?: Pick<Profile, "full_name" | "avatar_url">;
};

export type AppNotification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type ActivityLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Profile;
};

export type SessionUser = {
  id: string;
  email: string;
  status: UserStatus;
  mustChangePassword: boolean;
  role: RoleName;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  employeeCode: string | null;
  permissions: Record<string, string[]>;
};
