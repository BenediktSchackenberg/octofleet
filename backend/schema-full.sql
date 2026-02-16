-- Octofleet Platform - Full Database Schema
-- CI/CD compatible with TimescaleDB

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Excludes TimescaleDB internal schemas and psql meta-commands

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path = public;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = heap;
CREATE TABLE public.hardware_changes (
    "time" timestamp with time zone NOT NULL,
    node_id uuid NOT NULL,
    change_type character varying(50),
    component character varying(100),
    old_value jsonb,
    new_value jsonb
);
CREATE TABLE public.node_metrics (
    "time" timestamp with time zone NOT NULL,
    node_id uuid NOT NULL,
    cpu_percent real,
    ram_percent real,
    disk_percent real,
    network_in_mb real,
    network_out_mb real
);
CREATE TABLE public.eventlog_entries (
    id bigint NOT NULL,
    node_id text NOT NULL,
    log_name text NOT NULL,
    event_id integer NOT NULL,
    level integer NOT NULL,
    level_name text,
    source text,
    message text,
    event_time timestamp with time zone NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_data jsonb
);
CREATE TABLE public.alert_rule_channels (
    rule_id uuid NOT NULL,
    channel_id uuid NOT NULL
);
CREATE TABLE public.alert_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    event_type character varying(100) NOT NULL,
    condition jsonb DEFAULT '{}'::jsonb,
    severity character varying(20) DEFAULT 'warning'::character varying,
    is_enabled boolean DEFAULT true,
    cooldown_minutes integer DEFAULT 60,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid,
    rule_name character varying(255),
    event_type character varying(100) NOT NULL,
    severity character varying(20) NOT NULL,
    title character varying(500) NOT NULL,
    message text,
    node_id uuid,
    node_name character varying(255),
    metadata jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'fired'::character varying,
    fired_at timestamp with time zone DEFAULT now(),
    acknowledged_at timestamp with time zone,
    acknowledged_by character varying(255),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    key_hash character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    permissions text[] DEFAULT '{}'::text[],
    expires_at timestamp with time zone,
    last_used timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true
);
CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    user_id uuid,
    action character varying(100) NOT NULL,
    resource_type character varying(50),
    resource_id character varying(255),
    details jsonb,
    ip_address inet
);
CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;
CREATE TABLE public.browser_cookies (
    id integer NOT NULL,
    node_id uuid NOT NULL,
    username character varying(255) NOT NULL,
    browser character varying(50) NOT NULL,
    profile character varying(255) DEFAULT 'Default'::character varying NOT NULL,
    domain character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    path character varying(512) DEFAULT '/'::character varying,
    expires_utc timestamp with time zone,
    is_secure boolean DEFAULT false,
    is_http_only boolean DEFAULT false,
    same_site character varying(20),
    is_session boolean DEFAULT false,
    is_expired boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.browser_cookies_current (
    id bigint NOT NULL,
    node_id uuid,
    browser character varying(50),
    profile character varying(255) DEFAULT 'Default'::character varying,
    domain character varying(500),
    name character varying(500),
    value text,
    expires timestamp with time zone,
    secure boolean DEFAULT false,
    http_only boolean DEFAULT false,
    same_site character varying(20),
    created_at timestamp with time zone
);
CREATE SEQUENCE public.browser_cookies_current_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.browser_cookies_current_id_seq OWNED BY public.browser_cookies_current.id;
CREATE SEQUENCE public.browser_cookies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.browser_cookies_id_seq OWNED BY public.browser_cookies.id;
CREATE TABLE public.browser_current (
    node_id uuid NOT NULL,
    browser character varying(50) NOT NULL,
    profile character varying(255) DEFAULT 'Default'::character varying NOT NULL,
    extensions jsonb,
    cookies_count integer DEFAULT 0,
    history_count integer DEFAULT 0,
    logins_count integer DEFAULT 0,
    bookmarks_count integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    profile_path text,
    bookmark_count integer,
    password_count integer,
    username character varying(255) DEFAULT ''::character varying
);
CREATE TABLE public.deployment_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deployment_id uuid NOT NULL,
    node_id uuid NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    exit_code integer,
    output text,
    error_message text,
    attempts integer DEFAULT 0,
    last_attempt_at timestamp with time zone,
    CONSTRAINT deployment_status_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'downloading'::character varying, 'installing'::character varying, 'success'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);
CREATE TABLE public.deployments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    package_version_id uuid NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid,
    mode character varying(20) DEFAULT 'required'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    scheduled_start timestamp with time zone,
    scheduled_end timestamp with time zone,
    maintenance_window_only boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by character varying(255),
    CONSTRAINT deployments_mode_check CHECK (((mode)::text = ANY ((ARRAY['required'::character varying, 'available'::character varying, 'uninstall'::character varying])::text[]))),
    CONSTRAINT deployments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'paused'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT deployments_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['node'::character varying, 'group'::character varying, 'all'::character varying])::text[])))
);
CREATE TABLE public.detection_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_version_id uuid NOT NULL,
    rule_order integer DEFAULT 1,
    rule_type text NOT NULL,
    config jsonb NOT NULL,
    operator text DEFAULT 'AND'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT detection_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['msi'::text, 'registry'::text, 'file'::text, 'service'::text, 'script'::text])))
);
CREATE TABLE public.device_groups (
    node_id uuid NOT NULL,
    group_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by character varying(255)
);
CREATE TABLE public.device_tags (
    node_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.enrollment_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token character varying(64) NOT NULL,
    name character varying(255),
    description text,
    expires_at timestamp with time zone,
    max_uses integer,
    current_uses integer DEFAULT 0,
    created_by character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone,
    is_active boolean DEFAULT true
);
CREATE TABLE public.eventlog_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id text,
    log_name text NOT NULL,
    min_level integer DEFAULT 3,
    event_ids integer[],
    enabled boolean DEFAULT true,
    hours_back integer DEFAULT 24,
    max_events integer DEFAULT 500,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.eventlog_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.eventlog_entries_id_seq OWNED BY public.eventlog_entries.id;
