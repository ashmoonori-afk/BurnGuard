-- A project restored from a portable bundle whose builtin design system is not installed keeps
-- the builtin identifier here, so a later export can still name it. It is never used as a pin.
ALTER TABLE projects ADD COLUMN missing_design_system_ref TEXT;
