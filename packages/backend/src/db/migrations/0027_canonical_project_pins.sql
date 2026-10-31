ALTER TABLE project_design_system_pins ADD COLUMN format TEXT CHECK (format IS NULL OR format = 'canonical-v1');