CREATE VIEW public.eventlog_summary AS
 SELECT node_id,
    log_name,
    count(*) FILTER (WHERE (level = 1)) AS critical_count,
    count(*) FILTER (WHERE (level = 2)) AS error_count,
    count(*) FILTER (WHERE (level = 3)) AS warning_count,
    count(*) FILTER (WHERE (level >= 4)) AS info_count,
    max(collected_at) AS last_collected
   FROM public.eventlog_entries
  WHERE (collected_at > (now() - '24:00:00'::interval))
  GROUP BY node_id, log_name;
CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    parent_id uuid,
    is_dynamic boolean DEFAULT false,
    dynamic_rule jsonb,
    color character varying(7),
    icon character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.hardware_current (
    node_id uuid NOT NULL,
    cpu jsonb,
    ram jsonb,
    disks jsonb,
    mainboard jsonb,
    bios jsonb,
    gpu jsonb,
    nics jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    virtualization jsonb
);
CREATE TABLE public.hotfixes_current (
    node_id uuid NOT NULL,
    kb_id character varying(20) NOT NULL,
    description text,
    installed_on date,
    updated_at timestamp with time zone DEFAULT now(),
    installed_by character varying(255)
);
CREATE TABLE public.job_assignments (
    id integer NOT NULL,
    job_id uuid NOT NULL,
    node_id uuid NOT NULL,
    status text DEFAULT 'pending'::text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT job_assignments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);
CREATE SEQUENCE public.job_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.job_assignments_id_seq OWNED BY public.job_assignments.id;
CREATE TABLE public.job_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    node_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    queued_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    exit_code integer,
    stdout text,
    stderr text,
    error_message text,
    duration_ms integer,
    attempt integer DEFAULT 1,
    max_attempts integer DEFAULT 3,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT job_instances_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'running'::text, 'success'::text, 'failed'::text, 'cancelled'::text, 'expired'::text])))
);
CREATE TABLE public.job_logs (
    id bigint NOT NULL,
    instance_id uuid NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    level text DEFAULT 'info'::text,
    message text NOT NULL,
    data jsonb,
    CONSTRAINT job_logs_level_check CHECK ((level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text])))
);
CREATE SEQUENCE public.job_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.job_logs_id_seq OWNED BY public.job_logs.id;
CREATE TABLE public.job_results (
    id integer NOT NULL,
    job_id uuid NOT NULL,
    node_id uuid NOT NULL,
    success boolean NOT NULL,
    logs text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.job_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.job_results_id_seq OWNED BY public.job_results.id;
CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    description text,
    target_type text NOT NULL,
    target_id uuid,
    target_tag text,
    command_type text NOT NULL,
    command_data jsonb NOT NULL,
    priority integer DEFAULT 5,
    scheduled_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    timeout_seconds integer DEFAULT 300,
    CONSTRAINT jobs_command_type_check CHECK ((command_type = ANY (ARRAY['run'::text, 'script'::text, 'inventory'::text, 'install_package'::text, 'uninstall_package'::text, 'update_package'::text, 'restart-agent'::text]))),
    CONSTRAINT jobs_target_type_check CHECK ((target_type = ANY (ARRAY['device'::text, 'group'::text, 'tag'::text, 'all'::text])))
);
CREATE VIEW public.job_summary AS
 SELECT j.id AS job_id,
    j.name,
    j.command_type,
    j.target_type,
    j.created_at,
    count(ji.id) AS total_instances,
    count(
        CASE
            WHEN (ji.status = 'pending'::text) THEN 1
            ELSE NULL::integer
        END) AS pending,
    count(
        CASE
            WHEN (ji.status = 'queued'::text) THEN 1
            ELSE NULL::integer
        END) AS queued,
    count(
        CASE
            WHEN (ji.status = 'running'::text) THEN 1
            ELSE NULL::integer
        END) AS running,
    count(
        CASE
            WHEN (ji.status = 'success'::text) THEN 1
            ELSE NULL::integer
        END) AS success,
    count(
        CASE
            WHEN (ji.status = 'failed'::text) THEN 1
            ELSE NULL::integer
        END) AS failed,
    count(
        CASE
            WHEN (ji.status = 'cancelled'::text) THEN 1
            ELSE NULL::integer
        END) AS cancelled
   FROM (public.jobs j
     LEFT JOIN public.job_instances ji ON ((ji.job_id = j.id)))
  GROUP BY j.id, j.name, j.command_type, j.target_type, j.created_at;
