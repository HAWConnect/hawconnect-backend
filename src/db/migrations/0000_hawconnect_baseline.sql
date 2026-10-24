CREATE TYPE "public"."app_platform" AS ENUM('ANDROID', 'IOS', 'WEB', 'WEB_DEV');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('STUDENT', 'EMPLOYEE', 'GUEST');--> statement-breakpoint
CREATE TYPE "public"."room_report_reason" AS ENUM('WRONG_DESCRIPTION', 'WRONG_LOCATION', 'NOT_EXISTING', 'MISSING', 'OTHER');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "app_platform"[] NOT NULL,
	"user_kind" "user_kind"[] NOT NULL,
	"title_de" text NOT NULL,
	"title_en" text NOT NULL,
	"description_de" text NOT NULL,
	"description_en" text NOT NULL,
	"start_date_time" timestamp with time zone NOT NULL,
	"end_date_time" timestamp with time zone NOT NULL,
	"priority" integer NOT NULL,
	"url" text,
	"image_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer,
	"operation" text NOT NULL,
	"name" text,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "haw_legacy_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_de" text NOT NULL,
	"title_en" text NOT NULL,
	"description_de" text,
	"description_en" text,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"rrule" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manual_cl_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_de" text NOT NULL,
	"title_en" text NOT NULL,
	"description_de" text,
	"description_en" text,
	"start_date_time" timestamp with time zone NOT NULL,
	"end_date_time" timestamp with time zone,
	"organizer" text NOT NULL,
	"location" text,
	"url" text,
	"instagram" text,
	"event_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"room" text NOT NULL,
	"reason" "room_report_reason" NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "haw_legacy_events_start_time_idx" ON "haw_legacy_events" USING btree ("start_time");