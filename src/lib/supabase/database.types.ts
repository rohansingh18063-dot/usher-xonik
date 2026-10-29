// Shape of the tables the app reads and writes. Keep in sync with
// supabase/migrations, or regenerate with `npx supabase gen types typescript`.

import type { BusinessProfileRow } from "@/lib/business-profile";
import type { LeadStatus, PreferredTime } from "@/lib/leads";
import type { QuickReply } from "@/lib/widget";
import type { GapCategory } from "@/lib/chat/hidden-tags";

export type Industry = "dentist" | "pharmacy" | "other";
export type DocumentFileType = "pdf" | "docx" | "txt";
export type DocumentStatus = "processing" | "ready" | "failed";
export type RejectionReason =
  | "invalid_key"
  | "assistant_paused"
  | "missing_origin"
  | "origin_not_allowed"
  | "invalid_request"
  | "ip_rate_limited"
  | "key_rate_limited"
  | "monthly_limit_reached";

export type Database = {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          user_id: string;
          business_name: string;
          industry: Industry;
          website_domain: string;
          assistant_paused: boolean;
          test_mode: boolean;
          monthly_message_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          business_name: string;
          industry: Industry;
          website_domain: string;
        };
        Update: {
          business_name?: string;
          industry?: Industry;
          website_domain?: string;
          assistant_paused?: boolean;
          test_mode?: boolean;
        };
        Relationships: [];
      };
      industry_packs: {
        Row: {
          id: string;
          industry: string;
          version: number;
          knowledge: string;
          behavior_rules: string;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          industry: string;
          version: number;
          knowledge: string;
          behavior_rules: string;
          is_published?: boolean;
        };
        Update: {
          knowledge?: string;
          behavior_rules?: string;
          is_published?: boolean;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          client_id: string;
          session_id: string;
          visitor_message: string;
          assistant_reply: string;
          channel: "test" | "website";
          page_url: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          session_id: string;
          visitor_message: string;
          assistant_reply: string;
          channel?: "test" | "website";
          page_url?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      business_profiles: {
        Row: BusinessProfileRow & { client_id: string; created_at: string; updated_at: string };
        Insert: BusinessProfileRow & { client_id: string };
        Update: Partial<BusinessProfileRow>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          client_id: string;
          file_name: string;
          file_type: DocumentFileType;
          size_bytes: number;
          storage_path: string;
          revision: number;
          status: DocumentStatus;
          error_message: string | null;
          chunk_count: number;
          processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          client_id: string;
          file_name: string;
          file_type: DocumentFileType;
          size_bytes: number;
          storage_path: string;
          revision?: number;
          status?: DocumentStatus;
        };
        Update: {
          file_name?: string;
          file_type?: DocumentFileType;
          size_bytes?: number;
          storage_path?: string;
          revision?: number;
          status?: DocumentStatus;
          error_message?: string | null;
          chunk_count?: number;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      api_keys: {
        Row: {
          client_id: string;
          public_key: string;
          requests_per_minute: number;
          created_at: string;
          regenerated_at: string | null;
        };
        Insert: { client_id: string; requests_per_minute?: number };
        Update: { requests_per_minute?: number };
        Relationships: [];
      };
      allowed_domains: {
        Row: { id: string; client_id: string; domain: string; include_subdomains: boolean; created_at: string };
        Insert: { client_id: string; domain: string; include_subdomains?: boolean };
        Update: Record<string, never>;
        Relationships: [];
      };
      widget_settings: {
        Row: {
          client_id: string;
          assistant_name: string;
          brand_color: string;
          position: "right" | "left";
          welcome_message: string;
          quick_replies: QuickReply[];
          logo_path: string | null;
          installed_at: string | null;
          installed_origin: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: {
          assistant_name?: string;
          brand_color?: string;
          position?: "right" | "left";
          welcome_message?: string;
          quick_replies?: QuickReply[];
          logo_path?: string | null;
          installed_at?: string | null;
          installed_origin?: string | null;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          mobile: string;
          preferred_date: string;
          preferred_time: PreferredTime;
          concern: string | null;
          status: LeadStatus;
          notes: string | null;
          conversation_id: string | null;
          source_url: string | null;
          seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: { status?: LeadStatus; notes?: string | null; seen_at?: string | null };
        Relationships: [];
      };
      notification_settings: {
        Row: { client_id: string; lead_alert_emails: string[]; created_at: string; updated_at: string };
        Insert: Record<string, never>;
        Update: { lead_alert_emails?: string[] };
        Relationships: [];
      };
      lead_notifications: {
        Row: {
          id: string;
          lead_id: string;
          client_id: string;
          channel: "email" | "whatsapp";
          recipient: string;
          status: "sent" | "failed" | "skipped";
          provider_message_id: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          lead_id: string;
          client_id: string;
          channel: "email" | "whatsapp";
          recipient: string;
          status: "sent" | "failed" | "skipped";
          provider_message_id?: string | null;
          error?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      knowledge_gaps: {
        Row: {
          id: string;
          client_id: string;
          category: GapCategory;
          topic: string;
          status: "open" | "resolved";
          question_count: number;
          first_asked_at: string;
          last_asked_at: string;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: { status?: "open" | "resolved"; resolved_at?: string | null };
        Relationships: [];
      };
      knowledge_gap_questions: {
        Row: { id: string; gap_id: string; client_id: string; question: string; session_id: string | null; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      public_api_rejections: {
        Row: { id: string; client_id: string | null; reason: RejectionReason; origin: string | null; created_at: string };
        Insert: { client_id: string | null; reason: RejectionReason; origin: string | null };
        Update: Record<string, never>;
        Relationships: [];
      };
      document_chunks: {
        Row: {
          id: string;
          client_id: string;
          document_id: string;
          revision: number;
          chunk_index: number;
          content: string;
          embedding: string;
          embedding_model: string;
          created_at: string;
        };
        Insert: {
          client_id: string;
          document_id: string;
          revision: number;
          chunk_index: number;
          content: string;
          embedding: string;
          embedding_model: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      regenerate_public_key: { Args: Record<string, never>; Returns: undefined };
      record_knowledge_gap: {
        Args: {
          p_client_id: string;
          p_category: GapCategory;
          p_topic: string;
          p_question: string;
          p_session_id: string | null;
          p_embedding: string | null;
          p_min_similarity?: number;
        };
        Returns: string;
      };
      conversation_list: {
        Args: {
          p_query?: string | null;
          p_from?: string | null;
          p_to?: string | null;
          p_has_lead?: boolean | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          session_id: string;
          started_at: string;
          last_message_at: string;
          message_count: number;
          first_message: string;
          page_url: string | null;
          lead_id: string | null;
          total_count: number;
        }[];
      };
      dashboard_daily: {
        Args: { p_from: string; p_to: string; p_time_zone: string };
        Returns: { day: string; conversations: number; messages: number; leads: number }[];
      };
      submit_lead: {
        Args: {
          p_client_id: string;
          p_name: string;
          p_mobile: string;
          p_preferred_date: string;
          p_preferred_time: PreferredTime;
          p_concern: string | null;
          p_conversation_id: string | null;
          p_source_url: string | null;
        };
        Returns: string | null;
      };
      hit_rate_limit: { Args: { p_bucket: string; p_limit: number; p_window_seconds: number }; Returns: boolean };
      match_document_chunks: {
        Args: {
          p_client_id: string;
          p_query_embedding: string;
          p_match_count?: number;
          p_min_similarity?: number;
        };
        Returns: {
          chunk_id: string;
          document_id: string;
          file_name: string;
          content: string;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