CREATE TABLE public.maintenance_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    days_of_week integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    timezone text DEFAULT 'Europe/Berlin'::text,
    is_active boolean DEFAULT true,
    target_type text,
    target_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT maintenance_windows_target_type_check CHECK ((target_type = ANY (ARRAY['all'::text, 'group'::text, 'node'::text])))
);
CREATE TABLE public.network_current (
    node_id uuid NOT NULL,
    open_ports jsonb,
    connections jsonb,
    firewall_rules jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    adapters jsonb,
    listening_ports jsonb
);
CREATE TABLE public.node_health (
    node_id uuid NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now(),
    is_online boolean DEFAULT true,
    last_offline_alert_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0
);
CREATE TABLE public.node_snapshots (
    "time" timestamp with time zone NOT NULL,
    node_id uuid NOT NULL,
    snapshot_type character varying(50),
    data jsonb NOT NULL,
    data_hash character varying(64)
);
CREATE TABLE public.nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id character varying(255) NOT NULL,
    hostname character varying(255) NOT NULL,
    domain character varying(255),
    os_name character varying(255),
    os_version character varying(100),
    os_build character varying(50),
    first_seen timestamp with time zone DEFAULT now(),
    last_seen timestamp with time zone DEFAULT now(),
    is_online boolean DEFAULT false,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    agent_version text
);
CREATE TABLE public.notification_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    channel_type character varying(50) NOT NULL,
    config jsonb NOT NULL,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.package_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    version text NOT NULL,
    filename text NOT NULL,
    file_size bigint,
    sha256_hash text,
    install_command text,
    install_args jsonb,
    uninstall_command text,
    uninstall_args jsonb,
    requires_reboot boolean DEFAULT false,
    requires_admin boolean DEFAULT true,
    silent_install boolean DEFAULT true,
    is_latest boolean DEFAULT false,
    is_active boolean DEFAULT true,
    release_date date,
    release_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    download_url text
);
CREATE TABLE public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    vendor text,
    description text,
    category text,
    os_type text DEFAULT 'windows'::text,
    os_min_version text,
    architecture text DEFAULT 'any'::text,
    homepage_url text,
    icon_url text,
    tags text[],
    is_active boolean DEFAULT true,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT packages_architecture_check CHECK ((architecture = ANY (ARRAY['x64'::text, 'x86'::text, 'arm64'::text, 'any'::text]))),
    CONSTRAINT packages_os_type_check CHECK ((os_type = ANY (ARRAY['windows'::text, 'linux'::text, 'macos'::text, 'any'::text])))
);
CREATE VIEW public.package_catalog AS
 SELECT p.id,
    p.name,
    p.display_name,
    p.vendor,
    p.description,
    p.category,
    p.os_type,
    p.icon_url,
    p.tags,
    p.is_active,
    pv.version AS latest_version,
    pv.id AS latest_version_id,
    pv.release_date,
    ( SELECT count(*) AS count
           FROM public.package_versions
          WHERE (package_versions.package_id = p.id)) AS version_count
   FROM (public.packages p
     LEFT JOIN public.package_versions pv ON (((pv.package_id = p.id) AND (pv.is_latest = true))));
