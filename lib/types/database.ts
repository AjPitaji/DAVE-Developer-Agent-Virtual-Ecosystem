export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          avatar_url: string | null
          email: string | null
          role: string | null
          github_username: string | null
          github_token: string | null
          specialization: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          avatar_url?: string | null
          email?: string | null
          role?: string | null
          github_username?: string | null
          github_token?: string | null
          specialization?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          avatar_url?: string | null
          email?: string | null
          role?: string | null
          github_username?: string | null
          github_token?: string | null
          specialization?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      teams: {
        Row: {
          id: string
          name: string
          description: string | null
          owner_id: string
          is_public: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          owner_id: string
          is_public?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          owner_id?: string
          is_public?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      team_members: {
        Row: {
          team_id: string
          user_id: string
          role: 'owner' | 'dev'
          joined_at: string
        }
        Insert: {
          team_id: string
          user_id: string
          role?: 'owner' | 'dev'
          joined_at?: string
        }
        Update: {
          team_id?: string
          user_id?: string
          role?: 'owner' | 'dev'
          joined_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          team_id: string
          name: string
          description: string | null
          owner_id: string
          status: 'active' | 'draft' | 'archived' | 'on_hold'
          max_open_tasks: number
          repo_url: string | null
          key: string | null
          deadline: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          name: string
          description?: string | null
          owner_id: string
          status?: 'active' | 'draft' | 'archived' | 'on_hold'
          max_open_tasks?: number
          repo_url?: string | null
          key?: string | null
          deadline?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          name?: string
          description?: string | null
          owner_id?: string
          status?: 'active' | 'draft' | 'archived' | 'on_hold'
          max_open_tasks?: number
          repo_url?: string | null
          key?: string | null
          deadline?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      project_members: {
        Row: {
          project_id: string
          user_id: string
          role: 'owner' | 'dev'
          joined_at: string
        }
        Insert: {
          project_id: string
          user_id: string
          role?: 'owner' | 'dev'
          joined_at?: string
        }
        Update: {
          project_id?: string
          user_id?: string
          role?: 'owner' | 'dev'
          joined_at?: string
        }
      }
      team_join_requests: {
        Row: {
          id: string
          team_id: string
          user_id: string
          status: 'pending' | 'approved' | 'rejected' | 'cancelled'
          message: string | null
          created_at: string
          updated_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          team_id: string
          user_id: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          message?: string | null
          created_at?: string
          updated_at?: string
          decided_at?: string | null
        }
        Update: {
          id?: string
          team_id?: string
          user_id?: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          message?: string | null
          created_at?: string
          updated_at?: string
          decided_at?: string | null
        }
      }
      project_michael_settings: {
        Row: {
          project_id: string
          prompt: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          project_id: string
          prompt?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          project_id?: string
          prompt?: string | null
          updated_by?: string | null
          updated_at?: string
        }
      }
    }
  }
}
