-- Migration 025: Home Pace Board default segment
--
-- ops_home_default marks the role whose sequence leads the HOME page's Pace
-- Board. The board's full view lives on /operations; the home embed shows one
-- segment, and this flag lets an operator pick which one — a subordinate
-- setting under ops_visible on Role Detail. Single-holder: setting it on one
-- role clears it everywhere else in the same atomic statement. When no role
-- carries it, the home board falls back to the primary (first) segment.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS ops_home_default BOOLEAN NOT NULL DEFAULT false;