CREATE TABLE public.package_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    source_type text NOT NULL,
    base_url text NOT NULL,
    priority integer DEFAULT 5,
    requires_auth boolean DEFAULT false,
    auth_config jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT package_sources_source_type_check CHECK ((source_type = ANY (ARRAY['http'::text, 'smb'::text, 'local'::text])))
);
CREATE TABLE public.package_version_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    relative_path text NOT NULL,
    is_primary boolean DEFAULT false
);
CREATE TABLE public.remediation_jobs (
    id integer NOT NULL,
    vulnerability_id integer,
    remediation_package_id integer,
    rule_id integer,
    node_id uuid,
    software_name text NOT NULL,
    software_version text NOT NULL,
    cve_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requires_approval boolean DEFAULT false,
    approved_by text,
    approved_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    exit_code integer,
    output_log text,
    error_message text,
    rollback_attempted boolean DEFAULT false,
    rollback_success boolean,
    health_check_passed boolean,
    health_check_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT remediation_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'running'::text, 'success'::text, 'failed'::text, 'rolled_back'::text, 'skipped'::text])))
);
CREATE SEQUENCE public.remediation_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.remediation_jobs_id_seq OWNED BY public.remediation_jobs.id;
CREATE TABLE public.remediation_packages (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    target_software text NOT NULL,
    min_fixed_version text,
    fix_method text NOT NULL,
    fix_command text,
    package_id uuid,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT remediation_packages_fix_method_check CHECK ((fix_method = ANY (ARRAY['winget'::text, 'choco'::text, 'package'::text, 'script'::text])))
);
CREATE SEQUENCE public.remediation_packages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.remediation_packages_id_seq OWNED BY public.remediation_packages.id;
CREATE TABLE public.remediation_rules (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    min_severity text NOT NULL,
    software_pattern text,
    auto_remediate boolean DEFAULT false,
    require_approval boolean DEFAULT true,
    maintenance_window_only boolean DEFAULT true,
    notify_on_new_vuln boolean DEFAULT true,
    notify_on_fix_success boolean DEFAULT true,
    notify_on_fix_failure boolean DEFAULT true,
    notification_channel_id integer,
    priority integer DEFAULT 100,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT remediation_rules_min_severity_check CHECK ((min_severity = ANY (ARRAY['CRITICAL'::text, 'HIGH'::text, 'MEDIUM'::text, 'LOW'::text])))
);
CREATE SEQUENCE public.remediation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.remediation_rules_id_seq OWNED BY public.remediation_rules.id;
CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    is_system boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.security_current (
    node_id uuid NOT NULL,
    antivirus jsonb,
    firewall jsonb,
    bitlocker jsonb,
    uac_enabled boolean,
    secure_boot boolean,
    tpm_version character varying(20),
    last_scan timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    defender jsonb,
    tpm jsonb,
    uac jsonb,
    local_admins jsonb
);
CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    token_hash character varying(255) NOT NULL,
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    last_activity timestamp with time zone DEFAULT now()
);
CREATE TABLE public.software_changes (
    "time" timestamp with time zone NOT NULL,
    node_id uuid NOT NULL,
    change_type character varying(20),
    software_name character varying(500),
    old_version character varying(100),
    new_version character varying(100)
);
CREATE TABLE public.software_current (
    id bigint NOT NULL,
    node_id uuid,
    name character varying(500) NOT NULL,
    version character varying(100),
    publisher character varying(255),
    install_date date,
    install_path text,
    size_mb integer,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.software_current_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.software_current_id_seq OWNED BY public.software_current.id;
CREATE TABLE public.system_current (
    node_id uuid NOT NULL,
    local_users jsonb,
    domain_users jsonb,
    services jsonb,
    startup_items jsonb,
    scheduled_tasks jsonb,
    shares jsonb,
    printers jsonb,
    env_vars jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    users jsonb,
    os_name text,
    os_version text,
    os_build text,
    computer_name text,
    domain text,
    workgroup text,
    domain_role text,
    is_domain_joined boolean,
    uptime_hours double precision,
    uptime_formatted character varying(50),
    last_boot_time timestamp without time zone,
    agent_version text
);
CREATE TABLE public.system_settings (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by text
);
CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    color character varying(7),
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.update_history (
    node_id uuid NOT NULL,
    update_id text NOT NULL,
    kb_id text,
    title text NOT NULL,
    description text,
    installed_on timestamp with time zone,
    operation text,
    result_code text,
    support_url text,
    categories jsonb,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid
);
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255),
    password_hash character varying(255) NOT NULL,
    display_name character varying(255),
    is_active boolean DEFAULT true,
    is_superuser boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone
);
CREATE VIEW public.v_nodes_overview AS
 SELECT n.id,
    n.node_id,
    n.hostname,
    n.domain,
    n.os_name,
    n.os_version,
    n.is_online,
    n.last_seen,
    n.tags,
    (h.cpu ->> 'name'::text) AS cpu_name,
    ((h.ram ->> 'totalGB'::text))::numeric AS ram_gb,
    jsonb_array_length(h.disks) AS disk_count,
    ( SELECT count(*) AS count
           FROM public.software_current s
          WHERE (s.node_id = n.id)) AS software_count
   FROM (public.nodes n
     LEFT JOIN public.hardware_current h ON ((h.node_id = n.id)));
CREATE VIEW public.v_recent_changes AS
 SELECT software_changes."time",
    software_changes.node_id,
    'software'::text AS category,
    software_changes.change_type,
    software_changes.software_name AS item,
    software_changes.old_version,
    software_changes.new_version
   FROM public.software_changes
  WHERE (software_changes."time" > (now() - '7 days'::interval))
UNION ALL
 SELECT hardware_changes."time",
    hardware_changes.node_id,
    'hardware'::text AS category,
    hardware_changes.change_type,
    hardware_changes.component AS item,
    (hardware_changes.old_value)::text AS old_version,
    (hardware_changes.new_value)::text AS new_version
   FROM public.hardware_changes
  WHERE (hardware_changes."time" > (now() - '7 days'::interval))
  ORDER BY 1 DESC;
CREATE TABLE public.vulnerabilities (
    id integer NOT NULL,
    software_name text NOT NULL,
    software_version text NOT NULL,
    cve_id text NOT NULL,
    description text,
    cvss_score numeric(3,1),
    cvss_vector text,
    severity text,
    published_date timestamp with time zone,
    reference_urls jsonb DEFAULT '[]'::jsonb,
    discovered_at timestamp with time zone DEFAULT now(),
    last_checked timestamp with time zone DEFAULT now()
);
CREATE VIEW public.v_remediable_vulnerabilities AS
 SELECT v.id AS vulnerability_id,
    v.software_name,
    v.software_version,
    v.cve_id,
    v.cvss_score,
    v.severity,
    rp.id AS remediation_package_id,
    rp.name AS fix_package_name,
    rp.fix_method,
    rp.fix_command,
    rp.min_fixed_version,
        CASE
            WHEN (rp.id IS NOT NULL) THEN true
            ELSE false
        END AS has_fix_available
   FROM (public.vulnerabilities v
     LEFT JOIN public.remediation_packages rp ON (((v.software_name ~~* (('%'::text || rp.target_software) || '%'::text)) AND (rp.enabled = true))))
  WHERE (v.severity = ANY (ARRAY['CRITICAL'::text, 'HIGH'::text]))
  ORDER BY v.cvss_score DESC NULLS LAST;
CREATE VIEW public.v_software_stats AS
 SELECT name,
    publisher,
    count(DISTINCT node_id) AS installed_count,
    array_agg(DISTINCT version) AS versions
   FROM public.software_current
  GROUP BY name, publisher
  ORDER BY (count(DISTINCT node_id)) DESC;
