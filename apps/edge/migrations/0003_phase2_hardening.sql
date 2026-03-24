CREATE TRIGGER IF NOT EXISTS trg_matches_channel_link_required_insert
BEFORE INSERT ON matches
FOR EACH ROW
WHEN NEW.channel_link_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'matches.channel_link_id is required');
END;

CREATE TRIGGER IF NOT EXISTS trg_matches_channel_link_required_update
BEFORE UPDATE ON matches
FOR EACH ROW
WHEN NEW.channel_link_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'matches.channel_link_id is required');
END;
