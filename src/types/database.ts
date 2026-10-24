export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'delayed' | 'completed' | 'canceled' | 'pending'
export type KanbanStage = 'ideas' | 'backlog' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'canceled'
export type Priority = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
export type UserRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest'

/**
 * Corporate layer per the "capas" framework: which layer a person's role
 * belongs to — independent of who they report to (see reports_to_user_id).
 *   gobierno: manda sobre las filiales, autoridad de mando
 *   coe:      fija el estándar, autoridad de veto sobre la forma
 *   sso:      ejecuta trabajo por pedido, sin autoridad sobre las filiales
 *   filial:   opera, tiene P&L y margen propio
 */
export type CorporateLayer = 'gobierno' | 'coe' | 'sso' | 'filial'
export type ProjectMemberRole = 'lead' | 'contributor' | 'viewer'
export type OrgPlan = 'free' | 'team' | 'team_plus' | 'business' | 'enterprise'
export type WorkspaceType = 'personal' | 'team'
export type OrgRole = 'owner' | 'admin' | 'member'
export type ProjectVisibility = 'workspace' | 'private' | 'personal'
export type AuditSource = 'app' | 'sheets' | 'api' | 'ai' | 'chat_bot' | 'email'
export type CostPoolLayer = 'gobierno' | 'coe' | 'sso'
export type CostPoolMethod = 'revenue' | 'headcount' | 'central' | 'base_plus_variable'
export type ChargeRunStatus = 'borrador' | 'aprobado' | 'anulado'
export type NotifyChannel = 'app' | 'email'
export type DocumentKind = 'politica' | 'manual' | 'sop' | 'acta' | 'raci' | 'jd' | 'sla' | 'acuerdo' | 'otro'
export type DocumentStatus = 'borrador' | 'en_revision' | 'aprobado' | 'obsoleto'
export type CaptureKind = 'audio' | 'video' | 'image' | 'text'
export type CaptureStatus = 'uploaded' | 'processing' | 'ready' | 'confirmed' | 'discarded' | 'failed'
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'

export type GoalStatus = 'not_started' | 'on_track' | 'at_risk' | 'off_track' | 'achieved' | 'canceled'

export type ProjectUpdateSentiment = 'positive' | 'neutral' | 'concern' | 'blocker'

/** Type for a single field inside an intake form. */
export type IntakeFieldType = 'text' | 'textarea' | 'email' | 'select' | 'date' | 'phone'
export type IntakeFieldTarget = 'title' | 'description' | 'due_date' | 'metadata' | 'priority'
export interface IntakeField {
  id: string
  label: string
  type: IntakeFieldType
  required: boolean
  placeholder?: string
  options?: string[]
  target: IntakeFieldTarget
}

export type AutomationTrigger =
  | 'task.created'
  | 'task.status_changed'
  | 'task.due_soon'         // cron — fires for tasks whose due_date is within N hours
  | 'project.health_low'    // cron — fires for projects whose health_score < threshold

export interface AutomationConditions {
  project_id?: string
  status?: TaskStatus
  priority?: Priority
  from_status?: TaskStatus     // for status_changed only
  to_status?: TaskStatus       // for status_changed only
  hours_until_due?: number     // for task.due_soon (default: 24)
  health_below?: number        // for project.health_low (default: 50)
}