CREATE SEQUENCE public.vulnerabilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.vulnerabilities_id_seq OWNED BY public.vulnerabilities.id;
CREATE TABLE public.vulnerability_scans (
    id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    packages_scanned integer DEFAULT 0,
    vulnerabilities_found integer DEFAULT 0,
    critical_count integer DEFAULT 0,
    high_count integer DEFAULT 0,
    medium_count integer DEFAULT 0,
    low_count integer DEFAULT 0,
    status text DEFAULT 'running'::text,
    error_message text
);
CREATE SEQUENCE public.vulnerability_scans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.vulnerability_scans_id_seq OWNED BY public.vulnerability_scans.id;
CREATE TABLE public.vulnerability_suppressions (
    id integer NOT NULL,
    cve_id text NOT NULL,
    software_name text,
    reason text NOT NULL,
    suppressed_by text NOT NULL,
    suppressed_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone
);
CREATE SEQUENCE public.vulnerability_suppressions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.vulnerability_suppressions_id_seq OWNED BY public.vulnerability_suppressions.id;
ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);
ALTER TABLE ONLY public.browser_cookies ALTER COLUMN id SET DEFAULT nextval('public.browser_cookies_id_seq'::regclass);
ALTER TABLE ONLY public.browser_cookies_current ALTER COLUMN id SET DEFAULT nextval('public.browser_cookies_current_id_seq'::regclass);
ALTER TABLE ONLY public.eventlog_entries ALTER COLUMN id SET DEFAULT nextval('public.eventlog_entries_id_seq'::regclass);
ALTER TABLE ONLY public.job_assignments ALTER COLUMN id SET DEFAULT nextval('public.job_assignments_id_seq'::regclass);
ALTER TABLE ONLY public.job_logs ALTER COLUMN id SET DEFAULT nextval('public.job_logs_id_seq'::regclass);
ALTER TABLE ONLY public.job_results ALTER COLUMN id SET DEFAULT nextval('public.job_results_id_seq'::regclass);
ALTER TABLE ONLY public.remediation_jobs ALTER COLUMN id SET DEFAULT nextval('public.remediation_jobs_id_seq'::regclass);
ALTER TABLE ONLY public.remediation_packages ALTER COLUMN id SET DEFAULT nextval('public.remediation_packages_id_seq'::regclass);
ALTER TABLE ONLY public.remediation_rules ALTER COLUMN id SET DEFAULT nextval('public.remediation_rules_id_seq'::regclass);
ALTER TABLE ONLY public.software_current ALTER COLUMN id SET DEFAULT nextval('public.software_current_id_seq'::regclass);
ALTER TABLE ONLY public.vulnerabilities ALTER COLUMN id SET DEFAULT nextval('public.vulnerabilities_id_seq'::regclass);
ALTER TABLE ONLY public.vulnerability_scans ALTER COLUMN id SET DEFAULT nextval('public.vulnerability_scans_id_seq'::regclass);
ALTER TABLE ONLY public.vulnerability_suppressions ALTER COLUMN id SET DEFAULT nextval('public.vulnerability_suppressions_id_seq'::regclass);
ALTER TABLE ONLY public.alert_rule_channels
    ADD CONSTRAINT alert_rule_channels_pkey PRIMARY KEY (rule_id, channel_id);
ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.browser_cookies_current
    ADD CONSTRAINT browser_cookies_current_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.browser_cookies
    ADD CONSTRAINT browser_cookies_node_id_username_browser_profile_domain_nam_key UNIQUE (node_id, username, browser, profile, domain, name);
ALTER TABLE ONLY public.browser_cookies
    ADD CONSTRAINT browser_cookies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.browser_current
    ADD CONSTRAINT browser_current_pkey PRIMARY KEY (node_id, browser, profile);
ALTER TABLE ONLY public.deployment_status
    ADD CONSTRAINT deployment_status_deployment_id_node_id_key UNIQUE (deployment_id, node_id);
ALTER TABLE ONLY public.deployment_status
    ADD CONSTRAINT deployment_status_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.deployments
    ADD CONSTRAINT deployments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.detection_rules
    ADD CONSTRAINT detection_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.device_groups
    ADD CONSTRAINT device_groups_pkey PRIMARY KEY (node_id, group_id);
ALTER TABLE ONLY public.device_tags
    ADD CONSTRAINT device_tags_pkey PRIMARY KEY (node_id, tag_id);
ALTER TABLE ONLY public.enrollment_tokens
    ADD CONSTRAINT enrollment_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.enrollment_tokens
    ADD CONSTRAINT enrollment_tokens_token_key UNIQUE (token);
ALTER TABLE ONLY public.eventlog_config
    ADD CONSTRAINT eventlog_config_node_id_log_name_key UNIQUE (node_id, log_name);
ALTER TABLE ONLY public.eventlog_config
    ADD CONSTRAINT eventlog_config_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.eventlog_entries
    ADD CONSTRAINT eventlog_entries_pkey PRIMARY KEY (id, collected_at);
ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_name_key UNIQUE (name);
ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.hardware_current
    ADD CONSTRAINT hardware_current_pkey PRIMARY KEY (node_id);
