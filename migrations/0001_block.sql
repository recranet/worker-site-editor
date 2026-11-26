-- The site's texts (createEditor's `pages`), each as Portable Text JSON.
-- IF NOT EXISTS: sites made from worker-site-starter before this package
-- already have the table from their own 0001_block.sql.
CREATE TABLE IF NOT EXISTS block (
	page TEXT NOT NULL,
	name TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	PRIMARY KEY (page, name)
);
