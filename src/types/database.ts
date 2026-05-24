export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'delayed' | 'completed' | 'canceled' | 'pending'
export type KanbanStage = 'ideas' | 'backlog' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'canceled'
export type Priority = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
export type UserRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest'
export type ProjectMemberRole = 'lead' | 'contributor' | 'viewer'
export type OrgPlan = 'free' | 'team' | 'business' | 'enterprise'
export type AuditSource = 'app' | 'sheets' | 'api' | 'ai' | 'chat_bot' | 'email'
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'

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
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: OrgPlan
          google_workspace_domain?: string | null
          billing_email?: string | null
          seats_max?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: OrgPlan
          google_workspace_domain?: string | null
          billing_email?: string | null
          seats_max?: number
          updated_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workspaces_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
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
        Insert: {
          id?: string
          org_id: string
          name: string
          email: string
          avatar_url?: string | null
          google_id?: string | null
          role?: UserRole
          department_id?: string | null
          position?: string | null
          is_active?: boolean
          joined_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          email?: string
          avatar_url?: string | null
          google_id?: string | null
          role?: UserRole
          department_id?: string | null
          position?: string | null
          is_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'users_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      departments: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          head_user_id: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          head_user_id?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          color?: string
          head_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'departments_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
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
        Insert: {
          id?: string
          workspace_id: string
          code: string
          name: string
          description?: string | null
          status?: ProjectStatus
          kanban_stage?: KanbanStage
          priority?: Priority
          start_date?: string | null
          end_date?: string | null
          estimated_hours?: number | null
          progress_pct?: number
          budget?: number | null
          currency?: string
          department_id?: string | null
          color?: string
          google_calendar_event_id?: string | null
          google_drive_folder_id?: string | null
          notebooklm_notebook_id?: string | null
          health_score?: number | null
          health_updated_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          code?: string
          name?: string
          description?: string | null
          status?: ProjectStatus
          kanban_stage?: KanbanStage
          priority?: Priority
          start_date?: string | null
          end_date?: string | null
          estimated_hours?: number | null
          progress_pct?: number
          budget?: number | null
          currency?: string
          department_id?: string | null
          color?: string
          health_score?: number | null
          health_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_department_id_fkey'
            columns: ['department_id']
            isOneToOne: false
            referencedRelation: 'departments'
            referencedColumns: ['id']
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          assignee_id: string | null
          reporter_id: string
          status: TaskStatus
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
        Insert: {
          id?: string
          project_id: string
          title: string
          description?: string | null
          assignee_id?: string | null
          reporter_id: string
          status?: TaskStatus
          priority?: Priority
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          parent_task_id?: string | null
          position?: number
          labels?: string[]
          google_task_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          description?: string | null
          assignee_id?: string | null
          reporter_id?: string
          status?: TaskStatus
          priority?: Priority
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          parent_task_id?: string | null
          position?: number
          labels?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_parent_task_id_fkey'
            columns: ['parent_task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          }
        ]
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
        Insert: {
          id?: string
          project_id: string
          user_id: string
          role?: ProjectMemberRole
          joined_at?: string
          removed_at?: string | null
          added_by: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
          role?: ProjectMemberRole
          removed_at?: string | null
          added_by?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
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
        Insert: {
          id?: string
          org_id: string
          entity_type: string
          entity_id: string
          action: string
          field_changed?: string | null
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          changed_at?: string
          source?: AuditSource
          ip_address?: string | null
        }
        Update: never
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_user_org_id: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: {
      project_status: ProjectStatus
      kanban_stage: KanbanStage
      priority: Priority
      user_role: UserRole
      project_member_role: ProjectMemberRole
      org_plan: OrgPlan
      audit_source: AuditSource
    }
  }
}