ALTER TABLE ONLY public.hotfixes_current
    ADD CONSTRAINT hotfixes_current_pkey PRIMARY KEY (node_id, kb_id);
ALTER TABLE ONLY public.job_assignments
    ADD CONSTRAINT job_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_instances
    ADD CONSTRAINT job_instances_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_results
    ADD CONSTRAINT job_results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maintenance_windows
    ADD CONSTRAINT maintenance_windows_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.network_current
    ADD CONSTRAINT network_current_pkey PRIMARY KEY (node_id);
ALTER TABLE ONLY public.node_health
    ADD CONSTRAINT node_health_pkey PRIMARY KEY (node_id);
ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_node_id_key UNIQUE (node_id);
ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.package_sources
    ADD CONSTRAINT package_sources_name_key UNIQUE (name);
ALTER TABLE ONLY public.package_sources
    ADD CONSTRAINT package_sources_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.package_version_sources
    ADD CONSTRAINT package_version_sources_package_version_id_source_id_key UNIQUE (package_version_id, source_id);
ALTER TABLE ONLY public.package_version_sources
    ADD CONSTRAINT package_version_sources_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.package_versions
    ADD CONSTRAINT package_versions_package_id_version_key UNIQUE (package_id, version);
ALTER TABLE ONLY public.package_versions
    ADD CONSTRAINT package_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_name_key UNIQUE (name);
ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.remediation_jobs
    ADD CONSTRAINT remediation_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.remediation_packages
    ADD CONSTRAINT remediation_packages_name_key UNIQUE (name);
ALTER TABLE ONLY public.remediation_packages
    ADD CONSTRAINT remediation_packages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.remediation_rules
    ADD CONSTRAINT remediation_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.security_current
    ADD CONSTRAINT security_current_pkey PRIMARY KEY (node_id);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.software_current
    ADD CONSTRAINT software_current_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.system_current
    ADD CONSTRAINT system_current_pkey PRIMARY KEY (node_id);
ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.update_history
    ADD CONSTRAINT update_history_pkey PRIMARY KEY (node_id, update_id);
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE ONLY public.vulnerabilities
    ADD CONSTRAINT vulnerabilities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vulnerabilities
    ADD CONSTRAINT vulnerabilities_software_name_software_version_cve_id_key UNIQUE (software_name, software_version, cve_id);
ALTER TABLE ONLY public.vulnerability_scans
    ADD CONSTRAINT vulnerability_scans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vulnerability_suppressions
    ADD CONSTRAINT vulnerability_suppressions_cve_id_software_name_key UNIQUE (cve_id, software_name);
ALTER TABLE ONLY public.vulnerability_suppressions
    ADD CONSTRAINT vulnerability_suppressions_pkey PRIMARY KEY (id);