export type AutomationAction =
  | { kind: 'set_status'; value: TaskStatus }
  | { kind: 'set_assignee'; value: string }       // user id, or 'reporter' / 'unassign'
  | { kind: 'set_priority'; value: Priority }
  | { kind: 'add_label'; value: string }
  | { kind: 'send_chat'; value: string }          // message template; uses org webhook

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          plan: OrgPlan
          workspace_type: WorkspaceType
          owner_user_id: string | null
          workspace_scoped_visibility: boolean
          google_workspace_domain: string | null
          google_chat_webhook_url: string | null
          notification_prefs: {
            chat_new_project?: boolean
            chat_mentions?: boolean
            chat_deadlines?: boolean
            chat_weekly_digest?: boolean
            chat_recurring_created?: boolean
          }
          custom_field_defs: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] }>
          billing_email: string | null
          seats_used: number
          seats_max: number
          timezone: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: OrgPlan
          workspace_type?: WorkspaceType
          owner_user_id?: string | null
          workspace_scoped_visibility?: boolean
          google_workspace_domain?: string | null
          google_chat_webhook_url?: string | null
          custom_field_defs?: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] }>
          billing_email?: string | null
          seats_max?: number
          timezone?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: OrgPlan
          workspace_type?: WorkspaceType
          owner_user_id?: string | null
          workspace_scoped_visibility?: boolean
          google_workspace_domain?: string | null
          google_chat_webhook_url?: string | null
          notification_prefs?: {
            chat_new_project?: boolean
            chat_mentions?: boolean
            chat_deadlines?: boolean
            chat_weekly_digest?: boolean
            chat_recurring_created?: boolean
          }
          custom_field_defs?: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] }>
          billing_email?: string | null
          seats_max?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_memberships: {
        Row: {
          id: string
          user_id: string
          org_id: string
          role: OrgRole
          joined_at: string
          invited_by: string | null
          corporate_layer: CorporateLayer | null
        }
        Insert: {
          id?: string
          user_id: string
          org_id: string
          role?: OrgRole
          joined_at?: string
          invited_by?: string | null
          corporate_layer?: CorporateLayer | null
        }
        Update: {
          role?: OrgRole
          invited_by?: string | null
          corporate_layer?: CorporateLayer | null
        }
        Relationships: [
          {
            foreignKeyName: 'org_memberships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_memberships_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      workspaces: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          icon: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          icon?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          color?: string
          icon?: string | null
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
          timezone: string | null
          last_active_org_id: string | null
          role_code: string | null
          corporate_layer: CorporateLayer | null
          reports_to_user_id: string | null
          dotted_line_to_user_id: string | null
          kpi_description: string | null
          notify_channel: NotifyChannel
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
          timezone?: string | null
          last_active_org_id?: string | null
          role_code?: string | null
          corporate_layer?: CorporateLayer | null
          reports_to_user_id?: string | null
          dotted_line_to_user_id?: string | null
          kpi_description?: string | null
          notify_channel?: NotifyChannel
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
          timezone?: string | null
          last_active_org_id?: string | null
          role_code?: string | null
          corporate_layer?: CorporateLayer | null
          reports_to_user_id?: string | null
          dotted_line_to_user_id?: string | null
          kpi_description?: string | null
          notify_channel?: NotifyChannel
        }
        Relationships: [
          {
            foreignKeyName: 'users_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_users_department'
            columns: ['department_id']
            isOneToOne: false
            referencedRelation: 'departments'
            referencedColumns: ['id']
          }
        ]
      }
      goals: {
        Row: {
          id: string
          org_id: string
          title: string
          description: string | null
          parent_goal_id: string | null
          owner_id: string | null
          status: GoalStatus
          progress_pct: number
          progress_manual: boolean
          target_date: string | null
          quarter: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title: string
          description?: string | null
          parent_goal_id?: string | null
          owner_id?: string | null
          status?: GoalStatus
          progress_pct?: number
          progress_manual?: boolean
          target_date?: string | null
          quarter?: string | null
          created_by: string
        }
        Update: {
          title?: string
          description?: string | null
          parent_goal_id?: string | null
          owner_id?: string | null
          status?: GoalStatus
          progress_pct?: number
          progress_manual?: boolean
          target_date?: string | null
          quarter?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      intake_forms: {
        Row: {
          id: string
          org_id: string
          slug: string
          title: string
          description: string | null
          branding_name: string | null
          target_project_id: string
          target_goal_id: string | null
          default_priority: Priority
          fields: IntakeField[]
          success_message: string
          is_active: boolean
          submission_count: number
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          slug: string
          title: string
          description?: string | null
          branding_name?: string | null
          target_project_id: string
          target_goal_id?: string | null
          default_priority?: Priority
          fields?: IntakeField[]
          success_message?: string
          is_active?: boolean
          created_by: string
        }
        Update: {
          slug?: string
          title?: string
          description?: string | null
          branding_name?: string | null
          target_project_id?: string
          target_goal_id?: string | null
          default_priority?: Priority
          fields?: IntakeField[]
          success_message?: string
          is_active?: boolean
          submission_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      intake_submissions: {
        Row: {
          id: string
          form_id: string
          raw_data: Json
          created_task_id: string | null
          submitter_ip: string | null
          user_agent: string | null
          submitted_at: string
        }
        Insert: {
          id?: string
          form_id: string
          raw_data: Json
          created_task_id?: string | null
          submitter_ip?: string | null
          user_agent?: string | null
        }
        Update: never
        Relationships: []
      }
      project_updates: {
        Row: {
          id: string
          project_id: string
          author_id: string
          content: string
          sentiment: ProjectUpdateSentiment | null
          visible_in_share: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          author_id: string
          content: string
          sentiment?: ProjectUpdateSentiment | null
          visible_in_share?: boolean
        }
        Update: {
          content?: string
          sentiment?: ProjectUpdateSentiment | null
          visible_in_share?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      inbound_emails: {
        Row: {
          id: string
          project_id: string
          from_email: string | null
          from_name: string | null
          subject: string | null
          body_text: string | null
          attachments: Array<{ name: string; size?: number; mime?: string }>
          created_task_id: string | null
          rejection_reason: string | null
          raw_headers: string | null
          received_at: string
        }
        Insert: {
          id?: string
          project_id: string
          from_email?: string | null
          from_name?: string | null
          subject?: string | null
          body_text?: string | null
          attachments?: Array<{ name: string; size?: number; mime?: string }>
          created_task_id?: string | null
          rejection_reason?: string | null
          raw_headers?: string | null
        }
        Update: never
        Relationships: []
      }
      share_links: {
        Row: {
          id: string
          org_id: string
          token: string
          entity_type: 'project' | 'task' | 'goal'
          entity_id: string
          label: string | null
          expires_at: string | null
          allow_comments: boolean
          created_by: string
          created_at: string
          access_count: number
          last_accessed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          token: string
          entity_type: 'project' | 'task' | 'goal'
          entity_id: string
          label?: string | null
          expires_at?: string | null
          allow_comments?: boolean
          created_by: string
        }
        Update: {
          label?: string | null
          expires_at?: string | null
          allow_comments?: boolean
          access_count?: number
          last_accessed_at?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          head_user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          head_user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          color?: string
          head_user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'departments_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'departments_head_user_id_fkey'
            columns: ['head_user_id']
            isOneToOne: false
            referencedRelation: 'users'
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
          custom_fields: Record<string, string | number | null>
          health_score: number | null
          health_updated_at: string | null
          goal_id: string | null
          inbound_token: string | null
          visibility: ProjectVisibility
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
          custom_fields?: Record<string, string | number | null>
          health_score?: number | null
          health_updated_at?: string | null
          goal_id?: string | null
          visibility?: ProjectVisibility
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
          google_calendar_event_id?: string | null
          google_drive_folder_id?: string | null
          notebooklm_notebook_id?: string | null
          custom_fields?: Record<string, string | number | null>
          health_score?: number | null
          health_updated_at?: string | null
          goal_id?: string | null
          inbound_token?: string | null
          visibility?: ProjectVisibility
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
          sprint_id: string | null
          drive_url: string | null
          reviewer_id: string | null
          review_state: 'requested' | 'approved' | 'changes_requested' | null
          workspace_id: string | null
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
          sprint_id?: string | null
          drive_url?: string | null
          reviewer_id?: string | null
          review_state?: 'requested' | 'approved' | 'changes_requested' | null
          workspace_id?: string | null
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
          sprint_id?: string | null
          drive_url?: string | null
          reviewer_id?: string | null
          review_state?: 'requested' | 'approved' | 'changes_requested' | null
          workspace_id?: string | null
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
      task_comments: {
        Row: {
          id: string
          task_id: string
          author_id: string
          content: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          task_id: string
          author_id: string
          content: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_comments_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_comments_author_id_fkey'
            columns: ['author_id']
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
        Relationships: [
          {
            foreignKeyName: 'audit_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      decisions: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          title: string
          description: string | null
          status: string
          resolved_option_id: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          title: string
          description?: string | null
          status?: string
          resolved_option_id?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          status?: string
          resolved_option_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      decision_criteria: {
        Row: {
          id: string
          decision_id: string
          label: string
          weight: number
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          decision_id: string
          label: string
          weight?: number
          position?: number
          created_at?: string
        }
        Update: { label?: string; weight?: number; position?: number }
        Relationships: [
          {
            foreignKeyName: 'decision_criteria_decision_id_fkey'
            columns: ['decision_id']
            isOneToOne: false
            referencedRelation: 'decisions'
            referencedColumns: ['id']
          }
        ]
      }
      decision_options: {
        Row: {
          id: string
          decision_id: string
          label: string
          notes: string | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          decision_id: string
          label: string
          notes?: string | null
          position?: number
          created_at?: string
        }
        Update: { label?: string; notes?: string | null; position?: number }
        Relationships: [
          {
            foreignKeyName: 'decision_options_decision_id_fkey'
            columns: ['decision_id']
            isOneToOne: false
            referencedRelation: 'decisions'
            referencedColumns: ['id']
          }
        ]
      }
      decision_scores: {
        Row: {
          id: string
          decision_id: string
          criterion_id: string
          option_id: string
          score: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          decision_id: string
          criterion_id: string
          option_id: string
          score?: number
          created_at?: string
          updated_at?: string
        }
        Update: { score?: number; updated_at?: string }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          id: string
          project_id: string
          user_id: string
          title: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
          title?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: { title?: string | null; updated_at?: string }
        Relationships: []
      }
      ai_messages: {
        Row: {
          id: string
          conversation_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          created_at?: string
        }
        Update: { content?: string }
        Relationships: []
      }
      task_attachments: {
        Row: {
          id: string
          task_id: string
          drive_file_id: string
          file_name: string
          mime_type: string | null
          size_bytes: number | null
          web_view_link: string
          icon_link: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          drive_file_id: string
          file_name: string
          mime_type?: string | null
          size_bytes?: number | null
          web_view_link: string
          icon_link?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: { file_name?: string; web_view_link?: string }
        Relationships: []
      }
      project_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          default_priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          default_color: string
          duration_days: number | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          description?: string | null
          default_priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          default_color?: string
          duration_days?: number | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          default_priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          default_color?: string
          duration_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      project_template_tasks: {
        Row: {
          id: string
          template_id: string
          title: string
          description: string | null
          priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          due_offset_days: number | null
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          template_id: string
          title: string
          description?: string | null
          priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          due_offset_days?: number | null
          position?: number
          created_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          due_offset_days?: number | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: 'project_template_tasks_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'project_templates'
            referencedColumns: ['id']
          }
        ]
      }
      time_entries: {
        Row: {
          id: string
          task_id: string
          user_id: string
          started_at: string
          ended_at: string | null
          duration_minutes: number | null
          notes: string | null
          source: 'timer' | 'manual'
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          user_id: string
          started_at: string
          ended_at?: string | null
          duration_minutes?: number | null
          notes?: string | null
          source?: 'timer' | 'manual'
          created_at?: string
        }
        Update: {
          ended_at?: string | null
          duration_minutes?: number | null
          notes?: string | null
        }
        Relationships: []
      }
      task_dependencies: {
        Row: {
          id: string
          task_id: string
          depends_on_id: string
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          depends_on_id: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      sprints: {
        Row: {
          id: string
          org_id: string
          name: string
          goal: string | null
          start_date: string
          end_date: string
          status: 'planned' | 'active' | 'completed'
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          goal?: string | null
          start_date: string
          end_date: string
          status?: 'planned' | 'active' | 'completed'
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          goal?: string | null
          start_date?: string
          end_date?: string
          status?: 'planned' | 'active' | 'completed'
          updated_at?: string
        }
        Relationships: []
      }
      task_recurring_rules: {
        Row: {
          id: string
          project_id: string
          title_template: string
          description_template: string | null
          assignee_id: string | null
          priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          cadence: string
          next_run_at: string
          is_active: boolean
          last_run_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title_template: string
          description_template?: string | null
          assignee_id?: string | null
          priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          cadence: string
          next_run_at: string
          is_active?: boolean
          last_run_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          title_template?: string
          description_template?: string | null
          assignee_id?: string | null
          priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
          cadence?: string
          next_run_at?: string
          is_active?: boolean
          last_run_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      automations: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          enabled: boolean
          trigger: AutomationTrigger
          conditions: AutomationConditions
          actions: AutomationAction[]
          created_by: string
          created_at: string
          updated_at: string
          last_run_at: string | null
          run_count: number
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          description?: string | null
          enabled?: boolean
          trigger: AutomationTrigger
          conditions?: AutomationConditions
          actions?: AutomationAction[]
          created_by: string
        }
        Update: {
          name?: string
          description?: string | null
          enabled?: boolean
          trigger?: AutomationTrigger
          conditions?: AutomationConditions
          actions?: AutomationAction[]
          last_run_at?: string | null
          run_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          id: string
          automation_id: string
          triggered_at: string
          trigger_payload: Json
          matched: boolean
          results: Array<{ kind: string; ok: boolean; error?: string }>
          duration_ms: number | null
        }
        Insert: {
          id?: string
          automation_id: string
          triggered_at?: string
          trigger_payload?: Json
          matched: boolean
          results?: Array<{ kind: string; ok: boolean; error?: string }>
          duration_ms?: number | null
        }
        Update: never
        Relationships: []
      }
      workspace_members: {
        Row: {
          id: string
          user_id: string
          workspace_id: string
          department_id: string | null
          position: string
          role: UserRole
          is_active: boolean
          joined_at: string
        }
        Insert: {
          id?: string
          user_id: string
          workspace_id: string
          department_id?: string | null
          position: string
          role?: UserRole
          is_active?: boolean
          joined_at?: string
        }
        Update: {
          user_id?: string
          workspace_id?: string
          department_id?: string | null
          position?: string
          role?: UserRole
          is_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'workspace_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          }
        ]
      }
      project_workspaces: {
        Row: { project_id: string; workspace_id: string }
        Insert: { project_id: string; workspace_id: string }
        Update: { project_id?: string; workspace_id?: string }
        Relationships: [
          {
            foreignKeyName: 'project_workspaces_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_workspaces_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          }
        ]
      }
      captures: {
        Row: {
          id: string
          org_id: string
          created_by: string
          kind: CaptureKind
          source: AuditSource
          storage_path: string | null
          mime_type: string | null
          duration_sec: number | null
          raw_text: string | null
          transcript: Json | null
          status: CaptureStatus
          error: string | null
          client_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          created_by: string
          kind: CaptureKind
          source?: AuditSource
          storage_path?: string | null
          mime_type?: string | null
          duration_sec?: number | null
          raw_text?: string | null
          transcript?: Json | null
          status?: CaptureStatus
          error?: string | null
          client_id?: string | null
          created_at?: string
        }
        Update: {
          kind?: CaptureKind
          source?: AuditSource
          storage_path?: string | null
          mime_type?: string | null
          duration_sec?: number | null
          raw_text?: string | null
          transcript?: Json | null
          status?: CaptureStatus
          error?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'captures_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      task_proposals: {
        Row: {
          id: string
          capture_id: string
          position: number
          title: string
          assignee_id: string | null
          workspace_id: string | null
          project_id: string | null
          due_date: string | null
          priority: Priority
          quote: string
          quote_at: string | null
          confidence: number | null
          warning: string | null
          included: boolean
          created_task_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          capture_id: string
          position?: number
          title: string
          assignee_id?: string | null
          workspace_id?: string | null
          project_id?: string | null
          due_date?: string | null
          priority?: Priority
          quote: string
          quote_at?: string | null
          confidence?: number | null
          warning?: string | null
          included?: boolean
          created_task_id?: string | null
          created_at?: string
        }
        Update: {
          position?: number
          title?: string
          assignee_id?: string | null
          workspace_id?: string | null
          project_id?: string | null
          due_date?: string | null
          priority?: Priority
          warning?: string | null
          included?: boolean
          created_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'task_proposals_capture_id_fkey'
            columns: ['capture_id']
            isOneToOne: false
            referencedRelation: 'captures'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_proposals_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      chat_channels: {
        Row: {
          id: string
          org_id: string
          kind: 'channel' | 'dm'
          slug: string | null
          name: string
          description: string | null
          visibility: 'public' | 'private'
          workspace_id: string | null
          project_id: string | null
          layer: CorporateLayer | null
          dm_key: string | null
          created_by: string | null
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          kind?: 'channel' | 'dm'
          slug?: string | null
          name: string
          description?: string | null
          visibility?: 'public' | 'private'
          workspace_id?: string | null
          project_id?: string | null
          layer?: CorporateLayer | null
          dm_key?: string | null
          created_by?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          visibility?: 'public' | 'private'
          archived_at?: string | null
        }
        Relationships: []
      }
      chat_members: {
        Row: {
          channel_id: string
          user_id: string
          role: 'member' | 'admin'
          last_read_at: string
          muted: boolean
          joined_at: string
        }
        Insert: {
          channel_id: string
          user_id: string
          role?: 'member' | 'admin'
          last_read_at?: string
          muted?: boolean
          joined_at?: string
        }
        Update: {
          role?: 'member' | 'admin'
          last_read_at?: string
          muted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'chat_members_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'chat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      chat_messages: {
        Row: {
          id: string
          channel_id: string
          author_id: string | null
          kind: 'text' | 'system' | 'ai'
          body: string
          parent_id: string | null
          mentions: string[]
          mention_all: boolean
          task_id: string | null
          edited_at: string | null
          deleted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          author_id?: string | null
          kind?: 'text' | 'system' | 'ai'
          body: string
          parent_id?: string | null
          mentions?: string[]
          mention_all?: boolean
          task_id?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Update: {
          body?: string
          task_id?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          mentions?: string[]
          mention_all?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'chat_messages_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'chat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_messages_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      chat_reactions: {
        Row: { message_id: string; user_id: string; emoji: string; created_at: string }
        Insert: { message_id: string; user_id: string; emoji: string; created_at?: string }
        Update: { emoji?: string }
        Relationships: [
          {
            foreignKeyName: 'chat_reactions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'chat_messages'
            referencedColumns: ['id']
          }
        ]
      }
      documents: {
        Row: {
          id: string
          org_id: string
          workspace_id: string | null
          kind: DocumentKind
          title: string
          status: DocumentStatus
          body_md: string
          owner_id: string | null
          reviewer_id: string | null
          approved_by: string | null
          approved_at: string | null
          next_review_at: string | null
          version: number
          project_id: string | null
          task_id: string | null
          tags: string[]
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workspace_id?: string | null
          kind?: DocumentKind
          title: string
          status?: DocumentStatus
          body_md?: string
          owner_id?: string | null
          reviewer_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          next_review_at?: string | null
          version?: number
          project_id?: string | null
          task_id?: string | null
          tags?: string[]
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string | null
          kind?: DocumentKind
          title?: string
          status?: DocumentStatus
          body_md?: string
          owner_id?: string | null
          reviewer_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          next_review_at?: string | null
          version?: number
          project_id?: string | null
          task_id?: string | null
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: 'documents_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          }
        ]
      }
      document_versions: {
        Row: {
          id: string
          document_id: string
          version: number
          title: string
          body_md: string
          saved_by: string | null
          note: string | null
          saved_at: string
        }
        Insert: {
          id?: string
          document_id: string
          version: number
          title: string
          body_md?: string
          saved_by?: string | null
          note?: string | null
          saved_at?: string
        }
        Update: {
          title?: string
          body_md?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'document_versions_saved_by_fkey'
            columns: ['saved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      cost_pools: {
        Row: {
          id: string
          org_id: string
          name: string
          layer: CostPoolLayer
          method: CostPoolMethod
          monthly_amount: number
          currency: string
          variable_pct: number
          notes: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          layer: CostPoolLayer
          method: CostPoolMethod
          monthly_amount?: number
          currency?: string
          variable_pct?: number
          notes?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          layer?: CostPoolLayer
          method?: CostPoolMethod
          monthly_amount?: number
          currency?: string
          variable_pct?: number
          notes?: string | null
          is_active?: boolean
        }
        Relationships: []
      }
      empresa_period_metrics: {
        Row: {
          id: string
          org_id: string
          workspace_id: string
          period: string
          revenue: number
          headcount: number
          attributed_sales: number
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workspace_id: string
          period: string
          revenue?: number
          headcount?: number
          attributed_sales?: number
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          revenue?: number
          headcount?: number
          attributed_sales?: number
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'empresa_period_metrics_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          }
        ]
      }
      charge_runs: {
        Row: {
          id: string
          org_id: string
          period: string
          status: ChargeRunStatus
          prepared_by: string | null
          approved_by: string | null
          approved_at: string | null
          note: string | null
          total: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          period: string
          status?: ChargeRunStatus
          prepared_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          note?: string | null
          total?: number | null
          created_at?: string
        }
        Update: {
          status?: ChargeRunStatus
          approved_by?: string | null
          approved_at?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'charge_runs_prepared_by_fkey'
            columns: ['prepared_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'charge_runs_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      charge_lines: {
        Row: {
          id: string
          run_id: string
          pool_id: string | null
          pool_name: string
          method: string
          workspace_id: string
          amount: number
          driver_value: number
          driver_share: number
          currency: string
          explanation: string | null
        }
        Insert: {
          id?: string
          run_id: string
          pool_id?: string | null
          pool_name: string
          method: string
          workspace_id: string
          amount?: number
          driver_value?: number
          driver_share?: number
          currency?: string
          explanation?: string | null
        }
        Update: {
          amount?: number
          explanation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'charge_lines_run_id_fkey'
            columns: ['run_id']
            isOneToOne: false
            referencedRelation: 'charge_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'charge_lines_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          user_id: string
          kind: string
          title: string
          body: string | null
          url: string | null
          entity_type: string | null
          entity_id: string | null
          actor_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          kind: string
          title: string
          body?: string | null
          url?: string | null
          entity_type?: string | null
          entity_id?: string | null
          actor_id?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          last_used_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          last_used_at?: string | null
        }
        Update: {
          p256dh?: string
          auth?: string
          user_agent?: string | null
          last_used_at?: string | null
        }
        Relationships: []
      }
      user_notification_prefs: {
        Row: {
          user_id: string
          push_enabled: boolean
          kinds: Json
          quiet_start: string | null
          quiet_end: string | null
          email_digest: 'off' | 'daily' | 'weekly'
          email_instant: boolean
          email_kinds: Json
          digest_hour: number
          last_digest_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          push_enabled?: boolean
          kinds?: Json
          quiet_start?: string | null
          quiet_end?: string | null
          email_digest?: 'off' | 'daily' | 'weekly'
          email_instant?: boolean
          email_kinds?: Json
          digest_hour?: number
          last_digest_at?: string | null
          updated_at?: string
        }
        Update: {
          push_enabled?: boolean
          kinds?: Json
          quiet_start?: string | null
          quiet_end?: string | null
          email_digest?: 'off' | 'daily' | 'weekly'
          email_instant?: boolean
          email_kinds?: Json
          digest_hour?: number
          last_digest_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: { id: string; user_id: string; kind: string; created_at: string }
        Insert: { id?: string; user_id: string; kind: string; created_at?: string }
        Update: { kind?: string }
        Relationships: []
      }
      ai_usage: {
        Row: {
          id: string
          org_id: string
          user_id: string | null
          feature: string
          model: string
          tier: string
          input_tokens: number
          output_tokens: number
          cost_usd: number
          latency_ms: number | null
          ok: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id?: string | null
          feature: string
          model: string
          tier?: string
          input_tokens?: number
          output_tokens?: number
          cost_usd?: number
          latency_ms?: number | null
          ok?: boolean
          created_at?: string
        }
        Update: {
          feature?: string
          cost_usd?: number
        }
        Relationships: []
      }
      ai_budgets: {
        Row: {
          org_id: string
          monthly_usd: number | null
          per_user_monthly_usd: number | null
          warn_pct: number
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          org_id: string
          monthly_usd?: number | null
          per_user_monthly_usd?: number | null
          warn_pct?: number
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          monthly_usd?: number | null
          per_user_monthly_usd?: number | null
          warn_pct?: number
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      search_documents: {
        Row: {
          id: string
          org_id: string
          workspace_id: string | null
          entity_type: 'task' | 'document' | 'chat' | 'decision' | 'update'
          entity_id: string
          title: string
          body: string
          project_id: string | null
          channel_id: string | null
          author_id: string | null
          url: string
          source_updated_at: string
          tsv: string | null
          embedding: string | null
          embedded_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          workspace_id?: string | null
          entity_type: 'task' | 'document' | 'chat' | 'decision' | 'update'
          entity_id: string
          title?: string
          body?: string
          project_id?: string | null
          channel_id?: string | null
          author_id?: string | null
          url: string
          source_updated_at: string
          embedding?: string | null
          embedded_at?: string | null
        }
        Update: {
          workspace_id?: string | null
          title?: string
          body?: string
          project_id?: string | null
          channel_id?: string | null
          author_id?: string | null
          url?: string
          source_updated_at?: string
          embedding?: string | null
          embedded_at?: string | null
        }
        Relationships: []
      }
      search_index_state: {
        Row: { stream: string; cursor: string | null; cursor_id: string | null; updated_at: string }
        Insert: { stream: string; cursor?: string | null; cursor_id?: string | null; updated_at?: string }
        Update: { cursor?: string | null; cursor_id?: string | null; updated_at?: string }
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
      cleanup_old_audit_log: {
        Args: { days_to_keep?: number }
        Returns: number
      }
      /** Top-level task totals per project (supabase/migrations/20261025_aggregates.sql). */
      project_task_stats: {
        Args: { p_project_ids: string[] }
        Returns: Array<{ project_id: string; total: number; done: number; last_activity: string | null }>
      }
      /** Per-status counts with overdue and the caller's pending tasks (same migration). */
      task_overview_stats: {
        Args: { p_project_ids: string[]; p_user_id: string; p_today: string }
        Returns: Array<{ status: string; total: number; overdue: number; mine_pending: number }>
      }
      /** Per-channel unread/mention counts and last-message preview (supabase/migrations/20261027_chat_counts.sql). */
      chat_unread_counts: {
        Args: { p_user: string; p_org: string }
        Returns: Array<{
          channel_id: string
          unread: number
          mentions: number
          last_message_at: string | null
          last_message_body: string | null
          last_author_id: string | null
        }>
      }
      /** Hybrid (full-text + vector) search with the permission lists applied inside the query (20261027_search.sql). */
      search_hybrid: {
        Args: {
          p_org: string
          p_query: string
          p_embedding: string | null
          p_project_ids: string[]
          p_channel_ids: string[]
          p_workspace_ids: string[]
          p_types: string[] | null
          p_limit?: number
        }
        Returns: Array<{
          entity_type: 'task' | 'document' | 'chat' | 'decision' | 'update'
          entity_id: string
          title: string
          body: string
          project_id: string | null
          channel_id: string | null
          workspace_id: string | null
          author_id: string | null
          url: string
          source_updated_at: string
          score: number
        }>
      }
      ai_usage_rollup: {
        Args: { p_org: string; p_from: string; p_to: string; p_tz: string; p_user?: string | null }
        Returns: Array<{
          feature: string
          user_id: string | null
          day: string
          calls: number
          failed: number
          input_tokens: number
          output_tokens: number
          cost_usd: number
        }>
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
