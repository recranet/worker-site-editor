-- A collection's items (createEditor's `collections`): projects, news, ...
-- The id never changes and keys the item's texts in `block` (page
-- "item:<collection>:<id>"); the slug is the item's URL and the customer
-- may change it. `fields` is the item's field values as JSON.
CREATE TABLE item (
	collection TEXT NOT NULL,
	id TEXT NOT NULL,
	slug TEXT NOT NULL,
	title TEXT NOT NULL,
	position INTEGER NOT NULL,
	fields TEXT NOT NULL DEFAULT '{}',
	published INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	PRIMARY KEY (collection, id),
	UNIQUE (collection, slug)
);
CREATE INDEX item_position ON item (collection, position);

-- A page's field values (a page's `fields` in createEditor's `pages`), as
-- one JSON object per page.
CREATE TABLE page_fields (
	page TEXT NOT NULL PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL
);