CREATE INDEX eventlog_entries_collected_at_idx ON public.eventlog_entries USING btree (collected_at DESC);
CREATE INDEX hardware_changes_time_idx ON public.hardware_changes USING btree ("time" DESC);
CREATE INDEX idx_alerts_event_type ON public.alerts USING btree (event_type);
CREATE INDEX idx_alerts_fired_at ON public.alerts USING btree (fired_at DESC);
CREATE INDEX idx_alerts_node_id ON public.alerts USING btree (node_id);
CREATE INDEX idx_alerts_status ON public.alerts USING btree (status);
CREATE INDEX idx_api_keys_user ON public.api_keys USING btree (user_id);
CREATE INDEX idx_audit_log_timestamp ON public.audit_log USING btree ("timestamp" DESC);
CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_id);
CREATE INDEX idx_browser_cookies_domain ON public.browser_cookies USING btree (domain);
CREATE INDEX idx_browser_cookies_node ON public.browser_cookies USING btree (node_id);
CREATE INDEX idx_cookies_browser ON public.browser_cookies_current USING btree (browser);
CREATE INDEX idx_cookies_domain ON public.browser_cookies_current USING btree (domain);
CREATE INDEX idx_cookies_node ON public.browser_cookies_current USING btree (node_id);
CREATE INDEX idx_deployment_status_deployment ON public.deployment_status USING btree (deployment_id);
CREATE INDEX idx_deployment_status_node ON public.deployment_status USING btree (node_id);
CREATE INDEX idx_deployment_status_status ON public.deployment_status USING btree (status);
CREATE INDEX idx_deployments_package_version ON public.deployments USING btree (package_version_id);
CREATE INDEX idx_deployments_status ON public.deployments USING btree (status);
CREATE INDEX idx_detection_rules_version ON public.detection_rules USING btree (package_version_id);
CREATE INDEX idx_device_groups_group ON public.device_groups USING btree (group_id);
CREATE INDEX idx_device_groups_node ON public.device_groups USING btree (node_id);
CREATE INDEX idx_device_tags_node ON public.device_tags USING btree (node_id);
CREATE INDEX idx_device_tags_tag ON public.device_tags USING btree (tag_id);
CREATE INDEX idx_enrollment_tokens_active ON public.enrollment_tokens USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_enrollment_tokens_token ON public.enrollment_tokens USING btree (token);
CREATE INDEX idx_eventlog_event_id ON public.eventlog_entries USING btree (event_id);
CREATE INDEX idx_eventlog_level ON public.eventlog_entries USING btree (level) WHERE (level <= 2);
CREATE INDEX idx_eventlog_log_name ON public.eventlog_entries USING btree (log_name);
CREATE INDEX idx_eventlog_node_time ON public.eventlog_entries USING btree (node_id, collected_at DESC);
CREATE INDEX idx_groups_parent ON public.groups USING btree (parent_id);
CREATE INDEX idx_hardware_changes_node ON public.hardware_changes USING btree (node_id, "time" DESC);
CREATE INDEX idx_job_instances_job_id ON public.job_instances USING btree (job_id);
CREATE INDEX idx_job_instances_node_status ON public.job_instances USING btree (node_id, status);
CREATE INDEX idx_job_instances_queued_at ON public.job_instances USING btree (queued_at);
CREATE INDEX idx_job_logs_instance ON public.job_logs USING btree (instance_id, "timestamp");
CREATE INDEX idx_jobs_created_at ON public.jobs USING btree (created_at DESC);
CREATE INDEX idx_metrics_node ON public.node_metrics USING btree (node_id, "time" DESC);
CREATE INDEX idx_nodes_hostname ON public.nodes USING btree (hostname);
CREATE INDEX idx_nodes_is_online ON public.nodes USING btree (is_online);
CREATE INDEX idx_nodes_node_id ON public.nodes USING btree (node_id);
CREATE INDEX idx_package_versions_package ON public.package_versions USING btree (package_id);
CREATE INDEX idx_packages_category ON public.packages USING btree (category);
CREATE INDEX idx_packages_name ON public.packages USING btree (name);
CREATE INDEX idx_remediation_jobs_cve ON public.remediation_jobs USING btree (cve_id);
CREATE INDEX idx_remediation_jobs_node ON public.remediation_jobs USING btree (node_id);
CREATE INDEX idx_remediation_jobs_status ON public.remediation_jobs USING btree (status);
CREATE INDEX idx_remediation_packages_software ON public.remediation_packages USING btree (target_software);
CREATE INDEX idx_sessions_expires ON public.sessions USING btree (expires_at);
CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id);
CREATE INDEX idx_snapshots_node ON public.node_snapshots USING btree (node_id, "time" DESC);
CREATE INDEX idx_software_changes_node ON public.software_changes USING btree (node_id, "time" DESC);
CREATE INDEX idx_software_name ON public.software_current USING btree (name);
CREATE INDEX idx_software_node ON public.software_current USING btree (node_id);
CREATE INDEX idx_software_publisher ON public.software_current USING btree (publisher);
CREATE INDEX idx_update_history_node_date ON public.update_history USING btree (node_id, installed_on DESC);
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_vulnerabilities_cvss ON public.vulnerabilities USING btree (cvss_score DESC NULLS LAST);
CREATE INDEX idx_vulnerabilities_severity ON public.vulnerabilities USING btree (severity);
CREATE INDEX idx_vulnerabilities_software ON public.vulnerabilities USING btree (software_name, software_version);
CREATE INDEX node_metrics_time_idx ON public.node_metrics USING btree ("time" DESC);
CREATE INDEX node_snapshots_time_idx ON public.node_snapshots USING btree ("time" DESC);
CREATE INDEX software_changes_time_idx ON public.software_changes USING btree ("time" DESC);
ALTER TABLE ONLY public.alert_rule_channels
    ADD CONSTRAINT alert_rule_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.notification_channels(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.alert_rule_channels
    ADD CONSTRAINT alert_rule_channels_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.alert_rules(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.browser_cookies_current
    ADD CONSTRAINT browser_cookies_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.browser_cookies
    ADD CONSTRAINT browser_cookies_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.browser_current
    ADD CONSTRAINT browser_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deployment_status
    ADD CONSTRAINT deployment_status_deployment_id_fkey FOREIGN KEY (deployment_id) REFERENCES public.deployments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deployment_status
    ADD CONSTRAINT deployment_status_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deployments
    ADD CONSTRAINT deployments_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES public.package_versions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.detection_rules
    ADD CONSTRAINT detection_rules_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES public.package_versions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.device_groups
    ADD CONSTRAINT device_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.device_groups
    ADD CONSTRAINT device_groups_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.device_tags
    ADD CONSTRAINT device_tags_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.device_tags
    ADD CONSTRAINT device_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.eventlog_config
    ADD CONSTRAINT eventlog_config_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(node_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.eventlog_entries
    ADD CONSTRAINT eventlog_entries_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(node_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.groups(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.hardware_current
    ADD CONSTRAINT hardware_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.hotfixes_current
    ADD CONSTRAINT hotfixes_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_assignments
    ADD CONSTRAINT job_assignments_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_instances
    ADD CONSTRAINT job_instances_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.job_instances(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_results
    ADD CONSTRAINT job_results_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.network_current
    ADD CONSTRAINT network_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.node_health
    ADD CONSTRAINT node_health_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_version_sources
    ADD CONSTRAINT package_version_sources_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES public.package_versions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_version_sources
    ADD CONSTRAINT package_version_sources_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.package_sources(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.package_versions
    ADD CONSTRAINT package_versions_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.remediation_jobs
    ADD CONSTRAINT remediation_jobs_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id);
ALTER TABLE ONLY public.remediation_jobs
    ADD CONSTRAINT remediation_jobs_remediation_package_id_fkey FOREIGN KEY (remediation_package_id) REFERENCES public.remediation_packages(id);
ALTER TABLE ONLY public.remediation_jobs
    ADD CONSTRAINT remediation_jobs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.remediation_rules(id);
ALTER TABLE ONLY public.remediation_jobs
    ADD CONSTRAINT remediation_jobs_vulnerability_id_fkey FOREIGN KEY (vulnerability_id) REFERENCES public.vulnerabilities(id);
ALTER TABLE ONLY public.remediation_packages
    ADD CONSTRAINT remediation_packages_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(id);
ALTER TABLE ONLY public.security_current
    ADD CONSTRAINT security_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.software_current
    ADD CONSTRAINT software_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.system_current
    ADD CONSTRAINT system_current_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.update_history
    ADD CONSTRAINT update_history_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ============================================================================
-- E18: Service Orchestration Schema
-- ============================================================================

-- Service Classes define templates for services (e.g., nginx-webservice, postgresql-cluster)
CREATE TABLE public.service_classes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name character varying(100) NOT NULL UNIQUE,
    description text,
    -- Service type: single (1 node) or cluster (N nodes)
    service_type character varying(20) DEFAULT 'single' CHECK (service_type IN ('single', 'cluster')),
    -- Node requirements
    min_nodes integer DEFAULT 1,
    max_nodes integer DEFAULT 1,
    -- Available roles for this service class (JSON array)
    roles jsonb DEFAULT '["primary"]'::jsonb,
    -- Required packages to install (JSON array)
    required_packages jsonb DEFAULT '[]'::jsonb,
    -- Config template (Jinja2-style with variables)
    config_template text,
    -- Health check definition
    health_check jsonb DEFAULT '{"type": "tcp", "port": 80}'::jsonb,
    -- Drift policy: strict (auto-fix) or tolerant (alert-only)
    drift_policy character varying(20) DEFAULT 'strict' CHECK (drift_policy IN ('strict', 'tolerant')),
    -- Update strategy: rolling, one-by-one, all-at-once
    update_strategy character varying(20) DEFAULT 'rolling' CHECK (update_strategy IN ('rolling', 'one-by-one', 'all-at-once')),
    -- Metadata
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by character varying(100)
);

-- Services are instances of service classes
CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    class_id uuid NOT NULL REFERENCES public.service_classes(id) ON DELETE RESTRICT,
    name character varying(100) NOT NULL,
    description text,
    -- Service status: provisioning, healthy, degraded, failed, stopped
    status character varying(20) DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'healthy', 'degraded', 'failed', 'stopped')),
    -- Desired state version (incremented on config changes)
    desired_state_version integer DEFAULT 1,
    -- Current config values (variables for template)
    config_values jsonb DEFAULT '{}'::jsonb,
    -- Secrets reference (encrypted or vault path)
    secrets_ref text,
    -- Metadata
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by character varying(100),
    UNIQUE(name)
);

-- Service node assignments link services to nodes with roles
CREATE TABLE public.service_node_assignments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
    -- Role within the service (e.g., primary, replica, web-node)
    role character varying(50) DEFAULT 'primary',
    -- Assignment status: pending, provisioning, active, draining, removed
    status character varying(20) DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'draining', 'removed')),
    -- Last reconciliation
    last_reconciled_at timestamp with time zone,
    last_reconciled_version integer,
    -- Health status from last check
    health_status character varying(20) DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'unhealthy', 'unknown')),
    health_message text,
    -- Metadata
    assigned_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(service_id, node_id)
);

