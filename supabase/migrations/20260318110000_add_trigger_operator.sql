ALTER TABLE automation_flows 
ADD COLUMN IF NOT EXISTS trigger_operator VARCHAR(3) DEFAULT 'OR' 
CHECK (trigger_operator IN ('OR', 'AND'));

UPDATE automation_flows SET trigger_operator = 'OR' WHERE trigger_operator IS NULL;
