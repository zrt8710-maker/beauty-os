export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      capabilities: {
        Row: {
          code: string
          created_at: string
          definition: string
          definition_version: number
          display_name: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          definition: string
          definition_version?: number
          display_name: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          definition?: string
          definition_version?: number
          display_name?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      care_roles: {
        Row: {
          code: string
          created_at: string
          definition: string
          definition_version: number
          display_name: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          definition: string
          definition_version?: number
          display_name: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          definition?: string
          definition_version?: number
          display_name?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      catalog_product_ingredients: {
        Row: {
          catalog_product_id: string
          confidence: number
          evidence_note: string | null
          ingredient_id: string
          ingredient_order: number | null
          source_id: string
        }
        Insert: {
          catalog_product_id: string
          confidence: number
          evidence_note?: string | null
          ingredient_id: string
          ingredient_order?: number | null
          source_id: string
        }
        Update: {
          catalog_product_id?: string
          confidence?: number
          evidence_note?: string | null
          ingredient_id?: string
          ingredient_order?: number | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_ingredients_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_ingredients_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_product_capabilities: {
        Row: {
          assessment_note: string | null
          capability_code: string
          catalog_product_id: string
          confidence: number | null
          created_at: string
          id: string
          reviewed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment_note?: string | null
          capability_code: string
          catalog_product_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          assessment_note?: string | null
          capability_code?: string
          catalog_product_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_capabilities_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "catalog_product_capabilities_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_product_care_roles: {
        Row: {
          assessment_note: string | null
          assignment_kind: string
          care_role_code: string
          catalog_product_id: string
          confidence: number | null
          created_at: string
          id: string
          reviewed_at: string | null
          source_locator: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment_note?: string | null
          assignment_kind: string
          care_role_code: string
          catalog_product_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          source_locator?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          assessment_note?: string | null
          assignment_kind?: string
          care_role_code?: string
          catalog_product_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          reviewed_at?: string | null
          source_locator?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_care_roles_care_role_code_fkey"
            columns: ["care_role_code"]
            isOneToOne: false
            referencedRelation: "care_roles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "catalog_product_care_roles_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_product_research_drafts: {
        Row: {
          catalog_product_id: string
          created_at: string
          created_by: string
          id: string
          overall_confidence: number | null
          research_model: string | null
          research_payload: Json
          research_run_id: string | null
          research_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          catalog_product_id: string
          created_at?: string
          created_by: string
          id?: string
          overall_confidence?: number | null
          research_model?: string | null
          research_payload: Json
          research_run_id?: string | null
          research_version: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          catalog_product_id?: string
          created_at?: string
          created_by?: string
          id?: string
          overall_confidence?: number | null
          research_model?: string | null
          research_payload?: Json
          research_run_id?: string | null
          research_version?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_research_drafts_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_research_drafts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_products: {
        Row: {
          barcode: string | null
          brand_name: string
          catalog_image_source_url: string | null
          catalog_image_url: string | null
          category: string
          confidence: number
          created_at: string
          id: string
          primary_source_id: string
          product_name: string
          product_type: string
          status: string
          subcategory: string
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          brand_name: string
          catalog_image_source_url?: string | null
          catalog_image_url?: string | null
          category: string
          confidence: number
          created_at?: string
          id?: string
          primary_source_id: string
          product_name: string
          product_type: string
          status?: string
          subcategory: string
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          brand_name?: string
          catalog_image_source_url?: string | null
          catalog_image_url?: string | null
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          primary_source_id?: string
          product_name?: string
          product_type?: string
          status?: string
          subcategory?: string
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_primary_source_id_fkey"
            columns: ["primary_source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          aliases: string[]
          created_at: string
          display_name: string | null
          id: string
          inci_name: string
          ingredient_kind: string | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          display_name?: string | null
          id?: string
          inci_name: string
          ingredient_kind?: string | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          display_name?: string | null
          id?: string
          inci_name?: string
          ingredient_kind?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_sources: {
        Row: {
          created_at: string
          id: string
          license_note: string | null
          name: string
          retrieved_at: string
          source_type: string
          source_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          license_note?: string | null
          name: string
          retrieved_at?: string
          source_type: string
          source_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          license_note?: string | null
          name?: string
          retrieved_at?: string
          source_type?: string
          source_url?: string | null
        }
        Relationships: []
      }
      product_capability_evidence: {
        Row: {
          confidence: number | null
          created_at: string
          direction: string
          evidence_note: string
          evidence_type: string
          id: string
          product_capability_id: string
          review_status: string
          source_locator: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          direction: string
          evidence_note: string
          evidence_type: string
          id?: string
          product_capability_id: string
          review_status?: string
          source_locator?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          direction?: string
          evidence_note?: string
          evidence_type?: string
          id?: string
          product_capability_id?: string
          review_status?: string
          source_locator?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_capability_evidence_product_capability_id_fkey"
            columns: ["product_capability_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      product_drafts: {
        Row: {
          barcode: string | null
          brand_name: string | null
          candidate_catalog_product_id: string | null
          category: string | null
          created_at: string
          id: string
          knowledge_confirmed_at: string | null
          match_confidence: number | null
          match_evidence: string | null
          match_source: string | null
          notes: string | null
          product_name: string | null
          product_type: string | null
          source: string
          status: string
          subcategory: string | null
          updated_at: string
          upload_asset_id: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          brand_name?: string | null
          candidate_catalog_product_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          knowledge_confirmed_at?: string | null
          match_confidence?: number | null
          match_evidence?: string | null
          match_source?: string | null
          notes?: string | null
          product_name?: string | null
          product_type?: string | null
          source?: string
          status?: string
          subcategory?: string | null
          updated_at?: string
          upload_asset_id: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          brand_name?: string | null
          candidate_catalog_product_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          knowledge_confirmed_at?: string | null
          match_confidence?: number | null
          match_evidence?: string | null
          match_source?: string | null
          notes?: string | null
          product_name?: string | null
          product_type?: string | null
          source?: string
          status?: string
          subcategory?: string | null
          updated_at?: string
          upload_asset_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_drafts_candidate_catalog_product_id_fkey"
            columns: ["candidate_catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_drafts_upload_asset_id_fkey"
            columns: ["upload_asset_id"]
            isOneToOne: false
            referencedRelation: "upload_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand_name: string | null
          catalog_product_id: string | null
          category: string | null
          created_at: string
          created_by_user_id: string
          id: string
          identity_status: string
          product_name: string
          product_type: string
          subcategory: string
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          brand_name?: string | null
          catalog_product_id?: string | null
          category: string
          created_at?: string
          created_by_user_id: string
          id?: string
          identity_status?: string
          product_name: string
          product_type: string
          subcategory: string
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          brand_name?: string | null
          catalog_product_id?: string | null
          category?: string
          created_at?: string
          created_by_user_id?: string
          id?: string
          identity_status?: string
          product_name?: string
          product_type?: string
          subcategory?: string
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allergies: string[]
          avoid_ingredients: string[]
          created_at: string
          display_name: string | null
          goals: string[]
          latitude: number | null
          locale: string
          location_name: string | null
          long_term_skin_baseline?: Json
          longitude: number | null
          max_am_steps: number
          max_pm_steps: number
          onboarding_completed_at: string | null
          preferences: Json
          sensitivity_level: number
          skin_type: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allergies?: string[]
          avoid_ingredients?: string[]
          created_at?: string
          display_name?: string | null
          goals?: string[]
          latitude?: number | null
          locale?: string
          location_name?: string | null
          long_term_skin_baseline?: Json
          longitude?: number | null
          max_am_steps?: number
          max_pm_steps?: number
          onboarding_completed_at?: string | null
          preferences?: Json
          sensitivity_level?: number
          skin_type?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allergies?: string[]
          avoid_ingredients?: string[]
          created_at?: string
          display_name?: string | null
          goals?: string[]
          latitude?: number | null
          locale?: string
          location_name?: string | null
          long_term_skin_baseline?: Json
          longitude?: number | null
          max_am_steps?: number
          max_pm_steps?: number
          onboarding_completed_at?: string | null
          preferences?: Json
          sensitivity_level?: number
          skin_type?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchase_analyses: {
        Row: {
          candidate_product_id: string | null
          candidate_snapshot: Json
          compatibility_score: number
          created_at: string
          decision: string
          duplicate_score: number
          evidence: Json
          final_score: number
          gap_score: number
          goal_snapshot: Json
          id: string
          inventory_snapshot: Json
          reason_codes: string[]
          risk_score: number
          unknowns: Json
          usage_probability_score: number
          user_id: string
        }
        Insert: {
          candidate_product_id?: string | null
          candidate_snapshot: Json
          compatibility_score: number
          created_at?: string
          decision: string
          duplicate_score: number
          evidence?: Json
          final_score: number
          gap_score: number
          goal_snapshot: Json
          id?: string
          inventory_snapshot: Json
          reason_codes?: string[]
          risk_score: number
          unknowns?: Json
          usage_probability_score: number
          user_id: string
        }
        Update: {
          candidate_product_id?: string | null
          candidate_snapshot?: Json
          compatibility_score?: number
          created_at?: string
          decision?: string
          duplicate_score?: number
          evidence?: Json
          final_score?: number
          gap_score?: number
          goal_snapshot?: Json
          id?: string
          inventory_snapshot?: Json
          reason_codes?: string[]
          risk_score?: number
          unknowns?: Json
          usage_probability_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_analyses_candidate_product_id_fkey"
            columns: ["candidate_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_steps: {
        Row: {
          created_at: string
          feedback_at: string | null
          feedback_notes: string | null
          feedback_rating: number | null
          id: string
          owned_product_id: string
          reason: string
          reason_code: string
          role: string
          routine_id: string
          score: number
          score_breakdown: Json
          step_order: number
        }
        Insert: {
          created_at?: string
          feedback_at?: string | null
          feedback_notes?: string | null
          feedback_rating?: number | null
          id?: string
          owned_product_id: string
          reason: string
          reason_code?: string
          role: string
          routine_id: string
          score: number
          score_breakdown?: Json
          step_order: number
        }
        Update: {
          created_at?: string
          feedback_at?: string | null
          feedback_notes?: string | null
          feedback_rating?: number | null
          id?: string
          owned_product_id?: string
          reason?: string
          reason_code?: string
          role?: string
          routine_id?: string
          score?: number
          score_breakdown?: Json
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "routine_steps_owned_product_id_fkey"
            columns: ["owned_product_id"]
            isOneToOne: false
            referencedRelation: "user_owned_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_steps_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_memories: {
        Row: {
          id: string
          user_id: string
          source: string
          fingerprint: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source: string
          fingerprint: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          source?: string
          fingerprint?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
      routines: {
        Row: {
          created_at: string
          decision_snapshot: Json | null
          excluded_products: Json
          id: string
          period: string
          routine_date: string
          skin_snapshot: Json
          status: string
          updated_at: string
          user_id: string
          weather_snapshot: Json
        }
        Insert: {
          created_at?: string
          decision_snapshot?: Json | null
          excluded_products?: Json
          id?: string
          period: string
          routine_date: string
          skin_snapshot?: Json
          status?: string
          updated_at?: string
          user_id: string
          weather_snapshot?: Json
        }
        Update: {
          created_at?: string
          decision_snapshot?: Json | null
          excluded_products?: Json
          id?: string
          period?: string
          routine_date?: string
          skin_snapshot?: Json
          status?: string
          updated_at?: string
          user_id?: string
          weather_snapshot?: Json
        }
        Relationships: []
      }
      skin_checkins: {
        Row: {
          acne_level: number
          created_at: string
          daily_state?: Json | null
          dryness_level: number
          field_provenance?: Json | null
          id: string
          known_fields?: string[] | null
          notes: string | null
          oiliness_level: number
          recorded_date: string
          redness_level: number
          sensitivity_level: number
          user_id: string
        }
        Insert: {
          acne_level?: number
          created_at?: string
          daily_state?: Json | null
          dryness_level?: number
          field_provenance?: Json | null
          id?: string
          known_fields?: string[] | null
          notes?: string | null
          oiliness_level?: number
          recorded_date: string
          redness_level?: number
          sensitivity_level?: number
          user_id: string
        }
        Update: {
          acne_level?: number
          created_at?: string
          daily_state?: Json | null
          dryness_level?: number
          field_provenance?: Json | null
          id?: string
          known_fields?: string[] | null
          notes?: string | null
          oiliness_level?: number
          recorded_date?: string
          redness_level?: number
          sensitivity_level?: number
          user_id?: string
        }
        Relationships: []
      }
      upload_assets: {
        Row: {
          created_at: string
          file_name: string
          file_size: number
          id: string
          mime_type: string
          product_id: string | null
          owned_product_id?: string | null
          purpose: string
          status: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size: number
          id?: string
          mime_type: string
          product_id?: string | null
          owned_product_id?: string | null
          purpose: string
          status?: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          product_id?: string | null
          owned_product_id?: string | null
          purpose?: string
          status?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_assets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_assets_owned_product_id_fkey"
            columns: ["owned_product_id"]
            isOneToOne: false
            referencedRelation: "user_owned_products"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_history: {
        Row: {
          completion_status: string
          created_at: string
          feedback_conversation_id: string | null
          feedback_message_ids: string[]
          id: string
          notes: string | null
          overall_rating: number | null
          period: string
          routine_role_preferences: Json
          routine_id: string
          skin_reaction_level: number | null
          used_date: string
          user_id: string
        }
        Insert: {
          completion_status: string
          created_at?: string
          feedback_conversation_id?: string | null
          feedback_message_ids?: string[]
          id?: string
          notes?: string | null
          overall_rating?: number | null
          period: string
          routine_role_preferences?: Json
          routine_id: string
          skin_reaction_level?: number | null
          used_date: string
          user_id: string
        }
        Update: {
          completion_status?: string
          created_at?: string
          feedback_conversation_id?: string | null
          feedback_message_ids?: string[]
          id?: string
          notes?: string | null
          overall_rating?: number | null
          period?: string
          routine_role_preferences?: Json
          routine_id?: string
          skin_reaction_level?: number | null
          used_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_history_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_history_products: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          owned_product_id: string
          rating: number | null
          reaction_level: number | null
          reaction_tags: string[]
          texture_feedback: string | null
          usage_history_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          owned_product_id: string
          rating?: number | null
          reaction_level?: number | null
          reaction_tags?: string[]
          texture_feedback?: string | null
          usage_history_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          owned_product_id?: string
          rating?: number | null
          reaction_level?: number | null
          reaction_tags?: string[]
          texture_feedback?: string | null
          usage_history_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_history_products_owned_product_id_fkey"
            columns: ["owned_product_id"]
            isOneToOne: false
            referencedRelation: "user_owned_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_history_products_usage_history_id_fkey"
            columns: ["usage_history_id"]
            isOneToOne: false
            referencedRelation: "usage_history"
            referencedColumns: ["id"]
          },
        ]
      }
      user_owned_products: {
        Row: {
          asset_category?: string
          archived_at: string | null
          created_at: string
          expires_on: string | null
          id: string
          identified_image_source_url?: string | null
          identified_image_url?: string | null
          image_override_upload_id?: string | null
          notes: string | null
          package_size?: string | null
          manufacture_date?: string | null
          opened_at: string | null
          product_id: string
          purchase_date: string | null
          quantity_remaining_percent: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_category?: string
          archived_at?: string | null
          created_at?: string
          expires_on?: string | null
          id?: string
          identified_image_source_url?: string | null
          identified_image_url?: string | null
          image_override_upload_id?: string | null
          notes?: string | null
          package_size?: string | null
          manufacture_date?: string | null
          opened_at?: string | null
          product_id: string
          purchase_date?: string | null
          quantity_remaining_percent?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_category?: string
          archived_at?: string | null
          created_at?: string
          expires_on?: string | null
          id?: string
          identified_image_source_url?: string | null
          identified_image_url?: string | null
          image_override_upload_id?: string | null
          notes?: string | null
          package_size?: string | null
          manufacture_date?: string | null
          opened_at?: string | null
          product_id?: string
          purchase_date?: string | null
          quantity_remaining_percent?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_owned_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_owned_products_image_override_upload_id_fkey"
            columns: ["image_override_upload_id"]
            isOneToOne: false
            referencedRelation: "upload_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_data: {
        Row: {
          created_at: string
          humidity: number | null
          id: string
          raw_payload: Json
          recorded_date: string
          source: string
          temperature: number | null
          user_id: string
          uv_index: number | null
          weather_code: string | null
        }
        Insert: {
          created_at?: string
          humidity?: number | null
          id?: string
          raw_payload?: Json
          recorded_date: string
          source?: string
          temperature?: number | null
          user_id: string
          uv_index?: number | null
          weather_code?: string | null
        }
        Update: {
          created_at?: string
          humidity?: number | null
          id?: string
          raw_payload?: Json
          recorded_date?: string
          source?: string
          temperature?: number | null
          user_id?: string
          uv_index?: number | null
          weather_code?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_catalog_seed_v01: {
        Args: { p_input: Json }
        Returns: Json
      }
      apply_product_knowledge_curation_v01: {
        Args: { p_input: Json }
        Returns: Json
      }
      confirm_product_draft: {
        Args: { p_catalog_product_id?: string; p_draft_id: string }
        Returns: {
          created_owned_product_id: string
          created_product_id: string
        }[]
      }
      create_owned_product_with_identity: {
        Args: {
          p_barcode: string
          p_brand_name: string
          p_catalog_product_id: string
          p_category: string
          p_expires_on: string
          p_notes: string
          p_opened_at: string
          p_product_name: string
          p_product_type: string
          p_purchase_date: string
          p_quantity_remaining_percent: number
          p_resolution_kind: string
          p_status: string
          p_subcategory: string
          p_user_id: string
          p_variant_name: string
        }
        Returns: {
          archived_at: string | null
          created_at: string
          expires_on: string | null
          id: string
          notes: string | null
          package_size: string | null
          manufacture_date: string | null
          opened_at: string | null
          product_id: string
          purchase_date: string | null
          quantity_remaining_percent: number
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_owned_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_owned_product_with_identity_idempotent: {
        Args: {
          p_asset_category: string
          p_barcode: string | null
          p_brand_name: string | null
          p_catalog_product_id: string | null
          p_category: string
          p_expires_on: string | null
          p_idempotency_key: string
          p_manufacture_date: string | null
          p_notes: string | null
          p_opened_at: string | null
          p_package_size: string | null
          p_product_name: string
          p_product_type: string
          p_purchase_date: string | null
          p_quantity_remaining_percent: number
          p_resolution_kind: string
          p_status: string
          p_subcategory: string
          p_user_id: string
          p_variant_name: string | null
        }
        Returns: Database["public"]["Tables"]["user_owned_products"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "user_owned_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      find_verified_catalog_products_by_identity: {
        Args: { p_brand_name: string; p_product_name: string }
        Returns: {
          barcode: string | null
          brand_name: string
          category: string
          confidence: number
          created_at: string
          id: string
          primary_source_id: string
          product_name: string
          product_type: string
          status: string
          subcategory: string
          updated_at: string
          variant_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      normalize_product_match_text: { Args: { value: string }; Returns: string }
      persist_purchase_analysis: {
        Args: {
          p_candidate_product_id: string
          p_candidate_snapshot: Json
          p_compatibility_score: number
          p_decision: string
          p_duplicate_score: number
          p_evidence: Json
          p_final_score: number
          p_gap_score: number
          p_goal_snapshot: Json
          p_inventory_snapshot: Json
          p_reason_codes: string[]
          p_risk_score: number
          p_unknowns: Json
          p_usage_probability_score: number
        }
        Returns: {
          candidate_product_id: string | null
          candidate_snapshot: Json
          compatibility_score: number
          created_at: string
          decision: string
          duplicate_score: number
          evidence: Json
          final_score: number
          gap_score: number
          goal_snapshot: Json
          id: string
          inventory_snapshot: Json
          reason_codes: string[]
          risk_score: number
          unknowns: Json
          usage_probability_score: number
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "purchase_analyses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_routine_usage: {
        Args: {
          p_completion_status: string
          p_notes: string
          p_overall_rating: number
          p_period: string
          p_products: Json
          p_routine_id: string
          p_skin_reaction_level: number
          p_used_date: string
        }
        Returns: string
      }
      record_usage_feedback_message: {
        Args: {
          p_completion_status: string
          p_conversation_id: string
          p_message_id: string
          p_notes: string | null
          p_products: Json
          p_routine_role_preferences: Json
          p_routine_id: string
        }
        Returns: {
          applied: boolean
          usage_id: string
        }[]
      }
      replace_daily_routine: {
        Args: {
          p_decision_snapshot: Json
          p_excluded_products: Json
          p_period: string
          p_routine_date: string
          p_skin_snapshot: Json
          p_steps: Json
          p_weather_snapshot: Json
        }
        Returns: string
      }
      save_product_draft_match: {
        Args: {
          p_candidate_catalog_product_id: string
          p_draft_id: string
          p_match_source: string
        }
        Returns: {
          barcode: string | null
          brand_name: string | null
          candidate_catalog_product_id: string | null
          category: string | null
          created_at: string
          id: string
          knowledge_confirmed_at: string | null
          match_confidence: number | null
          match_evidence: string | null
          match_source: string | null
          notes: string | null
          product_name: string | null
          product_type: string | null
          source: string
          status: string
          subcategory: string | null
          updated_at: string
          upload_asset_id: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_drafts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
