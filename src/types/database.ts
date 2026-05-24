export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'delayed' | 'completed' | 'canceled' | 'pending'
export type KanbanStage = 'ideas' | 'backlog' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'canceled'
export type Priority = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
export type UserRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest'
export type ProjectMemberRole = 'lead' | 'contributor' | 'viewer'
export type OrgPlan = 'free' | 'team' | 'business' | 'enterprise'
export type AuditSource = 'app' | 'sheets' | 'api' | 'ai' | 'chat_bot' | 'email'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          plan: OrgPlan
          google_workspace_domain: string | null
          billing_email: string | null
          seats_used: number
          seats_max: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at' | 'seats_used'>
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>
      }
      users: {
        Row: {
          id: string
          org_id: string
          name: string
          email: string
          avatar_url: string | null
          google_id: string | null
          role: UserRole
          department_id: string | null
          position: string | null
          is_active: boolean
          joined_at: string
        }
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'joined_at'>
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      departments: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          head_user_id: string | null
        }
        Insert: Omit<Database['public']['Tables']['departments']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['departments']['Insert']>
      }
      projects: {
        Row: {
          id: string
          workspace_id: string
          code: string
          name: string
          description: string | null
          status: ProjectStatus
          kanban_stage: KanbanStage
          priority: Priority
          start_date: string | null
          end_date: string | null
          estimated_hours: number | null
          progress_pct: number
          budget: number | null
          currency: string
          department_id: string | null
          color: string
          google_calendar_event_id: string | null
          google_drive_folder_id: string | null
          notebooklm_notebook_id: string | null
          health_score: number | null
          health_updated_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['projects']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['projects']['Insert']>
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          assignee_id: string | null
          reporter_id: string
          status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'
          priority: Priority
          due_date: string | null
          estimated_hours: number | null
          actual_hours: number | null
          parent_task_id: string | null
          position: number
          labels: string[]
          google_task_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['tasks']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          user_id: string
          role: ProjectMemberRole
          joined_at: string
          removed_at: string | null
          added_by: string
        }
        Insert: Omit<Database['public']['Tables']['project_members']['Row'], 'id' | 'joined_at'>
        Update: Partial<Database['public']['Tables']['project_members']['Insert']>
      }
      audit_log: {
        Row: {
          id: string
          org_id: string
          entity_type: string
          entity_id: string
          action: string
          field_changed: string | null
          old_value: string | null
          new_value: string | null
          changed_by: string | null
          changed_at: string
          source: AuditSource
          ip_address: string | null
        }
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'changed_at'>
        Update: never
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
