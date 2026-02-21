-- ============================================
-- E19: PXE Zero-Touch Provisioning
-- ============================================

-- Platform types for provisioning
DO $$ BEGIN
    CREATE TYPE platform_type AS ENUM (
        'hyperv-gen2',
        'kvm-libvirt',
        'vmware',
        'baremetal-uefi',
        'baremetal-bios'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Provisioning task status
DO $$ BEGIN
    CREATE TYPE provisioning_status AS ENUM (
        'pending',      -- waiting for PXE boot
        'booting',      -- iPXE script fetched
        'imaging',      -- DISM running
        'configuring',  -- post-install
        'completed',    -- success
        'failed'        -- error
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- OS Images available for deployment
CREATE TABLE IF NOT EXISTS provisioning_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,           -- 'win2025-standard-desktop'
    display_name VARCHAR(255) NOT NULL,          -- 'Windows Server 2025 Standard (Desktop)'
    wim_path VARCHAR(500) NOT NULL,              -- '/images/win2025/install.wim'
    wim_index INT NOT NULL DEFAULT 1,            -- Index in WIM file
    os_type VARCHAR(50),                         -- 'windows-server', 'windows-client'
    os_version VARCHAR(50),                      -- '2025', '11', '10'
    edition VARCHAR(100),                        -- 'Standard', 'Datacenter', 'Pro'
    architecture VARCHAR(10) DEFAULT 'amd64',
    size_bytes BIGINT,
    checksum_sha256 VARCHAR(64),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform-specific templates
CREATE TABLE IF NOT EXISTS provisioning_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform platform_type UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    ipxe_template TEXT NOT NULL,                 -- iPXE script template with ${VAR} placeholders
    drivers JSONB DEFAULT '[]',                  -- Additional driver files to inject
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provisioning tasks
CREATE TABLE IF NOT EXISTS provisioning_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mac_address VARCHAR(17) UNIQUE NOT NULL,     -- '00:15:5D:00:23:02'
    hostname VARCHAR(63),                        -- Target hostname (auto-generated if empty)
    platform platform_type NOT NULL,
    image_id UUID REFERENCES provisioning_images(id),
    
    -- Network configuration
    use_dhcp BOOLEAN DEFAULT true,
    static_ip INET,
    subnet_mask VARCHAR(15) DEFAULT '255.255.255.0',
    gateway INET,
    dns_servers INET[] DEFAULT ARRAY['192.168.0.8'::INET],
    
    -- Domain join
    domain_name VARCHAR(255),
    domain_user VARCHAR(100),
    domain_password_encrypted BYTEA,             -- Encrypted with server key
    domain_ou VARCHAR(500),                      -- OU path for computer account
    
    -- Post-install options
    install_octofleet_agent BOOLEAN DEFAULT true,
    enable_rdp BOOLEAN DEFAULT true,
    admin_password_encrypted BYTEA,
    
    -- Status tracking
    status provisioning_status DEFAULT 'pending',
    status_message TEXT,
    current_step INT DEFAULT 0,
    total_steps INT DEFAULT 7,
    progress_percent INT DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Audit
    created_by UUID,
    node_id UUID REFERENCES nodes(id)            -- Linked node after completion
);

-- Provisioning event log
CREATE TABLE IF NOT EXISTS provisioning_events (
    id SERIAL PRIMARY KEY,
    task_id UUID REFERENCES provisioning_tasks(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,             -- 'ipxe_fetch', 'step_completed', 'error'
    step_number INT,
    message TEXT,
    details JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prov_tasks_mac ON provisioning_tasks(mac_address);
CREATE INDEX IF NOT EXISTS idx_prov_tasks_status ON provisioning_tasks(status);
CREATE INDEX IF NOT EXISTS idx_prov_tasks_created ON provisioning_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prov_events_task ON provisioning_events(task_id);
CREATE INDEX IF NOT EXISTS idx_prov_events_time ON provisioning_events(timestamp DESC);

-- Seed default images
INSERT INTO provisioning_images (name, display_name, wim_path, wim_index, os_type, os_version, edition)
VALUES 
    ('win2025-standard-core', 'Windows Server 2025 Standard (Core)', '/images/win2025/install.wim', 1, 'windows-server', '2025', 'Standard'),
    ('win2025-standard-desktop', 'Windows Server 2025 Standard (Desktop)', '/images/win2025/install.wim', 2, 'windows-server', '2025', 'Standard'),
    ('win2025-datacenter-core', 'Windows Server 2025 Datacenter (Core)', '/images/win2025/install.wim', 3, 'windows-server', '2025', 'Datacenter'),
    ('win2025-datacenter-desktop', 'Windows Server 2025 Datacenter (Desktop)', '/images/win2025/install.wim', 4, 'windows-server', '2025', 'Datacenter')
ON CONFLICT (name) DO NOTHING;

-- Seed platform templates
INSERT INTO provisioning_templates (platform, display_name, ipxe_template, drivers, notes)
VALUES 
    ('hyperv-gen2', 'Hyper-V Generation 2 (UEFI)', 
     E'#!ipxe\nkernel ${PXE_SERVER}/images/winpe/wimboot index=1\ninitrd ${PXE_SERVER}/scripts/winpeshl.ini      winpeshl.ini\ninitrd ${PXE_SERVER}/scripts/startnet-${MAC}.cmd startnet.cmd\ninitrd ${PXE_SERVER}/scripts/deploypart.txt    deploypart.txt\ninitrd ${PXE_SERVER}/scripts/curl.exe          curl.exe\ninitrd ${PXE_SERVER}/images/winpe/boot.wim     boot.wim\nboot',
     '[]'::jsonb,
     'Tested 2026-02-21. Gen1 NOT supported (wimboot bug).'),
    
    ('kvm-libvirt', 'KVM/QEMU (libvirt)', 
     E'#!ipxe\nkernel ${PXE_SERVER}/images/winpe/wimboot\ninitrd ${PXE_SERVER}/drivers/virtio/vioscsi.inf vioscsi.inf\ninitrd ${PXE_SERVER}/drivers/virtio/vioscsi.sys vioscsi.sys\ninitrd ${PXE_SERVER}/drivers/virtio/vioscsi.cat vioscsi.cat\ninitrd ${PXE_SERVER}/scripts/winpeshl.ini      winpeshl.ini\ninitrd ${PXE_SERVER}/scripts/startnet-${MAC}.cmd startnet.cmd\ninitrd ${PXE_SERVER}/scripts/deploypart.txt    deploypart.txt\ninitrd ${PXE_SERVER}/scripts/curl.exe          curl.exe\ninitrd ${PXE_SERVER}/images/winpe/boot.wim     boot.wim\nboot',
     '["vioscsi.inf", "vioscsi.sys", "vioscsi.cat"]'::jsonb,
     'Requires VirtIO SCSI drivers. Tested 2026-02-20.'),
    
    ('baremetal-uefi', 'Bare Metal (UEFI)', 
     E'#!ipxe\nkernel ${PXE_SERVER}/images/winpe/wimboot index=1\ninitrd ${PXE_SERVER}/scripts/winpeshl.ini      winpeshl.ini\ninitrd ${PXE_SERVER}/scripts/startnet-${MAC}.cmd startnet.cmd\ninitrd ${PXE_SERVER}/scripts/deploypart.txt    deploypart.txt\ninitrd ${PXE_SERVER}/scripts/curl.exe          curl.exe\ninitrd ${PXE_SERVER}/images/winpe/boot.wim     boot.wim\nboot',
     '[]'::jsonb,
     'May require additional storage/NIC drivers depending on hardware.')
ON CONFLICT (platform) DO NOTHING;
