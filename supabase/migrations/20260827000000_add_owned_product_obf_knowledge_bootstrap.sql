-- OBF bootstrap was removed before this migration was deployed anywhere.
-- Keep this version as a no-op so linked projects record the historical
-- migration sequence without creating obsolete private tables.
select 1;
