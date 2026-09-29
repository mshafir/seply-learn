-- WP-2.6 search (spec §2.8). Hand-written (drizzle-kit generate --custom):
-- the search columns are maintained by triggers, so they are not in
-- @umbel/domain's Drizzle schema, and nothing but search reads them.
--
-- Concepts: title + aliases A, summary B, overview C, article sections D.
-- Expeditions: title A, summary B. `search_title` (title and aliases) and
-- expeditions.title carry pg_trgm indexes for fuzzy title matches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "expeditions" ADD COLUMN "search" tsvector;
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "search" tsvector;
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "search_title" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE FUNCTION umbel_expedition_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER expeditions_search BEFORE INSERT OR UPDATE OF title, summary
  ON "expeditions" FOR EACH ROW EXECUTE FUNCTION umbel_expedition_search();
--> statement-breakpoint
-- A Concept's whole vector, articles included (read from article_sections).
CREATE FUNCTION umbel_concept_tsvector(
  exp text, cid text, search_title text, summary text, overview text
) RETURNS tsvector LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(search_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(overview, '')), 'C') ||
    setweight(to_tsvector('english', coalesce((
      SELECT string_agg(s.heading || E'\n' || s.md, E'\n' ORDER BY s.order_key)
      FROM article_sections s
      WHERE s.expedition_id = exp AND s.concept_id = cid AND s.deleted_at IS NULL
    ), '')), 'D')
$$;
--> statement-breakpoint
CREATE FUNCTION umbel_concept_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_title := btrim(NEW.title || ' ' || array_to_string(NEW.aliases, ' '));
  NEW.search := umbel_concept_tsvector(
    NEW.expedition_id, NEW.id, NEW.search_title, NEW.summary, NEW.overview
  );
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER concepts_search BEFORE INSERT OR UPDATE OF title, aliases, summary, overview
  ON "concepts" FOR EACH ROW EXECUTE FUNCTION umbel_concept_search();
--> statement-breakpoint
-- An article section's edit re-indexes its Concept.
CREATE FUNCTION umbel_article_section_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE concepts c
      SET search = umbel_concept_tsvector(c.expedition_id, c.id, c.search_title, c.summary, c.overview)
      WHERE c.expedition_id = OLD.expedition_id AND c.id = OLD.concept_id;
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.concept_id IS DISTINCT FROM OLD.concept_id) THEN
    UPDATE concepts c
      SET search = umbel_concept_tsvector(c.expedition_id, c.id, c.search_title, c.summary, c.overview)
      WHERE c.expedition_id = NEW.expedition_id AND c.id = NEW.concept_id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER article_sections_search AFTER INSERT OR UPDATE OR DELETE
  ON "article_sections" FOR EACH ROW EXECUTE FUNCTION umbel_article_section_search();
--> statement-breakpoint
-- Existing rows (the triggers fire on these no-op updates).
UPDATE "expeditions" SET "title" = "title";
--> statement-breakpoint
UPDATE "concepts" SET "title" = "title";
--> statement-breakpoint
CREATE INDEX "expeditions_search_idx" ON "expeditions" USING gin ("search");
--> statement-breakpoint
CREATE INDEX "expeditions_title_trgm_idx" ON "expeditions" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "concepts_search_idx" ON "concepts" USING gin ("search");
--> statement-breakpoint
CREATE INDEX "concepts_search_title_trgm_idx" ON "concepts" USING gin ("search_title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "concept_tags_lower_tag_idx" ON "concept_tags" USING btree (lower("tag") text_pattern_ops);
--> statement-breakpoint
CREATE INDEX "expedition_tags_lower_tag_idx" ON "expedition_tags" USING btree (lower("tag") text_pattern_ops);
