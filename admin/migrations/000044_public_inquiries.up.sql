SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_inquiries (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    source_type VARCHAR(32) NOT NULL DEFAULT 'website',
    product_id BIGINT NULL REFERENCES cms_content_entries(id) ON DELETE SET NULL,
    product_slug VARCHAR(255) NOT NULL DEFAULT '',
    product_title VARCHAR(512) NOT NULL DEFAULT '',
    page_url TEXT NOT NULL DEFAULT '',
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(128) NOT NULL DEFAULT '',
    company VARCHAR(255) NOT NULL DEFAULT '',
    country VARCHAR(128) NOT NULL DEFAULT '',
    requested_quantity VARCHAR(128) NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_inquiries_site_created_at ON cms_inquiries(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_inquiries_product_slug ON cms_inquiries(site_id, product_slug);
CREATE INDEX IF NOT EXISTS idx_cms_inquiries_status ON cms_inquiries(site_id, status, created_at DESC);