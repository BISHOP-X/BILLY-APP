export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OnboardingStep =
  | 'profile'
  | 'pin'
  | 'biometrics'
  | 'complete';

export type Database = {
  public: {
    Tables: {
      legal_acceptances: {
        Row: {
          accepted_at: string;
          id: number;
          privacy_version: string;
          source: 'billy_mobile_signup' | 'billy_oauth_post_auth';
          terms_version: string;
          user_id: string;
        };
        Insert: {
          accepted_at?: string;
          id?: never;
          privacy_version: string;
          source: 'billy_mobile_signup' | 'billy_oauth_post_auth';
          terms_version: string;
          user_id: string;
        };
        Update: {
          accepted_at?: string;
          id?: never;
          privacy_version?: string;
          source?: 'billy_mobile_signup' | 'billy_oauth_post_auth';
          terms_version?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      account_deletion_requests: {
        Row: {
          completed_at: string | null;
          failure_code: string | null;
          id: string;
          requested_at: string;
          status: 'processing' | 'completed' | 'failed';
          user_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          failure_code?: string | null;
          id?: string;
          requested_at?: string;
          status?: 'processing' | 'completed' | 'failed';
          user_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          failure_code?: string | null;
          id?: string;
          requested_at?: string;
          status?: 'processing' | 'completed' | 'failed';
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          country_code: string;
          created_at: string;
          date_of_birth: string | null;
          display_name: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          onboarding_completed_at: string | null;
          onboarding_step: OnboardingStep;
          phone: string | null;
          preferred_currency: string;
          profile_completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          country_code?: string;
          created_at?: string;
          date_of_birth?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          id: string;
          last_name?: string | null;
          onboarding_completed_at?: string | null;
          onboarding_step?: OnboardingStep;
          phone?: string | null;
          preferred_currency?: string;
          profile_completed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          country_code?: string;
          created_at?: string;
          date_of_birth?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          onboarding_completed_at?: string | null;
          onboarding_step?: OnboardingStep;
          phone?: string | null;
          preferred_currency?: string;
          profile_completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          created_at: string;
          hide_balances_by_default: boolean;
          locale: string;
          marketing_notifications_enabled: boolean;
          push_notifications_enabled: boolean;
          theme: 'system' | 'light' | 'dark';
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          hide_balances_by_default?: boolean;
          locale?: string;
          marketing_notifications_enabled?: boolean;
          push_notifications_enabled?: boolean;
          theme?: 'system' | 'light' | 'dark';
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          hide_balances_by_default?: boolean;
          locale?: string;
          marketing_notifications_enabled?: boolean;
          push_notifications_enabled?: boolean;
          theme?: 'system' | 'light' | 'dark';
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_security_settings: {
        Row: {
          created_at: string;
          failed_pin_attempts: number;
          last_sensitive_action_at: string | null;
          pin_locked_until: string | null;
          security_notifications_enabled: boolean;
          transaction_pin_set_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          failed_pin_attempts?: number;
          last_sensitive_action_at?: string | null;
          pin_locked_until?: string | null;
          security_notifications_enabled?: boolean;
          transaction_pin_set_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          failed_pin_attempts?: number;
          last_sensitive_action_at?: string | null;
          pin_locked_until?: string | null;
          security_notifications_enabled?: boolean;
          transaction_pin_set_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_current_legal_documents: {
        Args: Record<PropertyKey, never>;
        Returns: {
          accepted_at: string;
          privacy_version: string;
          terms_version: string;
        }[];
      };
      has_current_legal_acceptance: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      set_transaction_pin: {
        Args: {
          p_pin: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      onboarding_step: OnboardingStep;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type LegalAcceptance =
  Database['public']['Tables']['legal_acceptances']['Row'];
export type UserPreferences =
  Database['public']['Tables']['user_preferences']['Row'];
export type UserSecuritySettings =
  Database['public']['Tables']['user_security_settings']['Row'];