-- Service reconciliation history
CREATE TABLE public.service_reconciliation_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    node_id uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
    -- Action: provision, configure, health-check, drift-fix, scale-up, scale-down
    action character varying(50) NOT NULL,
    status character varying(20) NOT NULL CHECK (status IN ('started', 'success', 'failed', 'skipped')),
    -- Details
    message text,
    details jsonb,
    -- Timing
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    duration_ms integer
);

-- Indexes for E18
CREATE INDEX idx_services_class ON public.services(class_id);
CREATE INDEX idx_services_status ON public.services(status);
CREATE INDEX idx_service_node_assignments_service ON public.service_node_assignments(service_id);
CREATE INDEX idx_service_node_assignments_node ON public.service_node_assignments(node_id);
CREATE INDEX idx_service_reconciliation_log_service ON public.service_reconciliation_log(service_id);
CREATE INDEX idx_service_reconciliation_log_time ON public.service_reconciliation_log(started_at DESC);


-- E19: Alert System
CREATE TABLE IF NOT EXISTS alert_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    channel_type VARCHAR(20) NOT NULL, -- 'discord', 'telegram', 'email', 'webhook'
    config JSONB NOT NULL DEFAULT '{}', -- webhook_url, chat_id, etc.
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'node_offline', 'job_failed', 'disk_warning', 'vulnerability_critical'
    condition JSONB DEFAULT '{}', -- optional filters
    channel_id UUID REFERENCES alert_channels(id) ON DELETE CASCADE,
    cooldown_minutes INT DEFAULT 15, -- prevent spam
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
    channel_id UUID REFERENCES alert_channels(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed', 'throttled'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rules_event ON alert_rules(event_type);

-- TimescaleDB Hypertables (using legacy syntax for compatibility)
SELECT create_hypertable('node_metrics', 'time', if_not_exists => TRUE);
SELECT create_hypertable('hardware_changes', 'time', if_not_exists => TRUE);
-- eventlog_entries skipped: PK doesn't include event_time column

-- Done
